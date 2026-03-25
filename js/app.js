/**
 * app.js — PZ Texture Editor
 * Entry point: initialises all modules and wires up global events / keyboard shortcuts.
 */

import { Editor }          from './editor.js';
import { LayerManager }    from './layers.js';
import { ToolManager }     from './tools.js';
import { Preview3D }       from './preview3d.js';
import { FileManager }     from './fileManager.js';
import { BgRemoval }       from './bgRemoval.js';
import { Filters }         from './filters.js';
import { ColorPicker }     from './colorPicker.js';

/* ── Global state ─────────────────────────────────── */
export const APP = {
  canvasW: 1024,
  canvasH: 1024,
  zoom: 1,
  primaryColor:   '#000000ff',
  secondaryColor: '#ffffffff',
  gridVisible: false,
  pixelGridVisible: false,
  checkerVisible: true,
  previewLive: true,
};

/* ── Event bus (tiny pub/sub) ─────────────────────── */
const _listeners = {};
export const bus = {
  on(ev, fn)  { (_listeners[ev] ??= []).push(fn); },
  off(ev, fn) { _listeners[ev] = (_listeners[ev] ?? []).filter(f => f !== fn); },
  emit(ev, data) { (_listeners[ev] ?? []).forEach(fn => fn(data)); },
};

