/**
 * bgRemoval.js — Borrado de fondo con IA
 * UI: un solo canvas de edición con feedback visual intuitivo.
 * - Modo BORRAR: imagen normal, pintar hace la zona transparente (tablero de ajedrez)
 * - Modo RESTAURAR: imagen atenuada, pintar revela la zona con opacidad completa
 */

import { bus } from './app.js';

const BGR_LIB_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.14/dist/browser/index.js';
const BGR_PUBLIC  = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.14/dist/browser/';

export class BgRemoval {
  constructor(editor, layers, appState) {
    this._editor   = editor;
    this._layers   = layers;
    this._app      = appState;
    this._removeBackground = null;

    this._origCanvas = null;
    this._maskCanvas = null;
    this._editCanvas = null;

    this._painting  = false;
    this._lastPos   = null;
    this._tool      = 'erase';
    this._brushSize = 30;

    this._bindUI();
  }

  /* ── Abrir modal ────────────────────────────────── */

  async openModal() {
    const layer = this._layers.getActive();
    if (!layer) { alert('Selecciona una capa con imagen primero.'); return; }

    const modal = document.getElementById('modal-bg-removal');
    modal.classList.remove('hidden');

    const w = this._app.canvasW;
    const h = this._app.canvasH;

    this._origCanvas = this._makeCanvas(w, h);
    this._maskCanvas = this._makeCanvas(w, h);

    const origCtx = this._origCanvas.getContext('2d');
    const fabricObj = layer.fabricObj;
    if (fabricObj?.getElement?.()) {
      origCtx.drawImage(fabricObj.getElement(), 0, 0, w, h);
    } else {
      await this._drawFromDataUrl(origCtx, this._editor.toDataURL({ format: 'png' }), w, h);
    }

    // Máscara inicial todo blanco = todo visible
    const mCtx = this._maskCanvas.getContext('2d');
    mCtx.fillStyle = '#ffffff';
    mCtx.fillRect(0, 0, w, h);

    this._editCanvas = document.getElementById('bgr-edit-canvas');
    this._editCanvas.width  = w;
    this._editCanvas.height = h;

    this._tool = 'erase';
    document.getElementById('bgr-btn-erase').classList.add('active');
    document.getElementById('bgr-btn-restore').classList.remove('active');
    document.getElementById('bgr-hint').textContent =
      'Pinta sobre zonas que quieras eliminar (dejarlas transparentes)';
    document.getElementById('bgr-apply').disabled = true;
    this._setStatus('');
    this._renderEditCanvas();
    this._bindPainting();
    this._runAI();
  }

  /* ── Proceso IA ─────────────────────────────────── */

  async _runAI() {
    const spinner = document.getElementById('bgr-spinner');
    spinner.classList.remove('hidden');
    this._setStatus('⏳ Cargando módulo de IA (primera vez puede tardar 10-20 s)…', 'loading');

    try {
      if (!this._removeBackground) {
        const mod = await import(BGR_LIB_URL);
        this._removeBackground = mod.removeBackground ?? mod.default?.removeBackground;
        if (!this._removeBackground) throw new Error('Función removeBackground no encontrada en el módulo.');
      }

      this._setStatus('🤖 Procesando con IA…', 'loading');

      const blob = await new Promise(res => this._origCanvas.toBlob(res, 'image/png'));
      const resultBlob = await this._removeBackground(blob, {
        publicPath: BGR_PUBLIC,
        model: 'medium',
        output: { format: 'image/png', quality: 0.9, type: 'foreground' },
      });

      // Extraer canal alpha del resultado → máscara B/N
      const resultImg = await this._loadImageFromBlob(resultBlob);
      const tmp  = this._makeCanvas(this._origCanvas.width, this._origCanvas.height);
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(resultImg, 0, 0, tmp.width, tmp.height);

      const rData = tCtx.getImageData(0, 0, tmp.width, tmp.height);
      const mCtx  = this._maskCanvas.getContext('2d');
      const mData = mCtx.getImageData(0, 0, tmp.width, tmp.height);

      for (let i = 0; i < rData.data.length; i += 4) {
        const v = rData.data[i + 3]; // alpha → luminosidad máscara
        mData.data[i] = mData.data[i+1] = mData.data[i+2] = v;
        mData.data[i + 3] = 255;
      }
      mCtx.putImageData(mData, 0, 0);

      spinner.classList.add('hidden');
      this._renderEditCanvas();
      document.getElementById('bgr-apply').disabled = false;
      this._setStatus('✓ IA lista. Pinta sobre la imagen para corregir errores.', 'ok');

    } catch (err) {
      spinner.classList.add('hidden');
      document.getElementById('bgr-apply').disabled = false;
      this._setStatus(`⚠ Error IA: ${err.message}. Puedes pintar la máscara manualmente.`, 'error');
      console.error('[BgRemoval]', err);
    }
  }

  /* ── Render canvas de edición ───────────────────── */

