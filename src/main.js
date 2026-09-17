/** نقطة البداية: تشغيل التطبيق، تحميل البيانات، والتنقّل بين الشاشات. */
import { byId, $$ } from "./core/dom.js";
import { set, get, on, saveCache, loadCache } from "./core/store.js";
import { toast, toastError, toastWarn, setConnection, confirmDialog } from "./core/ui.js";
import { initClient, isConfigured } from "./data/client.js";
import { items as itemsRepo, lists, settings as settingsRepo } from "./data/repo.js";
import { startRealtime, watchNetwork, onTxnChange } from "./data/realtime.js";
import { restoreSession, signOut, currentUser } from "./auth/auth.js";
import { startSessionGuard, stopSessionGuard, isSessionStale, markExpiry, takeExpiryReason } from "./auth/session-guard.js";
import { mountLogin } from "./auth/login.js";
import { can, roleLabel } from "./auth/roles.js";
import { APP } from "./config.js";

import * as dashboard from "./views/dashboard.js";
import * as itemsView from "./views/items.js";
import { makeVoucherView } from "./views/voucher.js";
import * as logView from "./views/log.js";
import * as reportsView from "./views/reports.js";
import * as pricingView from "./views/pricing.js";
import * as stocktakeView from "./views/stocktake.js";
import * as settingsView from "./views/settings.js";
import * as accountingView from "./views/accounting.js";
import { refreshSummary } from "./views/shared.js";

const voucherIn  = makeVoucherView("in");
const voucherOut = makeVoucherView("out");

/** عنوان كل شاشة كما يظهر في الشريط العلوي */
const TITLES = {
  dashboard: "لوحة القيادة", items: "الأصناف", voucherIn: "إذن وارد", voucherOut: "إذن صرف",
  log: "سجل الحركات", reports: "التقارير", pricing: "التسعير", accounting: "المحاسبة",
  stocktake: "الجرد", settings: "الإعدادات",
};

const closeNav = () => document.body.classList.remove("nav-open");

const VIEWS = {
  dashboard:  { render: dashboard.render,     permission: null },
  items:      { render: itemsView.render,     permission: null },
  voucherIn:  { render: voucherIn.render,     permission: "create_voucher" },
  voucherOut: { render: voucherOut.render,    permission: "create_voucher" },
  log:        { render: logView.render,       permission: null },
  reports:    { render: reportsView.render,   permission: null },
  pricing:    { render: pricingView.render,   permission: "view_pricing" },
  accounting: { render: accountingView.render, permission: "accounting" },
  stocktake:  { render: stocktakeView.render, permission: "stocktake" },
  settings:   { render: settingsView.render,  permission: null },
};

/* ------------------------- التشغيل ------------------------- */
start();

/** يمنع أي نداء شبكة معلّق من تجميد بدء التطبيق. */
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function start() {
  document.body.classList.add("is-locked");

  // شاشة الدخول تُركَّب أولًا دائمًا، حتى لو تعطّل الاتصال بالخادم،
  // حتى لا يجد المستخدم نفسه أمام شاشة جامدة لا تستجيب.
  try { initClient(); } catch (err) { console.error(err); }
  mountLogin(boot);

  // سبب آخر خروج تلقائي — يُعرض مرة واحدة حتى لا يتساءل المستخدم لماذا خرج
  const expiryNote = takeExpiryReason();
  if (expiryNote) toastWarn(expiryNote);

  if (!isConfigured()) return;

  try {
    const profile = await withTimeout(restoreSession(), 9000, "لم يستجب الخادم خلال ٩ ثوانٍ");

    // جلسة محفوظة لكن مدة الخمول أو سقف الجلسة انتهيا أثناء إغلاق المتصفح:
    // لا تُستعاد، وإلا صار إغلاق المتصفح وفتحه وسيلة لتجاوز حد الخمول.
    const stale = profile && isSessionStale();
    if (stale) {
      markExpiry(stale);
      await signOut();
      stopSessionGuard({ broadcast: false });
      toastWarn(stale === "max" ? "انتهت مدة الجلسة القصوى. سجّل الدخول من جديد."
                                : "انتهت الجلسة تلقائيًا بسبب عدم النشاط.");
      return;
    }

    if (profile) {
      byId("loginScene").hidden = true;
      document.body.classList.remove("is-locked");
      boot(profile);
    }
  } catch (err) {
    // لا جلسة سابقة أو تعذّر التحقق منها — شاشة الدخول جاهزة بالفعل
    console.warn("تعذّرت استعادة الجلسة:", err.message);
  }
}