/* ── Init ─────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {

  /* Instantiate modules */
  const editor      = new Editor('main-canvas', APP);
  const layers      = new LayerManager(editor, APP);
  const tools       = new ToolManager(editor, layers, APP);
  const preview     = new Preview3D('preview-3d', APP);
  const files       = new FileManager(editor, layers, preview, APP);
  const bgRemoval   = new BgRemoval(editor, layers, APP);
  const filters     = new Filters(editor, layers, APP);
  const colorPicker = new ColorPicker(APP);

  let presets = null;
  try {
    const { ClothingPresets } = await import('./clothingPresets.js');
    presets = new ClothingPresets(editor, layers, preview, files, APP);
  } catch (e) {
    console.error('[App] Error cargando ClothingPresets:', e);
  }

  window._pze = { editor, layers, tools, preview, files, bgRemoval, filters, colorPicker, presets };

  /* ── Wire toolbar buttons ─────────────────────── */
  $('btn-new').addEventListener('click', () => showModal('modal-new-project'));
  $('btn-open-image').addEventListener('click', () => $('file-image').click());
  $('btn-open-template').addEventListener('click', () => $('file-template').click());
  $('btn-load-model').addEventListener('click', () => $('file-model').click());
  $('btn-load-model-quick').addEventListener('click', () => $('file-model').click());
  $('btn-save-project').addEventListener('click', () => files.saveProject());
  $('btn-export').addEventListener('click', () => showModal('modal-export'));

  $('btn-undo').addEventListener('click', () => editor.undo());
  $('btn-redo').addEventListener('click', () => editor.redo());

  $('btn-zoom-out').addEventListener('click', () => editor.setZoom(APP.zoom * 0.8));
  $('btn-zoom-in').addEventListener('click',  () => editor.setZoom(APP.zoom * 1.25));
  $('btn-zoom-fit').addEventListener('click', () => editor.fitToScreen());

  /* Toggle buttons */
  setupToggle('btn-grid',          v => { APP.gridVisible = v; editor.drawOverlay(); });
  setupToggle('btn-pixel-grid',    v => { APP.pixelGridVisible = v; editor.drawOverlay(); });
  setupToggle('btn-checkerboard',  v => { APP.checkerVisible = v; $('checker-bg').style.display = v ? '' : 'none'; }, true);
  setupToggle('btn-pixel-mode',    v => { tools.setPixelMode(v); });
  setupToggle('preview-toggle-live', v => { APP.previewLive = v; });

  /* Canvas size preset */
  $('canvas-size-select').addEventListener('change', e => {
    const val = e.target.value;
    if (val === 'custom') { showModal('modal-new-project'); return; }
    const s = parseInt(val);
    resizeCanvas(s, s, editor, layers);
  });

  /* ── File inputs ─────────────────────────────── */
  $('file-image').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    files.openImage(f);
    e.target.value = '';
  });
  $('file-template').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    files.openTemplate(f);
    e.target.value = '';
  });
  $('file-model').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    files.loadModel(f);
    e.target.value = '';
  });
  $('file-project').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    files.loadProject(f);
    e.target.value = '';
  });
  $('file-font').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    files.importFont(f, tools);
    e.target.value = '';
  });

  /* ── New project modal ───────────────────────── */
  $('new-preset').addEventListener('change', e => {
    const show = e.target.value === 'custom';
    $('new-custom-dims').classList.toggle('hidden', !show);
  });
  $('new-cancel').addEventListener('click', () => hideModal('modal-new-project'));
  $('new-confirm').addEventListener('click', () => {
    const preset = $('new-preset').value;
    let w = 1024, h = 1024;
    if (preset !== 'custom') {
      [w, h] = preset.split(',').map(Number);
    } else {
      w = parseInt($('new-width').value) || 1024;
      h = parseInt($('new-height').value) || 1024;
    }
    const transparent = $('new-transparent').checked;
    hideModal('modal-new-project');
    resizeCanvas(w, h, editor, layers, transparent);
  });

  /* ── Export modal ────────────────────────────── */
  $('export-format').addEventListener('change', e => {
    $('export-quality-row').classList.toggle('hidden', e.target.value !== 'jpeg');
  });
  $('export-quality').addEventListener('input', e => {
    $('export-quality-val').textContent = e.target.value + '%';
  });
  $('export-cancel').addEventListener('click', () => hideModal('modal-export'));
  $('export-confirm').addEventListener('click', () => {
    files.exportPNG({
      format:      $('export-format').value,
      scale:       parseFloat($('export-scale').value),
      filename:    $('export-filename').value || 'texture',
      quality:     parseInt($('export-quality').value) / 100,
      flatAll:     $('export-flat').checked,
      noTemplate:  $('export-no-template').checked,
    });
    hideModal('modal-export');
  });

  /* ── Filter section ──────────────────────────── */
  const filterSliders = [
    ['filter-brightness', 'f-brightness-val', v => `${v}`],
    ['filter-contrast',   'f-contrast-val',   v => `${v}`],
    ['filter-saturation', 'f-saturation-val', v => `${v}`],
    ['filter-hue',        'f-hue-val',        v => `${v}°`],
    ['filter-temperature','f-temp-val',        v => `${v}`],
    ['filter-vibrance',   'f-vibrance-val',    v => `${v}`],
    ['filter-sharpen',    'f-sharpen-val',     v => `${v}`],
    ['filter-blur',       'f-blur-val',        v => `${v}`],
  ];
  filterSliders.forEach(([id, valId, fmt]) => {
    $(id).addEventListener('input', e => $(valId).textContent = fmt(e.target.value));
  });
  $('apply-filters-btn').addEventListener('click', () => filters.applyToActiveLayer());
  $('reset-filters-btn').addEventListener('click', () => filters.resetSliders());
  $('color-match-btn').addEventListener('click', () => filters.colorMatchToTemplate());

  /* ── Color swatches ──────────────────────────── */
  $('primary-color').addEventListener('click', () => colorPicker.open('primary'));
  $('secondary-color').addEventListener('click', () => colorPicker.open('secondary'));
  $('swap-colors').addEventListener('click', () => {
    const tmp = APP.primaryColor;
    APP.primaryColor = APP.secondaryColor;
    APP.secondaryColor = tmp;
    updateColorSwatches();
    bus.emit('color-changed', { primary: APP.primaryColor });
  });
  $('reset-colors').addEventListener('click', () => {
    APP.primaryColor = '#000000ff';
    APP.secondaryColor = '#ffffffff';
    updateColorSwatches();
    bus.emit('color-changed', { primary: APP.primaryColor });
  });

  /* ── Layers panel controls ───────────────────── */
  $('btn-add-layer').addEventListener('click', () => layers.addEmpty());
  $('btn-add-image-layer').addEventListener('click', () => $('file-image').click());
  $('btn-duplicate-layer').addEventListener('click', () => layers.duplicateActive());
  $('btn-merge-down').addEventListener('click', () => layers.mergeDown());
  $('btn-delete-layer').addEventListener('click', () => layers.deleteActive());

  $('layer-blend-select').addEventListener('change', e => layers.setActiveBlendMode(e.target.value));
  $('layer-opacity-slider').addEventListener('input', e => {
    const v = e.target.value;
    $('layer-opacity-val').textContent = v + '%';
    layers.setActiveOpacity(v / 100);
  });

  /* ── 3D Preview ──────────────────────────────── */
  $('preview-reset-cam').addEventListener('click', () => preview.resetCamera());
  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const gender = btn.dataset.gender;
      preview.setGender(gender);
      presets?.onGenderChange(gender);
    });
  });

  /* ── Scale layer modal ───────────────────────────── */
  {
    const pSlider = $('scale-percent-slider');
    const pInput  = $('scale-percent');
    const wInput  = $('scale-width');
    const hInput  = $('scale-height');
    const xInput  = $('scale-x');
    const yInput  = $('scale-y');
    const propChk = $('scale-proportional');

    // Función para abrir el modal con valores actuales de la capa
    const openScaleModal = () => {
      const layer = layers.getActive();
      if (!layer?.fabricObj) { alert('Selecciona una capa primero.'); return; }
      const fo  = layer.fabricObj;
      const cW  = Math.round((fo.width  || APP.canvasW) * (fo.scaleX || 1));
      const cH  = Math.round((fo.height || APP.canvasH) * (fo.scaleY || 1));
      pSlider.value = 100;
      pInput.value  = 100;
      wInput.value  = cW;
      hInput.value  = cH;
      xInput.value  = Math.round(fo.left || 0);
      yInput.value  = Math.round(fo.top  || 0);
      showModal('modal-scale-layer');
    };

    // Sincronizar slider ↔ input de porcentaje
    const syncPercent = val => {
      pSlider.value = val;
      pInput.value  = val;
      const layer = layers.getActive();
      if (!layer?.fabricObj) return;
      const fo = layer.fabricObj;
      const origW = Math.round((fo.width  || APP.canvasW) * (fo.scaleX || 1));
      const origH = Math.round((fo.height || APP.canvasH) * (fo.scaleY || 1));
      wInput.value = Math.round(origW * val / 100);
      hInput.value = Math.round(origH * val / 100);
    };
    pSlider.addEventListener('input',  e => syncPercent(e.target.value));
    pInput.addEventListener('change',  e => syncPercent(e.target.value));

    // Sincronizar ancho ↔ alto (proporcional)
    wInput.addEventListener('change', e => {
      if (!propChk.checked) return;
      const layer = layers.getActive();
      if (!layer?.fabricObj) return;
      const fo = layer.fabricObj;
      const origW = (fo.width  || APP.canvasW) * (fo.scaleX || 1);
      const origH = (fo.height || APP.canvasH) * (fo.scaleY || 1);
      const newW = parseInt(e.target.value);
      hInput.value = Math.round(newW * (origH / origW));
    });
    hInput.addEventListener('change', e => {
      if (!propChk.checked) return;
      const layer = layers.getActive();
      if (!layer?.fabricObj) return;
      const fo = layer.fabricObj;
      const origW = (fo.width  || APP.canvasW) * (fo.scaleX || 1);
      const origH = (fo.height || APP.canvasH) * (fo.scaleY || 1);
      const newH = parseInt(e.target.value);
      wInput.value = Math.round(newH * (origW / origH));
    });

    $('scale-cancel').addEventListener('click', () => hideModal('modal-scale-layer'));
    $('scale-apply').addEventListener('click', () => {
      const layer = layers.getActive();
      if (!layer?.fabricObj) return;
      const fo   = layer.fabricObj;
      const newW = parseInt(wInput.value) || 1;
      const newH = parseInt(hInput.value) || 1;
      const newX = parseInt(xInput.value) || 0;
      const newY = parseInt(yInput.value) || 0;
      fo.set({
        scaleX: newW / (fo.width  || APP.canvasW),
        scaleY: newH / (fo.height || APP.canvasH),
        left:   newX,
        top:    newY,
      });
      fo.setCoords();
      editor.canvas.renderAll();
      editor._saveState();
      bus.emit('canvas-changed');
      hideModal('modal-scale-layer');
    });

    // Exponer para el context menu
    window._openScaleModal = openScaleModal;
  }
  $('template-select').addEventListener('change', e => preview.setTemplate(e.target.value));

  /* ── Import font ─────────────────────────────── */
  $('import-font-btn').addEventListener('click', () => $('file-font').click());

  /* ── Context menu ────────────────────────────── */
  setupContextMenu(layers, bgRemoval, filters);

  /* ── Global modal close ──────────────────────── */
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => hideModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) hideModal(overlay.id);
    });
  });

  /* ── Keyboard shortcuts ──────────────────────── */
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    const key = (e.ctrlKey || e.metaKey) ? `Ctrl+${e.key.toLowerCase()}` : e.key.toLowerCase();
    switch (key) {
      case 'Ctrl+z': e.preventDefault(); editor.undo(); break;
      case 'Ctrl+y':
      case 'Ctrl+shift+z': e.preventDefault(); editor.redo(); break;
      case 'Ctrl+s': e.preventDefault(); files.saveProject(); break;
      case 'Ctrl+e': e.preventDefault(); showModal('modal-export'); break;
      case 'Ctrl+n': e.preventDefault(); showModal('modal-new-project'); break;
      case 'v': tools.setTool('select'); break;
      case 'b': tools.setTool('brush'); break;
      case 'p': tools.setTool('pixel-paint'); break;
      case 'e': tools.setTool('eraser'); break;
      case 'f': tools.setTool('fill'); break;
      case 't': tools.setTool('text'); break;
      case 'r': tools.setTool('rect'); break;
      case 'o': tools.setTool('ellipse'); break;
      case 'l': tools.setTool('line'); break;
      case 'i': tools.setTool('eyedropper'); break;
      case 'c': tools.setTool('crop'); break;
      case '+':
      case '=': editor.setZoom(APP.zoom * 1.25); break;
      case '-': editor.setZoom(APP.zoom * 0.8); break;
      case '0': editor.fitToScreen(); break;
      case 'delete':
      case 'backspace': editor.deleteSelected(); break;
      case 'escape': editor.cancelAction(); break;
    }
  });

  /* ── Bus listeners ───────────────────────────── */
  bus.on('canvas-changed', () => {
    if (APP.previewLive) preview.updateTexture(editor);
    layers.refreshThumbnails();
    updateUndoRedoButtons(editor);
  });
  bus.on('layer-changed', () => {
    syncLayerControls(layers);
  });
  bus.on('color-picked', ({ color, target }) => {
    if (target === 'primary')   APP.primaryColor = color;
    if (target === 'secondary') APP.secondaryColor = color;
    updateColorSwatches();
    bus.emit('color-changed', { primary: APP.primaryColor });
  });
  bus.on('zoom-changed', z => {
    $('zoom-display').textContent = Math.round(z * 100) + '%';
  });
  bus.on('model-loaded', () => {
    $('preview-placeholder').style.display = 'none';
  });

  /* ── Initial state ───────────────────────────── */
  updateColorSwatches();
  layers.init();
  editor.fitToScreen();
  updateUndoRedoButtons(editor);

  console.log('[PZ Texture Editor] Inicializado correctamente.');
});

