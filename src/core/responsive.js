// طبقة الاستجابة — تُشغَّل مرة واحدة بعد الدخول.
//
// ثلاثة أشياء لا تحتاج تعديل أي شاشة:
//
// 1) تسمية خلايا الجداول: تقرأ رؤوس كل جدول وتنسخها في data-label
//    على كل خلية، فيقلبها CSS إلى كروت على الموبايل. لو فعلناها
//    بتعديل الشاشات لاحتجنا لمس ثلاث عشرة شاشة، ونسيان واحدة يكسرها.
//    المراقب يتولّى الجداول التي تُرسم لاحقًا.
//
// 2) شريط تنقّل سفلي: يُبنى من أزرار القائمة الجانبية نفسها، فيرث
//    صلاحياتها تلقائيًا ولا يعرض شاشة ممنوعة.
//
// 3) مقياس الخط: يضرب جذر الصفحة، وكل المقاسات بـ rem فيكبر كل شيء
//    معًا بدل أن يكبر النص وحده داخل أزرار لم تكبر.

import { byId, $$ } from "./dom.js";

const SCALES = [1, 1.12, 1.25];
const LS_SCALE = "mpstore.uiScale";

// الشاشات الأربع التي يقضي فيها أمين المخزن يومه
const PRIMARY = ["dashboard", "voucherIn", "voucherOut", "items"];

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  voucherIn: '<path d="M12 3v10"/><path d="m8 9 4 4 4-4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  voucherOut: '<path d="M12 14V4"/><path d="m8 8 4-4 4 4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  items: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  more: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
};

const LABELS = {
  dashboard: "اللوحة",
  voucherIn: "وارد",
  voucherOut: "صرف",
  items: "الأصناف",
  more: "المزيد",
};

export function startResponsive() {
  applyScale(readScale());
  mountScaleButton();
  mountBottomNav();
  labelAllTables();
  watchTables();
}

// ------------------------- مقياس الخط -------------------------

function readScale() {
  const saved = Number(localStorage.getItem(LS_SCALE));
  return SCALES.indexOf(saved) > -1 ? saved : 1;
}

function applyScale(scale) {
  document.documentElement.style.setProperty("--ui-scale", String(scale));
  const btn = byId("btnScale");
  if (btn) {
    const step = SCALES.indexOf(scale) + 1;
    btn.textContent = step === 1 ? "أ" : "أ" + "+".repeat(step - 1);
    btn.title = "حجم الخط: " + Math.round(scale * 100) + "٪";
  }
}

function mountScaleButton() {
  if (byId("btnScale")) return;
  const refresh = byId("btnRefresh");
  if (!refresh) return;

  const btn = document.createElement("button");
  btn.id = "btnScale";
  btn.type = "button";
  btn.className = "btn ghost small";
  btn.setAttribute("aria-label", "تكبير حجم الخط");

  btn.addEventListener("click", () => {
    const next = SCALES[(SCALES.indexOf(readScale()) + 1) % SCALES.length];
    try { localStorage.setItem(LS_SCALE, String(next)); } catch (e) {}
    applyScale(next);
  });

  refresh.parentNode.insertBefore(btn, refresh);
  applyScale(readScale());
}

// ------------------------- الشريط السفلي -------------------------

function mountBottomNav() {
  if (byId("bottomNav")) return;

  const nav = document.createElement("nav");
  nav.id = "bottomNav";
  nav.setAttribute("aria-label", "التنقّل السريع");

  PRIMARY.forEach((view) => {
    // الزر الأصلي في القائمة الجانبية مخفيّ إن لم يملك المستخدم صلاحيته
    const origin = document.querySelector('.nav [data-view="' + view + '"]');
    if (!origin || origin.hidden) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.jump = view;
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[view] + "</svg>" +
                    "<span>" + LABELS[view] + "</span>";
    btn.addEventListener("click", () => { location.hash = view; });
    nav.append(btn);
  });

  // "المزيد" يفتح القائمة الجانبية: بقية الشاشات تبقى موجودة كاملة
  const more = document.createElement("button");
  more.type = "button";
  more.dataset.jump = "__more";
  more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS.more + "</svg>" +
                   "<span>" + LABELS.more + "</span>";
  more.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  nav.append(more);

  document.body.append(nav);

  syncActive();
  window.addEventListener("hashchange", syncActive);
}

function syncActive() {
  const view = (location.hash.replace(/^#/, "").split("?")[0]) || "dashboard";
  $$("#bottomNav [data-jump]").forEach((b) => {
    b.classList.toggle("active", b.dataset.jump === view);
  });
}

// ------------------------- تسمية خلايا الجداول -------------------------

function labelTable(table) {
  const heads = [...table.querySelectorAll("thead th")].map((th) =>
    th.textContent.trim().replace(/\s+/g, " "));
  if (!heads.length) return;

  table.querySelectorAll("tbody tr").forEach((tr) => {
    const cells = tr.children;
    // صف يمتد على عرض الجدول (عنوان مجموعة أو رسالة فراغ) لا يُسمّى
    if (cells.length === 1 && cells[0].hasAttribute("colspan")) return;

    for (let i = 0; i < cells.length; i++) {
      const td = cells[i];
      if (td.dataset.label) continue;

      const head = heads[i] || "";
      td.dataset.label = head;

      if (i === 0) td.dataset.first = "";
      // عمود بلا عنوان في الرأس هو عمود الأزرار في كل شاشاتنا
      if (!head && td.querySelector(".btn")) td.dataset.actions = "";
    }
  });
}

function labelAllTables() {
  document.querySelectorAll(".table-wrap table").forEach(labelTable);
}

// الشاشات تُعيد رسم <tbody> عند كل تحديث، فالتسمية تحتاج متابعة
function watchTables() {
  const observer = new MutationObserver((records) => {
    const seen = new Set();
    for (const record of records) {
      const table = record.target.closest && record.target.closest(".table-wrap table");
      if (table && !seen.has(table)) { seen.add(table); labelTable(table); }
    }
  });

  const main = document.querySelector("main");
  if (main) observer.observe(main, { childList: true, subtree: true });
}
