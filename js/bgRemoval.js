/**
 * bgRemoval.js — Borrado de fondo con IA
 *
 * IMPORTANTE: NO usa import estático de @imgly/background-removal.
 * Lo carga de forma lazy (solo cuando el usuario abre el modal) con
 * varios CDNs de fallback. Si todos fallan, la app sigue funcionando
 * y el usuario puede pintar la máscara manualmente.
 */

import { bus } from './app.js';

// CDNs a probar en orden hasta que uno funcione
const CDN_CANDIDATES = [
  'https://esm.sh/@imgly/background-removal@1.4.14',
  'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.14/dist/browser/index.js',
  'https://unpkg.com/@imgly/background-removal@1.4.14/dist/browser/index.js',
];

export class BgRemoval {
  constructor(editor, layers, appState) {
    this._editor   = editor;
    this._layers   = layers;
    this._app      = appState;

    // La función se carga lazily; null = todavía no cargada
    this._removeBackground = null;

    // Canvases internos (fuera del DOM)
    this._origCanvas = null;
    this._maskCanvas = null;
    this._editCanvas = null;

    // Estado de pintura
    this._painting  = false;
    this._lastPos   = null;
    this._tool      = 'erase';
    this._brushSize = 30;

    this._bindUI();
  }

  /* ── Abrir modal ─────────────────────────────────── */

  async openModal() {
    const layer = this._layers.getActive();
    if (!layer) { alert('Selecciona una capa con imagen primero.'); return; }

    document.getElementById('modal-bg-removal').classList.remove('hidden');

    const w = this._app.canvasW;
    const h = this._app.canvasH;

    this._origCanvas = this._makeCanvas(w, h);
    this._maskCanvas = this._makeCanvas(w, h);

    // Dibujar la capa activa en el canvas original
    const origCtx   = this._origCanvas.getContext('2d');
    const fabricObj = layer.fabricObj;
    if (fabricObj?.getElement?.()) {
      origCtx.drawImage(fabricObj.getElement(), 0, 0, w, h);
    } else {
      await this._drawFromDataUrl(origCtx, this._editor.toDataURL({ format: 'png' }), w, h);
    }

    // Máscara inicial: todo blanco = todo visible
    const mCtx = this._maskCanvas.getContext('2d');
    mCtx.fillStyle = '#ffffff';
    mCtx.fillRect(0, 0, w, h);

    // Canvas de edición visible
    this._editCanvas = document.getElementById('bgr-edit-canvas');
    this._editCanvas.width  = w;
    this._editCanvas.height = h;

    // Resetear UI
    this._setTool('erase');
    document.getElementById('bgr-apply').disabled = true;
    this._setStatus('');
    this._renderEditCanvas();
    this._bindPainting();

    // Lanzar IA en background (no bloquea la UI)
    this._runAI();
  }

  /* ── Cargar librería IA lazy (varios CDNs de fallback) ── */

  async _loadLib() {
    if (this._removeBackground) return this._removeBackground;

    for (const url of CDN_CANDIDATES) {
      try {
        this._setStatus(`⏳ Cargando módulo IA…`, 'loading');
        const mod = await import(/* @vite-ignore */ url);
        const fn  = mod.removeBackground ?? mod.default?.removeBackground ?? mod.default;
        if (typeof fn === 'function') {
          this._removeBackground = fn;
          return fn;
        }
      } catch (e) {
        console.warn(`[BgRemoval] CDN fallido: ${url} —`, e.message);
      }
    }
    return null;
  }

  /* ── Proceso IA ──────────────────────────────────── */

