/**
 * layers.js — Layer management
 * Each layer corresponds to a Fabric.js object (Image or Group).
 * We maintain a parallel `_layers` array that tracks metadata.
 */

import { bus } from './app.js';

let _layerIdCounter = 1;

export class LayerManager {
  constructor(editor, appState) {
    this._editor = editor;
    this._app    = appState;
    this._layers = []; // [{id, name, fabricObj, visible, locked, isTemplate}]
    this._activeIdx = 0;
  }

  /* ── Initialise: create one empty base layer ─────── */
  init() {
    // Clear canvas objects
    this._editor.canvas.clear();
    this._layers = [];
    this.addEmpty('Base');
    this._render();
  }

  /* ── Add a blank raster layer ────────────────────── */
  addEmpty(name) {
    const id   = _layerIdCounter++;
    name = name || `Capa ${id}`;

    // Create an off-screen canvas to act as this layer's bitmap
    const offscreen = document.createElement('canvas');
    offscreen.width  = this._app.canvasW;
    offscreen.height = this._app.canvasH;

    const imgEl = new Image();
    imgEl.src = offscreen.toDataURL();

    const fabricImg = new fabric.Image(offscreen, {
      left: 0, top: 0,
      selectable: false, evented: false,
      opacity: 1,
      globalCompositeOperation: 'source-over',
    });
    fabricImg._layerId   = id;
    fabricImg._layerName = name;

    this._editor.canvas.add(fabricImg);
    this._editor.canvas.renderAll();

    const layerData = {
      id, name,
      fabricObj:  fabricImg,
      offscreen,
      visible:    true,
      locked:     false,
      isTemplate: false,
      blendMode:  'source-over',
      opacity:    1,
    };
    this._layers.push(layerData);
    this._activeIdx = this._layers.length - 1;
    this._render();
    bus.emit('layer-changed');
    return layerData;
  }

  /* ── Add image as a new layer ─────────────────────── */
  addImageLayer(htmlImageOrCanvas, name, isTemplate = false) {
    const id = _layerIdCounter++;
    name = name || (isTemplate ? 'Plantilla UV' : `Imagen ${id}`);

    // Use Fabric.Image from element
    const fImg = new fabric.Image(htmlImageOrCanvas, {
      left:    0,
      top:     0,
      scaleX:  this._app.canvasW / htmlImageOrCanvas.width,
      scaleY:  this._app.canvasH / htmlImageOrCanvas.height,
      selectable: !isTemplate,
      evented:    !isTemplate,
      opacity: isTemplate ? 0.45 : 1,
      globalCompositeOperation: 'source-over',
    });
    fImg._layerId    = id;
    fImg._layerName  = name;
    fImg._isTemplate = isTemplate;

    this._editor.canvas.add(fImg);
    // Move template to bottom
    if (isTemplate) this._editor.canvas.sendToBack(fImg);
    this._editor.canvas.renderAll();

    const layerData = {
      id, name,
      fabricObj:  fImg,
      offscreen:  null,
      visible:    true,
      locked:     isTemplate,
      isTemplate,
      blendMode:  'source-over',
      opacity:    isTemplate ? 0.45 : 1,
    };
    if (isTemplate) {
      this._layers.unshift(layerData);
      this._activeIdx = 1;
    } else {
      this._layers.push(layerData);
      this._activeIdx = this._layers.length - 1;
    }

    this._render();
    this._editor._saveState();
    bus.emit('canvas-changed');
    bus.emit('layer-changed');
    return layerData;
  }

  /* ── Add any Fabric object as a layer ─────────────── */
  addFabricObjectLayer(obj, name) {
    const id = _layerIdCounter++;
    name = name || `Objeto ${id}`;
    obj._layerId   = id;
    obj._layerName = name;
    this._editor.canvas.add(obj);
    this._editor.canvas.renderAll();
    const layerData = {
      id, name,
      fabricObj: obj,
      offscreen: null,
      visible: true, locked: false, isTemplate: false,
      blendMode: 'source-over', opacity: 1,
    };
    this._layers.push(layerData);
    this._activeIdx = this._layers.length - 1;
    this._render();
    this._editor._saveState();
    bus.emit('canvas-changed');
    bus.emit('layer-changed');
    return layerData;
  }

  /* ── Get active layer ────────────────────────────── */
  getActive() {
    return this._layers[this._activeIdx] ?? null;
  }

  setActive(idx) {
    if (idx < 0 || idx >= this._layers.length) return;
    this._activeIdx = idx;
    // Select the fabric object
    const layer = this._layers[idx];
    if (layer && !layer.locked && layer.fabricObj) {
      // Don't select if locked
    }
    this._render();
    bus.emit('layer-changed');
  }

