// Three.js globe renderer.
// - Points geometry with per-point color (cluster palette).
// - Underlying sphere mesh with a baked KDE-style surface texture.
// - Orbit controls via mouse drag, scroll zoom, arrow keys.

import * as THREE from 'three';
import { latLonToXYZ, clusterColor, hexToRgb, SPHERE_PALETTE } from './data.js';
import { raf } from './core/raf.js';
import { keys } from './core/keys.js';
import { store } from './core/store.js';
import {
  GLOBE_RADIUS, POINT_RADIUS, POINT_SIZE_BASE,
  MIN_ZOOM, MAX_ZOOM, DEFAULT_DISTANCE,
  SUB_LUMA_DIM_FACTOR, SUB_LUMA_BRIGHT_FACTOR,
  SLERP_RATE_APP, ZOOM_RATE_APP, SLERP_RATE_TOUR, ZOOM_RATE_TOUR,
  MAX_ROT_PER_FRAME, MAX_ZOOM_PER_FRAME, VIS_FADE_RATE,
  ZOOM_LIFT_PER_RAD, ZOOM_LIFT_MAX,
  VIS_TIER,
} from './core/constants.js';

function sphereColor(c) {
  const i = ((c % SPHERE_PALETTE.length) + SPHERE_PALETTE.length) % SPHERE_PALETTE.length;
  return SPHERE_PALETTE[i];
}

export class GlobeView extends EventTarget {
  constructor(canvas, state) {
    super();
    this.canvas = canvas;
    this.state = state;
    this.hoverIdx = -1;
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
    raf.add('globe', this._tick);

    // Subtopic luma shading (#32 #40): when the user has drilled into a
    // single cluster (cl set, gid null), recolor that cluster's points by
    // sub-id. Re-render only fires when the drill cl/gid combination
    // crosses the "single-cluster, no sub" threshold — string key dedupe.
    this._unsubLumaDrill = store.subscribe(
      (s) => {
        const d = s.drill || {};
        // Shade only when drilled to a cluster but NOT a single sub. When
        // gid is set the user wants their one sub highlighted; flat color
        // reads better against the dim filter.
        if (d.cl != null && d.gid == null) return `cl:${d.cl}`;
        return 'flat';
      },
      (key) => {
        if (key === 'flat') this.applySubLumaShading(null);
        else if (key.startsWith('cl:')) this.applySubLumaShading(parseInt(key.slice(3), 10));
      },
    );
  }

  _initPins() {
    // DOM pins (richer than sprites) projected each frame to the same radius as
    // the point cloud (see _updatePinScreenPositions).
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
    //
    // The pin's lat/lon stored in pin_placements.json was computed against
    // a specific sphere layout. When the active layout changes (e.g. the
    // user is on PyMDE while the placements file was generated against the
    // t-SNE-3D + Lloyd build), the saved lat/lon points off the surface of
    // the *current* point cloud — pins read as "floating in space" or
    // "anywhere in the viewport" rather than anchored to their post.
    //
    // Fix: anchor every pin to the live coordinate of its source post
    // (state.coords[2*idx]) whenever idx is finite. The placement file's
    // lat/lon is only used when no idx is recorded.
    const stCoords = this.state?.coords;
    const stCluster = this.state?.cluster;
    this.pinLayer.innerHTML = '';
    this.pins = [];
    for (const pl of placements || []) {
      // Resolve live lat/lon + cluster from the point index when available
      // so pins track whatever sphere layout the corpus is currently using.
      let lat = pl.lat, lon = pl.lon, cl = pl.cluster;
      if (Number.isFinite(pl.idx) && stCoords && pl.idx * 2 + 1 < stCoords.length) {
        lat = stCoords[2 * pl.idx];
        lon = stCoords[2 * pl.idx + 1];
      }
      if (Number.isFinite(pl.idx) && stCluster && pl.idx < stCluster.length) {
        cl = stCluster[pl.idx];
      }
      const color = sphereColor(cl);
      const clMeta = this.state.clusterMeta?.[String(cl)];
      const data = {
        ...pl,
        lat, lon, cluster: cl,
        cluster_name: clMeta?.name,
      };
      const el = document.createElement('button');
      el.className = 'pin';
      // Hidden until _updatePinScreenPositions() places it; otherwise the
      // pin briefly sits at top:0,left:0 (the .pin CSS default) before the
      // first frame projects it to the right spot.
      el.style.opacity = '0';
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
      this.pins.push({ data, el, lat, lon });
    }
  }

