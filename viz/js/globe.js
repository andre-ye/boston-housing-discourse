// Three.js globe renderer.
// - Points geometry with per-point color (cluster palette).
// - Underlying sphere mesh with a baked KDE-style surface texture.
// - Orbit controls via mouse drag, scroll zoom, arrow keys.
// - Thread arcs (post → comment) drawn as great-circle cubic bezier tubes.

import * as THREE from 'three';
import { mergeGeometries as mergeBufferGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { latLonToXYZ, clusterColor, hexToRgb, SPHERE_PALETTE } from './data.js';

function sphereColor(c) {
  const i = ((c % SPHERE_PALETTE.length) + SPHERE_PALETTE.length) % SPHERE_PALETTE.length;
  return SPHERE_PALETTE[i];
}

const GLOBE_RADIUS = 1.0;
const POINT_RADIUS = 1.012;    // points sit just above globe surface
const POINT_SIZE_BASE = 0.024;
const MIN_ZOOM = 1.18;
const MAX_ZOOM = 6.0;

export class GlobeView extends EventTarget {
  constructor(canvas, state) {
    super();
    this.canvas = canvas;
    this.state = state;
    this.hoverIdx = -1;
    this.threadArcs = null;
    this.threadArcsEnabled = true;
    this.surfaceEnabled = true;
    this.highlightCl = null;
    this.highlightGid = null;
    this.highlightPosIdx = null;

    this._initScene();
    this._initPoints();
    this._initSurface();
    this._bindInteraction();
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  _initScene() {
    const w = this.canvas.clientWidth || window.innerWidth * 0.6;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(2.0, window.devicePixelRatio));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 50);
    this.camera.position.set(0, 0, 3.0);

    // World rotation as a quaternion — supports unlimited spin in any direction.
    this.worldQuat = new THREE.Quaternion();
    this.worldQuatTarget = new THREE.Quaternion();
    this.distance = 3.0;
    this.distanceTarget = 3.0;
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);

    // Lights (subtle)
    const amb = new THREE.AmbientLight(0x334455, 1.0);
    this.scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.5);
    dir.position.set(3, 2, 4);
    this.scene.add(dir);

    window.addEventListener('resize', () => this._resize());
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => this._resize());
      ro.observe(this.canvas.parentElement);
    }
  }

  _resize() {
    const w = this.canvas.clientWidth || this.canvas.parentElement.clientWidth;
    const h = this.canvas.clientHeight || this.canvas.parentElement.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _initPoints() {
    const st = this.state;
    const N = st.N;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const lat = st.coords[2*i];
      const lon = st.coords[2*i+1];
      const [x,y,z] = latLonToXYZ(lat, lon, POINT_RADIUS);
      positions[3*i] = x; positions[3*i+1] = y; positions[3*i+2] = z;
      const cl = st.cluster[i];
      const hex = sphereColor(cl);
      const [r,g,b] = hexToRgb(hex);
      colors[3*i] = r/255; colors[3*i+1] = g/255; colors[3*i+2] = b/255;
      sizes[i] = 1.0;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    // dim attribute: per-point fade when highlight filter active
    const dim = new Float32Array(N); dim.fill(1.0);
    geom.setAttribute('dim', new THREE.BufferAttribute(dim, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);

    // Build a lat/lon bucket index for fast picking.
    // 64 lat rows, 128 lon cols → equal-angle bins (cheap; not equal-area).
    this._pickRows = 64;
    this._pickCols = 128;
    const buckets = Array.from({length: this._pickRows * this._pickCols}, () => []);
    for (let i = 0; i < N; i++) {
      const lat = st.coords[2*i];
      const lon = st.coords[2*i+1];
      const r = Math.min(this._pickRows - 1, Math.floor(((lat + Math.PI/2) / Math.PI) * this._pickRows));
      const c = Math.min(this._pickCols - 1, Math.floor(((lon + Math.PI) / (2*Math.PI)) * this._pickCols));
      buckets[r * this._pickCols + c].push(i);
    }
    this._pickBuckets = buckets;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        basePx: { value: POINT_SIZE_BASE },
        devicePR: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute float size;
        attribute float dim;
        varying vec3 vColor;
        varying float vDim;
        uniform float basePx;
        uniform float devicePR;
        void main() {
          vColor = color;
          vDim = dim;
          // Transform to world space first so cull/test uses consistent space.
          vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
          vec3 worldPos = worldPos4.xyz;
          vec3 worldNormal = normalize((modelMatrix * vec4(position, 0.0)).xyz);
          vec3 toCam = cameraPosition - worldPos;
          if (dot(worldNormal, normalize(toCam)) < -0.10) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            return;
          }
          vec4 mv = viewMatrix * worldPos4;
          gl_Position = projectionMatrix * mv;
          // Tight crisp sprites; modest growth on zoom-in.
          float s = basePx * 200.0 * size * pow(-mv.z, -0.55);
          s = clamp(s, 1.2, 6.5);
          gl_PointSize = s * devicePR;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vDim;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          // Crisp filled disc with a 1-pixel antialias edge — no halo.
          float disc = 1.0 - smoothstep(0.42, 0.50, d);
          vec3 col = mix(vec3(0.30), vColor, vDim);
          float alpha = (0.45 + 0.55 * vDim) * disc;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.pointMat = mat;
    this.pointGeom = geom;
    this.points = new THREE.Points(geom, mat);
    this.worldGroup.add(this.points);
  }

  _initSurface() {
    // Surface shading removed per user request — keep only a dark backdrop
    // so back-of-sphere points are occluded.
    const _backMat = new THREE.MeshBasicMaterial({ color: 0x0a0c12, side: THREE.FrontSide });
    const _backGeom = new THREE.SphereGeometry(GLOBE_RADIUS * 0.998, 64, 32);
    this.surfaceBackdrop = new THREE.Mesh(_backGeom, _backMat);
    this.worldGroup.add(this.surfaceBackdrop);
    this.surface = null;
    this.surfaceMat = null;
    return;
    // ── unreachable (kept for revertibility) ──
    // eslint-disable-next-line no-unreachable
    {
    const W = 2048, H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, W, H);
    const st = this.state;
    const N = st.N;
    // KDE-style surface: per-cluster channel accumulation in offscreen
    // buffers, then resolved into the final canvas as a saturated argmax.
    const stride = Math.max(1, Math.floor(N / 80000));
    const colorCache = new Map();
    function getColor(cl) {
      if (!colorCache.has(cl)) colorCache.set(cl, clusterColor(cl));
      return colorCache.get(cl);
    }

    // Shuffled draw order so no cluster sits "on top" everywhere.
    const order = [];
    for (let i = 0; i < N; i += stride) order.push(i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
    ctx.globalCompositeOperation = 'source-over';
    const R = 30;
    for (const i of order) {
      const lat = st.coords[2*i];
      const lon = st.coords[2*i+1];
      const u = ((lon + Math.PI) / (2 * Math.PI)) * W;
      const v = ((Math.PI/2 - lat) / Math.PI) * H;
      const col = getColor(st.cluster[i]);
      const grd = ctx.createRadialGradient(u, v, 0, u, v, R);
      grd.addColorStop(0, col + '14');     // ~8% alpha center, very subtle
      grd.addColorStop(0.5, col + '08');
      grd.addColorStop(1, col + '00');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(u, v, R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(8,10,16,0.7)';
    ctx.fillRect(0, 0, W, H);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;

    const geom = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.55,
      depthWrite: true,
    });
    this.surfaceMat = mat;
    this.surfaceTex = tex;
    this.surfaceCanvas = canvas;
    this.surface = new THREE.Mesh(geom, mat);
    this.surface.rotation.y = -Math.PI / 2;
    this.worldGroup.add(this.surface);
    }  // close eslint block
  }

  setSurfaceEnabled(v) {
    this.surfaceEnabled = v;
    if (this.surface) this.surface.visible = v;
  }

  _bindInteraction() {
    const canvas = this.canvas;
    let dragging = false;
    let lastX = 0, lastY = 0;
    let didDrag = false;
    const ROT_SPEED = 0.0055;
    const KEY_STEP = 0.06;

    const applyScreenRotation = (dx, dy) => {
      // Drag/up-arrow moves the visible content in the same direction as
      // the cursor / arrow. Camera is at +Z looking at origin; positive
      // rotation about +Y slides equatorial points right on screen, and
      // negative rotation about +X tilts the visible band upward.
      const qx = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), dx * ROT_SPEED);
      const qy = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), dy * ROT_SPEED);
      this.worldQuatTarget.premultiply(qx).premultiply(qy);
    };

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; didDrag = false; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      canvas.classList.remove('grabbing');
      if (!didDrag) this._handleClick(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) didDrag = true;
        lastX = e.clientX; lastY = e.clientY;
        applyScreenRotation(dx, dy);
      } else {
        this._updateHover(e);
      }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Adaptive zoom: gentler when already zoomed in (small distance) so
      // the user doesn't get whip-lashed near the surface.
      const t = (this.distanceTarget - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
      const sensitivity = 0.0008 + 0.0024 * Math.max(0, Math.min(1, t));
      const factor = Math.exp(e.deltaY * sensitivity);
      this.distanceTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.distanceTarget * factor));
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft')  dx = -100;
      if (e.key === 'ArrowRight') dx = 100;
      if (e.key === 'ArrowUp')    dy = -100;
      if (e.key === 'ArrowDown')  dy = 100;
      if (dx || dy) { applyScreenRotation(dx * KEY_STEP / ROT_SPEED * 0.001, dy * KEY_STEP / ROT_SPEED * 0.001); e.preventDefault(); return; }
      const tk = (this.distanceTarget - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
      const stepFactor = 0.04 + 0.12 * Math.max(0, Math.min(1, tk));   // 0.04 in, 0.16 out
      if (e.key === '+' || e.key === '=' || e.key === 'w' || e.key === 'W') {
        this.distanceTarget = Math.max(MIN_ZOOM, this.distanceTarget * (1 - stepFactor)); e.preventDefault();
      }
      if (e.key === '-' || e.key === '_' || e.key === 's' || e.key === 'S') {
        this.distanceTarget = Math.min(MAX_ZOOM, this.distanceTarget * (1 + stepFactor)); e.preventDefault();
      }
    });

    // Programmatic API for the on-screen control pad.
    this.nudge = (dxPx, dyPx) => applyScreenRotation(dxPx, dyPx);
    this.zoom = (factor) => {
      // Pad-button zoom: blend the requested factor toward 1.0 as we zoom in.
      const t = (this.distanceTarget - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
      const k = 0.25 + 0.75 * Math.max(0, Math.min(1, t));
      const adjusted = 1 + (factor - 1) * k;
      this.distanceTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.distanceTarget * adjusted));
    };
  }

  _updateHover(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const idx = this._pickPoint(mx, my);
    if (idx !== this.hoverIdx) {
      this.hoverIdx = idx;
      this.dispatchEvent(new CustomEvent('hover', { detail: { idx, clientX: e.clientX, clientY: e.clientY } }));
    } else if (idx >= 0) {
      this.dispatchEvent(new CustomEvent('hovermove', { detail: { idx, clientX: e.clientX, clientY: e.clientY } }));
    }
  }

  _handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const idx = this._pickPoint(mx, my);
    if (idx >= 0) {
      this.dispatchEvent(new CustomEvent('pointclick', { detail: { idx, clientX: e.clientX, clientY: e.clientY } }));
    } else {
      this.dispatchEvent(new CustomEvent('bgclick'));
    }
  }

  _pickPoint(nx, ny) {
    if (!this._raycaster) this._raycaster = new THREE.Raycaster();
    this._raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const sphereHit = this._raycaster.ray.intersectSphere(
      new THREE.Sphere(new THREE.Vector3(), POINT_RADIUS * 1.02),
      new THREE.Vector3()
    );
    if (!sphereHit) return -1;
    // Convert hit (in world space) into worldGroup local space (un-rotate).
    const inv = this.worldGroup.quaternion.clone().invert();
    const local = sphereHit.applyQuaternion(inv);
    const hitLat = Math.asin(THREE.MathUtils.clamp(local.y / POINT_RADIUS / 1.02, -1, 1));
    const hitLon = Math.atan2(local.z, local.x);
    const rRow = ((hitLat + Math.PI/2) / Math.PI) * this._pickRows;
    const cCol = ((hitLon + Math.PI) / (2*Math.PI)) * this._pickCols;
    const rMin = Math.max(0, Math.floor(rRow) - 3);
    const rMax = Math.min(this._pickRows - 1, Math.floor(rRow) + 3);
    const cMin = Math.floor(cCol) - 4;
    const cMax = Math.floor(cCol) + 4;

    const vec = new THREE.Vector3();
    const st = this.state;
    const pos = this.pointGeom.attributes.position.array;
    const dimArr = this.pointGeom.attributes.dim.array;
    const wq = this.worldGroup.quaternion;
    const cx = this.camera.position.x, cy = this.camera.position.y, cz = this.camera.position.z;
    let bestIdx = -1; let bestD2 = 0.0014;  // ~ 38px on a 1600-wide canvas
    const cols = this._pickCols;
    const consider = (i) => {
      if (dimArr[i] < 0.5) return;
      vec.set(pos[3*i], pos[3*i+1], pos[3*i+2]).applyQuaternion(wq);
      const wx = vec.x, wy = vec.y, wz = vec.z;
      if (wx*(cx-wx) + wy*(cy-wy) + wz*(cz-wz) <= 0) return;
      vec.project(this.camera);
      if (vec.z > 1) return;
      const dx = vec.x - nx; const dy = vec.y - ny;
      const d2 = dx*dx + dy*dy;
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    };
    for (let r = rMin; r <= rMax; r++) {
      for (let cc = cMin; cc <= cMax; cc++) {
        const c = ((cc % cols) + cols) % cols;
        const bucket = this._pickBuckets[r * cols + c];
        for (let k = 0; k < bucket.length; k++) consider(bucket[k]);
      }
    }
    return bestIdx;
  }

  // World-space position of a lat/lon (after rotation applied), for label projection.
  worldPositionOf(lat, lon, radius = POINT_RADIUS) {
    const cl = Math.cos(lat);
    const v = new THREE.Vector3(cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon));
    v.multiplyScalar(radius).applyQuaternion(this.worldGroup.quaternion);
    return v;
  }

  rotateTo(lat, lon, distance = null) {
    // Rotate world so the unit-sphere point at (lat, lon) faces +Z (the camera).
    const cl = Math.cos(lat);
    const target = new THREE.Vector3(cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon));
    const desired = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(target, desired);
    this.worldQuatTarget.copy(q);
    if (distance != null) this.distanceTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, distance));
  }

  setHighlight({ cl = null, gid = null, posIdx = null, subLocal = null } = {}) {
    this.highlightCl = cl;
    this.highlightGid = gid;
    this.highlightPosIdx = posIdx;

    const st = this.state;
    const dim = this.pointGeom.attributes.dim.array;
    if (cl == null && gid == null && posIdx == null) {
      dim.fill(1.0);
    } else {
      let matchSub = null;
      if (gid != null) {
        // find local sub for this gid
        for (const entry of Object.values(window.App.subGidMap.byGid)) {/* unused */}
        const g = window.App.subGidMap.byGid[gid];
        if (g) matchSub = { cl: g.cl, sub: g.sub };
      }
      for (let i = 0; i < st.N; i++) {
        let match = true;
        if (cl != null && st.cluster[i] !== cl) match = false;
        if (match && matchSub) {
          if (st.cluster[i] !== matchSub.cl || st.subLocal[i] !== matchSub.sub) match = false;
        }
        dim[i] = match ? 1.0 : 0.18;
      }
    }
    this.pointGeom.attributes.dim.needsUpdate = true;
  }

  setThreadsEnabled(v) {
    this.threadArcsEnabled = v;
    if (this.threadArcs) this.threadArcs.visible = v;
  }

  async loadThreadArcs(pairs) {
    // Render each post→comment pair as a thick, lifted great-circle tube.
    if (this.threadArcs) {
      this.worldGroup.remove(this.threadArcs);
      this.threadArcs.geometry.dispose();
      this.threadArcs.material.dispose();
      this.threadArcs = null;
    }
    if (!pairs || pairs.length === 0) return;

    const st = this.state;
    const SEG = 28;
    const TUBE_RAD = 0.0048;
    const TUBE_FACETS = 5;  // 5-sided "tube" (cheaper than full circle, looks fine)
    const geometries = [];

    for (let p = 0; p < pairs.length; p++) {
      const [iA, iB] = pairs[p];
      const latA = st.coords[2*iA], lonA = st.coords[2*iA+1];
      const latB = st.coords[2*iB], lonB = st.coords[2*iB+1];
      const [ax,ay,az] = latLonToXYZ(latA, lonA, POINT_RADIUS * 1.005);
      const [bx,by,bz] = latLonToXYZ(latB, lonB, POINT_RADIUS * 1.005);
      const v1 = new THREE.Vector3(ax,ay,az);
      const v2 = new THREE.Vector3(bx,by,bz);
      const angle = v1.angleTo(v2);
      const col = sphereColor(st.cluster[iA]);
      const [r,g,b] = hexToRgb(col);

      // Build a sequence of points along the great-circle, lifted by a sine bump
      // proportional to the arc length so longer arcs reach higher.
      const pts = [];
      const sinA = Math.sin(angle) || 1e-6;
      const peakLift = 0.10 + 0.22 * Math.min(1, angle / Math.PI);  // 10-32% of radius
      for (let s = 0; s < SEG; s++) {
        const t = s / (SEG - 1);
        const w1 = Math.sin((1-t) * angle) / sinA;
        const w2 = Math.sin(t * angle) / sinA;
        const px = v1.x * w1 + v2.x * w2;
        const py = v1.y * w1 + v2.y * w2;
        const pz = v1.z * w1 + v2.z * w2;
        const lift = 1 + peakLift * Math.sin(Math.PI * t);
        pts.push(new THREE.Vector3(px * lift, py * lift, pz * lift));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.TubeGeometry(curve, SEG - 1, TUBE_RAD, TUBE_FACETS, false);
      // Per-vertex color
      const colArr = new Float32Array(tube.attributes.position.count * 3);
      for (let i = 0; i < colArr.length; i += 3) {
        colArr[i] = r/255; colArr[i+1] = g/255; colArr[i+2] = b/255;
      }
      tube.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
      geometries.push(tube);
    }

    // Merge into a single BufferGeometry to keep one draw call.
    const merged = mergeBufferGeometries(geometries);
    geometries.forEach(g => g.dispose());
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.threadArcs = new THREE.Mesh(merged, mat);
    this.threadArcs.visible = this.threadArcsEnabled;
    this.worldGroup.add(this.threadArcs);
  }

  _tick() {
    this.worldQuat.slerp(this.worldQuatTarget, 0.18);
    this.distance += (this.distanceTarget - this.distance) * 0.14;
    this.worldGroup.quaternion.copy(this.worldQuat);

    // Right-bias: lookAt a point to the LEFT of origin so the world origin
    // (where the globe sits) projects to the right portion of the canvas.
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const fovTan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfWorldW = this.distance * fovTan * (w / h);
    const shift = halfWorldW * 0.30;  // ≈ 30% off-center → globe in right ~65%
    this.camera.position.set(0, 0, this.distance);
    this.camera.lookAt(-shift, 0, 0);
    this.camera.up.set(0, 1, 0);

    if (this._onFrame) this._onFrame();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._tick);
  }
}