  /* ── Layer operations ────────────────────────────── */

  duplicateActive() {
    const src = this.getActive();
    if (!src) return;
    src.fabricObj.clone(cloned => {
      const id   = _layerIdCounter++;
      const name = src.name + ' (copia)';
      cloned._layerId   = id;
      cloned._layerName = name;
      cloned.opacity    = src.opacity;
      cloned.globalCompositeOperation = src.blendMode;
      this._editor.canvas.add(cloned);
      this._editor.canvas.renderAll();
      const layerData = {
        id, name,
        fabricObj: cloned,
        offscreen: null,
        visible:   true, locked: false, isTemplate: false,
        blendMode: src.blendMode, opacity: src.opacity,
      };
      const insertAt = this._activeIdx + 1;
      this._layers.splice(insertAt, 0, layerData);
      this._activeIdx = insertAt;
      this._render();
      this._editor._saveState();
      bus.emit('canvas-changed');
      bus.emit('layer-changed');
    });
  }

  deleteActive() {
    if (this._layers.length <= 1) return; // keep at least 1
    const layer = this.getActive();
    if (!layer) return;
    if (layer.isTemplate && !confirm('¿Eliminar la capa de plantilla UV?')) return;
    this._editor.canvas.remove(layer.fabricObj);
    this._editor.canvas.renderAll();
    this._layers.splice(this._activeIdx, 1);
    this._activeIdx = Math.min(this._activeIdx, this._layers.length - 1);
    this._render();
    this._editor._saveState();
    bus.emit('canvas-changed');
    bus.emit('layer-changed');
  }