/* ── Helpers ──────────────────────────────────────── */

function $(id) { return document.getElementById(id); }

function showModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
function hideModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function setupToggle(id, onChange, defaultActive = false) {
  const btn = document.getElementById(id);
  if (!btn) return;
  let active = defaultActive;
  btn.dataset.active = active;
  btn.classList.toggle('active', active);
  btn.addEventListener('click', () => {
    active = !active;
    btn.dataset.active = active;
    btn.classList.toggle('active', active);
    onChange(active);
  });
}

function updateColorSwatches() {
  const primary = document.getElementById('primary-color');
  const secondary = document.getElementById('secondary-color');
  primary.style.background = APP.primaryColor;
  secondary.style.background = APP.secondaryColor;
}

function updateUndoRedoButtons(editor) {
  document.getElementById('btn-undo').disabled = !editor.canUndo();
  document.getElementById('btn-redo').disabled = !editor.canRedo();
}

function syncLayerControls(layers) {
  const active = layers.getActive();
  if (!active) return;
  const sel = document.getElementById('layer-blend-select');
  const opSlider = document.getElementById('layer-opacity-slider');
  const opVal = document.getElementById('layer-opacity-val');
  sel.value = active.blendMode ?? 'source-over';
  const op = Math.round((active.opacity ?? 1) * 100);
  opSlider.value = op;
  opVal.textContent = op + '%';
}

