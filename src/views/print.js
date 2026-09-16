/** طباعة جدول أو إذن في نافذة مستقلة بتنسيق موحّد. */
import { esc } from "../core/dom.js";
import { APP } from "../config.js";
import { fmtDate } from "../core/format.js";

export function printTable({ title, subtitle = "", headers, rows, footer = "" }) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>
    body { font-family: "IBM Plex Sans Arabic","Segoe UI",sans-serif; padding: 24px; color:#16272F; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .sub { font-size: 12px; color: #5B7078; margin-bottom: 14px; }
    table { width:100%; border-collapse: collapse; font-size: 12px; }
    th { background:#EEF2F3; text-align:right; padding:7px; border:1px solid #C9D6DA; }
    td { padding:6px 7px; border:1px solid #DDE6E9; }
    tfoot td { font-weight:600; background:#F7FAFB; }
    .meta { margin-top:18px; font-size:11px; color:#5B7078;
            display:flex; justify-content:space-between; border-top:1px solid #DDE6E9; padding-top:8px; }
    .sign { margin-top:40px; display:flex; gap:60px; font-size:12px; }
    .sign div { flex:1; border-top:1px solid #16272F; padding-top:6px; text-align:center; }
    @page { margin: 14mm; }
  </style></head><body>
  <h1>${esc(title)}</h1>
  <div class="sub">${esc(subtitle)}</div>
  <table>
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    ${footer ? `<tfoot><tr><td colspan="${headers.length}">${esc(footer)}</td></tr></tfoot>` : ""}
  </table>
  <div class="sign"><div>أمين المخزن</div><div>المستلم</div><div>المدير</div></div>
  <div class="meta"><span>${esc(APP.name)}</span><span>طُبع في ${fmtDate(new Date())}</span></div>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