  mergeDown() {
    const idx = this._activeIdx;
    if (idx === 0) return;
    // Flatten current layer onto the one below
    const top    = this._layers[idx];
    const bottom = this._layers[idx - 1];

    // Use a temporary canvas to composite
    const temp = document.createElement('canvas');
    temp.width  = this._app.canvasW;
    temp.height = this._app.canvasH;
    const ctx   = temp.getContext('2d');

    // Draw bottom then top
    ctx.drawImage(getFabricCanvas(bottom.fabricObj, this._app), 0, 0);
    ctx.globalCompositeOperation = top.blendMode ?? 'source-over';
    ctx.globalAlpha = top.opacity ?? 1;
    ctx.drawImage(getFabricCanvas(top.fabricObj, this._app), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Replace bottom with merged result
    const merged = new fabric.Image(temp, {
      left: 0, top: 0,
      scaleX: 1, scaleY: 1,
      selectable: false, evented: false,
      opacity: 1, globalCompositeOperation: 'source-over',
    });
    merged._layerId   = bottom.id;
    merged._layerName = bottom.name;

    const zidx = this._editor.canvas.getObjects().indexOf(bottom.fabricObj);
    this._editor.canvas.remove(bottom.fabricObj);
    this._editor.canvas.remove(top.fabricObj);
    this._editor.canvas.insertAt(merged, zidx, false);
    this._editor.canvas.renderAll();

    this._layers[idx-1] = { ...bottom, fabricObj: merged };
    this._layers.splice(idx, 1);
    this._activeIdx = idx - 1;
    this._render();
    this._editor._saveState();
    bus.emit('canvas-changed');
    bus.emit('layer-changed');
  }

  setActiveBlendMode(mode) {
    const layer = this.getActive();
    if (!layer) return;
    layer.blendMode = mode;
    layer.fabricObj.globalCompositeOperation = mode;
    this._editor.canvas.renderAll();
    bus.emit('canvas-changed');
  }

  setActiveOpacity(val) {
    const layer = this.getActive();
    if (!layer) return;
    layer.opacity = val;
    layer.fabricObj.opacity = val;
    this._editor.canvas.renderAll();
    bus.emit('canvas-changed');
  }

  toggleVisibility(idx) {
    const layer = this._layers[idx];
    if (!layer) return;
    layer.visible = !layer.visible;
    layer.fabricObj.visible = layer.visible;
    this._editor.canvas.renderAll();
    this._render();
    bus.emit('canvas-changed');
  }

  renameActive() {
    const layer = this.getActive();
    if (!layer) return;
    const el = document.querySelector(`.layer-item[data-index="${this._activeIdx}"] .layer-name`);
    if (!el) return;
    el.contentEditable = 'true';
    el.focus();
    el.classList.add('editing');
    el.addEventListener('blur', () => {
      layer.name = el.textContent.trim() || layer.name;
      el.contentEditable = 'false';
      el.classList.remove('editing');
      this._render();
    }, { once: true });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  }

  /* ── Reorder layers (drag-drop) ──────────────────── */
  moveLayer(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const [moved] = this._layers.splice(fromIdx, 1);
    this._layers.splice(toIdx, 0, moved);
    // Sync Fabric z-order
    this._syncFabricOrder();
    this._activeIdx = toIdx;
    this._render();
    this._editor._saveState();
    bus.emit('canvas-changed');
    bus.emit('layer-changed');
  }

  _syncFabricOrder() {
    this._layers.forEach((layer, i) => {
      this._editor.canvas.moveTo(layer.fabricObj, i);
    });
    this._editor.canvas.renderAll();
  }

  /* ── Thumbnail refresh ───────────────────────────── */
  refreshThumbnails() {
    this._layers.forEach((layer, i) => {
      const el = document.querySelector(`.layer-item[data-index="${i}"] .layer-thumb`);
      if (!el) return;
      const mini = layer.fabricObj.toDataURL ? layer.fabricObj.toDataURL({ format: 'png', multiplier: 28 / this._app.canvasW }) : null;
      if (mini) {
        el.style.backgroundImage = `url(${mini})`;
        el.style.backgroundSize  = 'cover';
      }
    });
  }

  /* ── Render layer list UI ────────────────────────── */
  _render() {
    const list = document.getElementById('layers-list');
    if (!list) return;

    // Render in reverse order (top layer = top of UI list)
    const reversed = [...this._layers].reverse();
    list.innerHTML = reversed.map((layer, revIdx) => {
      const realIdx = this._layers.length - 1 - revIdx;
      const isActive = realIdx === this._activeIdx;
      const visIcon  = layer.visible ? '👁' : '🚫';
      const lockIcon = layer.locked  ? '🔒' : '🔓';
      const templateMark = layer.isTemplate ? ' template-layer' : '';

      return `
        <div class="layer-item${isActive ? ' active' : ''}${templateMark}"
             data-index="${realIdx}"
             draggable="true">
          <span class="layer-vis${layer.visible ? '' : ' hidden'}"
                data-vis-idx="${realIdx}" title="Mostrar/ocultar">${visIcon}</span>
          <div class="layer-thumb checker-bg"
               style="background-image:none"
               data-thumb-idx="${realIdx}"></div>
          <span class="layer-name">${escHtml(layer.name)}</span>
          <span class="layer-lock${layer.locked ? ' locked' : ''}"
                data-lock-idx="${realIdx}" title="Bloquear/desbloquear">${lockIcon}</span>
        </div>
      `;
    }).join('');

    // Events: click to select
    list.querySelectorAll('.layer-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.dataset.visIdx !== undefined) return;
        if (e.target.dataset.lockIdx !== undefined) return;
        this.setActive(parseInt(item.dataset.index));
      });
      item.addEventListener('dblclick', () => this.renameActive());
    });

    // Toggle visibility
    list.querySelectorAll('[data-vis-idx]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleVisibility(parseInt(el.dataset.visIdx));
      });
    });

    // Toggle lock
    list.querySelectorAll('[data-lock-idx]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.lockIdx);
        this._layers[idx].locked = !this._layers[idx].locked;
        this._render();
      });
    });

    // Drag-and-drop reorder
    this._setupDragDrop(list);

    // Refresh thumbnails after render
    requestAnimationFrame(() => this.refreshThumbnails());

    // Sync layer controls
    bus.emit('layer-changed');
  }

  _setupDragDrop(list) {
    let dragIdx = null;
    list.querySelectorAll('.layer-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        dragIdx = parseInt(item.dataset.index);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        list.querySelectorAll('.layer-item').forEach(i => {
          i.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        const rect   = item.getBoundingClientRect();
        const isTop  = e.clientY < rect.top + rect.height / 2;
        item.classList.toggle('drag-over-top',    isTop);
        item.classList.toggle('drag-over-bottom', !isTop);
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      item.addEventListener('drop', e => {
        e.preventDefault();
        if (dragIdx === null) return;
        const toIdx  = parseInt(item.dataset.index);
        const rect   = item.getBoundingClientRect();
        const isTop  = e.clientY < rect.top + rect.height / 2;
        const target = isTop ? toIdx : toIdx + 1;
        this.moveLayer(dragIdx, target > dragIdx ? target - 1 : target);
        dragIdx = null;
      });
    });
  }
}

/* ── Helpers ──────────────────────────────────────── */

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getFabricCanvas(fabricObj, app) {
  // Render a single fabric object to a temp canvas
  const tmp = document.createElement('canvas');
  tmp.width  = app.canvasW;
  tmp.height = app.canvasH;
  const ctx  = tmp.getContext('2d');
  if (fabricObj.getElement) {
    ctx.drawImage(fabricObj.getElement(), 0, 0, app.canvasW, app.canvasH);
  }
  return tmp;
}
