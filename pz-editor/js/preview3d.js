/**
 * preview3d.js — Three.js 3D preview panel
 * Loads FBX models, applies a live CanvasTexture, and supports OrbitControls.
 * Also handles .X → FBX conversion by downloading a helper Blender script.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader }     from 'three/addons/loaders/FBXLoader.js';
import { bus }           from './app.js';

export class Preview3D {
  constructor(canvasId, appState) {
    this._app       = appState;
    this._canvas    = document.getElementById(canvasId);
    this._model     = null;
    this._texture   = null;
    this._genders   = { male: null, female: null };
    this._gender    = 'female';
    this._running   = false;
    this._updateTimer = null;

    this._initScene();
  }

  /* ── Scene setup ──────────────────────────────────── */

  _initScene() {
    const w = this._canvas.clientWidth  || 260;
    const h = this._canvas.clientHeight || 260;

    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
      alpha: true,
    });
    this._renderer.setSize(w, h, false);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.outputEncoding = THREE.sRGBEncoding;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.2;

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x0d0f0d);

    // Camera
    this._camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 2000);
    this._camera.position.set(0, 100, 300);

    // Orbit controls
    this._controls = new OrbitControls(this._camera, this._canvas);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
    this._controls.minDistance   = 50;
    this._controls.maxDistance   = 800;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this._scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(100, 200, 150);
    dirLight.castShadow = true;
    this._scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x7aab45, 0.3);
    fillLight.position.set(-100, 80, -100);
    this._scene.add(fillLight);

    // Ground grid
    const grid = new THREE.GridHelper(400, 20, 0x2a332a, 0x1a221a);
    grid.position.y = -0.5;
    this._scene.add(grid);

    // Render loop
    this._running = true;
    this._animate();

    // Handle resize
    const ro = new ResizeObserver(() => this._onResize());
    ro.observe(this._canvas.parentElement);
  }

  _animate() {
    if (!this._running) return;
    requestAnimationFrame(() => this._animate());
    this._controls.update();
    this._renderer.render(this._scene, this._camera);
  }

  _onResize() {
    const container = this._canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h, false);
  }

  /* ── Load FBX model ───────────────────────────────── */

  loadFBX(file, gender = 'male') {
    const url = URL.createObjectURL(file);
    const loader = new FBXLoader();

    loader.load(url, (fbx) => {
      URL.revokeObjectURL(url);

      // Remove previous model of this gender
      if (this._genders[gender]) {
        this._scene.remove(this._genders[gender]);
        disposeObject(this._genders[gender]);
      }

      // Auto-scale to a reasonable size
      const box    = new THREE.Box3().setFromObject(fbx);
      const size   = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale  = 200 / maxDim;
      fbx.scale.setScalar(scale);

      // Center at ground
      const box2   = new THREE.Box3().setFromObject(fbx);
      const center = box2.getCenter(new THREE.Vector3());
      fbx.position.sub(center);
      fbx.position.y = 0;

      fbx.traverse(child => {
        if (child.isMesh) {
          child.castShadow    = true;
          child.receiveShadow = true;
          if (this._texture) {
            child.material = new THREE.MeshStandardMaterial({ map: this._texture });
          }
        }
      });

      this._genders[gender] = fbx;
      if (this._gender === gender) {
        this._scene.add(fbx);
        this._model = fbx;
      }

      this._updateTemplate(gender);
      bus.emit('model-loaded', { gender });
    },
    xhr => { /* progress */ },
    err => { console.error('[Preview3D] Error cargando FBX:', err); });
  }

  /* ── Switch gender ────────────────────────────────── */

  setGender(gender) {
    if (this._genders[this._gender]) this._scene.remove(this._genders[this._gender]);
    this._gender = gender;
    if (this._genders[gender]) {
      this._scene.add(this._genders[gender]);
      this._model = this._genders[gender];
    } else {
      this._model = null;
    }
  }

  /* ── Apply template overlay ───────────────────────── */

  setTemplate(src) {
    if (!src) return;
    const texLoader = new THREE.TextureLoader();
    texLoader.load(src, tex => {
      this._templateTex = tex;
    });
  }

  _updateTemplate(gender) {
    const model = this._genders[gender];
    if (!model || !this._templateTex) return;
    model.traverse(child => {
      if (child.isMesh && child.material?.map === undefined) {
        child.material = new THREE.MeshStandardMaterial({ map: this._templateTex });
      }
    });
  }

  /* ── Live texture update from editor canvas ──────── */

  updateTexture(editor) {
    if (!this._model) return;

    // Throttle updates to ~10fps
    clearTimeout(this._updateTimer);
    this._updateTimer = setTimeout(() => {
      this._doUpdateTexture(editor);
    }, 100);
  }

  _doUpdateTexture(editor) {
    try {
      const dataUrl = editor.toDataURL({ format: 'png' });
      if (!this._texture) {
        const img = new Image();
        img.onload = () => {
          this._texture = new THREE.CanvasTexture(img);
          this._texture.encoding = THREE.sRGBEncoding;
          this._applyTextureToModel();
        };
        img.src = dataUrl;
      } else {
        const img = new Image();
        img.onload = () => {
          const ctx = document.createElement('canvas');
          ctx.width = img.width; ctx.height = img.height;
          ctx.getContext('2d').drawImage(img, 0, 0);
          this._texture.image = ctx;
          this._texture.needsUpdate = true;
        };
        img.src = dataUrl;
      }
    } catch(_) {}
  }

  _applyTextureToModel() {
    if (!this._model || !this._texture) return;
    this._model.traverse(child => {
      if (child.isMesh) {
        if (!child.material || child.material.type !== 'MeshStandardMaterial') {
          child.material = new THREE.MeshStandardMaterial();
        }
        child.material.map = this._texture;
        child.material.needsUpdate = true;
      }
    });
  }

  /* ── Camera controls ──────────────────────────────── */

  resetCamera() {
    this._camera.position.set(0, 100, 300);
    this._controls.target.set(0, 80, 0);
    this._controls.update();
  }

  /* ── Cleanup ──────────────────────────────────────── */

  dispose() {
    this._running = false;
    this._renderer.dispose();
  }
}

/* ── Dispose Three.js object tree ─────────────────── */

function disposeObject(obj) {
  obj.traverse(child => {
    if (child.geometry)  child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(m => disposeMaterial(m));
      } else {
        disposeMaterial(child.material);
      }
    }
  });
}

function disposeMaterial(mat) {
  if (mat.map)     mat.map.dispose();
  if (mat.dispose) mat.dispose();
}
