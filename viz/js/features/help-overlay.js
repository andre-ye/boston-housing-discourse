// help-overlay — ? keyboard shortcuts sheet (overlayManager + keys.helpSheetRows).

import { keys } from '../core/keys.js';
import { overlayManager } from '../core/overlays.js';
import { storage } from '../core/storage.js';
import { escapeHtml } from './html-utils.js';

const GROUP_ORDER = ['search', 'navigate', 'view', 'other'];
const GROUP_TITLE = {
  search: 'Search',
  navigate: 'Navigate',
  view: 'View',
  other: 'Other',
};

function groupRank(g) {
  const i = GROUP_ORDER.indexOf(g);
  return i < 0 ? GROUP_ORDER.length : i;
}

function keysCellHtml(keysStr) {
  const bits = keysStr.split(' · ').map((s) => s.trim()).filter(Boolean);
  if (!bits.length) return '';
  return bits.map((b) => `<kbd class="help-kbd">${escapeHtml(b)}</kbd>`).join(' ');
}

function renderSheet(bodyEl) {
  const rows = keys.helpSheetRows();
  rows.sort((a, b) => {
    const rg = groupRank(a.group) - groupRank(b.group);
    if (rg !== 0) return rg;
    return 0;
  });
  const sections = new Map();
  for (const r of rows) {
    const g = r.group || 'other';
    if (!sections.has(g)) sections.set(g, []);
    sections.get(g).push(r);
  }
  const parts = [];
  for (const g of GROUP_ORDER) {
    const list = sections.get(g);
    if (!list?.length) continue;
    const title = GROUP_TITLE[g] || g;
    parts.push(`<section class="help-section" aria-labelledby="help-h-${escapeHtml(g)}">`);
    parts.push(`<h3 class="help-section-title" id="help-h-${escapeHtml(g)}">${escapeHtml(title)}</h3>`);
    parts.push('<dl class="help-dl">');
    for (const row of list) {
      parts.push(
        '<div class="help-row">',
        `<dt class="help-keys">${keysCellHtml(row.keys)}</dt>`,
        `<dd class="help-desc">${escapeHtml(row.label)}</dd>`,
        '</div>',
      );
    }
    parts.push('</dl></section>');
  }
  bodyEl.innerHTML = parts.join('');
}

/**
 * Registers #help-overlay with overlayManager and binds ? to toggle.
 * Call late in boot after every module has registered its keys.bind().
 */
export function initHelpOverlay() {
  const root = document.getElementById('help-overlay');
  if (!root || root.dataset.helpInit === '1') return;
  root.dataset.helpInit = '1';

  const bodyEl = root.querySelector('.help-overlay-body');
  const closeBtn = root.querySelector('.help-overlay-close');
  const backdrop = root.querySelector('.help-overlay-backdrop');

  overlayManager.register({
    name: 'help',
    rootEl: root,
    bodyClasses: ['help-overlay-open'],
    closeOnEsc: true,
    onOpen() {
      try { storage.set('help-seen', '1'); } catch {}
      if (bodyEl) renderSheet(bodyEl);
      closeBtn?.focus?.();
    },
  });

  function toggleHelp(e) {
    if (overlayManager.isOpen('help')) {
      overlayManager.close('help');
    } else {
      overlayManager.open('help');
    }
    e?.preventDefault?.();
    return true;
  }

  keys.bind({
    keys: ['Escape'],
    priority: 250,
    label: 'esc-help-overlay',
    helpHidden: true,
    allowInInput: true,
    handler: (e) => {
      if (!overlayManager.isOpen('help')) return false;
      overlayManager.close('help');
      e.preventDefault();
      return true;
    },
  });

  keys.bind({
    keys: ['?'],
    priority: 22,
    label: 'help-overlay-toggle',
    helpHidden: true,
    handler: toggleHelp,
  });

  closeBtn?.addEventListener('click', () => overlayManager.close('help'));
  backdrop?.addEventListener('click', () => overlayManager.close('help'));

  document.getElementById('btn-help')?.addEventListener('click', (e) => toggleHelp(e));
}
