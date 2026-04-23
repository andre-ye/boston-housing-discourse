// Guided tour: opening screen + three cluster beats. Pans the globe
// between clusters while an Atlantic-styled overlay card narrates.

import { clusterAnchor } from './data.js?v=252';

const BEATS = [
  {
    kind: 'intro',
    eyebrow: 'An atlas of Boston discourse',
    headline: 'What do people say about what it\u2019s like to live and commute in Boston?',
    lede: '422,114 Reddit posts from 2015 to 2025, arranged so that neighbors are voices that argue about the same thing. Each point is somebody typing at two in the morning about rent, the T, a landlord, a bike lane. Three stops on the way in.',
  },
  {
    kind: 'cluster',
    cl: 32,
    zoom: 1.8,
    label: '1 of 3',
    eyebrow: 'Who gets to live here',
    title: 'Rent control, zoning, and supply',
    prose: 'A decade of argument about what Boston\u2019s housing crisis actually is. Some posts say the answer is to build \u2014 end single-family zoning, pass the MBTA Communities Act, let triple-deckers come back. Others argue rent stabilization matters more than new luxury stock. The cluster is where that fight lives.',
    pullquotes: [
      'Market supply can\u2019t match demand here.',
      'Rent control is good for incumbents and bad for newcomers.',
      'It\u2019s the zoning that made this mess.',
    ],
  },
  {
    kind: 'cluster',
    cl: 8,
    zoom: 1.8,
    label: '2 of 3',
    eyebrow: 'Once you\u2019re in the door',
    title: 'Heating, repairs, and when a landlord has to act',
    prose: 'Further out on the sphere: the day-to-day texture of being a tenant. What counts as an emergency. How cold the apartment has to be before you can call the city. The statute of limitations on a security deposit. The quiet infrastructure of who owes what.',
    pullquotes: [
      '98\u00b0F with no AC \u2014 is that uninhabitable?',
      'Landlord hasn\u2019t fixed the boiler in three weeks.',
      'Mass tenant rights actually do cover this.',
    ],
  },
  {
    kind: 'cluster',
    cl: 41,
    zoom: 1.8,
    label: '3 of 3',
    eyebrow: 'The unexpected argument',
    title: 'Where the loudest fights turn out to be about bike lanes',
    prose: 'The third cluster is a surprise. Nothing polarizes Boston Reddit quite like a white painted stripe on Commonwealth Ave. Who kills whom. Who runs red lights. Whether a delivery van counts as blocking or parking. Ghost bikes, Vision Zero, right-hooks at Porter. A city arguing about its sidewalks.',
    pullquotes: [
      'Drivers kill far more people than cyclists do.',
      'Cyclists roll through stops constantly.',
      'Protected lanes aren\u2019t optional \u2014 they\u2019re the only thing that works.',
    ],
  },
];

function wordsHTML(s) {
  // Basic HTML-escape.
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createTour({ globe, App, nav }) {
  let idx = 0;
  let active = false;
  let savedFocus = null;

  const overlay = document.getElementById('tour-overlay');
  if (!overlay) return { start() {}, close() {}, active: () => false };
  const heroEl = overlay.querySelector('.tour-hero');
  const cardEl = overlay.querySelector('.tour-card');
  const btnBegin = overlay.querySelector('#tour-begin');
  const btnNext = overlay.querySelector('#tour-next');
  const btnPrev = overlay.querySelector('#tour-prev');
  const btnSkip = overlay.querySelector('#tour-skip');
  const skipHero = overlay.querySelector('#tour-skip-hero');

  function renderHero(beat) {
    heroEl.querySelector('.tour-eyebrow').textContent = beat.eyebrow;
    heroEl.querySelector('.tour-headline').textContent = beat.headline;
    heroEl.querySelector('.tour-lede').textContent = beat.lede;
    heroEl.classList.remove('hidden');
    cardEl.classList.add('hidden');
  }

  function renderCard(beat) {
    const total = BEATS.filter(b => b.kind === 'cluster').length;
    cardEl.querySelector('.tour-step').textContent = beat.label;
    cardEl.querySelector('.tour-eyebrow').textContent = beat.eyebrow;
    cardEl.querySelector('.tour-title').textContent = beat.title;
    cardEl.querySelector('.tour-prose').textContent = beat.prose;
    const quotes = cardEl.querySelector('.tour-quotes');
    quotes.innerHTML = (beat.pullquotes || []).map(q =>
      `<blockquote class="tour-quote">\u201c${wordsHTML(q)}\u201d</blockquote>`
    ).join('');
    btnPrev.classList.toggle('hidden', idx <= 1);
    btnNext.textContent = (idx === BEATS.length - 1) ? 'Explore on your own \u2192' : 'Next \u2192';
    cardEl.classList.remove('hidden');
    heroEl.classList.add('hidden');
    // slide-in from right
    cardEl.classList.remove('tour-in'); void cardEl.offsetWidth;
    cardEl.classList.add('tour-in');
  }

  function panToCluster(cl, zoom) {
    try {
      const anchor = clusterAnchor(App.state, cl);
      if (!anchor) return;
      globe.rotateTo(anchor.lat, anchor.lon, zoom || 1.9);
      // Highlight the cluster softly so the eye lands on it.
      if (globe.setHighlight) globe.setHighlight({ cl });
    } catch (e) {
      console.warn('tour: pan failed', e);
    }
  }

  function render() {
    const beat = BEATS[idx];
    if (beat.kind === 'intro') {
      renderHero(beat);
    } else {
      // Start the pan a beat before the card shows, so the globe is
      // already settling when the reader starts reading.
      panToCluster(beat.cl, beat.zoom);
      setTimeout(() => { if (active && BEATS[idx] === beat) renderCard(beat); }, 450);
    }
  }

  function clearHighlight() {
    if (globe.setHighlight) globe.setHighlight({});
  }

  function start() {
    if (active) return;
    active = true;
    idx = 0;
    savedFocus = nav && nav.focusCl != null
      ? { cl: nav.focusCl, gid: nav.focusGid, posIdx: nav.focusPosIdx }
      : null;
    overlay.classList.remove('hidden');
    document.body.classList.add('tour-active');
    render();
  }

  function close() {
    if (!active) return;
    active = false;
    overlay.classList.add('hidden');
    document.body.classList.remove('tour-active');
    clearHighlight();
    // Zoom back out for free exploration.
    try { globe.rotateTo(15, -25, 3.0); } catch {}
  }

  function next() {
    if (idx >= BEATS.length - 1) { close(); return; }
    idx += 1;
    render();
  }
  function prev() {
    if (idx <= 0) return;
    idx -= 1;
    render();
  }

  btnBegin?.addEventListener('click', next);
  btnNext?.addEventListener('click', next);
  btnPrev?.addEventListener('click', prev);
  btnSkip?.addEventListener('click', close);
  skipHero?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'Escape') { close(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === ' ') { next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { prev(); e.preventDefault(); }
  });

  return { start, close, isActive: () => active };
}
