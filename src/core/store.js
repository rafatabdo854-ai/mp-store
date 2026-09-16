/**
 * مخزن الحالة في الذاكرة + اشتراكات.
 * الهدف: عرض فوري بدون انتظار الشبكة، والتحديث يصل عبر Realtime.
 */
const state = {
  session: null,
  profile: null,          // { id, username, full_name, role }
  items: [],              // كل الأصناف
  itemsById: new Map(),
  suppliers: [],
  projects: [],
  categories: [],
  settings: {},
  summary: null,
  loadedAt: null,
};

const listeners = new Map();   // key -> Set<fn>

export function get(key) { return key ? state[key] : state; }

export function set(patch) {
  Object.assign(state, patch);
  if (patch.items) {
    state.itemsById = new Map(patch.items.map((i) => [i.id, i]));
  }
  for (const key of Object.keys(patch)) emit(key);
}

export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key).delete(fn);
}

function emit(key) {
  listeners.get(key)?.forEach((fn) => { try { fn(state[key]); } catch (e) { console.error(e); } });
}

export const item = (id) => state.itemsById.get(id) || null;

/** تحديث صنف واحد في الذاكرة (يستخدمه Realtime) دون إعادة تحميل الكل. */
export function upsertItem(row) {
  const idx = state.items.findIndex((i) => i.id === row.id);
  if (idx >= 0) state.items[idx] = { ...state.items[idx], ...row };
  else state.items.push(row);
  state.itemsById.set(row.id, state.items[idx >= 0 ? idx : state.items.length - 1]);
  emit("items");
}

export function removeItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  state.itemsById.delete(id);
  emit("items");
}

/** ذاكرة مؤقتة محلية لعرض سريع عند فتح الصفحة قبل وصول البيانات. */
const CACHE_KEY = "mpstore.cache.v10";
export function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      items: state.items, suppliers: state.suppliers,
      projects: state.projects, categories: state.categories, at: Date.now(),
    }));
  } catch { /* الذاكرة ممتلئة — تجاهل */ }
}

export function loadCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!raw || Date.now() - raw.at > 7 * 864e5) return false;
    set({ items: raw.items || [], suppliers: raw.suppliers || [],
          projects: raw.projects || [], categories: raw.categories || [] });
    return true;
  } catch { return false; }
}

export function clearCache() { localStorage.removeItem(CACHE_KEY); }
