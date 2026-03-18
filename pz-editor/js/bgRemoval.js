/**
 * bgRemoval.js — Background Removal using @imgly/background-removal
 * Runs entirely in the browser via WASM — no API key, no server.
 */

import { bus } from './app.js';

const BGS_CDN = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/browser/index.js';

export class BgRemoval {
  constructor(editor, layers, appState) {
    this._editor  = editor;
    this._layers  = layers;
    this._app     = appState;
    this._lib     = null;

    // Canvas references (set when modal opens)
    this._origCanvas   = null;
    this._maskCanvas   = null;
    this._resultCanvas = null;

    // Mask painting state
    this._maskPainting  = false;
    this._maskTool      = 'restore'; // 'restore' | 'erase'
    this._maskBrushSize = 20;

    this._bindUI();
  }

  /* ── Load library on demand ───────────────────────── */

  async _loadLib() {
    if (this._lib) return this._lib;
    this._setStatus('Cargando módulo IA (primera vez puede tardar)…');
    const mod  = await import(/* @vite-ignore */ BGS_CDN);
    this._lib  = mod;
    this._setStatus('');
    return mod;
  }

  /* ── Open modal ───────────────────────────────────── */

  async openModal() {
    const layer = this._layers.getActive();
    if (!layer) { alert('Selecciona una capa con imagen primero.'); return; }

    const modal = document.getElementById('modal-bg-removal');
    modal.classList.remove('hidden');

    this._origCanvas   = document.getElementById('bgr-original');
    this._maskCanvas   = document.getElementById('bgr-mask');
    this._resultCanvas = document.getElementById('bgr-result');

    // Render active layer to original canvas
    const w = this._app.canvasW;
    const h = this._app.canvasH;
    [this._origCanvas, this._maskCanvas, this._resultCanvas].forEach(c => {
      c.width = w; c.height = h;
    });

    // Draw active layer content
    const fabricObj = layer.fabricObj;
    const ctx = this._origCanvas.getContext('2d');
    if (fabricObj.getElement?.()) {
      ctx.drawImage(fabricObj.getElement(), 0, 0, w, h);
    } else {
      const img = new Image();
      img.src = this._editor.toDataURL({ format: 'png' });
      await new Promise(r => { img.onload = r; });
      ctx.drawImage(img, 0, 0);
    }

    // Clear mask & result
    this._maskCanvas.getContext('2d').clearRect(0, 0, w, h);
    this._resultCanvas.getContext('2d').clearRect(0, 0, w, h);

    document.getElementById('bgr-apply').disabled = true;
    this._setStatus('');

    // Start processing
    this._processRemoval();
    this._bindMaskPainting();
  }

  /* ── Run AI background removal ────────────────────── */

  async _processRemoval() {
    const processing = document.getElementById('bgr-processing');
    processing.classList.remove('hidden');
    this._setStatus('');

    try {
      const lib = await this._loadLib();

      // Convert canvas to blob
      const blob = await canvasToBlob(this._origCanvas);

      const resultBlob = await lib.removeBackground(blob, {
        publicPath: `https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/browser/`,
        model:      'medium',
        output: { format: 'image/png', quality: 0.8, type: 'foreground' },
      });

      // Draw result
      const url = URL.createObjectURL(resultBlob);
      const img = new Image();
      img.onload = () => {
        const w = this._app.canvasW, h = this._app.canvasH;
        // Draw result on result canvas
        const rCtx = this._resultCanvas.getContext('2d');
        rCtx.clearRect(0, 0, w, h);
        rCtx.drawImage(img, 0, 0, w, h);

        // Build mask: where alpha > 0 → white, else black
        const mCtx  = this._maskCanvas.getContext('2d');
        const iData = rCtx.getImageData(0, 0, w, h);
        const mask  = new ImageData(w, h);
        for (let i = 0; i < iData.data.length; i+=4) {
          const v = iData.data[i+3] > 10 ? 255 : 0;
          mask.data[i]=mask.data[i+1]=mask.data[i+2]=v;
          mask.data[i+3]=255;
        }
        mCtx.putImageData(mask, 0, 0);

        URL.revokeObjectURL(url);
        processing.classList.add('hidden');
        document.getElementById('bgr-apply').disabled = false;
        this._setStatus('✓ IA completada. Edita la máscara si es necesario.');
      };
      img.src = url;

    } catch (err) {
      processing.classList.add('hidden');
      this._setStatus(`⚠ Error: ${err.message}. Puede que el modelo no haya cargado aún.`);
      console.error('[BgRemoval]', err);
    }
  }