  async _runAI() {
    const spinner = document.getElementById('bgr-spinner');
    spinner.classList.remove('hidden');
    this._setStatus('⏳ Cargando módulo IA… (puede tardar 10-30 s la primera vez)', 'loading');

    try {
      const removeBackground = await this._loadLib();
      if (!removeBackground) {
        throw new Error('No se pudo cargar el módulo desde ningún CDN. Revisa la conexión a Internet.');
      }

      this._setStatus('🤖 Procesando imagen con IA…', 'loading');

      const blob = await new Promise(res => this._origCanvas.toBlob(res, 'image/png'));

      // publicPath sirve para que la librería cargue sus archivos WASM
      const publicPath = CDN_CANDIDATES[0].replace('index.js', '');
      const resultBlob = await removeBackground(blob, {
        publicPath,
        model: 'medium',
        output: { format: 'image/png', quality: 0.9, type: 'foreground' },
      });

      // Extraer canal alpha → máscara B/N
      const resultImg  = await this._loadImageFromBlob(resultBlob);
      const tmp        = this._makeCanvas(this._origCanvas.width, this._origCanvas.height);
      const tCtx       = tmp.getContext('2d');
      tCtx.drawImage(resultImg, 0, 0, tmp.width, tmp.height);

      const rData = tCtx.getImageData(0, 0, tmp.width, tmp.height);
      const mCtx  = this._maskCanvas.getContext('2d');
      const mData = mCtx.getImageData(0, 0, tmp.width, tmp.height);

      for (let i = 0; i < rData.data.length; i += 4) {
        const v = rData.data[i + 3];
        mData.data[i] = mData.data[i+1] = mData.data[i+2] = v;
        mData.data[i+3] = 255;
      }
      mCtx.putImageData(mData, 0, 0);

      spinner.classList.add('hidden');
      this._renderEditCanvas();
      document.getElementById('bgr-apply').disabled = false;
      this._setStatus('✓ IA lista. Pinta sobre la imagen para corregir errores.', 'ok');

    } catch (err) {
      spinner.classList.add('hidden');
      document.getElementById('bgr-apply').disabled = false;
      this._setStatus(`⚠ ${err.message}. Puedes pintar la máscara manualmente.`, 'error');
      console.error('[BgRemoval]', err);
    }
  }

  /* ── Render del canvas visible ───────────────────── */

  _renderEditCanvas() {
    const ec = this._editCanvas;
    if (!ec || !this._origCanvas) return;
    const w   = ec.width, h = ec.height;
    const ctx = ec.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Fondo: tablero de ajedrez
    this._drawChecker(ctx, w, h);

    if (this._tool === 'erase') {
      // Imagen con máscara como alpha → transparente donde se borra
      const tmp  = this._makeCanvas(w, h);
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(this._origCanvas, 0, 0);
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.drawImage(this._maskCanvas, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else {
      // Imagen muy atenuada + imagen normal donde la máscara es blanca
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.drawImage(this._origCanvas, 0, 0);
      ctx.restore();

      const tmp  = this._makeCanvas(w, h);
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(this._origCanvas, 0, 0);
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.drawImage(this._maskCanvas, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    }
  }

  /* ── Pintura sobre la máscara ────────────────────── */

  _bindPainting() {
    const ec    = this._editCanvas;
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
      const pos = getPos(e);
      this._lastPos = pos;
      this._paintAt(pos.x, pos.y, null);
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

  /** Pincel continuo con lineTo (sin efecto punteado) */
  _paintAt(x, y, lastPos) {
    const mCtx       = this._maskCanvas.getContext('2d');
    mCtx.lineWidth   = this._brushSize;
    mCtx.lineCap     = 'round';
    mCtx.lineJoin    = 'round';
    const color      = this._tool === 'erase' ? '#000000' : '#ffffff';
    mCtx.strokeStyle = color;
    mCtx.fillStyle   = color;

    mCtx.beginPath();
    if (lastPos) {
      mCtx.moveTo(lastPos.x, lastPos.y);
      mCtx.lineTo(x, y);
      mCtx.stroke();
    } else {
      mCtx.arc(x, y, this._brushSize / 2, 0, Math.PI * 2);
      mCtx.fill();
    }
    this._renderEditCanvas();
  }

  /* ── Aplicar resultado al canvas ─────────────────── */

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
      this._setTool('erase');
      document.getElementById('bgr-hint').textContent =
        'Pinta sobre zonas que quieras ELIMINAR (dejarlas transparentes)';
    });
    document.getElementById('bgr-btn-restore')?.addEventListener('click', () => {
      this._setTool('restore');
      document.getElementById('bgr-hint').textContent =
        'Pinta sobre zonas que quieras RECUPERAR (hacerlas visibles)';
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

  _setTool(tool) {
    this._tool = tool;
    document.getElementById('bgr-btn-erase')?.classList.toggle('active', tool === 'erase');
    document.getElementById('bgr-btn-restore')?.classList.toggle('active', tool === 'restore');
    this._renderEditCanvas();
  }

  /* ── Helpers ─────────────────────────────────────── */

  _makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  _setStatus(msg, type = '') {
    const el = document.getElementById('bgr-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'bgr-status' + (type ? ` bgr-status--${type}` : '');
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
