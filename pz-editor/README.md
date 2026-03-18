# PZ Texture Editor 🧟

Editor de texturas para **Project Zomboid** — 100% cliente, sin servidor, publicable directamente en GitHub Pages.

## ✨ Características

| Módulo | Funcionalidades |
|---|---|
| **Editor (Fabric.js)** | Pincel, borrador, pixel art, relleno, texto, formas, cuentagotas |
| **Capas** | Añadir / borrar / duplicar / fusionar · Blend modes · Opacidad · Drag-drop |
| **Filtros** | Brillo, contraste, saturación, tono, temperatura, vibración, nitidez, desenfoque · Armonización de color |
| **Preview 3D (Three.js)** | Carga modelo FBX (hombre/mujer) · Textura en tiempo real · OrbitControls |
| **Borrado de fondo IA** | @imgly/background-removal — WASM en navegador, sin API key · Edición manual de máscara |
| **Importar/Exportar** | PNG / JPEG / WebP · Proyectos .pzproj (JSON) · Plantilla UV · Fuentes TTF/OTF |
| **Conversión .X → FBX** | Script Python/Blender incluido para convertir modelos DirectX |

## 🚀 Uso local

```bash
# Clonar o descomprimir el proyecto
cd pz-editor

# Cualquier servidor HTTP local sirve (necesario por ES modules + fetch WASM)
npx serve .
# o:
python3 -m http.server 8080
# o simplemente abre index.html en VS Code con Live Server
```

> ⚠️ **No abras `index.html` directamente con `file://`** — los módulos ES y el WASM del borrado de fondo requieren un servidor HTTP.

## 🌐 GitHub Pages

1. Sube la carpeta entera como repositorio.
2. Ve a **Settings → Pages → Source → Deploy from branch** → selecciona `main` / `/ (root)`.
3. Accede a `https://<tu-usuario>.github.io/<nombre-repo>/`

No hay build step. Todo es HTML + CSS + JS modules nativos.

## 📁 Estructura

```
pz-editor/
├── index.html          # Interfaz completa
├── css/
│   ├── main.css        # Variables, reset, componentes
│   ├── toolbar.css     # Barra superior
│   ├── tool-panel.css  # Panel izquierdo (herramientas)
│   ├── editor.css      # Área del canvas
│   ├── panels.css      # Panel derecho (3D + capas)
│   └── modals.css      # Modales y menú contextual
├── js/
│   ├── app.js          # Entry point, bus de eventos, shortcuts
│   ├── editor.js       # Wrapper Fabric.js (zoom, undo/redo, overlay)
│   ├── layers.js       # Sistema de capas
│   ├── tools.js        # Herramientas de pintura
│   ├── filters.js      # Ajustes de imagen
│   ├── preview3d.js    # Escena Three.js + FBXLoader
│   ├── bgRemoval.js    # Borrado de fondo IA
│   ├── fileManager.js  # I/O archivos
│   └── colorPicker.js  # Modal selector de color
└── assets/
    ├── models/         # Pon aquí tus modelos FBX
    └── templates/      # Pon aquí tus plantillas UV PNG
```

## 🧍 Modelos 3D

El editor acepta archivos **.fbx**. Si tienes modelos en formato **.X** (DirectX):

1. Haz clic en "Modelo 3D" y selecciona el archivo `.x`.
2. El editor te preguntará si quieres descargar un **script Python para Blender**.
3. Ejecuta en terminal:
   ```bash
   blender --background --python convert_x_to_fbx.py -- modelo.x modelo.fbx
   ```
4. Carga el `.fbx` resultante.

**Nomenglatura recomendada para autodetección de género:**
- `player_female.fbx` → detectado como mujer ♀
- `player_male.fbx` → detectado como hombre ♂

## ⌨️ Atajos de teclado

| Acción | Tecla |
|---|---|
| Herramientas | V B P E F T R O L I C |
| Deshacer / Rehacer | Ctrl+Z / Ctrl+Y |
| Guardar proyecto | Ctrl+S |
| Exportar PNG | Ctrl+E |
| Nuevo proyecto | Ctrl+N |
| Zoom +/- | +  /  - |
| Ajustar al viewport | 0 |
| Borrar selección | Delete |
| Cancelar | Escape |

## 📦 Dependencias (CDN, sin instalación)

| Librería | Versión | Uso |
|---|---|---|
| [Fabric.js](http://fabricjs.com/) | 5.3.0 | Canvas editor |
| [Three.js](https://threejs.org/) | r158 | Preview 3D |
| [@imgly/background-removal](https://img.ly/open-source/background-removal-js) | 1.4.5 | IA borrado fondo |
| [Barlow / Share Tech Mono](https://fonts.google.com/) | — | Fuentes UI |

## 📝 Licencia

Uso personal / project modding. No incluye assets de Project Zomboid — debes proveer tus propios modelos y plantillas UV.
