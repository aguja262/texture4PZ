/**
 * colorPicker.js — Advanced color picker modal
 * Gradient SV area, hue strip, alpha strip, HEX/RGB/HSL inputs, recent swatches.
 */

import { bus, APP } from './app.js';

export class ColorPicker {
  constructor(appState) {
    this._app       = appState;
    this._target    = 'primary'; // 'primary' | 'secondary'
    this._hue       = 0;         // 0–360
    this._sat       = 1;         // 0–1 (SV space)
    this._val       = 1;         // 0–1 (SV space)
    this._alpha     = 255;       // 0–255
    this._recent    = [];
    this._dragging  = null;      // 'gradient' | 'hue' | 'alpha'

    this._gradCanvas  = document.getElementById('cp-gradient');
    this._hueCanvas   = document.getElementById('cp-hue-bar');
    this._alphaCanvas = document.getElementById('cp-alpha-bar');

    this._gradCursor  = document.getElementById('cp-gradient-cursor');
    this._hueCursor   = document.getElementById('cp-hue-cursor');
    this._alphaCursor = document.getElementById('cp-alpha-cursor');

    this._init();
  }

  /* ── Open picker ──────────────────────────────────── */

  open(target = 'primary') {
    this._target = target;
    const color = target === 'primary' ? APP.primaryColor : APP.secondaryColor;
    this._setFromHex(color);

    // Store old color for preview
    document.getElementById('cp-old-color').style.background = color;

    document.getElementById('modal-color-picker').classList.remove('hidden');
    this._drawAll();
    this._updateInputs();
    this._moveCursors();
  }

  /* ── Private init ─────────────────────────────────── */

