/**
 * tools.js — ToolManager
 * - Herramientas de pintura
 * - Selección rectangular tipo marquee (arrastrar para seleccionar)
 * - Crop: recorta la capa activa a la región seleccionada
 */

import { bus, APP } from './app.js';

export class ToolManager {
  constructor(editor, layers, appState) {
    this._editor  = editor;
    this._layers  = layers;
    this._app     = appState;
    this._current = 'select';
    this._pixelMode = false;

    // Estado shape drawing
    this._drawing    = false;
    this._origin     = { x: 0, y: 0 };
    this._tempShape  = null;

    // Estado selección rectangular (crop / marquee)
    this._selActive  = false;
    this._selStart   = null;
    this._selEnd     = null;
    this._selBounds  = null; // { x, y, w, h }

    // Texto
    this._textBold      = false;
    this._textItalic    = false;
    this._textUnderline = false;

    this._bindToolButtons();
    this._bindToolOptions();
    this._bindCanvasEvents();
    this.setTool('select');
  }

  /* ── Selección actual ─────────────────────────────── */
  getSelection() { return this._selBounds; }
  clearSelection() {
    this._selBounds = this._selStart = this._selEnd = null;
    this._selActive = false;
    this._redrawOverlay();
    this._hideCropBar();
  }

  /* ── Tool selection ───────────────────────────────── */