  _renderEditCanvas() {
    const ec = this._editCanvas;
    if (!ec || !this._origCanvas) return;
    const w   = ec.width, h = ec.height;
    const ctx = ec.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Fondo: tablero de ajedrez (siempre visible como indicador de transparencia)
    this._drawChecker(ctx, w, h);

    if (this._tool === 'erase') {
      // Modo BORRAR: imagen visible donde la máscara es blanca, transparencia donde es negra
      const tmp  = this._makeCanvas(w, h);
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(this._origCanvas, 0, 0);
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.drawImage(this._maskCanvas, 0, 0);
      ctx.drawImage(tmp, 0, 0);

    } else {
      // Modo RESTAURAR: imagen oscurecida + imagen normal donde la máscara es blanca
      // 1. Imagen completa, muy atenuada
      const dim = this._makeCanvas(w, h);
      const dCtx = dim.getContext('2d');
      dCtx.drawImage(this._origCanvas, 0, 0);
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.drawImage(dim, 0, 0);
      ctx.restore();

      // 2. Imagen normal donde la máscara es blanca (lo que se conservará)
      const tmp  = this._makeCanvas(w, h);
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(this._origCanvas, 0, 0);
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.drawImage(this._maskCanvas, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    }
  }

  /* ── Pintura sobre la máscara ───────────────────── */

  _bindPainting() {
    const ec = this._editCanvas;
    const newEc = ec.cloneNode(true);
    ec.parentNode.replaceChild(newEc, ec);
    this._editCanvas = newEc;

    const getPos = e => {
      const rect   = newEc.getBoundingClientRect();
      const scaleX = newEc.width  / rect.width;
      const scaleY = newEc.height / rect.height;
      const src    = e.touches?.[0] ?? e;
      return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top)  * scaleY,
      };
    };

    const startPaint = e => {
      e.preventDefault();
      this._painting = true;
      this._lastPos  = getPos(e);
      this._paintAt(this._lastPos.x, this._lastPos.y, null);
    };

    const movePaint = e => {
      if (!this._painting) return;
      e.preventDefault();
      const pos = getPos(e);
      this._paintAt(pos.x, pos.y, this._lastPos);
      this._lastPos = pos;
    };

    const endPaint = () => { this._painting = false; this._lastPos = null; };

    newEc.addEventListener('mousedown',  startPaint, { passive: false });
    newEc.addEventListener('mousemove',  movePaint,  { passive: false });
    newEc.addEventListener('mouseup',    endPaint);
    newEc.addEventListener('mouseleave', endPaint);
    newEc.addEventListener('touchstart', startPaint, { passive: false });
    newEc.addEventListener('touchmove',  movePaint,  { passive: false });
    newEc.addEventListener('touchend',   endPaint);
  }

  /**
   * Pinta en la máscara con trazado continuo (evita el efecto "punteado").
   * Usa lineTo desde la posición anterior a la actual.
   */
  _paintAt(x, y, lastPos) {
    const mCtx       = this._maskCanvas.getContext('2d');
    mCtx.lineWidth   = this._brushSize;
    mCtx.lineCap     = 'round';
    mCtx.lineJoin    = 'round';
    const color      = this._tool === 'erase' ? '#000000' : '#ffffff';
    mCtx.strokeStyle = color;
    mCtx.fillStyle   = color;

    mCtx.beginPath();
    if (lastPos && (Math.abs(x - lastPos.x) + Math.abs(y - lastPos.y)) < this._brushSize * 4) {
      // Línea continua desde la posición anterior
      mCtx.moveTo(lastPos.x, lastPos.y);
      mCtx.lineTo(x, y);
      mCtx.stroke();
    } else {
      // Punto inicial o salto grande: círculo
      mCtx.arc(x, y, this._brushSize / 2, 0, Math.PI * 2);
      mCtx.fill();
    }

    this._renderEditCanvas();
  }

  /* ── Aplicar resultado al canvas ────────────────── */

  _applyToCanvas() {
    const w     = this._app.canvasW, h = this._app.canvasH;
    const final = this._makeCanvas(w, h);
    const ctx   = final.getContext('2d');

    ctx.drawImage(this._origCanvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this._maskCanvas, 0, 0);

    const imgEl = new Image();
    imgEl.onload = () => {
      this._layers.addImageLayer(imgEl, 'Sin fondo (IA)');
      document.getElementById('modal-bg-removal').classList.add('hidden');
    };
    imgEl.src = final.toDataURL('image/png');
  }

  /* ── Bindings UI ─────────────────────────────────── */

  _bindUI() {
    document.getElementById('bgr-btn-erase')?.addEventListener('click', () => {
      this._tool = 'erase';
      document.getElementById('bgr-btn-erase').classList.add('active');
      document.getElementById('bgr-btn-restore').classList.remove('active');
      document.getElementById('bgr-hint').textContent =
        'Pinta sobre zonas que quieras ELIMINAR (dejarlas transparentes)';
      this._renderEditCanvas();
    });
    document.getElementById('bgr-btn-restore')?.addEventListener('click', () => {
      this._tool = 'restore';
      document.getElementById('bgr-btn-restore').classList.add('active');
      document.getElementById('bgr-btn-erase').classList.remove('active');
      document.getElementById('bgr-hint').textContent =
        'Pinta sobre zonas que quieras RECUPERAR (hacerlas visibles)';
      this._renderEditCanvas();
    });
    document.getElementById('bgr-brush-size')?.addEventListener('input', e => {
      this._brushSize = parseInt(e.target.value);
      document.getElementById('bgr-brush-size-val').textContent = e.target.value + 'px';
    });
    document.getElementById('bgr-apply')?.addEventListener('click', () => this._applyToCanvas());
    document.getElementById('bgr-cancel')?.addEventListener('click', () => {
      document.getElementById('modal-bg-removal').classList.add('hidden');
    });
  }

  _setStatus(msg, type = '') {
    const el = document.getElementById('bgr-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'bgr-status' + (type ? ` bgr-status--${type}` : '');
  }

  _makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  _drawChecker(ctx, w, h) {
    const s = 10;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        ctx.fillStyle = ((Math.floor(y/s) + Math.floor(x/s)) % 2 === 0) ? '#c0c0c0' : '#888';
        ctx.fillRect(x, y, s, s);
      }
    }
  }

  _loadImageFromBlob(blob) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload  = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Error cargando imagen resultado')); };
      img.src = url;
    });
  }

  _drawFromDataUrl(ctx, dataUrl, w, h) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, w, h); res(); };
      img.src = dataUrl;
    });
  }
}