async function boot(profile) {
  byId("appShell").classList.add("ready");
  byId("userName").textContent = profile.full_name;
  byId("userRole").textContent = roleLabel(profile.role);
  byId("appVersion").textContent = `الإصدار ${APP.version}`;

  applyPermissions();
  wireChrome();

  // عرض فوري من النسخة المحلية ثم تحديثها من الخادم
  const hadCache = loadCache();
  if (hadCache) routeFromHash();
  setConnection("syncing", "جارٍ تحميل البيانات...");

  try {
    const [itemRows, supplierRows, projectRows, categoryRows, settingsRows] = await Promise.all([
      itemsRepo.list(), lists.suppliers(), lists.projects(), lists.categories(), settingsRepo.all(),
    ]);
    set({ items: itemRows, suppliers: supplierRows, projects: projectRows,
          categories: categoryRows, settings: settingsRows, loadedAt: Date.now() });
    saveCache();
    setConnection("online", "متصل");
  } catch (err) {
    setConnection("offline", "تعذّر التحميل — تُعرض آخر نسخة محفوظة");
    toastError(err.message);
  }

  startRealtime();
  watchNetwork();
  onTxnChange(() => { if (currentView() === "dashboard") refreshSummary(); });
  on("items", saveCache);

  // إنهاء الجلسة تلقائيًا عند الخمول (٣٠ دقيقة) أو تجاوز سقف الجلسة (١٢ ساعة)،
  // وإعادة التحميل إلى شاشة الدخول بدل ترك واجهة معطوبة بلا جلسة صالحة.
  startSessionGuard(() => location.reload());

  routeFromHash();
  window.addEventListener("hashchange", routeFromHash);
}

/* ------------------------- التنقّل ------------------------- */
/** الرابط يحمل الشاشة ومعها مرشّحاتها: #items?stock=low */
function parseHash() {
  const raw = location.hash.replace(/^#/, "");
  const [view, query] = raw.split("?");
  return {
    view: view || "dashboard",
    params: Object.fromEntries(new URLSearchParams(query || "")),
  };
}

const currentView = () => parseHash().view;

/** تُستخدمها الشاشات للانتقال لشاشة أخرى بمرشّح جاهز. */
export function go(view, params = {}) {
  const query = new URLSearchParams(params).toString();
  location.hash = query ? `${view}?${query}` : view;
}
window.mpGo = go;

function routeFromHash() {
  let { view, params } = parseHash();
  if (!VIEWS[view]) { view = "dashboard"; params = {}; }
  const perm = VIEWS[view].permission;
  if (perm && !can(perm)) { toastError("ليس لديك صلاحية لفتح هذه الشاشة"); view = "dashboard"; params = {}; }

  $$("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  byId("pageTitle").textContent = TITLES[view] || "";
  closeNav();
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === `view-${view}`));
  window.scrollTo({ top: 0 });
  try { VIEWS[view].render(params); } catch (err) { console.error(err); toastError("تعذّر عرض الشاشة"); }
}

function applyPermissions() {
  $$("[data-view]").forEach((btn) => {
    const perm = VIEWS[btn.dataset.view]?.permission;
    btn.hidden = Boolean(perm && !can(perm));
  });
}

function wireChrome() {
  $$("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = btn.dataset.view; });
  });

  byId("btnMenu").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  byId("navBackdrop").addEventListener("click", closeNav);

  byId("btnLogout").addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "تسجيل الخروج", message: "هل تريد إنهاء الجلسة الآن؟" });
    if (!ok) return;
    stopSessionGuard();
    await signOut();
    location.reload();
  });

  byId("btnRefresh").addEventListener("click", async () => {
    setConnection("syncing", "جارٍ التحديث...");
    try {
      const [itemRows] = await Promise.all([itemsRepo.list(), refreshSummary()]);
      set({ items: itemRows });
      saveCache();
      setConnection("online", "متصل");
      toast("تم تحديث البيانات");
      routeFromHash();
    } catch (err) { setConnection("offline", "تعذّر التحديث"); toastError(err.message); }
  });

  // اختصارات لوحة المفاتيح لأمين المخزن سريع الإدخال
  document.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    const map = { "1": "dashboard", "2": "items", "3": "voucherIn", "4": "voucherOut", "5": "log" };
    if (map[e.key]) { e.preventDefault(); location.hash = map[e.key]; }
  });
}