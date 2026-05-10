// Part 3 / Recap — what we learned in the search + time section.

export const beat = {
  id: 'cluster3-recap',
  kind: 'step',
  section: { topic: 'cycling & bike lanes', tool: 'recap', cl: 5 },
  bodyHtml:
    '<p><strong>To recap this section,</strong> the ' +
    '<span class="topic-tag" data-cl="5">cycling and bike lanes</span> ' +
    'cluster looked thin compared with rent control or tenant rights, but ' +
    'more advanced tools revealed the conversation hiding inside it. ' +
    'Searching “Mass Ave” concentrated 336 of the 2,039 corpus matches into ' +
    'the cycling cluster; the rest live elsewhere on the sphere because ' +
    'people argue about Mass Ave for many reasons. Sliding the time window ' +
    'across years revealed how the bike-lane conversation itself shifts: ' +
    'which posts brighten in 2016, which dominate by 2024, and how the ' +
    'cluster’s centre of gravity moves along with the city.</p>' +
    '<p><strong>The takeaway:</strong> bike lanes aren’t a debate in ' +
    'the abstract. They’re a debate at a specific corner, in a ' +
    'specific year, with a specific cast of voices. Search and time turn the ' +
    'sphere from a topic browser into a query interface that lets you ' +
    'triangulate exactly that.</p>',
  enter() {
    // Close the timeline scrubber if the prior beat left it open. Removing
    // .has-timeline-open from the body lets the structural CSS rule
    // (`body.tour-active.has-timeline-open .tour-card`) un-lift the modal
    // back to its base bottom-right anchor — no per-beat positioning needed.
    try {
      const tl = document.getElementById('timeline-scrubber');
      const toggle = document.getElementById('tl-toggle');
      if (tl && !tl.classList.contains('hidden')) {
        // Click the toggle so its own handler fires (preference persistence,
        // toggle-active state, body-class sync, --timeline-h reset all in
        // one place). Falling back to manual class flips would drift if the
        // toggle ever owns more state.
        toggle?.click?.();
      }
    } catch {}
    return () => {};
  },
};
