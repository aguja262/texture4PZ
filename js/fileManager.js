/**
 * fileManager.js — File I/O operations
 * Handles: open image, open template, load FBX, save/load project JSON,
 *          export PNG, import custom font, .X conversion helper.
 */

import { bus, APP } from './app.js';

export class FileManager {
  constructor(editor, layers, preview, appState) {
    this._editor  = editor;
    this._layers  = layers;
    this._preview = preview;
    this._app     = appState;
  }

  /* ── Open image as a new layer ──────────────────── */

  openImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      this._layers.addImageLayer(img, file.name.replace(/\.[^.]+$/, ''));
    };
    img.src = url;
  }

  /* ── Open template (UV reference) ───────────────── */

  openTemplate(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      this._layers.addImageLayer(img, 'Plantilla UV', true);

      // Add to template selector in 3D panel
      const select = document.getElementById('template-select');
      const opt    = document.createElement('option');
      const objUrl = URL.createObjectURL(file);
      opt.value = objUrl;
      opt.textContent = file.name;
      select.appendChild(opt);
      select.value = objUrl;
      this._preview.setTemplate(objUrl);
    };
    img.src = url;
  }

  /* ── Load FBX / .X model ─────────────────────────── */

  loadModel(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'fbx') {
      // Usa el botón de género actualmente seleccionado en la UI
      // (si el usuario ha pulsado ♀ antes de cargar, se asigna a mujer; si pulsó ♂, a hombre)
      const activeBtn = document.querySelector('.model-btn.active');
      const gender    = activeBtn?.dataset.gender ?? 'male';
      this._preview.loadFBX(file, gender);
      console.log(`[FileManager] Modelo cargado como: ${gender}`);
    } else if (ext === 'x') {
      // .X format: offer Blender conversion script
      this._handleXFormat(file);
    } else {
      alert(`Formato de modelo no soportado: .${ext}\nSe aceptan archivos .fbx`);
    }
  }

  /* ── .X → FBX conversion helper ─────────────────── */

  _handleXFormat(file) {
    const choice = confirm(
      `.X (DirectX mesh) detectado: "${file.name}"\n\n` +
      'El editor carga modelos FBX. Para convertir, puedes:\n\n' +
      '1. Usar Blender (gratis): File > Import > DirectX (.x) → luego File > Export > FBX\n' +
      '2. Usar MeshLab o Noesis.\n\n' +
      '¿Quieres descargar un script de Python para Blender que automatice la conversión?'
    );
    if (choice) this._downloadBlenderScript(file.name);
  }

  _downloadBlenderScript(sourceFilename) {
    const script = `# Blender Python script: convert .X to .FBX
# Usage: blender --background --python convert_x_to_fbx.py -- input.x output.fbx
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
input_file  = argv[0] if len(argv) > 0 else "model.x"
output_file = argv[1] if len(argv) > 1 else "model.fbx"

# Clear scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import .X
bpy.ops.import_scene.x(filepath=input_file)

# Export .FBX
bpy.ops.export_scene.fbx(
    filepath=output_file,
    use_selection=False,
    global_scale=1.0,
    apply_unit_scale=True,
    apply_scale_options='FBX_SCALE_NONE',
    bake_space_transform=False,
    object_types={'MESH','ARMATURE'},
    use_mesh_modifiers=True,
    mesh_smooth_type='FACE',
    use_tspace=True,
    use_custom_props=False,
    add_leaf_bones=False,
    primary_bone_axis='Y',
    secondary_bone_axis='X',
    use_armature_deform_only=False,
    bake_anim=True,
    bake_anim_use_all_bones=True,
    bake_anim_use_nla_strips=False,
    bake_anim_use_all_actions=False,
    bake_anim_force_startend_keying=True,
    bake_anim_step=1.0,
    bake_anim_simplify_factor=1.0,
    path_mode='AUTO',
    embed_textures=False,
    batch_mode='OFF',
    use_batch_own_dir=True,
    axis_forward='-Z',
    axis_up='Y',
)

print(f"[OK] Exported: {output_file}")
`;
    const blob = new Blob([script], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'convert_x_to_fbx.py';
    a.click();
    URL.revokeObjectURL(a.href);
    alert(
      'Script descargado: convert_x_to_fbx.py\n\n' +
      'Instrucciones:\n' +
      '1. Instala Blender (blender.org)\n' +
      '2. Abre Blender → Scripting\n' +
      '3. Abre el script, ajusta las rutas y ejecuta\n' +
      '   O desde terminal: blender --background --python convert_x_to_fbx.py -- modelo.x modelo.fbx\n' +
      '4. Vuelve a cargar el .fbx generado aquí'
    );
  }

  /* ── Save project (JSON) ─────────────────────────── */

  saveProject() {
    const projectData = {
      version:   '1.0',
      timestamp: new Date().toISOString(),
      canvasW:   this._app.canvasW,
      canvasH:   this._app.canvasH,
      canvas:    this._editor.canvas.toJSON(['_layerId','_layerName','_isTemplate','_locked']),
      layers:    this._layers._layers.map(l => ({
        id:         l.id,
        name:       l.name,
        visible:    l.visible,
        locked:     l.locked,
        isTemplate: l.isTemplate,
        blendMode:  l.blendMode,
        opacity:    l.opacity,
      })),
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `pz_project_${dateStamp()}.pzproj`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── Load project (JSON) ─────────────────────────── */

  loadProject(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.canvas) { alert('Archivo de proyecto inválido.'); return; }
        this._app.canvasW = data.canvasW ?? 1024;
        this._app.canvasH = data.canvasH ?? 1024;
        this._editor.resize(data.canvasW, data.canvasH, true);
        this._editor.canvas.loadFromJSON(data.canvas, () => {
          this._editor.canvas.renderAll();
          bus.emit('canvas-changed');
          bus.emit('layer-changed');
        });
      } catch (err) {
        alert('Error al cargar el proyecto: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* ── Export PNG / JPEG / WebP ────────────────────── */

  exportPNG({ format = 'png', scale = 1, filename = 'texture', quality = 0.95, flatAll = true, noTemplate = false } = {}) {
    const excludeIds = noTemplate
      ? this._layers._layers.filter(l => l.isTemplate).map(l => l.id)
      : [];

    const dataUrl = this._editor.toDataURL({
      format,
      quality,
      multiplier: scale,
      excludeLayerIds: excludeIds,
    });

    const ext = format === 'jpeg' ? 'jpg' : format;
    const a   = document.createElement('a');
    a.href     = dataUrl;
    a.download = `${filename}.${ext}`;
    a.click();
  }

  /* ── Import custom font ───────────────────────────── */

  importFont(file, tools) {
    const reader = new FileReader();
    reader.onload = e => {
      const fontName = file.name.replace(/\.[^.]+$/, '');
      const face = new FontFace(fontName, e.target.result);
      face.load().then(loaded => {
        document.fonts.add(loaded);
        // Add to font selector
        const sel = document.getElementById('text-font');
        if (sel) {
          const opt = document.createElement('option');
          opt.value = `'${fontName}', sans-serif`;
          opt.textContent = fontName;
          sel.appendChild(opt);
          sel.value = opt.value;
        }
      }).catch(err => alert('Error cargando fuente: ' + err.message));
    };
    reader.readAsArrayBuffer(file);
  }
}

/* ── Helpers ─────────────────────────────────────────── */

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function pad(n) { return String(n).padStart(2,'0'); }