  _updatePinScreenPositions() {
    if (!this.pins || this.pins.length === 0) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const camPos = this.camera.position;
    const _v = new THREE.Vector3();
    const focusCl = this.highlightCl;   // set by setHighlight when a cluster is focused
    for (const p of this.pins) {
      // Same shell as the point cloud (POINT_RADIUS) so pins sit on the globe,
      // not radially in front of it (the old *1.04 read as visibly "floating").
      const wp = this.worldPositionOf(p.lat, p.lon, POINT_RADIUS);
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
    this.camera.position.set(0, 0, DEFAULT_DISTANCE);

    // World rotation as a quaternion — supports unlimited spin in any direction.
    this.worldQuat = new THREE.Quaternion();
    this.worldQuatTarget = new THREE.Quaternion();
    this.distance = DEFAULT_DISTANCE;
    this.distanceTarget = DEFAULT_DISTANCE;
    // Last zoom set by rotateTo / app navigation (scroll wheel only changes
    // distanceTarget). Used so Esc can snap back after user zoom.
    this._canonicalDistance = DEFAULT_DISTANCE;
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
    // Snapshot the per-point base color (cluster hue) so #32 #40 luma
    // shading can be applied non-destructively: when the user drills into
    // a cluster we recompute colors[] from these base values * a per-sub
    // luminance factor. Restoring on un-drill is a single array.set().
    this._baseColors = new Float32Array(colors);
    this._lumaDrilledCl = null;   // tracks which cluster (if any) is currently shaded
    // Per-cluster sub-id → luminance factor map, lazily built on first drill.
    this._lumaSubFactors = null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    // dim attribute: per-point fade when highlight filter active (VIS_TIER).
    // We keep two arrays: `dim` is what the GPU reads each frame, `dimTarget`
    // is what _recomputeDim() writes to. _tick eases dim toward dimTarget at
    // VIS_FADE_RATE so points lose/regain color gradually instead of snapping.
    const dim = new Float32Array(N); dim.fill(VIS_TIER.BRIGHT);
    this._dimTarget = new Float32Array(N); this._dimTarget.fill(VIS_TIER.BRIGHT);
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

    keys.bind({
      keys: [
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        '+', '=', '-', '_', 'w', 'W', 's', 'S',
      ],
      priority: 10,
      label: 'globe-arrows-zoom',
      helpLabel: 'Pan the globe; + / − (or w / s) zoom in / out',
      helpGroup: 'view',
      helpKeys: ['←', '→', '↑', '↓', '+', '−'],
      allowRepeat: true,
      handler: (e) => {
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
          return true;
        }
        const tk = (this.distanceTarget - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
        const stepFactor = 0.04 + 0.12 * Math.max(0, Math.min(1, tk));   // 0.04 in, 0.16 out
        if (e.key === '+' || e.key === '=' || e.key === 'w' || e.key === 'W') {
          this.distanceTarget = Math.max(MIN_ZOOM, this.distanceTarget * (1 - stepFactor));
          e.preventDefault();
          return true;
        }
        if (e.key === '-' || e.key === '_' || e.key === 's' || e.key === 'S') {
          this.distanceTarget = Math.min(MAX_ZOOM, this.distanceTarget * (1 + stepFactor));
          e.preventDefault();
          return true;
        }
        return false;
      },
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
    const closeT = Math.max(0, Math.min(1,
      (this.distanceTarget - MIN_ZOOM) / (DEFAULT_DISTANCE - MIN_ZOOM)));
    const closeScale = 0.08 + 0.92 * Math.pow(closeT, 1.35);
    const farScale = this.distanceTarget > DEFAULT_DISTANCE
      ? this.distanceTarget / DEFAULT_DISTANCE
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

  // Snap variant of rotateTo: lands the camera at (lat, lon, distance)
  // instantly rather than slerping in. Used by the tour runner when
  // restoring a snapshot on Back / Forward-into-completed so the user
  // doesn't watch a swoop they didn't initiate.
  snapTo(lat, lon, distance = null) {
    const cl = Math.cos(lat);
    const target = new THREE.Vector3(cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon));
    const desired = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(target, desired);
    this.worldQuatTarget.copy(q);
    this.worldQuat.copy(q);
    if (distance != null) {
      const d = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, distance));
      this.distanceTarget = d;
      this.distance = d;
      this._canonicalDistance = d;
    }
    try { this.worldGroup.quaternion.copy(this.worldQuat); } catch {}
    try { this.camera.position.set(0, 0, this.distance); } catch {}
  }

  /** User scroll moved zoom away from the last app-set distance (rotateTo). */
  isZoomedAwayFromCanonical() {
    const c = this._canonicalDistance != null ? this._canonicalDistance : DEFAULT_DISTANCE;
    const tol = 0.055;
    // Compare both: wheel updates distanceTarget first; distance eases behind.
    // If we only checked distanceTarget, Esc could no-op while the camera
    // was still mid-zoom after the user had scrolled back to the target.
    return Math.abs(this.distanceTarget - c) > tol || Math.abs(this.distance - c) > tol;
  }

  /** Snap zoom to the canonical distance from the last rotateTo (or default). */
  resetCanonicalZoom() {
    const c = this._canonicalDistance != null ? this._canonicalDistance : DEFAULT_DISTANCE;
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
    dimLayer: null,    // Set<number> rendered at VIS_TIER.DIM when otherwise HIDDEN (#34)
  };
  _recomputeDim() {
    const st = this.state;
    const f = this._filter;
    // Write the target alpha tier per point; _tick eases the live `dim`
    // attribute toward this target each frame.
    const dim = this._dimTarget;
    const hasMultiC = f.multiClusters && f.multiClusters.size > 0;
    const hasMultiS = f.multiSubs && f.multiSubs.size > 0;
    const hasMultiP = f.multiPositions && f.multiPositions.size > 0;
    const hasSR = f.subredditIds && f.subredditIds.size > 0;
    const assign = st.subredditAssignments;
    const hasMonth = !!f.monthRange;
    const monthAssign = st.monthAssignments;
    const monthLabels = st.monthLabels;
    const byLocal = window.App?.subGidMap?.byLocal;
    const hasSpot = f.spotlight && f.spotlight.size > 0;
    const hasDimLayer = f.dimLayer && f.dimLayer.size > 0;
    const hasNonMonth = f.focusCl != null || f.focusSubLocal != null || f.focusPosIdx != null ||
      hasMultiC || hasMultiS || hasMultiP || hasSR || hasSpot;
    const noFilter = !hasNonMonth && !hasMonth;
    // Per-month bucket of points passing every non-month predicate. Used
    // by the timeline's "X posts" label so the count narrows when the user
    // drills into a topic, paints a regex, or spotlights a search match.
    // Null sentinel means "no non-month filters are active" — readers can
    // fall back to the pre-baked total[] histogram.
    let monthCounts = null;
    if (hasNonMonth && monthAssign && monthLabels) {
      monthCounts = this._filteredMonthCounts;
      if (!monthCounts || monthCounts.length !== monthLabels.length) {
        monthCounts = new Int32Array(monthLabels.length);
      } else {
        monthCounts.fill(0);
      }
    }
    if (noFilter) {
      dim.fill(VIS_TIER.BRIGHT);
    } else {
      for (let i = 0; i < st.N; i++) {
        let okNonMonth = true;
        if (f.focusCl != null && st.cluster[i] !== f.focusCl) okNonMonth = false;
        if (okNonMonth && f.focusSubLocal &&
            (st.cluster[i] !== f.focusSubLocal.cl || st.subLocal[i] !== f.focusSubLocal.sub)) okNonMonth = false;
        if (okNonMonth && f.focusPosIdx != null && st.positionAssignments &&
            st.positionAssignments[i] !== f.focusPosIdx) okNonMonth = false;
        if (okNonMonth && hasMultiC && !hasMultiS && !f.multiClusters.has(st.cluster[i])) okNonMonth = false;
        if (okNonMonth && hasMultiS && !f.multiSubs.has(`${st.cluster[i]}_${st.subLocal[i]}`)) okNonMonth = false;
        if (okNonMonth && hasMultiP && st.positionAssignments && byLocal) {
          const cl = st.cluster[i], sl = st.subLocal[i];
          const gid = byLocal[cl]?.[sl];
          const pa = st.positionAssignments[i];
          if (gid == null || pa == null || pa === 255 || !f.multiPositions.has(`${gid}_${pa}`)) okNonMonth = false;
        }
        if (okNonMonth && hasSR && assign && !f.subredditIds.has(assign[i])) okNonMonth = false;
        if (okNonMonth && hasSpot && !f.spotlight.has(i)) okNonMonth = false;
        // Bucket the non-month-passing points by month so the timeline
        // label can intersect (drill ∩ spotlight ∩ ...) with [lo, hi]
        // in O(rangeLen) instead of O(N) per drag tick.
        if (okNonMonth && monthCounts && monthAssign) {
          const m = monthAssign[i];
          if (m < monthCounts.length) monthCounts[m]++;
        }
        let ok = okNonMonth;
        if (ok && hasMonth && monthAssign) {
          const m = monthAssign[i];
          if (m < f.monthRange.lo || m > f.monthRange.hi) ok = false;
        }
        // Three-tier (#34): otherwise-HIDDEN points listed in dimLayer get
        // promoted to DIM so parent context stays legible.
        dim[i] = ok ? VIS_TIER.BRIGHT : (hasDimLayer && f.dimLayer.has(i) ? VIS_TIER.DIM : VIS_TIER.HIDDEN);
      }
    }
    this._filteredMonthCounts = monthCounts;
    // Live `dim` attribute is animated toward _dimTarget inside _tick — no
    // direct needsUpdate flag here (the tween marks it each frame).
    this._dimDirty = true;
    this._multiHighlightActive = hasMultiC || hasMultiS || hasMultiP;
    this._subredditHighlightActive = hasSR;
    this._spotlightActive = hasSpot;
    // Notify listeners so the timeline label can re-sum the bucket without
    // polling. monthRange changes also fire this, but the timeline ignores
    // them since it already drives that change.
    try { this.dispatchEvent(new CustomEvent('filterschanged')); } catch {}
  }

  // Sum of the per-month "passes-all-non-month-filters" bucket over the
  // inclusive [lo, hi] range. Returns null when no non-month filter is
  // active — caller should fall back to the pre-baked total[] histogram
  // (so the count exactly matches the existing whole-corpus path).
  getFilteredMonthCount(lo, hi) {
    const buf = this._filteredMonthCounts;
    if (!buf) return null;
    const a = Math.max(0, lo | 0);
    const b = Math.min(buf.length - 1, hi | 0);
    let s = 0;
    for (let i = a; i <= b; i++) s += buf[i];
    return s;
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
    // Focus changes (click, nav.focus) reset the parent-context dim layer
    // (#34): the new focus's hover-tier caller repopulates it as needed.
    f.dimLayer = null;
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
    // Mirror to store as a single representative "paint" slot — cross-module
    // readers don't need the union breakdown, only "is paint active".
    try {
      const paint = f.multiPositions || f.multiSubs || f.multiClusters || null;
      store.set({ filters: { paint } });
    } catch {}
  }

  // Subreddit filter. Intersects with whatever focus state is already active.
  setSubredditHighlight(idSet /* , opts — kept for compat but unused */) {
    const f = this._filter;
    f.subredditIds = idSet && idSet.size > 0 ? idSet : null;
    this._recomputeDim();
    try { store.set({ filters: { subredditId: f.subredditIds } }); } catch {}
  }

  // Filter globe to a month-idx range, intersected with everything else.
  // Pass null to clear. lo/hi are inclusive.
  setMonthRange(range) {
    const f = this._filter;
    f.monthRange = range && range.lo != null && range.hi != null ? range : null;
    this._recomputeDim();
    try { store.set({ filters: { monthRange: f.monthRange } }); } catch {}
  }

  // Per-post text filter: only points in this set are lit. Intersects with
  // everything else. Pass null to clear.
  setSpotlight(idxSet) {
    const f = this._filter;
    f.spotlight = idxSet && idxSet.size > 0 ? idxSet : null;
    this._recomputeDim();
    try { store.set({ filters: { spotlight: f.spotlight } }); } catch {}
  }

  // Mid-tier dim layer (#34): points in this set render at VIS_TIER.DIM
  // when they would otherwise be at VIS_TIER.HIDDEN. Pass null to clear.
  setDimLayer(idxSet) {
    const f = this._filter;
    f.dimLayer = idxSet && idxSet.size > 0 ? idxSet : null;
    this._recomputeDim();
  }

  // ── Subtopic luminance shading on globe points (#32 #40) ──────────────
  // When the user drills into a single cluster (cl set, gid null), shade
  // each sub-cluster within that cluster as a different luminance step
  // within the parent hue. Sub ids are sorted ascending for stable
  // colors across reloads. When un-drilled or drilled deeper to a single
  // sub, restore the flat per-cluster color.
  //
  // Recolor only fires on drill change — colors are written once per
  // change and the GPU buffer is marked dirty. No per-frame work.
  applySubLumaShading(cl) {
    const st = this.state;
    if (!this._baseColors || !st || !st.cluster || !st.subLocal) return;
    const colors = this.pointGeom.attributes.color.array;
    const N = st.N;
    if (cl == null) {
      // Restore flat color from snapshot.
      if (this._lumaDrilledCl == null) return;   // already flat
      colors.set(this._baseColors);
      this._lumaDrilledCl = null;
      this.pointGeom.attributes.color.needsUpdate = true;
      return;
    }
    if (this._lumaDrilledCl === cl) return;      // already shaded for this cluster
    // Build sub-id → factor map for this cluster.
    const subSet = new Set();
    for (let i = 0; i < N; i++) {
      if (st.cluster[i] === cl) subSet.add(st.subLocal[i]);
    }
    const subs = [...subSet].sort((a, b) => a - b);
    const factorBy = new Map();
    if (subs.length === 1) {
      factorBy.set(subs[0], 1.0);
    } else {
      for (let k = 0; k < subs.length; k++) {
        const t = k / (subs.length - 1);                         // 0..1
        const f = SUB_LUMA_BRIGHT_FACTOR + t * (SUB_LUMA_DIM_FACTOR - SUB_LUMA_BRIGHT_FACTOR);
        factorBy.set(subs[k], f);
      }
    }
    // First restore from snapshot so we don't compound prior shading.
    colors.set(this._baseColors);
    // Then apply the factor in-cluster only.
    for (let i = 0; i < N; i++) {
      if (st.cluster[i] !== cl) continue;
      const f = factorBy.get(st.subLocal[i]) || 1.0;
      const r = this._baseColors[3*i] * f;
      const g = this._baseColors[3*i + 1] * f;
      const b = this._baseColors[3*i + 2] * f;
      // Clamp to [0,1] so >1 factors don't wrap or blow out.
      colors[3*i]     = Math.min(1, r);
      colors[3*i + 1] = Math.min(1, g);
      colors[3*i + 2] = Math.min(1, b);
    }
    this._lumaDrilledCl = cl;
    this.pointGeom.attributes.color.needsUpdate = true;
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
    const tourOn = typeof window !== 'undefined' && window.App?.tour?.isActive?.();
    const camSnappy = tourOn && typeof document !== 'undefined'
      && document.body?.classList?.contains('tour-cam-snappy');
    const useTour = tourOn && !camSnappy;
    const slerpRate = useTour ? SLERP_RATE_TOUR : SLERP_RATE_APP;
    const zoomRate  = useTour ? ZOOM_RATE_TOUR : ZOOM_RATE_APP;

    // Slerp the camera toward the target with a per-frame angular cap.
    // The default slerp(t) covers `t × angle_remaining` per frame, so a long
    // arc starts fast and decays exponentially — readable as a snap on big
    // swings. Capping at MAX_ROT_PER_FRAME turns long arcs into steady
    // glides; once the residual angle drops below the cap, the slerp
    // fraction takes over and the move settles smoothly.
    const angleRemaining = this.worldQuat.angleTo(this.worldQuatTarget);
    let effSlerp = slerpRate;
    if (angleRemaining > 1e-5) {
      const capped = MAX_ROT_PER_FRAME / angleRemaining;
      if (capped < slerpRate) effSlerp = capped;
    }
    this.worldQuat.slerp(this.worldQuatTarget, effSlerp);

    // Pull-out arc: while the camera is mid-rotation, lift the effective
    // distance target so the camera arcs OUT during the swing and back IN
    // as it arrives. Lift is proportional to angular distance remaining
    // (clamped at ZOOM_LIFT_MAX so we never drift past MAX_ZOOM). When
    // angleRemaining drops to ~0 the lift naturally vanishes and the
    // camera settles to the user-requested distanceTarget.
    const lift = Math.min(angleRemaining * ZOOM_LIFT_PER_RAD, ZOOM_LIFT_MAX);
    const effectiveDistTarget = Math.min(MAX_ZOOM, this.distanceTarget + lift);
    const distDelta = effectiveDistTarget - this.distance;
    const easedDist = distDelta * zoomRate;
    const cappedDist = Math.sign(easedDist) * Math.min(Math.abs(easedDist), MAX_ZOOM_PER_FRAME);
    this.distance += cappedDist;

    this.worldGroup.quaternion.copy(this.worldQuat);

    // Per-point alpha fade. Lerp each entry of the live `dim` attribute
    // toward _dimTarget; mark needsUpdate only on frames that actually
    // moved a point, so a static globe stays at zero per-frame upload cost.
    if (this.pointGeom && this._dimTarget) {
      const live = this.pointGeom.attributes.dim.array;
      const tgt = this._dimTarget;
      const N = live.length;
      let moved = false;
      for (let i = 0; i < N; i++) {
        const d = tgt[i] - live[i];
        if (d === 0) continue;
        if (Math.abs(d) < 0.002) { live[i] = tgt[i]; moved = true; }
        else { live[i] += d * VIS_FADE_RATE; moved = true; }
      }
      if (moved || this._dimDirty) {
        this.pointGeom.attributes.dim.needsUpdate = true;
        this._dimDirty = false;
      }
    }

    // Globe is centred in its own panel now (the canvas itself sits between
    // the left nav and the right detail panel), so the camera looks at
    // origin — no right-bias offset.
    this.camera.position.set(0, 0, this.distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 1, 0);

    // Pin DOM markers are owned by the globe — project them directly here
    // (after camera state is settled this frame) so they're never a tick
    // behind the underlying point cloud during a tween. Other per-frame
    // overlays (labels, sprouts, halos, …) still go through _onFrame.
    this._updatePinScreenPositions();
    if (this._onFrame) this._onFrame();
    this.renderer.render(this.scene, this.camera);
  }
}
