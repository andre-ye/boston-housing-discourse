// Unified keydown registry — Stage 2 of the refactor.
//
// One global keydown listener (capture-phase) dispatches to a priority-sorted
// list of "intents" registered via keys.bind(). Each intent declares which
// keys it cares about, optional gating predicates, and whether it tolerates
// modifiers / typing targets. The first intent whose handler returns `true`
// consumes the event; lower-priority intents do not see it.
//
// Conventions used by callers (see comments in main.js / nav.js / tour.js):
//   200 — tour-active gates
//   100 — overlay closers (help, etc.)
//    50 — pinned-card / focus-card Esc dismissal
//    25 — feature toggles in tour-aware contexts
//    20 — nav top-level shortcuts
//    10 — globe arrows / zoom (default-ish)
//     5 — idle-rotate stop, intro-toast dismiss

const _intents = [];
let _wired = false;
let _idSeq = 0;

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  return false;
}

function dispatch(e) {
  // Iterate over a snapshot so handlers that unbind during dispatch don't
  // shift the array out from under us.
  const snapshot = _intents.slice();
  for (const intent of snapshot) {
    if (intent.priority < 0) continue;
    if (!intent.keys.includes(e.key)) {
      // also check lower-case form for letter keys
      const lk = (e.key || '').toLowerCase();
      if (!intent.keys.includes(lk)) continue;
    }
    if (e.repeat && !intent.allowRepeat) continue;
    if ((e.metaKey || e.ctrlKey || e.altKey) && !intent.allowModifiers) continue;
    if (!intent.allowInInput && isTypingTarget(e.target || document.activeElement)) continue;
    if (intent.when && !intent.when()) continue;
    let consumed = false;
    try { consumed = intent.handler(e) === true; } catch (err) { console.error('[keys]', err); }
    if (consumed) return;
  }
}

function wire() {
  if (_wired) return;
  _wired = true;
  window.addEventListener('keydown', dispatch, true);
}

export const keys = {
  init() { wire(); },
  bind(spec) {
    if (!Array.isArray(spec.keys) || spec.keys.length === 0) {
      throw new Error('keys.bind requires non-empty keys[]');
    }
    if (typeof spec.handler !== 'function') {
      throw new Error('keys.bind requires handler fn');
    }
    const id = ++_idSeq;
    const intent = {
      id,
      keys: spec.keys.slice(),
      handler: spec.handler,
      priority: typeof spec.priority === 'number' ? spec.priority : 10,
      when: spec.when || null,
      allowInInput: !!spec.allowInInput,
      allowModifiers: !!spec.allowModifiers,
      allowRepeat: !!spec.allowRepeat,
      label: spec.label || '',
    };
    _intents.push(intent);
    _intents.sort((a, b) => b.priority - a.priority);
    wire();
    return () => {
      const idx = _intents.findIndex(i => i.id === id);
      if (idx >= 0) _intents.splice(idx, 1);
    };
  },
  // Test/debug
  list() {
    return _intents.map(i => ({ id: i.id, keys: i.keys, priority: i.priority, label: i.label }));
  },
};
