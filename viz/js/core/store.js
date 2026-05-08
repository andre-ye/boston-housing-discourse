// store — cross-module read surface; owners keep canonical state and mirror writes.
//
// Slices:
//   drill      — { cl, gid, posIdx } — owned by NavController
//   filters    — { subredditId, monthRange, paint, spotlight } — owned by GlobeView
//   selection  — { pinnedIdx, hoveredIdx, pinnedInterviewId } — owned by main.js boot()
//   modes      — { connections, sproutsActive } — owned by main.js boot()
//   tour       — { active, beat } — owned by tour/runner.js

const _state = {
  drill: { cl: null, gid: null, posIdx: null },
  filters: {
    subredditId: null,
    monthRange: null,         // { lo, hi } or null
    paint: null,              // Set<number> or null (search/regex)
    spotlight: null,          // Set<number> or null (overrides during tour)
  },
  selection: {
    pinnedIdx: -1,
    hoveredIdx: -1,
    pinnedInterviewId: null,
  },
  modes: {
    connections: false,
    sproutsActive: false,
  },
  tour: {
    active: false,
    beat: 0,
  },
};

const _subscribers = new Set();   // { selector, lastValue, callback }
let _notifying = false;
let _pending = false;

function notify() {
  if (_notifying) { _pending = true; return; }
  _notifying = true;
  do {
    _pending = false;
    for (const sub of _subscribers) {
      try {
        const v = sub.selector(_state);
        // Reference-equality comparison; if subscriber wants deep, they pass
        // a stable selector that returns a stable value.
        if (v !== sub.lastValue) {
          sub.lastValue = v;
          sub.callback(v, _state);
        }
      } catch (e) { console.error('[store subscribe]', e); }
    }
  } while (_pending);
  _notifying = false;
}

function deepMerge(target, patch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Set) && !(v instanceof Map)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

export const store = {
  get() { return _state; },
  set(patch) {
    deepMerge(_state, patch);
    notify();
  },
  // Replace a slice wholesale (use when you want a clean override, e.g. clearing all filters).
  setSlice(name, value) {
    _state[name] = value;
    notify();
  },
  subscribe(selector, callback) {
    const sub = { selector, callback, lastValue: undefined };
    try { sub.lastValue = selector(_state); } catch (e) { sub.lastValue = undefined; }
    _subscribers.add(sub);
    return () => _subscribers.delete(sub);
  },
  reset() {
    _state.drill = { cl: null, gid: null, posIdx: null };
    _state.filters = { subredditId: null, monthRange: null, paint: null, spotlight: null };
    _state.selection = { pinnedIdx: -1, hoveredIdx: -1, pinnedInterviewId: null };
    _state.modes = { connections: false, sproutsActive: false };
    _state.tour = { active: false, beat: 0 };
    notify();
  },
};
