/**
 * الجرد — إدخال الكميات الفعلية ومقارنتها بالنظام.
 * المسودّة تُحفظ محليًا أولًا بأول حتى لا يضيع جرد طويل عند إغلاق الصفحة.
 */
import { byId, esc, fillTable, debounce, onClick } from "../core/dom.js";
import { todayISO, fmtDate, fmtNum, itemLabel, arSort, toInt } from "../core/format.js";
import { get } from "../core/store.js";
import { stocktakes } from "../data/repo.js";
import { can } from "../auth/roles.js";
import { toast, toastError, toastWarn, confirmDialog, openModal, withBusy } from "../core/ui.js";
import { exportRows } from "../data/excel.js";
import { printTable } from "./print.js";
import { refreshSummary } from "./shared.js";

const DRAFT_KEY = "mpstore.stocktake.draft";
let built = false;
let counted = {};       // itemId -> قيمة مُدخلة
let search = "";
let category = "";

function loadDraft() {
  try { counted = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch { counted = {}; }
}
const saveDraft = debounce(() => {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(counted)); } catch { /* تجاهل */ }
}, 400);

function build() {
  byId("view-stocktake").innerHTML = `
    <div class="panel">
      <h2>جلسة جرد جديدة</h2>
      <form class="fields" id="stkForm" novalidate>
        <div class="field">
          <label class="req" for="stkTitle">عنوان الجرد</label>
          <input id="stkTitle" data-field="title" placeholder="جرد نهاية الشهر">
          <div class="field-error" data-error-for="title"></div>
        </div>
        <div class="field">
          <label class="req" for="stkDate">تاريخ الجرد</label>
          <input type="date" id="stkDate" data-field="date" value="${todayISO()}">
          <div class="field-error" data-error-for="date"></div>
        </div>
        <div class="field full">
          <label for="stkNotes">ملاحظات</label>
          <textarea id="stkNotes" rows="2"></textarea>
        </div>
        <div class="field full">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="stkPost" style="width:auto">
            ترحيل الفروقات كأذون تسوية وتعديل الأرصدة فعليًا
          </label>
        </div>
      </form>
    </div>

    <div class="stat-grid" id="stkCards"></div>

    <div class="panel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">كشف الجرد</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="stkExport">تنزيل كشف فارغ</button>
        <button class="btn ghost small" id="stkPrint">طباعة الكشف</button>
      </div>
      <div class="toolbar">
        <input type="search" id="stkSearch" placeholder="بحث بالكود أو الاسم">
        <select id="stkCategory"><option value="">كل الفئات</option></select>
        <span class="hint" id="stkDraftHint"></span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الكود</th><th>الصنف</th><th class="center">رصيد النظام</th>
            <th class="center">الكمية الفعلية</th><th class="center">الفرق</th>
          </tr></thead>
          <tbody id="stkBody"></tbody>
        </table>
      </div>
      <div class="toolbar" style="margin-top:14px">
        <button class="btn" id="stkSave">حفظ الجرد</button>
        <button class="btn ghost" id="stkReset">تفريغ المُدخَل</button>
      </div>
    </div>

    <div class="panel">
      <h2>سجل الجرد السابق</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>العنوان</th><th>التاريخ</th><th class="center">الأصناف</th>
            <th class="center">مُرحَّل</th><th>بواسطة</th><th>إجراء</th></tr></thead>
          <tbody id="stkHistory"></tbody>
        </table>
      </div>
    </div>`;

  byId("stkSearch").addEventListener("input", debounce((e) => { search = e.target.value.toLowerCase().trim(); paintTable(); }));
  byId("stkCategory").addEventListener("change", (e) => { category = e.target.value; paintTable(); });
  byId("stkSave").addEventListener("click", save);
  byId("stkReset").addEventListener("click", async () => {
    if (await confirmDialog({ title: "تفريغ المُدخَل", message: "سيتم مسح كل الكميات التي أدخلتها في هذه الجلسة." })) {
      counted = {}; saveDraft(); paintTable(); paintCards();
    }
  });
  byId("stkExport").addEventListener("click", exportSheet);
  byId("stkPrint").addEventListener("click", printSheet);

  byId("stkBody").addEventListener("input", (e) => {
    const input = e.target.closest("input[data-count-for]");
    if (!input) return;
    const id = input.dataset.countFor;
    const value = input.value.trim();
    if (value === "") delete counted[id];
    else counted[id] = toInt(value, 0);
    saveDraft();
    paintDiff(input);
    paintCards();
  });

  onClick(byId("stkHistory"), "[data-act]", async (btn) => {
    if (btn.dataset.act === "detail") return showDetail(btn.dataset.id, btn.dataset.title);
  });

  built = true;
}

