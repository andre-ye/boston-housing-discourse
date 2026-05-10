// storage — namespaced localStorage wrapper; migrates legacy keys on first boot.

const PREFIX = 'boston-reddit:';
const LEGACY_KEYS = {
  vizIntroSeen:    'intro-seen',
  vizSearchHist:   'search-hist',
  vizPref:         'pref',
  vizFsHintSeen:   'fs-hint-seen',
  layout:          'layout',
};

let _migrated = false;
function migrateLegacy() {
  if (_migrated) return;
  _migrated = true;
  try {
    const flag = localStorage.getItem(PREFIX + '_migrated');
    if (flag === '1') return;
    for (const [oldKey, newSubkey] of Object.entries(LEGACY_KEYS)) {
      const v = localStorage.getItem(oldKey);
      if (v == null) continue;
      const newKey = PREFIX + newSubkey;
      if (localStorage.getItem(newKey) == null) localStorage.setItem(newKey, v);
      localStorage.removeItem(oldKey);
    }
    localStorage.setItem(PREFIX + '_migrated', '1');
  } catch {}
}

export const storage = {
  init() { migrateLegacy(); },
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : v;
    } catch { return fallback; }
  },
  getJSON(key, fallback = null) {
    const v = this.get(key, null);
    if (v == null) return fallback;
    try { return JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, value); } catch {}
  },
  setJSON(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch {}
  },
};
