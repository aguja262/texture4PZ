/**
 * editor.js — Fabric.js canvas wrapper
 * Handles canvas init, zoom/pan, undo/redo, overlay (grid/pixel grid),
 * and exposes helpers for other modules.
 */

import { bus, APP } from './app.js';

export class Editor {
  /**
   * @param {string} canvasId - ID of the <canvas> element
   * @param {object} appState - Shared APP state object
   */
  constructor(canvasId, appState) {
    this._app = appState;
    this._undoStack = [];
    this._redoStack = [];
    this._maxUndo   = 40;
    this._isRestoring = false;
    this._drawingShape = false;
    this._shapeOrigin  = null;
    this._activeShapeObj = null;

    /* Fabric.js canvas */
    this.canvas = new fabric.Canvas(canvasId, {
      width:               appState.canvasW,
      height:              appState.canvasH,
      selection:           true,
      preserveObjectStacking: true,
      enableRetinaScaling: false,
      backgroundColor:     null,
    });

    /* Overlay canvas for grid */
    this._overlay = document.getElementById('overlay-canvas');
    this._overlayCtx = this._overlay.getContext('2d');
    this._overlay.width  = appState.canvasW;
    this._overlay.height = appState.canvasH;

    /* Zoom / pan */
    this._container = document.getElementById('canvas-container');
    this._wrapper   = document.getElementById('canvas-wrapper');

    this._setupEvents();
    this._saveState(); // initial state
    this.drawOverlay();
  }

  /* ── Public API ──────────────────────────────────── */

  resize(w, h, transparent = true) {
    this._app.canvasW = w;
    this._app.canvasH = h;
    this.canvas.setWidth(w);
    this.canvas.setHeight(h);
    this._overlay.width  = w;
    this._overlay.height = h;
    if (!transparent) {
      this.canvas.setBackgroundColor('#ffffff', () => this.canvas.renderAll());
    } else {
      this.canvas.setBackgroundColor(null, () => this.canvas.renderAll());
    }
    this._undoStack = [];
    this._redoStack = [];
    this._saveState();
    this.fitToScreen();
    bus.emit('canvas-changed');
  }

  /** Fit canvas to available viewport */
  fitToScreen() {
    const wrapper = this._wrapper;
    const pad = 40;
    const maxW = wrapper.clientWidth  - pad;
    const maxH = wrapper.clientHeight - pad;
    const scale = Math.min(maxW / this._app.canvasW, maxH / this._app.canvasH, 1);
    this.setZoom(scale);
  }

  setZoom(z) {
    z = Math.max(0.05, Math.min(32, z));
    APP.zoom = z;
    this._container.style.transform = `scale(${z})`;
    // Adjust wrapper scroll area via width/height hints
    const w = this._app.canvasW * z;
    const h = this._app.canvasH * z;
    this._container.style.width  = this._app.canvasW + 'px';
    this._container.style.height = this._app.canvasH + 'px';
    this._wrapper.style.setProperty('--content-w', w + 'px');
    this._wrapper.style.setProperty('--content-h', h + 'px');
    bus.emit('zoom-changed', z);
    document.getElementById('zoom-display').textContent = Math.round(z * 100) + '%';
  }

  /** Get all Fabric objects as a flat array (bottom-to-top) */
  getAllObjects() {
    return this.canvas.getObjects();
  }

  getActiveObject() {
    return this.canvas.getActiveObject();
  }

  deleteSelected() {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    if (obj.type === 'activeSelection') {
      obj.getObjects().forEach(o => this.canvas.remove(o));
      this.canvas.discardActiveObject();
    } else {
      this.canvas.remove(obj);
    }
    this.canvas.renderAll();
    this._saveState();
    bus.emit('canvas-changed');
  }

  cancelAction() {
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    // If drawing shape, cancel
    if (this._drawingShape && this._activeShapeObj) {
      this.canvas.remove(this._activeShapeObj);
      this._activeShapeObj = null;
      this._drawingShape = false;
      this.canvas.renderAll();
    }
  }

  /* ── Drawing helpers (for tools.js) ─────────────── */

  setBrushMode(color, size, opacity, hardness, blendMode) {
    this.canvas.isDrawingMode = true;
    const brush = new fabric.PencilBrush(this.canvas);
    brush.color   = color;
    brush.width   = size;
    brush.globalCompositeOperation = blendMode || 'source-over';
    this.canvas.freeDrawingBrush = brush;
    this.canvas.freeDrawingBrush.color = hexAlphaToRgba(color, opacity / 100);
  }