  /* ── Apply result to canvas ───────────────────────── */

  _applyToCanvas() {
    const w = this._app.canvasW, h = this._app.canvasH;

    // Composite: original * mask alpha
    const final = document.createElement('canvas');
    final.width = w; final.height = h;
    const ctx   = final.getContext('2d');

    const origData = this._origCanvas.getContext('2d').getImageData(0, 0, w, h);
    const maskData = this._maskCanvas.getContext('2d').getImageData(0, 0, w, h);
    const out      = new ImageData(w, h);

    for (let i = 0; i < origData.data.length; i+=4) {
      // Mask brightness as alpha
      const alpha = maskData.data[i]; // R channel of mask (0 or 255)
      out.data[i]   = origData.data[i];
      out.data[i+1] = origData.data[i+1];
      out.data[i+2] = origData.data[i+2];
      out.data[i+3] = alpha;
    }
    ctx.putImageData(out, 0, 0);

    // Add as new layer
    const imgEl = new Image();
    imgEl.onload = () => {
      this._layers.addImageLayer(imgEl, 'Sin fondo');
      document.getElementById('modal-bg-removal').classList.add('hidden');
    };
    imgEl.src = final.toDataURL('image/png');
  }

  /* ── Mask painting ────────────────────────────────── */

  _bindMaskPainting() {
    const mCanvas = this._maskCanvas;
    const ctx     = mCanvas.getContext('2d');

    const getPos = e => {
      const rect  = mCanvas.getBoundingClientRect();
      const scaleX = mCanvas.width  / rect.width;
      const scaleY = mCanvas.height / rect.height;
      const src = e.touches?.[0] || e;
      return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top)  * scaleY,
      };
    };

    const paint = e => {
      if (!this._maskPainting) return;
      const { x, y } = getPos(e);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = this._maskTool === 'restore' ? '#ffffff' : '#000000';
      ctx.beginPath();
      ctx.arc(x, y, this._maskBrushSize / 2, 0, Math.PI*2);
      ctx.fill();
      this._updateResult();
    };

    mCanvas.addEventListener('mousedown', e => { this._maskPainting = true; paint(e); });
    mCanvas.addEventListener('mousemove', paint);
    mCanvas.addEventListener('mouseup',   () => { this._maskPainting = false; });
    mCanvas.addEventListener('mouseleave',() => { this._maskPainting = false; });
  }

  _updateResult() {
    const w = this._app.canvasW, h = this._app.canvasH;
    const origData = this._origCanvas.getContext('2d').getImageData(0, 0, w, h);
    const maskData = this._maskCanvas.getContext('2d').getImageData(0, 0, w, h);
    const out = new ImageData(w, h);
    for (let i = 0; i < origData.data.length; i+=4) {
      out.data[i]   = origData.data[i];
      out.data[i+1] = origData.data[i+1];
      out.data[i+2] = origData.data[i+2];
      out.data[i+3] = maskData.data[i];
    }
    const rCtx = this._resultCanvas.getContext('2d');
    rCtx.clearRect(0, 0, w, h);
    rCtx.putImageData(out, 0, 0);
  }

  /* ── UI bindings ──────────────────────────────────── */

  _bindUI() {
    document.getElementById('bgr-brush-restore')?.addEventListener('click', e => {
      this._maskTool = 'restore';
      document.getElementById('bgr-brush-restore').classList.add('active');
      document.getElementById('bgr-brush-erase').classList.remove('active');
    });
    document.getElementById('bgr-brush-erase')?.addEventListener('click', () => {
      this._maskTool = 'erase';
      document.getElementById('bgr-brush-erase').classList.add('active');
      document.getElementById('bgr-brush-restore').classList.remove('active');
    });
    const sizeSlider = document.getElementById('bgr-brush-size');
    sizeSlider?.addEventListener('input', e => {
      this._maskBrushSize = parseInt(e.target.value);
      document.getElementById('bgr-brush-size-val').textContent = e.target.value + 'px';
    });
    document.getElementById('bgr-apply')?.addEventListener('click', () => this._applyToCanvas());
    document.getElementById('bgr-cancel')?.addEventListener('click', () => {
      document.getElementById('modal-bg-removal').classList.add('hidden');
    });
  }

  _setStatus(msg) {
    const el = document.getElementById('bgr-status');
    if (el) el.textContent = msg;
  }
}

/* ── Helper ─────────────────────────────────────────── */

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
