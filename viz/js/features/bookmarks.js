// bookmarks — save pinned points for later (storage-backed, most-recent first).

import { escapeHtml, formatRedditKindLabel } from './html-utils.js';

const BOOKMARKS_KEY = 'bookmarks-v1';
const BOOKMARKS_MAX = 200;

export function init(ctx) {
  const { App, storage, sphereColor, pinPointByIndex, getCurrentDetailPin } = ctx;
  const dcBookmarkBtn = document.getElementById('dc-bookmark');
  const bmCard = document.getElementById('bookmarks-card');
  const bmList = document.getElementById('bm-list');
  const bmEmpty = document.getElementById('bm-empty');
  const bmClearBtn = document.getElementById('bm-clear');
  const bmCloseBtn = document.getElementById('bm-close');
  const bmToggle = document.getElementById('bookmarks-toggle');
  const bmToggleCount = document.getElementById('bookmarks-toggle-count');

  function loadBookmarks() {
    const parsed = storage.getJSON(BOOKMARKS_KEY, []);
    return Array.isArray(parsed) ? parsed : [];
  }
  function saveBookmarks(list) {
    storage.setJSON(BOOKMARKS_KEY, list.slice(0, BOOKMARKS_MAX));
  }
  let _bookmarks = loadBookmarks();
  function isBookmarked(idx) {
    if (idx == null) return false;
    return _bookmarks.some(b => b.idx === idx);
  }
  function bookmarkSnapshot(d) {
    return {
      idx: d.idx,
      title: (d.title || '').slice(0, 240),
      bodySnippet: (d.body || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      subreddit: d.subreddit || '',
      type: d.type,
      month: d.month || '',
      cluster: d.cluster,
      permalink: d.permalink || '',
      savedAt: Date.now(),
    };
  }
  function addBookmark(d) {
    if (d?.idx == null) return;
    if (isBookmarked(d.idx)) return;
    _bookmarks.unshift(bookmarkSnapshot(d));
    if (_bookmarks.length > BOOKMARKS_MAX) _bookmarks.length = BOOKMARKS_MAX;
    saveBookmarks(_bookmarks);
    syncBookmarksUI();
  }
  function removeBookmark(idx) {
    const next = _bookmarks.filter(b => b.idx !== idx);
    if (next.length === _bookmarks.length) return;
    _bookmarks = next;
    saveBookmarks(_bookmarks);
    syncBookmarksUI();
  }
  function clearAllBookmarks() {
    if (_bookmarks.length === 0) return;
    if (!confirm(`Remove all ${_bookmarks.length} saved point${_bookmarks.length === 1 ? '' : 's'}?`)) return;
    _bookmarks = [];
    saveBookmarks(_bookmarks);
    syncBookmarksUI();
  }

  function formatBookmarkAge(ts) {
    if (!ts) return '';
    const sec = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
    catch { return ''; }
  }

  function syncBookmarksUI() {
    const n = _bookmarks.length;
    if (bmToggle && bmToggleCount) {
      bmToggleCount.textContent = String(n);
      bmToggle.classList.toggle('hidden', n === 0);
    }
    updateDetailBookmarkBtn();
    if (bmCard && !bmCard.classList.contains('hidden')) renderBookmarksCard();
  }
  function updateDetailBookmarkBtn() {
    if (!dcBookmarkBtn) return;
    const idx = getCurrentDetailPin?.()?.idx;
    const on = idx != null && isBookmarked(idx);
    dcBookmarkBtn.classList.toggle('on', on);
    dcBookmarkBtn.textContent = on ? '★' : '☆';
    dcBookmarkBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    dcBookmarkBtn.title = on ? 'Remove from saved points' : 'Bookmark this point (saved locally)';
  }
  function renderBookmarksCard() {
    if (!bmCard || !bmList) return;
    bmList.innerHTML = '';
    if (!_bookmarks.length) {
      if (bmEmpty) bmEmpty.style.display = '';
      return;
    }
    if (bmEmpty) bmEmpty.style.display = 'none';
    for (const b of _bookmarks) {
      const col = sphereColor(b.cluster);
      const titleText = (b.title || b.bodySnippet || '(no text)').trim();
      const meta = `r/${escapeHtml(b.subreddit || '—')} · ${escapeHtml(formatRedditKindLabel(b.type))}${b.month ? ' · ' + escapeHtml(b.month) : ''}`;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bm-row';
      row.dataset.idx = String(b.idx);
      row.innerHTML = `
        <span class="bm-dot" style="background:${col}"></span>
        <span class="bm-row-body">
          <span class="bm-row-meta">${meta}</span>
          <span class="bm-row-title">${escapeHtml(titleText)}</span>
          <span class="bm-row-saved">saved ${escapeHtml(formatBookmarkAge(b.savedAt))}</span>
        </span>
        <button class="bm-row-remove" type="button" aria-label="Remove from saved" title="Remove">×</button>
      `;
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('.bm-row-remove')) return;
        pinPointByIndex(b.idx);
      });
      row.querySelector('.bm-row-remove').addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeBookmark(b.idx);
      });
      bmList.appendChild(row);
    }
  }
  function showBookmarksCard() {
    if (!bmCard) return;
    bmCard.classList.remove('hidden');
    bmToggle?.classList.add('on');
    bmToggle?.setAttribute('aria-pressed', 'true');
    renderBookmarksCard();
  }
  function hideBookmarksCard() {
    if (!bmCard) return;
    bmCard.classList.add('hidden');
    bmToggle?.classList.remove('on');
    bmToggle?.setAttribute('aria-pressed', 'false');
  }
  function toggleBookmarksCard() {
    if (!bmCard) return;
    if (bmCard.classList.contains('hidden')) showBookmarksCard();
    else hideBookmarksCard();
  }

  if (dcBookmarkBtn) {
    dcBookmarkBtn.onclick = (ev) => {
      ev.stopPropagation();
      const d = getCurrentDetailPin?.();
      if (!d || d.idx == null) return;
      if (isBookmarked(d.idx)) removeBookmark(d.idx);
      else addBookmark(d);
    };
  }
  if (bmToggle) bmToggle.onclick = (ev) => { ev.stopPropagation(); toggleBookmarksCard(); };
  if (bmCloseBtn) bmCloseBtn.onclick = (ev) => { ev.stopPropagation(); hideBookmarksCard(); };
  if (bmClearBtn) bmClearBtn.onclick = (ev) => { ev.stopPropagation(); clearAllBookmarks(); };

  App.closeBookmarksCard = () => {
    if (!bmCard) return false;
    if (bmCard.classList.contains('hidden')) return false;
    hideBookmarksCard();
    return true;
  };

  syncBookmarksUI();

  return { syncBookmarksUI, updateDetailBookmarkBtn, isBookmarked, addBookmark, removeBookmark };
}
