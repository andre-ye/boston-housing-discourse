// Animation channel scheduler. One rAF loop drives multiple named channels,
// so adding a per-frame callback doesn't cost a separate rAF chain.
// Returns a disposer from `add` for symmetric setup/teardown.

const channels = new Map();   // channelName -> Set<callback>
let rafId = 0;

function loop(t) {
  rafId = 0;
  let any = false;
  for (const [name, cbs] of channels) {
    if (cbs.size === 0) continue;
    any = true;
    for (const cb of cbs) {
      try { cb(t); } catch (e) { console.error(`[raf:${name}]`, e); }
    }
  }
  if (any) rafId = requestAnimationFrame(loop);
}

function ensureRunning() {
  if (rafId === 0) rafId = requestAnimationFrame(loop);
}

export const raf = {
  add(channel, cb) {
    if (typeof cb !== 'function') throw new Error('raf.add requires a function');
    let set = channels.get(channel);
    if (!set) { set = new Set(); channels.set(channel, set); }
    set.add(cb);
    ensureRunning();
    return () => { set.delete(cb); };
  },
  clear(channel) {
    const set = channels.get(channel);
    if (set) set.clear();
  },
  has(channel) {
    const set = channels.get(channel);
    return !!set && set.size > 0;
  },
  channels() { return Array.from(channels.keys()); },
};
