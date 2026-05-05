// Three.js globe renderer.
// - Points geometry with per-point color (cluster palette).
// - Underlying sphere mesh with a baked KDE-style surface texture.
// - Orbit controls via mouse drag, scroll zoom, arrow keys.
// - Thread arcs (post → comment) drawn as great-circle cubic bezier tubes.

import * as THREE from 'three';
import { mergeGeometries as mergeBufferGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { latLonToXYZ, clusterColor, hexToRgb, SPHERE_PALETTE } from './data.js?v=233';

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
    this.threadArcsEnabled = false;   // off by default — per-hover arcs still draw on demand
    this._threadArcPairs = null;
    this._threadArcOpts = null;
    this._threadArcZoomBucket = null;
    this._lastThreadArcRebuildMs = 0;
    this.surfaceEnabled = true;
    this.highlightCl = null;
    this.highlightGid = null;
    this.highlightPosIdx = null;

    this._initScene();
    this._initPoints();
    this._initSurface();
    this._initPins();
    this._bindInteraction();
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  _initPins() {
    // Pins live in their own group above the sphere surface, with custom
    // picking that runs *before* point picking. Each pin is a small
    // billboarded sprite (inner disc + outer pulse ring).
    this.pinsGroup = new THREE.Group();
    this.pinsEnabled = true;
    this.worldGroup.add(this.pinsGroup);
    this.pins = [];            // [{data, pos:Vector3, screenX, screenY}]
    this.hoverPinIdx = -1;
    // Pin sprite DOM layer (not WebGL) — richer typography + shadows + click
    // handling than Three.js sprites, while still driven by projected world
    // coords each frame.
    this.pinLayer = document.getElementById('pin-labels');
    if (!this.pinLayer) {
      this.pinLayer = document.createElement('div');
      this.pinLayer.id = 'pin-labels';
      this.pinLayer.className = 'pin-labels';
      this.canvas.parentElement.appendChild(this.pinLayer);
    }
  }

  setInterviewPins(placements, _interviewsDoc) {
    // Build one DOM pin per placement. Positioned every frame by
    // _updatePinScreenPositions() below.
    this.pinLayer.innerHTML = '';
    this.pins = [];
    for (const pl of placements || []) {
      const cl = pl.cluster;
      const color = sphereColor(cl);
      const clMeta = this.state.clusterMeta?.[String(cl)];
      const data = {
        ...pl,
        cluster_name: clMeta?.name,
      };
      const el = document.createElement('button');
      el.className = 'pin';
      el.innerHTML = `
        <span class="pin-ring" style="background:${color}"></span>
        <span class="pin-dot" style="background:${color}"></span>
        <span class="pin-id" style="color:${color}">${pl.id}</span>
      `;
      el.dataset.id = pl.id;
      el.onmouseenter = (e) => {
        this.hoverPinIdx = this.pins.findIndex(p => p.data.id === pl.id);
        this.dispatchEvent(new CustomEvent('pinhover', { detail: { pin: data, clientX: e.clientX, clientY: e.clientY } }));
      };
      el.onmousemove = (e) => {
        this.dispatchEvent(new CustomEvent('pinhover', { detail: { pin: data, clientX: e.clientX, clientY: e.clientY } }));
      };
      el.onmouseleave = () => {
        this.hoverPinIdx = -1;
        this.dispatchEvent(new CustomEvent('pinunhover'));
      };
      el.onclick = (e) => {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('pinclick', { detail: { pin: data } }));
      };
      this.pinLayer.appendChild(el);
      this.pins.push({ data, el, lat: pl.lat, lon: pl.lon });
    }
  }

  _updatePinScreenPositions() {
    if (!this.pins || this.pins.length === 0) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const camPos = this.camera.position;
    const _v = new THREE.Vector3();
    const focusCl = this.highlightCl;   // set by setHighlight when a cluster is focused
    for (const p of this.pins) {
      const wp = this.worldPositionOf(p.lat, p.lon, POINT_RADIUS * 1.04);
      const facing = wp.x*(camPos.x-wp.x) + wp.y*(camPos.y-wp.y) + wp.z*(camPos.z-wp.z);
      if (!this.pinsEnabled || facing <= 0) {
        p.el.style.opacity = '0';
        p.el.style.pointerEvents = 'none';
        continue;
      }
      _v.copy(wp).project(this.camera);
      if (_v.z > 1) { p.el.style.opacity = '0'; p.el.style.pointerEvents = 'none'; continue; }
      const sx = (_v.x * 0.5 + 0.5) * w;
      const sy = (-_v.y * 0.5 + 0.5) * h;
      p.el.style.transform = `translate(${sx}px, ${sy}px)`;
      const inFocus = (focusCl == null) || (p.data.cluster === focusCl);
      const baseOp = Math.min(1, 0.55 + 0.45 * Math.min(1, facing));
      p.el.style.opacity = String(inFocus ? baseOp : baseOp * 0.22);
      p.el.style.pointerEvents = inFocus ? 'auto' : 'none';
      p.el.classList.toggle('dimmed', !inFocus);
    }
  }

  setPinsEnabled(v) { this.pinsEnabled = v; }

  lookTargetWorld() {
    // The point on the sphere nearest the camera — i.e. the visible centre.
    // Since we orbit by rotating the world and keep the camera at +Z, this is
    // just +Z direction at radius 1.
    return new THREE.Vector3(0, 0, 1);
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
    // Last zoom set by rotateTo / app navigation (scroll wheel only changes
    // distanceTarget). Used so Esc can snap back after user zoom.
    this._canonicalDistance = 3.0;
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
        uFocusLocalPos: { value: new THREE.Vector3() },
        uFocusActive:   { value: 0 },
        uPinnedLocalPos: { value: new THREE.Vector3() },
        uPinnedActive:   { value: 0 },
      },
      vertexShader: `
        attribute float size;
        attribute float dim;
        varying vec3 vColor;
        varying float vDim;
        varying float vFocus;
        uniform float basePx;
        uniform float devicePR;
        uniform vec3 uFocusLocalPos;
        uniform int  uFocusActive;
        uniform vec3 uPinnedLocalPos;
        uniform int  uPinnedActive;
        void main() {
          vColor = color;
          vDim = dim;
          float hd = distance(position, uFocusLocalPos);
          float pd = distance(position, uPinnedLocalPos);
          bool isFocus = (uFocusActive > 0 && hd < 0.001)
                      || (uPinnedActive > 0 && pd < 0.001);
          vFocus = isFocus ? 1.0 : 0.0;
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
          if (isFocus) s = max(s * 2.5, 16.0);
          gl_PointSize = s * devicePR;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vDim;
        varying float vFocus;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          if (vFocus > 0.5) {
            float core = 1.0 - smoothstep(0.30, 0.42, d);
            float halo = exp(-d * d * 8.0) * 0.80;
            float alpha = max(core, halo);
            gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
            return;
          }
          // Crisp filled disc with a 1-pixel antialias edge — no halo.
          float disc = 1.0 - smoothstep(0.42, 0.50, d);
          vec3 col = mix(vec3(0.30), vColor, vDim);
          float alpha = (0.28 + 0.42 * vDim) * disc;
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
    // Just a plain dark sphere behind the points — no painted continents or
    // texture; points alone make the viz pop.
    const backMat = new THREE.MeshBasicMaterial({ color: 0x0a0c12, side: THREE.FrontSide });
    const backGeom = new THREE.SphereGeometry(GLOBE_RADIUS * 0.998, 64, 32);
    this.surfaceBackdrop = new THREE.Mesh(backGeom, backMat);
    this.worldGroup.add(this.surfaceBackdrop);
    this.surface = null;
    this.surfaceMat = null;
    return;
    // ── unreachable leftover of the KDE painter (kept for easy revert) ──
    // eslint-disable-next-line no-unreachable
    this.worldGroup.add(this.surface);
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
      // the cursor / arrow. Rotation speed scales with zoom distance so
      // close-up panning stays precise instead of whipping across the globe.
      const zoomScale = this._interactionZoomScale();
      const speed = ROT_SPEED * zoomScale;
      const qx = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), dx * speed);
      const qy = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), dy * speed);
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
      // Arrow direction = direction content moves on screen (push-the-globe).
      if (e.key === 'ArrowLeft')  dx = -100;
      if (e.key === 'ArrowRight') dx = 100;
      if (e.key === 'ArrowUp')    dy = -100;
      if (e.key === 'ArrowDown')  dy = 100;
      if (dx || dy) {
        // Zoom-scaling is now handled inside applyScreenRotation.
        const mag = (KEY_STEP / ROT_SPEED) * 0.001;
        applyScreenRotation(dx * mag, dy * mag);
        e.preventDefault();
        return;
      }
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

  _interactionZoomScale() {
    const defaultDistance = 3.0;
    const closeT = Math.max(0, Math.min(1,
      (this.distanceTarget - MIN_ZOOM) / (defaultDistance - MIN_ZOOM)));
    const closeScale = 0.08 + 0.92 * Math.pow(closeT, 1.35);
    const farScale = this.distanceTarget > defaultDistance
      ? this.distanceTarget / defaultDistance
      : 1;
    return closeScale * farScale;
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
      this.dispatchEvent(new CustomEvent('pointclick', { detail: { idx, clientX: e.clientX, clientY: e.clientY, origEvent: e } }));
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
    if (distance != null) {
      this.distanceTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, distance));
      this._canonicalDistance = this.distanceTarget;
    }
  }

  /** User scroll moved zoom away from the last app-set distance (rotateTo). */
  isZoomedAwayFromCanonical() {
    const c = this._canonicalDistance != null ? this._canonicalDistance : 3.0;
    const tol = 0.055;
    // Compare both: wheel updates distanceTarget first; distance eases behind.
    // If we only checked distanceTarget, Esc could no-op while the camera
    // was still mid-zoom after the user had scrolled back to the target.
    return Math.abs(this.distanceTarget - c) > tol || Math.abs(this.distance - c) > tol;
  }

  /** Snap zoom to the canonical distance from the last rotateTo (or default). */
  resetCanonicalZoom() {
    const c = this._canonicalDistance != null ? this._canonicalDistance : 3.0;
    this.distanceTarget = c;
    this.distance = c;
  }

  // Composite dim state. Each setter updates one slot and calls
  // _recomputeDim(); filters intersect rather than overwrite, fixing the
  // bug where e.g. a position drill wiped an active subreddit filter.
  //   focusCl           : number | null
  //   focusSubLocal     : { cl, sub } | null
  //   focusPosIdx       : number | null   (requires focusSubLocal)
  //   multiClusters     : Set<number> | null
  //   multiSubs         : Set<string "cl_sub"> | null
  //   multiPositions    : Set<string "gid_posIdx"> | null  (search / regex paint)
  //   subredditIds      : Set<number> | null
  //   monthRange        : { lo, hi } inclusive month-idx | null
  _filter = {
    focusCl: null, focusSubLocal: null, focusPosIdx: null,
    multiClusters: null, multiSubs: null, multiPositions: null, subredditIds: null,
    monthRange: null,
    spotlight: null,   // Set<number> of point indices to show (per-post text filter)
  };
  _recomputeDim() {
    const st = this.state;
    const f = this._filter;
    const dim = this.pointGeom.attributes.dim.array;
    const hasMultiC = f.multiClusters && f.multiClusters.size > 0;
    const hasMultiS = f.multiSubs && f.multiSubs.size > 0;
    const hasMultiP = f.multiPositions && f.multiPositions.size > 0;
    const hasSR = f.subredditIds && f.subredditIds.size > 0;
    const assign = st.subredditAssignments;
    const hasMonth = !!f.monthRange;
    const monthAssign = st.monthAssignments;
    const byLocal = window.App?.subGidMap?.byLocal;
    const hasSpot = f.spotlight && f.spotlight.size > 0;
    const noFilter = f.focusCl == null && f.focusSubLocal == null && f.focusPosIdx == null &&
      !hasMultiC && !hasMultiS && !hasMultiP && !hasSR && !hasMonth && !hasSpot;
    if (noFilter) {
      dim.fill(1.0);
    } else {
      for (let i = 0; i < st.N; i++) {
        let ok = true;
        if (f.focusCl != null && st.cluster[i] !== f.focusCl) ok = false;
        if (ok && f.focusSubLocal &&
            (st.cluster[i] !== f.focusSubLocal.cl || st.subLocal[i] !== f.focusSubLocal.sub)) ok = false;
        if (ok && f.focusPosIdx != null && st.positionAssignments &&
            st.positionAssignments[i] !== f.focusPosIdx) ok = false;
        if (ok && hasMultiC && !hasMultiS && !f.multiClusters.has(st.cluster[i])) ok = false;
        if (ok && hasMultiS && !f.multiSubs.has(`${st.cluster[i]}_${st.subLocal[i]}`)) ok = false;
        if (ok && hasMultiP && st.positionAssignments && byLocal) {
          const cl = st.cluster[i], sl = st.subLocal[i];
          const gid = byLocal[cl]?.[sl];
          const pa = st.positionAssignments[i];
          if (gid == null || pa == null || pa === 255 || !f.multiPositions.has(`${gid}_${pa}`)) ok = false;
        }
        if (ok && hasSR && assign && !f.subredditIds.has(assign[i])) ok = false;
        if (ok && hasMonth && monthAssign) {
          const m = monthAssign[i];
          if (m < f.monthRange.lo || m > f.monthRange.hi) ok = false;
        }
        if (ok && hasSpot && !f.spotlight.has(i)) ok = false;
        dim[i] = ok ? 1.0 : 0.12;
      }
    }
    this.pointGeom.attributes.dim.needsUpdate = true;
    this._multiHighlightActive = hasMultiC || hasMultiS || hasMultiP;
    this._subredditHighlightActive = hasSR;
    this._spotlightActive = hasSpot;
  }

  setHighlight({ cl = null, gid = null, posIdx = null } = {}) {
    this.highlightCl = cl;
    this.highlightGid = gid;
    this.highlightPosIdx = posIdx;
    const f = this._filter;
    f.focusCl = cl;
    f.focusSubLocal = null;
    f.focusPosIdx = posIdx;
    if (gid != null) {
      const g = window.App?.subGidMap?.byGid?.[gid];
      if (g) f.focusSubLocal = { cl: g.cl, sub: g.sub };
    }
    // Changing a cluster-level focus invalidates sibling multi-selects
    // and subreddit filters would no longer make sense on a different
    // cluster; keep them and let _recomputeDim intersect.
    this._recomputeDim();
  }

  // Regex-on-globe paint for search: unions of clusters + subs + stance keys.
  setMultiHighlight({ clusters = null, subs = null, positions = null } = {}) {
    const f = this._filter;
    f.multiClusters = clusters && clusters.size > 0 ? clusters : null;
    f.multiSubs = subs && subs.size > 0 ? subs : null;
    f.multiPositions = positions && positions.size > 0 ? positions : null;
    this._recomputeDim();
  }

  // Subreddit filter. Intersects with whatever focus state is already active.
  setSubredditHighlight(idSet /* , opts — kept for compat but unused */) {
    const f = this._filter;
    f.subredditIds = idSet && idSet.size > 0 ? idSet : null;
    this._recomputeDim();
  }

  // Filter globe to a month-idx range, intersected with everything else.
  // Pass null to clear. lo/hi are inclusive.
  setMonthRange(range) {
    const f = this._filter;
    f.monthRange = range && range.lo != null && range.hi != null ? range : null;
    this._recomputeDim();
  }

  // Per-post text filter: only points in this set are lit. Intersects with
  // everything else. Pass null to clear.
  setSpotlight(idxSet) {
    const f = this._filter;
    f.spotlight = idxSet && idxSet.size > 0 ? idxSet : null;
    this._recomputeDim();
  }

  setThreadsEnabled(v) {
    this.threadArcsEnabled = v;
    if (this.threadArcs) this.threadArcs.visible = v;
  }

  async loadThreadArcs(pairs, opts = {}) {
    // Render each post→comment pair as a lifted great-circle tube. `opts`:
    //   thin    → half the default tube radius (used for shift-preview)
    //   opacity → override material opacity (default 0.92)
    this._threadArcPairs = pairs && pairs.length ? pairs : null;
    this._threadArcOpts = pairs && pairs.length ? { ...opts } : null;
    this._threadArcZoomBucket = null;
    this._disposeThreadArcs();
    if (!this._threadArcPairs) return;
    this._rebuildThreadArcs();
  }

  _disposeThreadArcs() {
    if (this.threadArcs) {
      this.worldGroup.remove(this.threadArcs);
      this.threadArcs.geometry.dispose();
      this.threadArcs.material.dispose();
      this.threadArcs = null;
    }
  }

  _threadArcRadiusScale() {
    const defaultDistance = 3.0;
    const t = Math.max(0, Math.min(1,
      (this.distanceTarget - MIN_ZOOM) / (defaultDistance - MIN_ZOOM)));
    // Near the surface the same world-space tube projects much wider, so the
    // geometry radius needs to shrink aggressively. Keep far/default zoom at
    // the established thickness.
    return 0.04 + 0.96 * Math.pow(t, 1.8);
  }

  _threadArcRadiusBucket() {
    return Math.round(this._threadArcRadiusScale() / 0.03) * 0.03;
  }

  _maybeRescaleThreadArcs() {
    if (!this._threadArcPairs || !this.threadArcs) return;
    const bucket = this._threadArcRadiusBucket();
    if (bucket === this._threadArcZoomBucket) return;
    const now = performance.now();
    if (now - this._lastThreadArcRebuildMs < 120) return;
    this._rebuildThreadArcs();
  }

  _rebuildThreadArcs() {
    const pairs = this._threadArcPairs;
    const opts = this._threadArcOpts || {};
    if (!pairs || pairs.length === 0) return;
    this._disposeThreadArcs();

    const st = this.state;
    const SEG = 28;
    const radiusBucket = this._threadArcRadiusBucket();
    const TUBE_RAD = (opts.thin ? 0.0022 : 0.0048) * radiusBucket;
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
      opacity: opts.opacity != null ? opts.opacity : 0.92,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.threadArcs = new THREE.Mesh(merged, mat);
    this.threadArcs.visible = this.threadArcsEnabled;
    this.worldGroup.add(this.threadArcs);
    this._threadArcZoomBucket = radiusBucket;
    this._lastThreadArcRebuildMs = performance.now();
  }

  setHoverPoint(idx) {
    const pos = this.pointGeom.attributes.position.array;
    if (idx >= 0) {
      this.pointMat.uniforms.uFocusLocalPos.value.set(pos[3*idx], pos[3*idx+1], pos[3*idx+2]);
      this.pointMat.uniforms.uFocusActive.value = 1;
    } else {
      this.pointMat.uniforms.uFocusActive.value = 0;
    }
  }

  setPinnedPoint(idx) {
    const pos = this.pointGeom.attributes.position.array;
    if (idx >= 0) {
      this.pointMat.uniforms.uPinnedLocalPos.value.set(pos[3*idx], pos[3*idx+1], pos[3*idx+2]);
      this.pointMat.uniforms.uPinnedActive.value = 1;
    } else {
      this.pointMat.uniforms.uPinnedActive.value = 0;
    }
  }

  _tick() {
    // When the guided tour is active, ease more slowly so rotations read
    // as deliberate camera moves rather than snap-to. 0.18/0.14 → 0.05/0.04
    // stretches the settle time from ~1.5s to ~6s.
    const tourOn = typeof window !== 'undefined' && window.App?.tour?.isActive?.();
    const slerpRate = tourOn ? 0.05 : 0.18;
    const zoomRate  = tourOn ? 0.04 : 0.14;
    this.worldQuat.slerp(this.worldQuatTarget, slerpRate);
    this.distance += (this.distanceTarget - this.distance) * zoomRate;
    this._maybeRescaleThreadArcs();
    this.worldGroup.quaternion.copy(this.worldQuat);

    // Globe is centred in its own panel now (the canvas itself sits between
    // the left nav and the right detail panel), so the camera looks at
    // origin — no right-bias offset.
    this.camera.position.set(0, 0, this.distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 1, 0);

    if (this._onFrame) this._onFrame();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._tick);
  }
}