  _init() {
    /* Gradient mouse events */
    const grad = document.getElementById('cp-gradient-area');
    grad.addEventListener('mousedown',  e => { this._dragging = 'gradient'; this._handleGradient(e); });
    window.addEventListener('mousemove', e => { if (this._dragging === 'gradient') this._handleGradient(e); });

    /* Hue strip */
    this._hueCanvas.addEventListener('mousedown',  e => { this._dragging = 'hue'; this._handleHue(e); });
    window.addEventListener('mousemove', e => { if (this._dragging === 'hue') this._handleHue(e); });

    /* Alpha strip */
    this._alphaCanvas.addEventListener('mousedown',  e => { this._dragging = 'alpha'; this._handleAlpha(e); });
    window.addEventListener('mousemove', e => { if (this._dragging === 'alpha') this._handleAlpha(e); });

    window.addEventListener('mouseup', () => { this._dragging = null; });

    /* Hex input */
    document.getElementById('cp-hex').addEventListener('change', e => {
      this._setFromHex(e.target.value);
      this._drawAll();
      this._updateInputs();
      this._moveCursors();
      this._previewNew();
    });

    /* RGB inputs */
    ['cp-r','cp-g','cp-b'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => this._fromRGB());
    });

    /* HSL inputs */
    ['cp-h','cp-s','cp-l'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => this._fromHSL());
    });

    /* Alpha slider */
    document.getElementById('cp-a')?.addEventListener('input', e => {
      this._alpha = parseInt(e.target.value);
      document.getElementById('cp-a-val').textContent = this._alpha;
      this._updateInputs();
      this._previewNew();
    });

    /* Apply / cancel */
    document.getElementById('cp-apply')?.addEventListener('click', () => this._apply());
    document.getElementById('cp-cancel')?.addEventListener('click', () => {
      document.getElementById('modal-color-picker').classList.add('hidden');
    });

    /* Old color → revert */
    document.getElementById('cp-old-color')?.addEventListener('click', () => {
      const old = document.getElementById('cp-old-color').style.background;
      this._setFromCss(old);
      this._drawAll();
      this._updateInputs();
      this._moveCursors();
      this._previewNew();
    });
  }

  /* ── Drawing ─────────────────────────────────────── */

  _drawAll() {
    this._drawGradient();
    this._drawHueBar();
    this._drawAlphaBar();
  }

  _drawGradient() {
    const ctx = this._gradCanvas.getContext('2d');
    const w   = this._gradCanvas.width;
    const h   = this._gradCanvas.height;
    const hue = this._hue;

    // Base hue color
    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
    ctx.fillRect(0, 0, w, h);

    // White → transparent (left to right)
    const white = ctx.createLinearGradient(0, 0, w, 0);
    white.addColorStop(0, 'rgba(255,255,255,1)');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, w, h);

    // Transparent → black (top to bottom)
    const black = ctx.createLinearGradient(0, 0, 0, h);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, w, h);
  }

  _drawHueBar() {
    const ctx = this._hueCanvas.getContext('2d');
    const w   = this._hueCanvas.width;
    const h   = this._hueCanvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    for (let i = 0; i <= 6; i++) {
      grad.addColorStop(i/6, `hsl(${i*60},100%,50%)`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  _drawAlphaBar() {
    const ctx = this._alphaCanvas.getContext('2d');
    const w   = this._alphaCanvas.width;
    const h   = this._alphaCanvas.height;

    // Checker background
    const size = 5;
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        ctx.fillStyle = ((Math.floor(y/size)+Math.floor(x/size))%2 === 0) ? '#fff' : '#ccc';
        ctx.fillRect(x, y, size, size);
      }
    }

    const [r,g,b] = hsvToRgb(this._hue, this._sat, this._val);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  /* ── Cursor positioning ──────────────────────────── */

  _moveCursors() {
    const gW = this._gradCanvas.width;
    const gH = this._gradCanvas.height;
    this._gradCursor.style.left = (this._sat * gW) + 'px';
    this._gradCursor.style.top  = ((1 - this._val) * gH) + 'px';

    const hH = this._hueCanvas.height;
    this._hueCursor.style.top   = ((this._hue / 360) * hH) + 'px';

    const aH = this._alphaCanvas.height;
    this._alphaCursor.style.top = ((1 - this._alpha / 255) * aH) + 'px';
  }

  /* ── Handle mouse interactions ───────────────────── */

  _handleGradient(e) {
    const rect = this._gradCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width,  e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    this._sat = x / rect.width;
    this._val = 1 - y / rect.height;
    this._afterChange();
  }

  _handleHue(e) {
    const rect = this._hueCanvas.getBoundingClientRect();
    const y    = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    this._hue  = (y / rect.height) * 360;
    this._drawGradient();
    this._drawAlphaBar();
    this._afterChange();
  }

  _handleAlpha(e) {
    const rect   = this._alphaCanvas.getBoundingClientRect();
    const y      = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    this._alpha  = Math.round(255 * (1 - y / rect.height));
    document.getElementById('cp-a').value = this._alpha;
    document.getElementById('cp-a-val').textContent = this._alpha;
    this._afterChange();
  }

  _afterChange() {
    this._moveCursors();
    this._updateInputs();
    this._previewNew();
  }

  /* ── Input sync ──────────────────────────────────── */

  _updateInputs() {
    const [r,g,b] = hsvToRgb(this._hue, this._sat, this._val);
    const a = this._alpha;
    const hex = rgbaToHex(r,g,b,a);
    const [h2,s2,l2] = rgbToHsl(r,g,b);

    document.getElementById('cp-hex').value = hex;
    document.getElementById('cp-r').value   = r;
    document.getElementById('cp-g').value   = g;
    document.getElementById('cp-b').value   = b;
    document.getElementById('cp-h').value   = Math.round(h2 * 360);
    document.getElementById('cp-s').value   = Math.round(s2 * 100);
    document.getElementById('cp-l').value   = Math.round(l2 * 100);
    document.getElementById('cp-a').value   = a;
    document.getElementById('cp-a-val').textContent = a;
  }

  _fromRGB() {
    const r = parseInt(document.getElementById('cp-r').value) || 0;
    const g = parseInt(document.getElementById('cp-g').value) || 0;
    const b = parseInt(document.getElementById('cp-b').value) || 0;
    [this._hue, this._sat, this._val] = rgbToHsv(r, g, b);
    this._drawAll();
    this._updateInputs();
    this._moveCursors();
    this._previewNew();
  }

  _fromHSL() {
    const h = parseInt(document.getElementById('cp-h').value) || 0;
    const s = parseInt(document.getElementById('cp-s').value) || 0;
    const l = parseInt(document.getElementById('cp-l').value) || 0;
    const [r,g,b] = hslToRgb(h/360, s/100, l/100);
    [this._hue, this._sat, this._val] = rgbToHsv(r,g,b);
    this._drawAll();
    this._updateInputs();
    this._moveCursors();
    this._previewNew();
  }

  _setFromHex(hex) {
    hex = hex.replace('#','').trim();
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = parseInt(hex.slice(0,2),16) || 0;
    const g = parseInt(hex.slice(2,4),16) || 0;
    const b = parseInt(hex.slice(4,6),16) || 0;
    this._alpha = hex.length >= 8 ? parseInt(hex.slice(6,8),16) : 255;
    [this._hue, this._sat, this._val] = rgbToHsv(r,g,b);
  }

  _setFromCss(css) {
    // parse rgb/rgba
    const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) {
      const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
      this._alpha = m[4] !== undefined ? Math.round(parseFloat(m[4])*255) : 255;
      [this._hue, this._sat, this._val] = rgbToHsv(r,g,b);
    }
  }

  _previewNew() {
    const [r,g,b] = hsvToRgb(this._hue, this._sat, this._val);
    const hex = rgbaToHex(r,g,b,this._alpha);
    document.getElementById('cp-new-color').style.background = hex;
  }

  /* ── Apply color ──────────────────────────────────── */

  _apply() {
    const [r,g,b] = hsvToRgb(this._hue, this._sat, this._val);
    const hex = rgbaToHex(r,g,b,this._alpha);

    // Add to recent swatches
    this._recent = [hex, ...this._recent.filter(c => c !== hex)].slice(0, 20);
    this._renderSwatches();

    bus.emit('color-picked', { color: hex, target: this._target });
    document.getElementById('modal-color-picker').classList.add('hidden');
  }

  _renderSwatches() {
    const container = document.getElementById('cp-recent-swatches');
    if (!container) return;
    container.innerHTML = this._recent.map(c =>
      `<div class="cp-swatch" style="background:${c}" data-color="${c}" title="${c}"></div>`
    ).join('');
    container.querySelectorAll('.cp-swatch').forEach(el => {
      el.addEventListener('click', () => {
        this._setFromHex(el.dataset.color);
        this._drawAll();
        this._updateInputs();
        this._moveCursors();
        this._previewNew();
      });
    });
  }
}

