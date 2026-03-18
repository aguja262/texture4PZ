/**
 * tools.js — ToolManager
 * Manages the active tool and wires Fabric.js events for each tool.
 */

import { bus, APP } from './app.js';

export class ToolManager {
  constructor(editor, layers, appState) {
    this._editor  = editor;
    this._layers  = layers;
    this._app     = appState;
    this._current = 'select';
    this._pixelMode = false;

    // Shape drawing state
    this._drawing = false;
    this._origin  = { x: 0, y: 0 };
    this._tempShape = null;

    // Text state
    this._textBold      = false;
    this._textItalic    = false;
    this._textUnderline = false;

    this._bindToolButtons();
    this._bindToolOptions();
    this._bindCanvasEvents();
    this.setTool('select');
  }

  /* ── Tool selection ───────────────────────────────── */

  setTool(name) {
    this._current = name;

    // Highlight active button
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === name);
    });

    // Show relevant options panel
    const groups = ['brush-options','eraser-options','text-options',
                    'pixel-options','fill-options','shape-options'];
    groups.forEach(id => document.getElementById(id)?.classList.add('hidden'));

    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.className = `tool-${name}`;

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

  setPixelMode(on) {
    this._pixelMode = on;
  }

  /* ── Activate brush ───────────────────────────────── */

  _activateBrush() {
    const size     = parseInt(document.getElementById('brush-size').value);
    const opacity  = parseInt(document.getElementById('brush-opacity').value);
    const blendMode = document.getElementById('brush-blend-mode').value;
    this._editor.setBrushMode(APP.primaryColor, size, opacity, 80, blendMode);
  }

  _activateEraser() {
    const size = parseInt(document.getElementById('eraser-size').value);
    this._editor.setEraserMode(size);
  }

  /* ── Canvas event handling ────────────────────────── */

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
      case 'fill':       this._doFill(x, y); break;
      case 'eyedropper': this._doEyedropper(x, y); break;
      case 'text':       this._doAddText(x, y); break;
      case 'pixel-paint':this._doPixelPaint(x, y); break;
      case 'rect':
      case 'ellipse':
      case 'line':
        this._startShape(x, y);
        break;
    }
  }

  _onMouseMove(e) {
    if (!this._drawing) return;
    const pt = this._editor.canvas.getPointer(e.e);
    this._updateShape(pt.x, pt.y);
  }

  _onMouseUp(e) {
    if (!this._drawing) return;
    this._drawing = false;
    if (this._tempShape) {
      this._editor._saveState();
      bus.emit('canvas-changed');
    }
    this._tempShape = null;
  }

  /* ── Flood fill ───────────────────────────────────── */

  _doFill(x, y) {
    const canvas  = this._editor.canvas;
    const w       = this._app.canvasW;
    const h       = this._app.canvasH;
    const toleran = parseInt(document.getElementById('fill-tolerance').value);
    const contig  = document.getElementById('fill-contiguous').checked;

    // Get flat pixel data from canvas
    const ctx   = canvas.getContext();
    const imgData = ctx.getImageData(0, 0, w, h);
    const data  = imgData.data;

    const ix = Math.max(0, Math.min(w-1, Math.floor(x)));
    const iy = Math.max(0, Math.min(h-1, Math.floor(y)));

    const targetColor = getPixel(data, ix, iy, w);
    const fillColorRgba = hexToRgba(APP.primaryColor);

    if (colorMatch(targetColor, fillColorRgba, 0)) return; // same color

    floodFill(data, ix, iy, w, h, targetColor, fillColorRgba, toleran, contig);
    ctx.putImageData(imgData, 0, 0);
    canvas.renderAll();
    this._editor._saveState();
    bus.emit('canvas-changed');
  }

  /* ── Eyedropper ───────────────────────────────────── */

  _doEyedropper(x, y) {
    const ctx = this._editor.canvas.getContext();
    const px  = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    const hex = rgbaToHex(px[0], px[1], px[2], px[3]);
    APP.primaryColor = hex;
    document.getElementById('primary-color').style.background = hex;
    bus.emit('color-changed', { primary: hex });
  }

  /* ── Text tool ────────────────────────────────────── */

  _doAddText(x, y) {
    const fontFamily = document.getElementById('text-font').value;
    const fontSize   = parseInt(document.getElementById('text-size').value) || 32;
    const itext = new fabric.IText('Texto', {
      left:       x,
      top:        y,
      fontFamily,
      fontSize,
      fill:       APP.primaryColor,
      fontWeight: this._textBold ? 'bold' : 'normal',
      fontStyle:  this._textItalic ? 'italic' : 'normal',
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

    // Draw directly on the canvas context
    const ctx = this._editor.canvas.getContext();
    ctx.fillStyle = APP.primaryColor;
    ctx.fillRect(px, py, pixelSize, pixelSize);
    this._editor.canvas.renderAll();
    // Throttle saves
    clearTimeout(this._pixelSaveTimer);
    this._pixelSaveTimer = setTimeout(() => {
      this._editor._saveState();
      bus.emit('canvas-changed');
    }, 400);
  }

  /* ── Shape drawing ────────────────────────────────── */

  _startShape(x, y) {
    this._drawing    = true;
    this._origin     = { x, y };

    const filled     = document.getElementById('shape-filled')?.classList.contains('active') ?? true;
    const strokeW    = parseInt(document.getElementById('shape-stroke-width')?.value ?? 2);
    const fill       = filled ? APP.primaryColor : 'transparent';
    const stroke     = APP.primaryColor;

    if (this._current === 'rect') {
      this._tempShape = new fabric.Rect({
        left: x, top: y, width: 0, height: 0,
        fill, stroke, strokeWidth: strokeW,
        selectable: false,
      });
    } else if (this._current === 'ellipse') {
      this._tempShape = new fabric.Ellipse({
        left: x, top: y, rx: 0, ry: 0,
        fill, stroke, strokeWidth: strokeW,
        selectable: false,
      });
    } else if (this._current === 'line') {
      this._tempShape = new fabric.Line([x, y, x, y], {
        stroke: APP.primaryColor,
        strokeWidth: strokeW,
        selectable: false,
      });
    }

    if (this._tempShape) {
      this._editor.canvas.add(this._tempShape);
    }
  }

  _updateShape(x, y) {
    if (!this._tempShape) return;
    const ox = this._origin.x, oy = this._origin.y;

    if (this._current === 'rect') {
      const left   = Math.min(ox, x);
      const top    = Math.min(oy, y);
      const width  = Math.abs(x - ox);
      const height = Math.abs(y - oy);
      this._tempShape.set({ left, top, width, height });
    } else if (this._current === 'ellipse') {
      const rx = Math.abs(x - ox) / 2;
      const ry = Math.abs(y - oy) / 2;
      const left = Math.min(ox, x);
      const top  = Math.min(oy, y);
      this._tempShape.set({ left, top, rx, ry });
    } else if (this._current === 'line') {
      this._tempShape.set({ x2: x, y2: y });
    }

    this._editor.canvas.renderAll();
  }

  /* ── Tool option bindings ─────────────────────────── */

  _bindToolButtons() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
    });
  }

  _bindToolOptions() {
    const liveSlider = (id, valId, fmt, onChange) => {
      const el = document.getElementById(id);
      const vl = document.getElementById(valId);
      if (!el) return;
      el.addEventListener('input', e => {
        if (vl) vl.textContent = fmt(e.target.value);
        onChange(e.target.value);
      });
    };

    liveSlider('brush-size', 'brush-size-val', v => v, () => {
      if (this._current === 'brush') this._activateBrush();
    });
    liveSlider('brush-opacity', 'brush-opacity-val', v => v + '%', () => {
      if (this._current === 'brush') this._activateBrush();
    });
    liveSlider('brush-hardness', 'brush-hardness-val', v => v + '%', () => {});
    document.getElementById('brush-blend-mode')?.addEventListener('change', () => {
      if (this._current === 'brush') this._activateBrush();
    });

    liveSlider('eraser-size', 'eraser-size-val', v => v, () => {
      if (this._current === 'eraser') this._activateEraser();
    });
    liveSlider('eraser-opacity', 'eraser-opacity-val', v => v + '%', () => {});

    liveSlider('fill-tolerance', 'fill-tolerance-val', v => v, () => {});

    liveSlider('shape-stroke-width', 'shape-stroke-val', v => v, () => {});

    // Shape fill/stroke toggle
    document.getElementById('shape-filled')?.addEventListener('click', e => {
      document.getElementById('shape-filled').classList.add('active');
      document.getElementById('shape-stroked').classList.remove('active');
    });
    document.getElementById('shape-stroked')?.addEventListener('click', () => {
      document.getElementById('shape-stroked').classList.add('active');
      document.getElementById('shape-filled').classList.remove('active');
    });

    // Text style toggles
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
}