export function render() {
  if (!built) { build(); loadDraft(); }
  const sel = byId("stkCategory");
  const current = sel.value;
  sel.innerHTML = `<option value="">كل الفئات</option>` +
    [...new Set(get("items").map((i) => i.category))].sort(arSort)
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = current;
  paintTable();
  paintCards();
  paintHistory();
}

const visible = () => get("items").filter((i) => {
  if (category && i.category !== category) return false;
  if (!search) return true;
  return `${i.code} ${i.brand} ${i.name} ${i.spec}`.toLowerCase().includes(search);
});

function paintTable() {
  fillTable(byId("stkBody"), visible().map((i) => {
    const value = counted[i.id];
    const diff = value === undefined ? "" : value - i.balance;
    return `
    <tr>
      <td class="code">${esc(i.code)}</td>
      <td>${esc(itemLabel(i))}</td>
      <td class="num center">${fmtNum(i.balance)}</td>
      <td class="center"><input type="number" min="0" inputmode="numeric" style="max-width:110px"
           data-count-for="${esc(i.id)}" value="${value ?? ""}"></td>
      <td class="num center" data-diff-for="${esc(i.id)}">${diffCell(diff)}</td>
    </tr>`;
  }), 5, "لا توجد أصناف");
  const n = Object.keys(counted).length;
  byId("stkDraftHint").textContent = n ? `مسودة محفوظة محليًا: ${fmtNum(n)} صنف` : "";
}

const diffCell = (diff) => diff === "" ? "—"
  : diff === 0 ? `<span class="pill ok">مطابق</span>`
  : diff > 0 ? `<span class="pill in">+${fmtNum(diff)}</span>`
  : `<span class="pill out">${fmtNum(diff)}</span>`;

function paintDiff(input) {
  const id = input.dataset.countFor;
  const item = get("itemsById").get(id);
  const cell = byId("stkBody").querySelector(`[data-diff-for="${CSS.escape(id)}"]`);
  const value = counted[id];
  if (cell) cell.innerHTML = diffCell(value === undefined ? "" : value - item.balance);
}

function paintCards() {
  let match = 0, surplus = 0, shortage = 0;
  for (const [id, value] of Object.entries(counted)) {
    const item = get("itemsById").get(id);
    if (!item) continue;
    const diff = value - item.balance;
    if (diff === 0) match++;
    else if (diff > 0) surplus += diff;
    else shortage += Math.abs(diff);
  }
  byId("stkCards").innerHTML = `
    <div class="stat"><div class="label">أصناف تم عدّها</div><div class="value">${fmtNum(Object.keys(counted).length)}</div></div>
    <div class="stat"><div class="label">مطابق للنظام</div><div class="value">${fmtNum(match)}</div></div>
    <div class="stat warn"><div class="label">إجمالي الزيادة</div><div class="value">${fmtNum(surplus)}</div></div>
    <div class="stat danger"><div class="label">إجمالي العجز</div><div class="value">${fmtNum(shortage)}</div></div>`;
}

function lines() {
  return Object.entries(counted).map(([id, value]) => {
    const item = get("itemsById").get(id);
    if (!item) return null;
    return {
      item_id: id, item_code: item.code, item_name: itemLabel(item),
      system_qty: item.balance, counted_qty: value,
    };
  }).filter(Boolean);
}

