/**
 * filters.js — Image filter / adjustment pipeline
 * Applies non-destructive-style adjustments (brightness, contrast, hue, etc.)
 * to the active layer via raw ImageData manipulation.
 */

import { bus } from './app.js';

export class Filters {
  constructor(editor, layers, appState) {
    this._editor = editor;
    this._layers = layers;
    this._app    = appState;
  }

  /* ── Read current slider values ─────────────────── */

  _getValues() {
    const g = id => parseFloat(document.getElementById(id)?.value ?? 0);
    return {
      brightness:  g('filter-brightness'),  // -100…100
      contrast:    g('filter-contrast'),    // -100…100
      saturation:  g('filter-saturation'),  // -100…100
      hue:         g('filter-hue'),         // -180…180
      temperature: g('filter-temperature'), // -100…100
      vibrance:    g('filter-vibrance'),    // -100…100
      sharpen:     g('filter-sharpen'),     // 0…5
      blur:        g('filter-blur'),        // 0…20
    };
  }

  resetSliders() {
    const ids = ['filter-brightness','filter-contrast','filter-saturation',
                 'filter-hue','filter-temperature','filter-vibrance',
                 'filter-sharpen','filter-blur'];
    const valIds = ['f-brightness-val','f-contrast-val','f-saturation-val',
                    'f-hue-val','f-temp-val','f-vibrance-val',
                    'f-sharpen-val','f-blur-val'];
    const fmts = [v=>`${v}`,v=>`${v}`,v=>`${v}`,v=>`${v}°`,
                  v=>`${v}`,v=>`${v}`,v=>`${v}`,v=>`${v}`];
    ids.forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = 0;
      const vi = document.getElementById(valIds[i]);
      if (vi) vi.textContent = fmts[i](0);
    });
  }

  /* ── Apply all filters to active layer ───────────── */

  applyToActiveLayer() {
    const layer = this._layers.getActive();
    if (!layer) { alert('No hay ninguna capa activa.'); return; }

    const vals = this._getValues();

    // Get the canvas context and composite all objects into a temp canvas
    const w = this._app.canvasW;
    const h = this._app.canvasH;

    // Render the entire canvas to a temp canvas to get ImageData
    const temp = document.createElement('canvas');
    temp.width = w; temp.height = h;
    const ctx  = temp.getContext('2d');

    // Draw just the active layer's fabric object
    const fabricObj = layer.fabricObj;
    if (!fabricObj) return;

    // Render to temp
    if (fabricObj.getElement && fabricObj.getElement()) {
      ctx.drawImage(fabricObj.getElement(), 0, 0, w, h);
    } else {
      // Fallback: export current canvas composite
      const img = new Image();
      img.src = this._editor.toDataURL({ format: 'png' });
      ctx.drawImage(img, 0, 0);
    }

    let imgData = ctx.getImageData(0, 0, w, h);

    // Apply filters in sequence
    if (vals.blur > 0)        imgData = this._applyBlur(imgData, w, h, vals.blur);
    if (vals.sharpen > 0)     imgData = this._applySharpen(imgData, w, h, vals.sharpen);
    imgData = this._applyBrightnessContrast(imgData, vals.brightness, vals.contrast);
    imgData = this._applyHueSaturation(imgData, vals.hue, vals.saturation, vals.vibrance);
    imgData = this._applyTemperature(imgData, vals.temperature);

    ctx.putImageData(imgData, 0, 0);

    // Replace the fabric object with the filtered result
    fabric.Image.fromURL(temp.toDataURL(), newImg => {
      newImg.set({
        left: 0, top: 0,
        scaleX: 1, scaleY: 1,
        selectable: layer.fabricObj.selectable,
        evented:    layer.fabricObj.evented,
        opacity:    layer.opacity,
        globalCompositeOperation: layer.blendMode,
      });
      newImg._layerId   = layer.id;
      newImg._layerName = layer.name;

      const zIdx = this._editor.canvas.getObjects().indexOf(layer.fabricObj);
      this._editor.canvas.remove(layer.fabricObj);
      this._editor.canvas.insertAt(newImg, zIdx, false);
      layer.fabricObj = newImg;
      this._editor.canvas.renderAll();
      this._editor._saveState();
      bus.emit('canvas-changed');

      // Reset sliders after apply
      this.resetSliders();
    });
  }

  /* ── Color match (histogram matching to template) ── */

  colorMatchToTemplate() {
    const templateLayer = this._layers._layers.find(l => l.isTemplate);
    const activeLayer   = this._layers.getActive();
    if (!templateLayer) { alert('No hay capa de plantilla UV cargada.'); return; }
    if (!activeLayer || activeLayer.isTemplate) { alert('Selecciona la capa a armonizar (no la plantilla).'); return; }

    const w = this._app.canvasW;
    const h = this._app.canvasH;

    const getCtxData = (fabricObj) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d');
      if (fabricObj.getElement?.()) cx.drawImage(fabricObj.getElement(), 0, 0, w, h);
      return cx.getImageData(0, 0, w, h);
    };

    const srcData  = getCtxData(activeLayer.fabricObj);
    const refData  = getCtxData(templateLayer.fabricObj);
    const matched  = this._histogramMatch(srcData, refData, w, h);

    const result = document.createElement('canvas');
    result.width = w; result.height = h;
    result.getContext('2d').putImageData(matched, 0, 0);

    fabric.Image.fromURL(result.toDataURL(), newImg => {
      newImg.set({ left:0,top:0,scaleX:1,scaleY:1,
        opacity: activeLayer.opacity,
        globalCompositeOperation: activeLayer.blendMode,
        selectable: activeLayer.fabricObj.selectable,
        evented:    activeLayer.fabricObj.evented,
      });
      newImg._layerId   = activeLayer.id;
      newImg._layerName = activeLayer.name;
      const zIdx = this._editor.canvas.getObjects().indexOf(activeLayer.fabricObj);
      this._editor.canvas.remove(activeLayer.fabricObj);
      this._editor.canvas.insertAt(newImg, zIdx, false);
      activeLayer.fabricObj = newImg;
      this._editor.canvas.renderAll();
      this._editor._saveState();
      bus.emit('canvas-changed');
    });
  }

  /* ── Private: filter algorithms ─────────────────── */

  _applyBrightnessContrast(imgData, brightness, contrast) {
    const d = imgData.data;
    const b = brightness / 100;
    const c = contrast;
    const factor = (259 * (c + 255)) / (255 * (259 - c));
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i+1], bl2 = d[i+2];
      // Brightness
      r += b * 255; g += b * 255; bl2 += b * 255;
      // Contrast
      r = factor * (r - 128) + 128;
      g = factor * (g - 128) + 128;
      bl2 = factor * (bl2 - 128) + 128;
      d[i]   = clamp(r);
      d[i+1] = clamp(g);
      d[i+2] = clamp(bl2);
    }
    return imgData;
  }

  _applyHueSaturation(imgData, hueShift, saturation, vibrance) {
    const d = imgData.data;
    const h = hueShift / 360;
    const s = saturation / 100;
    const v = vibrance / 100;
    for (let i = 0; i < d.length; i += 4) {
      let [rh, rs, rl] = rgbToHsl(d[i], d[i+1], d[i+2]);
      rh = (rh + h + 1) % 1;
      // Saturation
      const newSat = rs + s;
      // Vibrance (boost low-saturated colors more)
      const vibranceBoost = v * (1 - rs * 2);
      rs = clamp01(newSat + vibranceBoost);
      const [nr, ng, nb] = hslToRgb(rh, rs, rl);
      d[i]   = nr; d[i+1] = ng; d[i+2] = nb;
    }
    return imgData;
  }

  _applyTemperature(imgData, temp) {
    const d = imgData.data;
    const t = temp / 100;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = clamp(d[i]   + t * 30);   // red
      d[i+2] = clamp(d[i+2] - t * 30);   // blue
    }
    return imgData;
  }

  _applyBlur(imgData, w, h, radius) {
    // Simple box blur approximated as stack blur passes
    const passes = Math.ceil(radius / 2);
    let data = new ImageData(new Uint8ClampedArray(imgData.data), w, h);
    for (let p = 0; p < passes; p++) {
      data = boxBlur(data, w, h, Math.ceil(radius));
    }
    return data;
  }

  _applySharpen(imgData, w, h, amount) {
    const d = imgData.data;
    const result = new Uint8ClampedArray(d);
    const k = amount;
    const kernel = [
       0, -k,   0,
      -k, 1+4*k,-k,
       0, -k,   0,
    ];
    for (let y = 1; y < h-1; y++) {
      for (let x = 1; x < w-1; x++) {
        for (let c = 0; c < 3; c++) {
          let v = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const idx = ((y+ky)*w+(x+kx))*4+c;
              v += d[idx] * kernel[(ky+1)*3+(kx+1)];
            }
          }
          result[(y*w+x)*4+c] = clamp(v);
        }
      }
    }
    return new ImageData(result, w, h);
  }

  _histogramMatch(srcData, refData, w, h) {
    // Per-channel CDF matching
    const result = new ImageData(new Uint8ClampedArray(srcData.data), w, h);
    [0,1,2].forEach(c => {
      const srcCdf = buildCdf(srcData.data, c);
      const refCdf = buildCdf(refData.data, c);
      const lut    = buildLut(srcCdf, refCdf);
      for (let i = c; i < result.data.length; i += 4) {
        result.data[i] = lut[result.data[i]];
      }
    });
    return result;
  }
}

