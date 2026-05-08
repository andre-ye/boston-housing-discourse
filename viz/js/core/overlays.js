// overlays — single owner of overlay open/close + aggregated body classes.

const _registry = new Map();   // name → spec
const _stack = [];              // names, top of stack = most recently opened

function applyBody() {
  // Compute aggregated body classes from open overlays.
  const all = new Set();
  for (const name of _stack) {
    const spec = _registry.get(name);
    if (!spec) continue;
    for (const c of spec.bodyClasses) all.add(c);
  }
  // Remove any of our managed classes that shouldn't be there.
  const allManaged = new Set();
  for (const spec of _registry.values()) {
    for (const c of spec.bodyClasses) allManaged.add(c);
  }
  for (const c of allManaged) {
    if (all.has(c)) document.body.classList.add(c);
    else document.body.classList.remove(c);
  }
}

export const overlayManager = {
  register(spec) {
    if (!spec || !spec.name || !spec.rootEl) {
      throw new Error('overlayManager.register: name + rootEl required');
    }
    _registry.set(spec.name, {
      name: spec.name,
      rootEl: spec.rootEl,
      bodyClasses: Array.isArray(spec.bodyClasses) ? spec.bodyClasses.slice() : [],
      onOpen: spec.onOpen || null,
      onClose: spec.onClose || null,
      closeOnEsc: spec.closeOnEsc !== false,
      priority: typeof spec.priority === 'number' ? spec.priority : 10,
      isOpen: false,
    });
  },
  open(name) {
    const spec = _registry.get(name);
    if (!spec || spec.isOpen) return;
    spec.isOpen = true;
    _stack.push(name);
    spec.rootEl.classList.remove('hidden');
    applyBody();
    if (spec.onOpen) {
      try { spec.onOpen(); } catch (e) { console.error('[overlays.open]', e); }
    }
  },
  close(name) {
    const spec = _registry.get(name);
    if (!spec || !spec.isOpen) return;
    spec.isOpen = false;
    const idx = _stack.lastIndexOf(name);
    if (idx >= 0) _stack.splice(idx, 1);
    spec.rootEl.classList.add('hidden');
    applyBody();
    if (spec.onClose) {
      try { spec.onClose(); } catch (e) { console.error('[overlays.close]', e); }
    }
  },
  closeTop() {
    for (let i = _stack.length - 1; i >= 0; i--) {
      const spec = _registry.get(_stack[i]);
      if (spec && spec.closeOnEsc) {
        this.close(spec.name);
        return true;
      }
    }
    return false;
  },
  isOpen(name) {
    const spec = _registry.get(name);
    return !!(spec && spec.isOpen);
  },
  topName() { return _stack.length ? _stack[_stack.length - 1] : null; },
  registered() { return Array.from(_registry.keys()); },
};
