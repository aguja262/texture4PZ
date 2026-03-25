/**
 * clothingPresets.js — Selector de plantillas de textura de PZ
 *
 * Organiza las texturas en 4 categorías:
 *   - Hombre humano  (MaleBody01 … MaleBody05, variantes 'a')
 *   - Mujer humana   (FemaleBody01)
 *   - Hombre zombie  (M_ZedBody01-04, niveles 0-3)
 *   - Mujer zombie   (F_ZedBody01-04, niveles 0-3)
 *
 * Al seleccionar una variante:
 *   1. Carga la textura como capa de plantilla (referencia UV, bloqueada)
 *   2. Ajusta el canvas a 256×256 (tamaño nativo de las texturas PZ)
 *   3. Carga automáticamente el modelo FBX correspondiente al género activo
 *   4. Aplica la textura al modelo 3D para ver la referencia en el visor
 */

import { bus, APP } from './app.js';

// Modelos FBX por género (rutas relativas al proyecto)
const MODELS = {
  male:   'assets/models/male_body.fbx',
  female: 'assets/models/female_body.fbx',
};

// Estructura de texturas
const CATEGORIES = [
  {
    id:     'male',
    label:  '♂ Hombre humano',
    gender: 'male',
    variants: [
      { id: 'MaleBody01',  label: 'Cuerpo 01',          file: 'assets/templates/male/MaleBody01.png' },
      { id: 'MaleBody01a', label: 'Cuerpo 01 (alt)',     file: 'assets/templates/male/MaleBody01a.png' },
      { id: 'MaleBody02',  label: 'Cuerpo 02',          file: 'assets/templates/male/MaleBody02.png' },
      { id: 'MaleBody02a', label: 'Cuerpo 02 (alt)',     file: 'assets/templates/male/MaleBody02a.png' },
      { id: 'MaleBody03',  label: 'Cuerpo 03',          file: 'assets/templates/male/MaleBody03.png' },
      { id: 'MaleBody03a', label: 'Cuerpo 03 (alt)',     file: 'assets/templates/male/MaleBody03a.png' },
      { id: 'MaleBody04',  label: 'Cuerpo 04',          file: 'assets/templates/male/MaleBody04.png' },
      { id: 'MaleBody04a', label: 'Cuerpo 04 (alt)',     file: 'assets/templates/male/MaleBody04a.png' },
      { id: 'MaleBody05',  label: 'Cuerpo 05',          file: 'assets/templates/male/MaleBody05.png' },
      { id: 'MaleBody05a', label: 'Cuerpo 05 (alt)',     file: 'assets/templates/male/MaleBody05a.png' },
    ],
  },
  {
    id:     'female',
    label:  '♀ Mujer humana',
    gender: 'female',
    variants: [
      { id: 'FemaleBody01', label: 'Cuerpo 01', file: 'assets/templates/female/FemaleBody01.png' },
    ],
  },
  {
    id:     'malezombie',
    label:  '♂ Hombre zombie',
    gender: 'male',
    variants: [
      { id: 'M_ZedBody01',       label: 'Zed 01',          file: 'assets/templates/malezombie/M_ZedBody01.png' },
      { id: 'M_ZedBody01_lv1',   label: 'Zed 01 — Nivel 1', file: 'assets/templates/malezombie/M_ZedBody01_level1.png' },
      { id: 'M_ZedBody01_lv2',   label: 'Zed 01 — Nivel 2', file: 'assets/templates/malezombie/M_ZedBody01_level2.png' },
      { id: 'M_ZedBody01_lv3',   label: 'Zed 01 — Nivel 3', file: 'assets/templates/malezombie/M_ZedBody01_level3.png' },
      { id: 'M_ZedBody02',       label: 'Zed 02',          file: 'assets/templates/malezombie/M_ZedBody02.png' },
      { id: 'M_ZedBody02_lv1',   label: 'Zed 02 — Nivel 1', file: 'assets/templates/malezombie/M_ZedBody02_level1.png' },
      { id: 'M_ZedBody02_lv2',   label: 'Zed 02 — Nivel 2', file: 'assets/templates/malezombie/M_ZedBody02_level2.png' },
      { id: 'M_ZedBody02_lv3',   label: 'Zed 02 — Nivel 3', file: 'assets/templates/malezombie/M_ZedBody02_level3.png' },
      { id: 'M_ZedBody03',       label: 'Zed 03',          file: 'assets/templates/malezombie/M_ZedBody03.png' },
      { id: 'M_ZedBody03_lv1',   label: 'Zed 03 — Nivel 1', file: 'assets/templates/malezombie/M_ZedBody03_level1.png' },
      { id: 'M_ZedBody03_lv2',   label: 'Zed 03 — Nivel 2', file: 'assets/templates/malezombie/M_ZedBody03_level2.png' },
      { id: 'M_ZedBody03_lv3',   label: 'Zed 03 — Nivel 3', file: 'assets/templates/malezombie/M_ZedBody03_level3.png' },
      { id: 'M_ZedBody04',       label: 'Zed 04',          file: 'assets/templates/malezombie/M_ZedBody04.png' },
      { id: 'M_ZedBody04_lv1',   label: 'Zed 04 — Nivel 1', file: 'assets/templates/malezombie/M_ZedBody04_level1.png' },
      { id: 'M_ZedBody04_lv2',   label: 'Zed 04 — Nivel 2', file: 'assets/templates/malezombie/M_ZedBody04_level2.png' },
    ],
  },
  {
    id:     'femalezombie',
    label:  '♀ Mujer zombie',
    gender: 'female',
    variants: [
      { id: 'F_ZedBody01',       label: 'Zed 01',           file: 'assets/templates/femalezombie/F_ZedBody01.png' },
      { id: 'F_ZedBody01_lv1',   label: 'Zed 01 — Nivel 1', file: 'assets/templates/femalezombie/F_ZedBody01_level1.png' },
      { id: 'F_ZedBody01_lv2',   label: 'Zed 01 — Nivel 2', file: 'assets/templates/femalezombie/F_ZedBody01_level2.png' },
      { id: 'F_ZedBody01_lv3',   label: 'Zed 01 — Nivel 3', file: 'assets/templates/femalezombie/F_ZedBody01_level3.png' },
      { id: 'F_ZedBody02',       label: 'Zed 02',           file: 'assets/templates/femalezombie/F_ZedBody02.png' },
      { id: 'F_ZedBody02_lv1',   label: 'Zed 02 — Nivel 1', file: 'assets/templates/femalezombie/F_ZedBody02_level1.png' },
      { id: 'F_ZedBody02_lv2',   label: 'Zed 02 — Nivel 2', file: 'assets/templates/femalezombie/F_ZedBody02_level2.png' },
      { id: 'F_ZedBody02_lv3',   label: 'Zed 02 — Nivel 3', file: 'assets/templates/femalezombie/F_ZedBody02_level3.png' },
      { id: 'F_ZedBody03',       label: 'Zed 03',           file: 'assets/templates/femalezombie/F_ZedBody03.png' },
      { id: 'F_ZedBody03_lv1',   label: 'Zed 03 — Nivel 1', file: 'assets/templates/femalezombie/F_ZedBody03_level1.png' },
      { id: 'F_ZedBody03_lv2',   label: 'Zed 03 — Nivel 2', file: 'assets/templates/femalezombie/F_ZedBody03_level2.png' },
      { id: 'F_ZedBody03_lv3',   label: 'Zed 03 — Nivel 3', file: 'assets/templates/femalezombie/F_ZedBody03_level3.png' },
      { id: 'F_ZedBody04',       label: 'Zed 04',           file: 'assets/templates/femalezombie/F_ZedBody04.png' },
      { id: 'F_ZedBody04_lv1',   label: 'Zed 04 — Nivel 1', file: 'assets/templates/femalezombie/F_ZedBody04_level1.png' },
      { id: 'F_ZedBody04_lv2',   label: 'Zed 04 — Nivel 2', file: 'assets/templates/femalezombie/F_ZedBody04_level2.png' },
      { id: 'F_ZedBody04_lv3',   label: 'Zed 04 — Nivel 3', file: 'assets/templates/femalezombie/F_ZedBody04_level3.png' },
    ],
  },
];