/* ── Utilities ─────────────────────────────────────── */

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      case b: h=(r-g)/d+4; break;
    }
    h /= 6;
  }
  return [h,s,l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r=g=b=l; }
  else {
    const q = l<0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    r = hue2rgb(p,q,h+1/3);
    g = hue2rgb(p,q,h);
    b = hue2rgb(p,q,h-1/3);
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}
function hue2rgb(p,q,t) {
  if(t<0)t+=1; if(t>1)t-=1;
  if(t<1/6)return p+(q-p)*6*t;
  if(t<1/2)return q;
  if(t<2/3)return p+(q-p)*(2/3-t)*6;
  return p;
}

function boxBlur(imgData, w, h, r) {
  const src = imgData.data;
  const dst = new Uint8ClampedArray(src.length);
  const half = Math.floor(r/2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = [0,0,0,0]; let count = 0;
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const nx = Math.max(0,Math.min(w-1,x+kx));
          const ny = Math.max(0,Math.min(h-1,y+ky));
          const i  = (ny*w+nx)*4;
          sum[0]+=src[i]; sum[1]+=src[i+1]; sum[2]+=src[i+2]; sum[3]+=src[i+3];
          count++;
        }
      }
      const i = (y*w+x)*4;
      dst[i]=sum[0]/count; dst[i+1]=sum[1]/count;
      dst[i+2]=sum[2]/count; dst[i+3]=sum[3]/count;
    }
  }
  return new ImageData(dst, w, h);
}

function buildCdf(data, channel) {
  const hist = new Float32Array(256);
  const total = data.length / 4;
  for (let i = channel; i < data.length; i += 4) hist[data[i]]++;
  const cdf = new Float32Array(256);
  cdf[0] = hist[0] / total;
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i]/total;
  return cdf;
}

function buildLut(srcCdf, refCdf) {
  const lut = new Uint8Array(256);
  for (let s = 0; s < 256; s++) {
    let best = 0, bestDiff = Infinity;
    for (let r = 0; r < 256; r++) {
      const diff = Math.abs(srcCdf[s] - refCdf[r]);
      if (diff < bestDiff) { bestDiff = diff; best = r; }
    }
    lut[s] = best;
  }
  return lut;
}