/* ── Color conversion helpers ─────────────────────── */

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  const d = max - min;
  let h = 0, s = max === 0 ? 0 : d/max, v = max;
  if (d !== 0) {
    switch(max){
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      case b: h=(r-g)/d+4; break;
    }
    h *= 60;
  }
  return [h, s, v];
}

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c  = v * s;
  const x  = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m  = v - c;
  let r=0,g=0,b=0;
  if      (h<60)  {r=c;g=x;b=0;}
  else if (h<120) {r=x;g=c;b=0;}
  else if (h<180) {r=0;g=c;b=x;}
  else if (h<240) {r=0;g=x;b=c;}
  else if (h<300) {r=x;g=0;b=c;}
  else            {r=c;g=0;b=x;}
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

function rgbToHsl(r, g, b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0, s=0, l=(max+min)/2;
  if (max!==min) {
    const d=max-min;
    s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      case b: h=(r-g)/d+4; break;
    }
    h/=6;
  }
  return [h,s,l];
}

function hslToRgb(h,s,l){
  let r,g,b;
  if(s===0){r=g=b=l;}
  else{
    const q=l<0.5?l*(1+s):l+s-l*s;
    const p=2*l-q;
    r=hue2r(p,q,h+1/3);
    g=hue2r(p,q,h);
    b=hue2r(p,q,h-1/3);
  }
  return [Math.round(r*255),Math.round(g*255),Math.round(b*255)];
}
function hue2r(p,q,t){
  if(t<0)t+=1;if(t>1)t-=1;
  if(t<1/6)return p+(q-p)*6*t;
  if(t<1/2)return q;
  if(t<2/3)return p+(q-p)*(2/3-t)*6;
  return p;
}

function rgbaToHex(r,g,b,a=255) {
  return '#'+[r,g,b,a].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
}