/* ── Flood fill algorithm ─────────────────────────── */

function floodFill(data, sx, sy, w, h, target, fill, tolerance, contiguous) {
  if (contiguous) {
    const stack = [[sx, sy]];
    const visited = new Uint8Array(w * h);
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const idx = (y * w + x);
      if (visited[idx]) continue;
      const px = getPixel(data, x, y, w);
      if (!colorMatch(px, target, tolerance)) continue;
      visited[idx] = 1;
      setPixel(data, x, y, w, fill);
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
  } else {
    // Fill all matching pixels globally
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = Math.floor(i / w);
      const px = getPixel(data, x, y, w);
      if (colorMatch(px, target, tolerance)) setPixel(data, x, y, w, fill);
    }
  }
}

function getPixel(data, x, y, w) {
  const i = (y * w + x) * 4;
  return [data[i], data[i+1], data[i+2], data[i+3]];
}
function setPixel(data, x, y, w, [r,g,b,a]) {
  const i = (y * w + x) * 4;
  data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = a;
}
function colorMatch([r1,g1,b1,a1], [r2,g2,b2,a2], tol) {
  return Math.abs(r1-r2) + Math.abs(g1-g2) + Math.abs(b1-b2) + Math.abs(a1-a2) <= tol * 4;
}

function hexToRgba(hex) {
  hex = hex.replace('#','');
  const r = parseInt(hex.slice(0,2),16) || 0;
  const g = parseInt(hex.slice(2,4),16) || 0;
  const b = parseInt(hex.slice(4,6),16) || 0;
  const a = hex.length >= 8 ? parseInt(hex.slice(6,8),16) : 255;
  return [r,g,b,a];
}
function rgbaToHex(r,g,b,a=255) {
  return '#' + [r,g,b,a].map(v => v.toString(16).padStart(2,'0')).join('');
}