async function save() {
  if (!can("stocktake")) return toastError("ليس لديك صلاحية تنفيذ الجرد");
  const data = lines();
  if (!data.length) return toastWarn("أدخل الكمية الفعلية لصنف واحد على الأقل");
  if (data.some((l) => l.counted_qty < 0)) return toastError("لا يمكن إدخال كمية سالبة");

  const date = byId("stkDate").value || todayISO();
  if (date > todayISO()) return toastError("تاريخ الجرد في المستقبل");
  const title = byId("stkTitle").value.trim() || `جرد بتاريخ ${fmtDate(date)}`;
  const post = byId("stkPost").checked;
  const diffs = data.filter((l) => l.counted_qty !== l.system_qty).length;

  if (post && diffs) {
    const ok = await confirmDialog({
      title: "ترحيل فروقات الجرد",
      message: `سيتم إنشاء أذون تسوية لعدد ${diffs} فرق وتعديل الأرصدة فعليًا. لا يمكن التراجع إلا بحذف أذون التسوية.`,
      confirmText: "ترحيل", danger: true,
    });
    if (!ok) return;
  }

  await withBusy(byId("stkSave"), async () => {
    try {
      const res = await stocktakes.post({ title, date, notes: byId("stkNotes").value.trim(), lines: data, post });
      toast(`تم حفظ الجرد (${data.length} صنف)${res.posted ? " وترحيل الفروقات" : ""}`);
      counted = {}; localStorage.removeItem(DRAFT_KEY);
      byId("stkTitle").value = ""; byId("stkNotes").value = ""; byId("stkPost").checked = false;
      paintTable(); paintCards(); paintHistory();
      await refreshSummary();
    } catch (err) { toastError(err.message); }
  }, "جارٍ الحفظ...");
}

async function paintHistory() {
  try {
    const rows = await stocktakes.list();
    fillTable(byId("stkHistory"), rows.map((s) => `
      <tr>
        <td>${esc(s.title)}</td>
        <td>${fmtDate(s.stk_date)}</td>
        <td class="center num">—</td>
        <td class="center">${s.posted ? `<span class="pill ok">مُرحَّل</span>` : `<span class="pill low">مسجَّل فقط</span>`}</td>
        <td>${esc(s.created_by_name || "-")}</td>
        <td><button class="btn ghost small" data-act="detail" data-id="${esc(s.id)}"
             data-title="${esc(s.title)}">التفاصيل</button></td>
      </tr>`), 6, "لا توجد جلسات جرد سابقة");
  } catch (err) { toastError(err.message); }
}

async function showDetail(id, title) {
  try {
    const rows = await stocktakes.lines(id);
    openModal({
      title: `تفاصيل: ${title}`,
      bodyHtml: `<div class="table-wrap"><table>
        <thead><tr><th>الكود</th><th>الصنف</th><th class="center">النظام</th>
          <th class="center">الفعلي</th><th class="center">الفرق</th></tr></thead>
        <tbody>${rows.map((l) => `<tr>
          <td class="code">${esc(l.item_code)}</td><td>${esc(l.item_name)}</td>
          <td class="num center">${fmtNum(l.system_qty)}</td>
          <td class="num center">${fmtNum(l.counted_qty)}</td>
          <td class="num center">${diffCell(l.diff)}</td></tr>`).join("")}</tbody></table></div>`,
      actions: [{
        label: "طباعة", kind: "ghost",
        onClick: () => printTable({
          title: `تقرير جرد: ${title}`,
          subtitle: `عدد الأصناف: ${rows.length}`,
          headers: ["الكود", "الصنف", "رصيد النظام", "الكمية الفعلية", "الفرق"],
          rows: rows.map((l) => [l.item_code, l.item_name, l.system_qty, l.counted_qty, l.diff]),
        }),
      }],
    });
  } catch (err) { toastError(err.message); }
}

function sheetRows() {
  return visible().map((i) => ({
    "الكود": i.code, "الصنف": itemLabel(i), "الفئة": i.category,
    "رصيد النظام": i.balance,
    "الكمية الفعلية": counted[i.id] ?? "",
    "الفرق": counted[i.id] === undefined ? "" : counted[i.id] - i.balance,
  }));
}

async function exportSheet() {
  await exportRows(sheetRows(), "كشف_الجرد", "الجرد");
  toast("تم تنزيل الكشف");
}

function printSheet() {
  const rows = sheetRows();
  if (!rows.length) return toastError("لا توجد أصناف");
  printTable({
    title: "كشف جرد المخزن",
    subtitle: `التاريخ: ${fmtDate(byId("stkDate").value || todayISO())} — عدد الأصناف: ${rows.length}`,
    headers: Object.keys(rows[0]), rows: rows.map((r) => Object.values(r)),
  });
}