export class ClothingPresets {
  constructor(editor, layers, preview, fileManager, appState) {
    this._editor      = editor;
    this._layers      = layers;
    this._preview     = preview;
    this._fileManager = fileManager;
    this._app         = appState;

    this._currentCategory = null;
    this._currentVariant  = null;

    // Cache de modelos ya cargados (evita recargas)
    this._loadedModels = new Set();

    this._buildUI();
    // Cargar modelos body al arrancar
    this._autoLoadBothModels();
  }

  /* ── Construir la UI del panel ────────────────────── */

  _buildUI() {
    const catSel     = document.getElementById('preset-category');
    const variantSel = document.getElementById('preset-variant');
    if (!catSel || !variantSel) return;

    // Rellenar categorías
    CATEGORIES.forEach(cat => {
      const opt = document.createElement('option');
      opt.value       = cat.id;
      opt.textContent = cat.label;
      catSel.appendChild(opt);
    });

    // Cambio de categoría → actualizar variantes
    catSel.addEventListener('change', () => {
      this._populateVariants(catSel.value);
      // Al cambiar categoría, selecciona automáticamente la primera variante
      const first = variantSel.options[1]; // skip the "-- sin selección --"
      if (first) { variantSel.value = first.value; this._applyVariant(catSel.value, first.value); }
    });

    // Cambio de variante → cargar textura
    variantSel.addEventListener('change', () => {
      if (variantSel.value) this._applyVariant(catSel.value, variantSel.value);
    });
  }

  _populateVariants(catId) {
    const variantSel = document.getElementById('preset-variant');
    variantSel.innerHTML = '<option value="">— Variante —</option>';

    const cat = CATEGORIES.find(c => c.id === catId);
    if (!cat) return;

    cat.variants.forEach(v => {
      const opt = document.createElement('option');
      opt.value       = v.id;
      opt.textContent = v.label;
      variantSel.appendChild(opt);
    });
  }

