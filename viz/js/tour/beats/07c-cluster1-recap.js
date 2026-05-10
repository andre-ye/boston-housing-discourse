// Part 1 / Recap — what we learned in the bottom-up section.

export const beat = {
  id: 'cluster1-recap',
  kind: 'step',
  section: { topic: 'gentrification & rent control', tool: 'recap', cl: 32 },
  bodyHtml:
    '<p><strong>To recap this section,</strong> hovering, sampling, and ' +
    'pinning inside the <span class="topic-tag" ' +
    'data-cl="32">gentrification and rent control</span> region surfaced the ' +
    'kinds of things people bring up here: housing supply and the permitting ' +
    'process, rent prices and who can afford them, displacement and who gets ' +
    'pushed out, and the practical math of moving farther from the city.</p>' +
    '<p><strong>The takeaway:</strong> navigating the sphere in this bottom-up ' +
    'way lets you serendipitously discover, in a guided and controlled way, ' +
    'what people are talking about.</p>',
  enter() { return () => {}; },
};
