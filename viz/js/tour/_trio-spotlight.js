// Shared trio-spotlight: holds the spotlight + numbered markers across the
// 05-cluster1-hover-trio → 06-cluster1-click-pin transition so the dots
// don't disappear and reappear between beats. A short release grace period
// lets the next beat re-acquire before teardown actually runs.

import { attachSpotlight } from './spotlight.js';
import { setVisibilityTiers, clearVisibilityTiers } from '../features/visibility-tiers.js';

let _markers = null;
let _idxSet = null;
let _releaseTimer = null;
const RELEASE_GRACE_MS = 200;

export function ensureTrio(globe, state, picks) {
  // Pending release? Cancel — the next beat is reusing the same trio.
  if (_releaseTimer) { clearTimeout(_releaseTimer); _releaseTimer = null; }
  if (_markers) return _markers;

  _idxSet = new Set(picks.map(p => p.idx));
  try { globe.setSpotlight(_idxSet); } catch {}
  try { setVisibilityTiers({ level: 'tourSpotlight', scope: { brightIds: _idxSet } }); } catch {}
  document.body.classList.add('tour-pin-spotlight');

  _markers = attachSpotlight(globe, picks.map(p => ({
    idx: p.idx,
    lat: state.coords[2 * p.idx],
    lon: state.coords[2 * p.idx + 1],
    tag: p.tag,
  })));
  return _markers;
}

export function scheduleRelease(globe) {
  if (_releaseTimer) clearTimeout(_releaseTimer);
  _releaseTimer = setTimeout(() => {
    _releaseTimer = null;
    if (_markers) { try { _markers.teardown(); } catch {} _markers = null; }
    _idxSet = null;
    try { globe.setSpotlight(null); } catch {}
    try { clearVisibilityTiers(); } catch {}
    document.body.classList.remove('tour-pin-spotlight');
  }, RELEASE_GRACE_MS);
}