  /* ── Aplicar variante seleccionada ───────────────── */

  async _applyVariant(catId, variantId) {
    const cat     = CATEGORIES.find(c => c.id === catId);
    if (!cat) return;
    const variant = cat.variants.find(v => v.id === variantId);
    if (!variant) return;

    this._currentCategory = cat;
    this._currentVariant  = variant;

    const status = document.getElementById('preset-status');

    // 1. Ajustar canvas a 256×256 (tamaño nativo PZ)
    if (this._app.canvasW !== 256 || this._app.canvasH !== 256) {
      if (confirm('Las texturas de PZ son 256×256. ¿Ajustar el canvas automáticamente?')) {
        this._app.canvasW = 256;
        this._app.canvasH = 256;
        this._editor.resize(256, 256, true);
        this._layers.init();
        document.getElementById('canvas-dims').textContent = '256 × 256';
        document.getElementById('canvas-size-select').value = '256';
      }
    }

    // 2. Cargar textura como capa de plantilla
    if (status) status.textContent = '⏳ Cargando…';
    await this._loadTextureAsTemplate(variant, cat.label);

    // 3. Cambiar a género correcto en el visor
    this._switchToGender(cat.gender);

    // 4. Cargar el modelo si no está ya cargado
    const modelPath = MODELS[cat.gender];
    if (modelPath && !this._loadedModels.has(modelPath)) {
      await this._loadModelFromPath(modelPath, cat.gender);
    }

    // 5. Aplicar la textura también al modelo 3D como referencia
    this._preview.setTemplateFromUrl(variant.file);

    if (status) status.textContent = `✓ ${variant.label}`;
    setTimeout(() => { if (status) status.textContent = ''; }, 2000);

    bus.emit('preset-changed', { category: cat, variant });
  }

  /* ── Carga de textura como template layer ─────────── */

  async _loadTextureAsTemplate(variant, catLabel) {
    try {
      const response = await fetch(variant.file);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);

      const img = await this._loadImg(url);
      URL.revokeObjectURL(url);

      // Eliminar templates anteriores
      const templatesToRemove = this._layers._layers.filter(l => l.isTemplate);
      templatesToRemove.forEach(() => {
        const idx = this._layers._layers.findIndex(l => l.isTemplate);
        if (idx >= 0) {
          this._editor.canvas.remove(this._layers._layers[idx].fabricObj);
          this._layers._layers.splice(idx, 1);
        }
      });
      this._editor.canvas.renderAll();

      // Añadir nueva plantilla
      this._layers.addImageLayer(img, `${catLabel} — ${variant.label}`, true);

    } catch (err) {
      console.warn(`[Presets] No se pudo cargar ${variant.file}:`, err.message);
      const status = document.getElementById('preset-status');
      if (status) status.textContent = '⚠ Plantilla no disponible';
    }
  }

  /* ── Auto-carga de modelos al arrancar ───────────── */

  async _autoLoadBothModels() {
    // Cargar ambos modelos en segundo plano para que el visor los tenga listos
    for (const [gender, path] of Object.entries(MODELS)) {
      await this._loadModelFromPath(path, gender);
    }
  }

  async _loadModelFromPath(path, gender) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], path.split('/').pop(), { type: 'application/octet-stream' });
      this._preview.loadFBX(file, gender);
      this._loadedModels.add(path);
    } catch (err) {
      console.warn(`[Presets] No se pudo cargar modelo ${path}:`, err.message);
    }
  }

  /* ── Cambiar género en el visor ──────────────────── */

  _switchToGender(gender) {
    // Actualizar botones UI
    document.querySelectorAll('.model-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.gender === gender);
    });
    this._preview.setGender(gender);
  }

  /* ── Cambio de género desde botones ♂/♀ ─────────── */

  onGenderChange(gender) {
    // Recargar modelo si no está cargado para este género
    const path = MODELS[gender];
    if (path && !this._loadedModels.has(path)) {
      this._loadModelFromPath(path, gender);
    } else {
      this._preview.setGender(gender);
    }
    // Recargar plantilla si la categoría activa cambia de género
    if (this._currentCategory && this._currentCategory.gender !== gender) {
      // Buscar categoría equivalente del otro género (human↔human, zombie↔zombie)
      const isZombie  = this._currentCategory.id.includes('zombie');
      const newCatId  = gender === 'male'
        ? (isZombie ? 'malezombie' : 'male')
        : (isZombie ? 'femalezombie' : 'female');
      const newCat    = CATEGORIES.find(c => c.id === newCatId);
      if (newCat) {
        document.getElementById('preset-category').value = newCatId;
        this._populateVariants(newCatId);
        const first = newCat.variants[0];
        document.getElementById('preset-variant').value = first.id;
        this._applyVariant(newCatId, first.id);
      }
    }
  }

  /* ── Helper ──────────────────────────────────────── */

  _loadImg(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload  = () => res(img);
      img.onerror = () => rej(new Error('Error cargando imagen'));
      img.src     = src;
    });
  }
}