  setTool(name) {
    this._current = name;

    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === name);
    });

    const groups = ['brush-options','eraser-options','text-options',
                    'pixel-options','fill-options','shape-options'];
    groups.forEach(id => document.getElementById(id)?.classList.add('hidden'));

    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.className = `tool-${name}`;

    // Limpiar selección al cambiar de herramienta (excepto crop)
    if (name !== 'crop') this.clearSelection();

    switch (name) {
      case 'brush':
        document.getElementById('brush-options').classList.remove('hidden');
        this._activateBrush();
        break;
      case 'pixel-paint':
        document.getElementById('pixel-options').classList.remove('hidden');
        this._editor.disableDrawing();
        break;
      case 'eraser':
        document.getElementById('eraser-options').classList.remove('hidden');
        this._activateEraser();
        break;
      case 'fill':
        document.getElementById('fill-options').classList.remove('hidden');
        this._editor.disableDrawing();
        break;
      case 'text':
        document.getElementById('text-options').classList.remove('hidden');
        this._editor.disableDrawing();
        break;
      case 'rect':
      case 'ellipse':
      case 'line':
        document.getElementById('shape-options').classList.remove('hidden');
        this._editor.disableDrawing();
        break;
      case 'crop':
        this._editor.disableDrawing();
        this._setStatus('Arrastra para seleccionar el área a recortar');
        break;
      case 'eyedropper':
        this._editor.disableDrawing();
        break;
      case 'select':
        this._editor.setSelectMode();
        break;
      default:
        this._editor.disableDrawing();
    }
  }

  setPixelMode(on) { this._pixelMode = on; }

  /* ── Activar herramientas de dibujo ───────────────── */

  _activateBrush() {
    const size      = parseInt(document.getElementById('brush-size').value);
    const opacity   = parseInt(document.getElementById('brush-opacity').value);
    const blendMode = document.getElementById('brush-blend-mode').value;
    this._editor.setBrushMode(APP.primaryColor, size, opacity, 80, blendMode);
  }

  _activateEraser() {
    const size = parseInt(document.getElementById('eraser-size').value);
    this._editor.setEraserMode(size);
  }

  /* ── Eventos del canvas ───────────────────────────── */

  _bindCanvasEvents() {
    const canvas = this._editor.canvas;
    canvas.on('mouse:down', e => this._onMouseDown(e));
    canvas.on('mouse:move', e => this._onMouseMove(e));
    canvas.on('mouse:up',   e => this._onMouseUp(e));
  }

  _onMouseDown(e) {
    const pt = this._editor.canvas.getPointer(e.e);
    const x = pt.x, y = pt.y;

    switch (this._current) {
      case 'fill':        this._doFill(x, y); break;
      case 'eyedropper':  this._doEyedropper(x, y); break;
      case 'text':        this._doAddText(x, y); break;
      case 'pixel-paint': this._doPixelPaint(x, y); break;
      case 'crop':        this._startSelection(x, y); break;
      case 'rect':
      case 'ellipse':
      case 'line':        this._startShape(x, y); break;
    }
  }

  _onMouseMove(e) {
    const pt = this._editor.canvas.getPointer(e.e);
    if (this._current === 'crop' && this._selActive) {
      this._updateSelection(pt.x, pt.y);
    } else if (this._drawing) {
      this._updateShape(pt.x, pt.y);
    }
  }

  _onMouseUp(e) {
    if (this._current === 'crop' && this._selActive) {
      const pt = this._editor.canvas.getPointer(e.e);
      this._updateSelection(pt.x, pt.y);
      this._finalizeSelection();
    } else if (this._drawing) {
      this._drawing = false;
      if (this._tempShape) {
        this._editor._saveState();
        bus.emit('canvas-changed');
      }
      this._tempShape = null;
    }
  }

  /* ── Selección rectangular (crop) ────────────────── */

  _startSelection(x, y) {
    this._selActive = true;
    this._selStart  = { x, y };
    this._selEnd    = { x, y };
    this._selBounds = null;
    this._hideCropBar();
  }

  _updateSelection(x, y) {
    if (!this._selActive) return;
    this._selEnd = { x, y };
    this._redrawOverlay();
  }

  _finalizeSelection() {
    this._selActive = false;
    const sx = Math.min(this._selStart.x, this._selEnd.x);
    const sy = Math.min(this._selStart.y, this._selEnd.y);
    const sw = Math.abs(this._selEnd.x - this._selStart.x);
    const sh = Math.abs(this._selEnd.y - this._selStart.y);

    if (sw < 4 || sh < 4) {
      // Selección demasiado pequeña, cancelar
      this.clearSelection();
      return;
    }

    this._selBounds = {
      x: Math.round(sx), y: Math.round(sy),
      w: Math.round(sw), h: Math.round(sh),
    };
    this._redrawOverlay();
    this._showCropBar();
  }

  /** Redibuja el overlay incluyendo grid + selección */
  _redrawOverlay() {
    this._editor.drawOverlay(); // dibuja grid

    if (!this._selActive && !this._selBounds) return;

    const ctx = this._editor._overlayCtx;
    const cw  = this._app.canvasW;
    const ch  = this._app.canvasH;

    let sx, sy, sw, sh;
    if (this._selActive && this._selStart && this._selEnd) {
      sx = Math.min(this._selStart.x, this._selEnd.x);
      sy = Math.min(this._selStart.y, this._selEnd.y);
      sw = Math.abs(this._selEnd.x - this._selStart.x);
      sh = Math.abs(this._selEnd.y - this._selStart.y);
    } else if (this._selBounds) {
      ({ x: sx, y: sy, w: sw, h: sh } = this._selBounds);
    } else return;

    // Oscurecer área fuera de la selección
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0,  0,  cw, sy);           // arriba
    ctx.fillRect(0,  sy + sh, cw, ch);      // abajo
    ctx.fillRect(0,  sy, sx, sh);           // izquierda
    ctx.fillRect(sx + sw, sy, cw, sh);      // derecha

    // Borde con línea de marcha de hormigas (dashed azul)
    ctx.save();
    ctx.strokeStyle = '#4da6ff';
    ctx.lineWidth   = 1.5 / APP.zoom;
    ctx.setLineDash([6 / APP.zoom, 3 / APP.zoom]);
    ctx.strokeRect(sx, sy, sw, sh);

    // Esquinas
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2 / APP.zoom;
    const cs = 8 / APP.zoom;
    [[sx, sy], [sx+sw, sy], [sx, sy+sh], [sx+sw, sy+sh]].forEach(([cx, cy]) => {
      ctx.strokeRect(cx - cs/2, cy - cs/2, cs, cs);
    });
    ctx.restore();

    // Dimensiones de la selección
    ctx.fillStyle = 'rgba(77,166,255,0.9)';
    ctx.font = `${12 / APP.zoom}px monospace`;
    ctx.fillText(`${Math.round(sw)} × ${Math.round(sh)} px`, sx + 4 / APP.zoom, sy - 4 / APP.zoom);
  }

  /** Barra flotante de crop que aparece al terminar la selección */
  _showCropBar() {
    let bar = document.getElementById('crop-action-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'crop-action-bar';
      bar.innerHTML = `
        <span class="crop-info" id="crop-info"></span>
        <button id="crop-apply-btn" class="option-btn option-btn--accent" style="width:auto;margin:0;padding:4px 12px">✂ Recortar capa</button>
        <button id="crop-cancel-btn" class="option-btn" style="width:auto;margin:0;padding:4px 10px">✕ Cancelar</button>
      `;
      bar.style.cssText = `
        position:fixed;bottom:40px;left:50%;transform:translateX(-50%);
        display:flex;align-items:center;gap:8px;
        background:var(--bg-dark);border:1px solid var(--border-mid);
        border-radius:4px;padding:6px 12px;z-index:500;
        box-shadow:0 4px 16px rgba(0,0,0,0.6);
        font-family:var(--font-mono);font-size:11px;
      `;
      document.body.appendChild(bar);
      document.getElementById('crop-apply-btn').addEventListener('click', () => this._applyCrop());
      document.getElementById('crop-cancel-btn').addEventListener('click', () => this.clearSelection());
    }
    bar.style.display = 'flex';
    if (this._selBounds) {
      document.getElementById('crop-info').textContent =
        `Selección: ${this._selBounds.w} × ${this._selBounds.h} px`;
    }
  }

  _hideCropBar() {
    document.getElementById('crop-action-bar')?.remove();
  }

  _applyCrop() {
    const sel   = this._selBounds;
    if (!sel) return;
    const layer = this._layers.getActive();
    if (!layer) { alert('No hay capa activa para recortar.'); return; }

    const w = this._app.canvasW;
    const h = this._app.canvasH;

    // Obtener imagen completa de la capa
    const tmp  = document.createElement('canvas');
    tmp.width  = w; tmp.height = h;
    const tCtx = tmp.getContext('2d');
    const fo   = layer.fabricObj;
    if (fo?.getElement?.()) {
      tCtx.drawImage(fo.getElement(), 0, 0, w, h);
    } else {
      // Fallback: canvas completo aplanado
      const img = new Image();
      img.src = this._editor.toDataURL({ format: 'png' });
      // Si no está cargado todavía, cancelar
      if (!img.complete) { alert('Espera a que la imagen cargue.'); return; }
      tCtx.drawImage(img, 0, 0);
    }

    // Crear canvas resultado del mismo tamaño del canvas (fuera de la selección = transparente)
    const result  = document.createElement('canvas');
    result.width  = w; result.height = h;
    const rCtx    = result.getContext('2d');

    // Solo copiar la región seleccionada al mismo sitio (fuera queda transparente)
    rCtx.drawImage(tmp, sel.x, sel.y, sel.w, sel.h, sel.x, sel.y, sel.w, sel.h);

    fabric.Image.fromURL(result.toDataURL('image/png'), newImg => {
      newImg.set({
        left: 0, top: 0, scaleX: 1, scaleY: 1,
        selectable: fo.selectable, evented: fo.evented,
        opacity: layer.opacity,
        globalCompositeOperation: layer.blendMode,
      });
      newImg._layerId   = layer.id;
      newImg._layerName = layer.name;

      const zIdx = this._editor.canvas.getObjects().indexOf(fo);
      this._editor.canvas.remove(fo);
      this._editor.canvas.insertAt(newImg, zIdx, false);
      layer.fabricObj = newImg;
      this._editor.canvas.renderAll();
      this._editor._saveState();
      bus.emit('canvas-changed');
      this.clearSelection();
    });
  }

  /* ── Flood fill ───────────────────────────────────── */

  _doFill(x, y) {
    const canvas   = this._editor.canvas;
    const w        = this._app.canvasW;
    const h        = this._app.canvasH;
    const toleran  = parseInt(document.getElementById('fill-tolerance').value);
    const contig   = document.getElementById('fill-contiguous').checked;

    const ctx      = canvas.getContext();
    const imgData  = ctx.getImageData(0, 0, w, h);
    const data     = imgData.data;

    const ix = Math.max(0, Math.min(w-1, Math.floor(x)));
    const iy = Math.max(0, Math.min(h-1, Math.floor(y)));

    const targetColor    = getPixel(data, ix, iy, w);
    const fillColorRgba  = hexToRgba(APP.primaryColor);

    if (colorMatch(targetColor, fillColorRgba, 0)) return;

    floodFill(data, ix, iy, w, h, targetColor, fillColorRgba, toleran, contig);
    ctx.putImageData(imgData, 0, 0);
    canvas.renderAll();
    this._editor._saveState();
    bus.emit('canvas-changed');
  }

  /* ── Cuentagotas ──────────────────────────────────── */

  _doEyedropper(x, y) {
    try {
      const ctx = this._editor.canvas.getContext();
      const px  = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      const hex = rgbaToHex(px[0], px[1], px[2], px[3]);
      APP.primaryColor = hex;
      document.getElementById('primary-color').style.background = hex;
      bus.emit('color-changed', { primary: hex });
    } catch(_) {}
  }

  /* ── Texto ────────────────────────────────────────── */

  _doAddText(x, y) {
    const fontFamily = document.getElementById('text-font').value;
    const fontSize   = parseInt(document.getElementById('text-size').value) || 32;
    const itext = new fabric.IText('Texto', {
      left: x, top: y,
      fontFamily, fontSize,
      fill:       APP.primaryColor,
      fontWeight: this._textBold    ? 'bold'   : 'normal',
      fontStyle:  this._textItalic  ? 'italic' : 'normal',
      underline:  this._textUnderline,
      editable:   true,
    });
    this._layers.addFabricObjectLayer(itext, 'Texto');
    this._editor.canvas.setActiveObject(itext);
    itext.enterEditing();
    this._editor.canvas.renderAll();
  }

  /* ── Pixel paint ──────────────────────────────────── */

  _doPixelPaint(x, y) {
    const pixelSize = parseInt(document.getElementById('pixel-size').value) || 4;
    const px = Math.floor(x / pixelSize) * pixelSize;
    const py = Math.floor(y / pixelSize) * pixelSize;
    const ctx = this._editor.canvas.getContext();
    ctx.fillStyle = APP.primaryColor;
    ctx.fillRect(px, py, pixelSize, pixelSize);
    this._editor.canvas.renderAll();
    clearTimeout(this._pixelSaveTimer);
    this._pixelSaveTimer = setTimeout(() => {
      this._editor._saveState();
      bus.emit('canvas-changed');
    }, 400);
  }

  /* ── Shapes ───────────────────────────────────────── */

  _startShape(x, y) {
    this._drawing   = true;
    this._origin    = { x, y };
    const filled    = document.getElementById('shape-filled')?.classList.contains('active') ?? true;
    const strokeW   = parseInt(document.getElementById('shape-stroke-width')?.value ?? 2);
    const fill      = filled ? APP.primaryColor : 'transparent';

    if (this._current === 'rect') {
      this._tempShape = new fabric.Rect({
        left: x, top: y, width: 0, height: 0,
        fill, stroke: APP.primaryColor, strokeWidth: strokeW, selectable: false,
      });
    } else if (this._current === 'ellipse') {
      this._tempShape = new fabric.Ellipse({
        left: x, top: y, rx: 0, ry: 0,
        fill, stroke: APP.primaryColor, strokeWidth: strokeW, selectable: false,
      });
    } else if (this._current === 'line') {
      this._tempShape = new fabric.Line([x, y, x, y], {
        stroke: APP.primaryColor, strokeWidth: strokeW, selectable: false,
      });
    }
    if (this._tempShape) this._editor.canvas.add(this._tempShape);
  }

  _updateShape(x, y) {
    if (!this._tempShape) return;
    const ox = this._origin.x, oy = this._origin.y;
    if (this._current === 'rect') {
      this._tempShape.set({
        left:   Math.min(ox, x), top:    Math.min(oy, y),
        width:  Math.abs(x - ox), height: Math.abs(y - oy),
      });
    } else if (this._current === 'ellipse') {
      this._tempShape.set({
        left:  Math.min(ox, x), top: Math.min(oy, y),
        rx:    Math.abs(x - ox) / 2, ry: Math.abs(y - oy) / 2,
      });
    } else if (this._current === 'line') {
      this._tempShape.set({ x2: x, y2: y });
    }
    this._editor.canvas.renderAll();
  }

  /* ── Bindings UI ──────────────────────────────────── */

  _bindToolButtons() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
    });
  }

  _bindToolOptions() {
    const liveSlider = (id, valId, fmt, cb) => {
      const el = document.getElementById(id);
      const vl = document.getElementById(valId);
      if (!el) return;
      el.addEventListener('input', e => {
        if (vl) vl.textContent = fmt(e.target.value);
        cb(e.target.value);
      });
    };

    liveSlider('brush-size',    'brush-size-val',    v => v,         () => { if (this._current === 'brush') this._activateBrush(); });
    liveSlider('brush-opacity', 'brush-opacity-val', v => v + '%',   () => { if (this._current === 'brush') this._activateBrush(); });
    liveSlider('brush-hardness','brush-hardness-val',v => v + '%',   () => {});
    document.getElementById('brush-blend-mode')?.addEventListener('change', () => {
      if (this._current === 'brush') this._activateBrush();
    });
    liveSlider('eraser-size',    'eraser-size-val',    v => v,       () => { if (this._current === 'eraser') this._activateEraser(); });
    liveSlider('eraser-opacity', 'eraser-opacity-val', v => v + '%', () => {});
    liveSlider('fill-tolerance', 'fill-tolerance-val', v => v,       () => {});
    liveSlider('shape-stroke-width', 'shape-stroke-val', v => v,     () => {});

    document.getElementById('shape-filled')?.addEventListener('click',  () => {
      document.getElementById('shape-filled').classList.add('active');
      document.getElementById('shape-stroked').classList.remove('active');
    });
    document.getElementById('shape-stroked')?.addEventListener('click', () => {
      document.getElementById('shape-stroked').classList.add('active');
      document.getElementById('shape-filled').classList.remove('active');
    });

    const styleBtn = (id, prop) => {
      document.getElementById(id)?.addEventListener('click', e => {
        this[prop] = !this[prop];
        e.currentTarget.classList.toggle('active', this[prop]);
      });
    };
    styleBtn('text-bold',      '_textBold');
    styleBtn('text-italic',    '_textItalic');
    styleBtn('text-underline', '_textUnderline');
  }

  _setStatus(msg) {
    const el = document.getElementById('layer-info');
    if (el) el.textContent = msg;
  }
}

