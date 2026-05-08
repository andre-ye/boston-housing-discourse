// Idle auto-rotate: slow continuous drift toward the top-right until the
// user touches the globe (drag, wheel, arrow/zoom key) or drills into a
// cluster. Typing in the search box does NOT stop it.

export function init(ctx) {
  const { globe, nav, keys, raf } = ctx;
  const canvas = globe.canvas;
  let spinning = true;
  const DX = 0.18;   // rightward px-equivalent per frame (~11 px/sec @60fps)
  const DY = -0.09;  // upward
  const STOP_KEYS = [
    'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
    'w','W','s','S','+','=','-','_',
  ];
  let unbindKeys = null;
  const stop = () => {
    if (!spinning) return;
    spinning = false;
    canvas.removeEventListener('pointerdown', stop, true);
    canvas.removeEventListener('wheel', stop, true);
    if (unbindKeys) { unbindKeys(); unbindKeys = null; }
    nav?.removeEventListener?.('focus', stop);
  };
  canvas.addEventListener('pointerdown', stop, true);
  canvas.addEventListener('wheel', stop, true);
  unbindKeys = keys.bind({
    keys: STOP_KEYS,
    priority: 5,
    label: 'idle-rotate-stop',
    allowRepeat: true,
    allowModifiers: true,
    handler: () => { stop(); return false; },
  });
  nav?.addEventListener?.('focus', stop);
  let _disposeIdle = null;
  const tick = () => {
    if (!spinning) {
      if (_disposeIdle) { _disposeIdle(); _disposeIdle = null; }
      return;
    }
    if (!window.App?.tour?.isActive()) globe.nudge?.(DX, DY);
  };
  _disposeIdle = raf.add('idle-rotate', tick);
}
