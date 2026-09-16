/**
 * طباعة جدول أو إذن في نافذة مستقلة بتنسيق موحّد،
 * بترويسة تحمل لوجو الشركة واسمها.
 */
import { esc } from "../core/dom.js";
import { APP } from "../config.js";
import { fmtDate } from "../core/format.js";

/**
 * مسار اللوجو لازم يكون مطلقًا، لأن نافذة الطباعة صفحة فارغة
 * ولا ترث مسار الصفحة الأصلية فلن تجد المسار النسبي.
 */
function logoUrl() {
  if (!APP.logo) return "";
  try { return new URL(APP.logo, document.baseURI).href; }
  catch { return ""; }
}

export function printTable({ title, subtitle = "", headers, rows, footer = "" }) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;

  const logo = logoUrl();
  const head = logo
    ? `<img class="logo" src="${esc(logo)}" alt="" onerror="this.remove()">`
    : "";

  win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
  <title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: "IBM Plex Sans Arabic","Segoe UI",sans-serif; padding: 20px 24px; color:#16272F; }
    .letterhead {
      display:flex; align-items:center; gap:14px;
      border-bottom:2px solid #8C5A2B; padding-bottom:10px; margin-bottom:14px;
    }
    .letterhead .logo { height:${Number(APP.logoHeight) || 52}px; width:auto; object-fit:contain; }
    .letterhead .org { flex:1; }
    .letterhead .company { font-size:15px; font-weight:600; }
    .letterhead .dept { font-size:11px; color:#5B7078; }
    .letterhead .stamp { font-size:11px; color:#5B7078; text-align:left; white-space:nowrap; }
    h1 { font-size: 17px; margin: 0 0 4px; }
    .sub { font-size: 12px; color: #5B7078; margin-bottom: 14px; }
    table { width:100%; border-collapse: collapse; font-size: 12px; }
    th { background:#EEF2F3; text-align:right; padding:7px; border:1px solid #C9D6DA; }
    td { padding:6px 7px; border:1px solid #DDE6E9; }
    tfoot td { font-weight:600; background:#F7FAFB; }
    .meta { margin-top:18px; font-size:11px; color:#5B7078;
            display:flex; justify-content:space-between; border-top:1px solid #DDE6E9; padding-top:8px; }
    .sign { margin-top:40px; display:flex; gap:60px; font-size:12px; }
    .sign div { flex:1; border-top:1px solid #16272F; padding-top:6px; text-align:center; }
    @page { margin: 12mm; }
    @media print {
      .letterhead { position: running(header); }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
  </style></head><body>

  <div class="letterhead">
    ${head}
    <div class="org">
      <div class="company">${esc(APP.company || "")}</div>
      <div class="dept">${esc(APP.name)}</div>
    </div>
    <div class="stamp">${esc(fmtDate(new Date()))}</div>
  </div>

  <h1>${esc(title)}</h1>
  <div class="sub">${esc(subtitle)}</div>

  <table>
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    ${footer ? `<tfoot><tr><td colspan="${headers.length}">${esc(footer)}</td></tr></tfoot>` : ""}
  </table>

  <div class="sign"><div>أمين المخزن</div><div>المستلم</div><div>المدير</div></div>
  <div class="meta"><span>${esc(APP.name)}</span><span>طُبع في ${esc(fmtDate(new Date()))}</span></div>
  </body></html>`);
  win.document.close();
  win.focus();
  whenReady(win, () => win.print());
}

/**
 * لا تفتح نافذة الطباعة قبل تحميل اللوجو والخط،
 * وإلا تُطبع الصفحة بترويسة فارغة.
 */
function whenReady(win, run) {
  const images = Array.from(win.document.images || []);
  const pending = images.filter((img) => !img.complete);
  let done = false;
  const go = () => { if (!done) { done = true; run(); } };

  if (!pending.length) { setTimeout(go, 250); return; }

  let left = pending.length;
  const tick = () => { if (--left <= 0) setTimeout(go, 120); };
  pending.forEach((img) => { img.addEventListener("load", tick); img.addEventListener("error", tick); });

  // شبكة أمان: لا تنتظر أكثر من ثانيتين مهما حدث
  setTimeout(go, 2000);
}