/* ── Flood fill ────────────────────────────────────── */

function floodFill(data, sx, sy, w, h, target, fill, tol, contig) {
  if (contig) {
    const stack   = [[sx, sy]];
    const visited = new Uint8Array(w * h);
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const idx = y * w + x;
      if (visited[idx]) continue;
      if (!colorMatch(getPixel(data, x, y, w), target, tol)) continue;
      visited[idx] = 1;
      setPixel(data, x, y, w, fill);
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
  } else {
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = Math.floor(i / w);
      if (colorMatch(getPixel(data, x, y, w), target, tol)) setPixel(data, x, y, w, fill);
    }
  }
}

function getPixel(data, x, y, w) {
  const i = (y * w + x) * 4;
  return [data[i], data[i+1], data[i+2], data[i+3]];
}
function setPixel(data, x, y, w, [r,g,b,a]) {
  const i = (y * w + x) * 4;
  data[i]=r; data[i+1]=g; data[i+2]=b; data[i+3]=a;
}
function colorMatch([r1,g1,b1,a1],[r2,g2,b2,a2],tol) {
  return Math.abs(r1-r2)+Math.abs(g1-g2)+Math.abs(b1-b2)+Math.abs(a1-a2) <= tol*4;
}
function hexToRgba(hex) {
  hex = hex.replace('#','');
  return [
    parseInt(hex.slice(0,2),16)||0,
    parseInt(hex.slice(2,4),16)||0,
    parseInt(hex.slice(4,6),16)||0,
    hex.length>=8 ? parseInt(hex.slice(6,8),16) : 255,
  ];
}
function rgbaToHex(r,g,b,a=255) {
  return '#'+[r,g,b,a].map(v=>v.toString(16).padStart(2,'0')).join('');
}
