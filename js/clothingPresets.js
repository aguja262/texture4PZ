/**
 * clothingPresets.js — Prendas predefinidas para Project Zomboid
 * Gestiona el panel de selección de prendas, cargando modelos FBX y plantillas UV.
 */

import { bus } from './app.js';

// Definición de prendas. Los archivos se añadirán en assets/models y assets/templates.
export const PRESETS = [
  {
    id:       'none',
    name:     '— Sin prenda seleccionada —',
    models:   { female: null, male: null },
    template: null,
    size:     1024,
  },
  {
    id:       'tshirt',
    name:     'Camiseta',
    models:   {
      female: 'assets/models/tshirt_female.fbx',
      male:   'assets/models/tshirt_male.fbx',
    },
    template: 'assets/templates/tshirt_template.png',
    size:     1024,
  },
  {
    id:       'shirt',
    name:     'Camisa larga',
    models:   {
      female: 'assets/models/shirt_female.fbx',
      male:   'assets/models/shirt_male.fbx',
    },
    template: 'assets/templates/shirt_template.png',
    size:     1024,
  },
  {
    id:       'jacket',
    name:     'Chaqueta / Cazadora',
    models:   {
      female: 'assets/models/jacket_female.fbx',
      male:   'assets/models/jacket_male.fbx',
    },
    template: 'assets/templates/jacket_template.png',
    size:     1024,
  },
  {
    id:       'hoodie',
    name:     'Sudadera con capucha',
    models:   {
      female: 'assets/models/hoodie_female.fbx',
      male:   'assets/models/hoodie_male.fbx',
    },
    template: 'assets/templates/hoodie_template.png',
    size:     1024,
  },
  {
    id:       'pants',
    name:     'Pantalón',
    models:   {
      female: 'assets/models/pants_female.fbx',
      male:   'assets/models/pants_male.fbx',
    },
    template: 'assets/templates/pants_template.png',
    size:     1024,
  },
  {
    id:       'shorts',
    name:     'Pantalón corto',
    models:   {
      female: 'assets/models/shorts_female.fbx',
      male:   'assets/models/shorts_male.fbx',
    },
    template: 'assets/templates/shorts_template.png',
    size:     1024,
  },
  {
    id:       'boots',
    name:     'Botas',
    models:   {
      female: 'assets/models/boots_female.fbx',
      male:   'assets/models/boots_male.fbx',
    },
    template: 'assets/templates/boots_template.png',
    size:     512,
  },
  {
    id:       'shoes',
    name:     'Zapatos / Zapatillas',
    models:   {
      female: 'assets/models/shoes_female.fbx',
      male:   'assets/models/shoes_male.fbx',
    },
    template: 'assets/templates/shoes_template.png',
    size:     512,
  },
  {
    id:       'hat',
    name:     'Sombrero / Gorro',
    models:   {
      female: 'assets/models/hat_female.fbx',
      male:   'assets/models/hat_male.fbx',
    },
    template: 'assets/templates/hat_template.png',
    size:     512,
  },
  {
    id:       'backpack',
    name:     'Mochila',
    models:   {
      female: 'assets/models/backpack_female.fbx',
      male:   'assets/models/backpack_male.fbx',
    },
    template: 'assets/templates/backpack_template.png',
    size:     1024,
  },
];

export class ClothingPresets {
  constructor(editor, layers, preview, fileManager, appState) {
    this._editor      = editor;
    this._layers      = layers;
    this._preview     = preview;
    this._fileManager = fileManager;
    this._app         = appState;
    this._current     = null;

    this._buildUI();
  }

  /* ── Construir panel de selección ─────────────────── */

  _buildUI() {
    const select = document.getElementById('preset-select');
    if (!select) return;

    PRESETS.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });

    select.addEventListener('change', e => this._applyPreset(e.target.value));
  }

  /* ── Aplicar prenda seleccionada ──────────────────── */

  async _applyPreset(id) {
    const preset = PRESETS.find(p => p.id === id);
    if (!preset || id === 'none') { this._current = null; return; }

    this._current = preset;

    const status = document.getElementById('preset-status');
    if (status) status.textContent = '';

    // 1. Cargar plantilla UV (si existe)
    if (preset.template) {
      await this._loadTemplateFromPath(preset.template, preset);
    }

    // 2. Cargar modelo 3D activo (según género seleccionado)
    const gender = document.querySelector('.model-btn.active')?.dataset.gender ?? 'male';
    const modelPath = preset.models[gender];
    if (modelPath) {
      await this._loadModelFromPath(modelPath, gender, status);
    } else if (status) {
      status.textContent = '⚠ Modelo pendiente de añadir';
    }

    bus.emit('preset-changed', preset);
  }

  async _loadTemplateFromPath(path, preset) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        this._showTemplateNotFound(path);
        return;
      }
      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      await new Promise((res, rej) => {
        img.onload  = res;
        img.onerror = rej;
        img.src = url;
      });

      // Eliminar plantillas UV anteriores
      this._layers._layers
        .filter(l => l.isTemplate)
        .forEach(() => this._layers.deleteActive());

      this._layers.addImageLayer(img, `Plantilla: ${preset.name}`, true);

      // Añadir al selector de template del preview 3D
      const sel = document.getElementById('template-select');
      let opt = sel.querySelector(`option[data-preset="${preset.id}"]`);
      if (!opt) {
        opt = document.createElement('option');
        opt.dataset.preset = preset.id;
        sel.appendChild(opt);
      }
      opt.value       = url;
      opt.textContent = `Plantilla: ${preset.name}`;
      sel.value = url;
      this._preview.setTemplate(url);

    } catch (_) {
      this._showTemplateNotFound(path);
    }
  }

  async _loadModelFromPath(path, gender, statusEl) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        if (statusEl) statusEl.textContent = `⚠ Modelo aún no disponible (${path})`;
        return;
      }
      const blob = await response.blob();
      const file = new File([blob], path.split('/').pop(), { type: 'application/octet-stream' });
      this._preview.loadFBX(file, gender);
    } catch (_) {
      if (statusEl) statusEl.textContent = `⚠ No se encontró el modelo (${path.split('/').pop()})`;
    }
  }

  _showTemplateNotFound(path) {
    console.warn(`[ClothingPresets] Plantilla no encontrada: ${path}`);
  }

  /** Cambiar género recarga el modelo del preset activo */
  onGenderChange(gender) {
    if (!this._current) return;
    const modelPath = this._current.models[gender];
    if (modelPath) {
      const statusEl = document.getElementById('preset-status');
      this._loadModelFromPath(modelPath, gender, statusEl);
    }
  }
}
