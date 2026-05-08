// Part 2 / Step 5 — connections mode.
//
// The pinned-post panel shows a thread-context fisheye; the C key (or shift
// chip) draws the same relationships on the globe as arcs from the pinned
// node. We bind C at priority 200 so we fire before the global priority-25
// toggle, but return false so the global handler still runs and actually
// toggles connections mode.

export const beat = {
  id: 'connections',
  kind: 'step',
  eyebrow: 'PART 2 — TOP-DOWN',
  title: 'Look at this post in its thread',
  prose:
    'The pinned post is only one node in a Reddit thread. Look at the Thread context ' +
    'section in the panel: that little map is this post and its thread neighbors. Now ' +
    'click the bottom “connections” chip (or press C) to draw those same relationships ' +
    'as arcs from this exact pinned node on the globe.',
  hint: 'Look at Thread context, then click “connections” below',
  showChrome: ['nav', 'shift', 'cards'],
  pulse: 'tour-pulse-shift',
  manualContinue: true,
  enter(ctx) {
    const { App, keys, markStepDone } = ctx;

    // Draw attention to the panel's fisheye context first. The chip then
    // becomes the globe-level view of the same selected node.
    const emphasizeTimer = setTimeout(() => {
      try { App?.emphasizeDetailContextForConnections?.(); } catch {}
    }, 450);

    let fired = false;
    let triggerEmphasizeTimer = null;
    const trigger = () => {
      if (fired) return;
      fired = true;
      triggerEmphasizeTimer = setTimeout(() => {
        try { App?.emphasizeDetailContextForConnections?.(); } catch {}
      }, 250);
      markStepDone?.();
    };

    const chip = document.getElementById('shift-hint');
    const onClick = () => trigger();
    chip?.addEventListener('click', onClick);

    const unbindKey = keys.bind({
      keys: ['c'],
      priority: 200,
      label: 'tour-step:c-advance',
      handler: () => { trigger(); return false; },
    });

    return () => {
      chip?.removeEventListener('click', onClick);
      unbindKey();
      clearTimeout(emphasizeTimer);
      if (triggerEmphasizeTimer != null) clearTimeout(triggerEmphasizeTimer);
    };
  },
};