  setEraserMode(size) {
    this.canvas.isDrawingMode = true;
    // Use a white brush in destination-out mode
    const brush = new fabric.PencilBrush(this.canvas);
    brush.color  = 'rgba(0,0,0,1)';
    brush.width  = size;
    brush.globalCompositeOperation = 'destination-out';
    this.canvas.freeDrawingBrush = brush;
  }

  setSelectMode() {
    this.canvas.isDrawingMode = false;
    this.canvas.selection     = true;
  }

  disableDrawing() {
    this.canvas.isDrawingMode = false;
    this.canvas.selection     = false;
  }

  /** Export canvas to data URL (optionally excluding certain objects) */
  toDataURL({ format = 'png', quality = 1, multiplier = 1, excludeLayerIds = [] } = {}) {
    // Temporarily hide excluded objects
    const objs = this.canvas.getObjects();
    const hidden = [];
    objs.forEach(o => {
      if (excludeLayerIds.includes(o._layerId)) {
        if (o.visible) { o.visible = false; hidden.push(o); }
      }
    });
    this.canvas.renderAll();
    const url = this.canvas.toDataURL({ format, quality, multiplier });
    hidden.forEach(o => { o.visible = true; });
    this.canvas.renderAll();
    return url;
  }

  /* ── Undo / redo ─────────────────────────────────── */

  _saveState() {
    if (this._isRestoring) return;
    const json = JSON.stringify(this.canvas.toJSON(['_layerId', '_layerName', '_isTemplate', '_locked']));
    this._undoStack.push(json);
    if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
    this._redoStack = [];
    bus.emit('undo-stack-changed');
  }

  canUndo() { return this._undoStack.length > 1; }
  canRedo() { return this._redoStack.length > 0; }

  undo() {
    if (!this.canUndo()) return;
    const current = this._undoStack.pop();
    this._redoStack.push(current);
    this._loadState(this._undoStack[this._undoStack.length - 1]);
  }

  redo() {
    if (!this.canRedo()) return;
    const state = this._redoStack.pop();
    this._undoStack.push(state);
    this._loadState(state);
  }

  _loadState(json) {
    this._isRestoring = true;
    this.canvas.loadFromJSON(json, () => {
      this.canvas.renderAll();
      this._isRestoring = false;
      bus.emit('canvas-changed');
      bus.emit('layer-changed');
    });
  }

  /* ── Overlay (grid / pixel grid) ─────────────────── */

  drawOverlay() {
    const ctx = this._overlayCtx;
    const w   = this._app.canvasW;
    const h   = this._app.canvasH;
    ctx.clearRect(0, 0, w, h);

    if (APP.gridVisible) {
      const step = 64;
      ctx.strokeStyle = 'rgba(122,171,69,0.2)';
      ctx.lineWidth   = 0.5;
      for (let x = 0; x <= w; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }

    if (APP.pixelGridVisible && APP.zoom >= 4) {
      const pixSize = parseInt(document.getElementById('pixel-size')?.value ?? 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth   = 0.5;
      for (let x = 0; x <= w; x += pixSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y <= h; y += pixSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }
  }

  /* ── Mouse position helper ───────────────────────── */

  /** Convert mouse event → canvas pixel coords */
  eventToCanvas(e) {
    const rect = this.canvas.getElement().getBoundingClientRect();
    const z    = APP.zoom;
    return {
      x: (e.clientX - rect.left) / z,
      y: (e.clientY - rect.top)  / z,
    };
  }

  /* ── Internal event setup ────────────────────────── */

  _setupEvents() {
    /* Save state after each drawing path */
    this.canvas.on('path:created', () => {
      this._saveState();
      bus.emit('canvas-changed');
    });

    /* Object modified (moved, scaled, rotated) */
    this.canvas.on('object:modified', () => {
      this._saveState();
      bus.emit('canvas-changed');
    });

    /* Track cursor for status bar */
    this.canvas.on('mouse:move', ({ e }) => {
      const pt = this.canvas.getPointer(e);
      const x = Math.floor(pt.x);
      const y = Math.floor(pt.y);
      document.getElementById('cursor-pos').textContent = `${x}, ${y}`;
      // Sample color
      try {
        const ctx = this.canvas.getContext();
        const px  = ctx.getImageData(x, y, 1, 1).data;
        const hex = rgbToHex(px[0], px[1], px[2]);
        document.getElementById('color-preview-dot').style.background = hex;
        document.getElementById('color-preview-hex').textContent = hex;
      } catch(_) {}
    });

    /* Zoom via Ctrl+wheel */
    this._wrapper.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.85 : 1.18;
      this.setZoom(APP.zoom * delta);
    }, { passive: false });
  }
}

/* ── Utilities ──────────────────────────────────────── */

function hexAlphaToRgba(hex, alpha = 1) {
  if (!hex || hex.length < 7) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}