function resizeCanvas(w, h, editor, layers, transparent = true) {
  APP.canvasW = w;
  APP.canvasH = h;
  document.getElementById('canvas-dims').textContent = `${w} × ${h}`;
  document.getElementById('canvas-size-select').value = [256,512,1024,2048].includes(w) ? w : 'custom';
  editor.resize(w, h, transparent);
  layers.init();
}

function setupContextMenu(layers, bgRemoval, filters) {
  const menu = document.getElementById('context-menu');

  // Show on right-click over layer items
  document.getElementById('layers-list').addEventListener('contextmenu', e => {
    e.preventDefault();
    const item = e.target.closest('.layer-item');
    if (!item) return;
    const layerIdx = parseInt(item.dataset.index);
    layers.setActive(layerIdx);
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';
    menu.classList.remove('hidden');
  });

  // Also right-click on canvas area
  document.getElementById('canvas-area').addEventListener('contextmenu', e => {
    e.preventDefault();
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';
    menu.classList.remove('hidden');
  });

  // Actions
  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('click', () => {
      menu.classList.add('hidden');
      switch (item.dataset.action) {
        case 'duplicate':    layers.duplicateActive(); break;
        case 'merge-down':   layers.mergeDown(); break;
        case 'scale':        window._openScaleModal?.(); break;
        case 'bg-remove':    bgRemoval.openModal(); break;
        case 'apply-filters':document.getElementById('filter-brightness').closest('.filter-section')
                               .scrollIntoView({ behavior: 'smooth' }); break;
        case 'rename':       layers.renameActive(); break;
        case 'delete':       layers.deleteActive(); break;
      }
    });
  });

  // Close on click outside
  document.addEventListener('click', e => {
    if (!menu.contains(e.target)) menu.classList.add('hidden');
  });
}
