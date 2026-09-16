/** سجل الحركات — الترشيح والترقيم يتمّان على الخادم حتى لا يُحمَّل السجل كله. */
import { byId, esc, fillTable, debounce, onClick } from "../core/dom.js";
import { fmtDate, fmtNum } from "../core/format.js";
import { get } from "../core/store.js";
import { txns } from "../data/repo.js";
import { can } from "../auth/roles.js";
import { toast, toastError, confirmDialog } from "../core/ui.js";
import { exportRows } from "../data/excel.js";
import { printTable } from "./print.js";
import { refreshSummary } from "./shared.js";
import { APP } from "../config.js";

let built = false;
let state = { type: "", from: "", to: "", search: "", project: "", page: 0, count: 0, rows: [] };

function build() {
  byId("view-log").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">سجل الحركات</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="logExport">تنزيل Excel</button>
        <button class="btn ghost small" id="logPrint">طباعة</button>
      </div>
      <div class="toolbar">
        <input type="search" id="logSearch" placeholder="رقم إذن، صنف، جهة...">
        <select id="logType">
          <option value="">كل الأنواع</option>
          <option value="in">وارد</option>
          <option value="out">صرف</option>
        </select>
        <select id="logProject"><option value="">كل المشاريع</option></select>
        <input type="date" id="logFrom" title="من تاريخ">
        <input type="date" id="logTo" title="إلى تاريخ">
        <button class="btn ghost small" id="logReset">إعادة ضبط</button>
      </div>
      <div class="hint" id="logCount"></div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>النوع</th><th>رقم الإذن</th><th>التاريخ</th><th>الصنف</th>
            <th class="center">الكمية</th><th>الجهة</th><th>المشروع</th><th>بواسطة</th>
            ${can("delete_voucher") ? "<th>إجراء</th>" : ""}
          </tr></thead>
          <tbody id="logBody"></tbody>
        </table>
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn ghost small" id="logPrev">السابق</button>
        <span class="hint" id="logPage"></span>
        <button class="btn ghost small" id="logNext">التالي</button>
      </div>
    </div>`;

  const reload = debounce(() => { state.page = 0; load(); }, 260);
  byId("logSearch").addEventListener("input", (e) => { state.search = e.target.value.trim(); reload(); });
  byId("logType").addEventListener("change", (e) => { state.type = e.target.value; state.page = 0; load(); });
  byId("logProject").addEventListener("change", (e) => { state.project = e.target.value; state.page = 0; load(); });
  byId("logFrom").addEventListener("change", (e) => { state.from = e.target.value; state.page = 0; load(); });
  byId("logTo").addEventListener("change", (e) => { state.to = e.target.value; state.page = 0; load(); });
  byId("logReset").addEventListener("click", () => {
    state = { ...state, type: "", from: "", to: "", search: "", project: "", page: 0 };
    ["logSearch", "logType", "logProject", "logFrom", "logTo"].forEach((id) => { byId(id).value = ""; });
    load();
  });
  byId("logPrev").addEventListener("click", () => { if (state.page > 0) { state.page--; load(); } });
  byId("logNext").addEventListener("click", () => {
    if ((state.page + 1) * APP.logPageSize < state.count) { state.page++; load(); }
  });
  byId("logExport").addEventListener("click", exportCurrent);
  byId("logPrint").addEventListener("click", printCurrent);

  onClick(byId("logBody"), "[data-del]", async (btn) => {
    const no = btn.dataset.del;
    const ok = await confirmDialog({
      title: "حذف إذن", message: `سيُحذف الإذن ${no} بالكامل وتُعدَّل الأرصدة.`,
      confirmText: "حذف نهائي", danger: true,
    });
    if (!ok) return;
    try {
      await txns.deleteVoucher(no);
      toast(`تم حذف الإذن ${no}`);
      await Promise.all([load(), refreshSummary()]);
    } catch (err) { toastError(err.message); }
  });

  built = true;
}

export function render(params = {}) {
  if (!built) build();
  if (Object.keys(params).length) {
    state = { ...state, type: params.type || "", project: params.project || "",
              search: params.search || "", from: params.from || "", to: params.to || "", page: 0 };
    byId("logType").value = state.type;
    byId("logSearch").value = state.search;
    byId("logFrom").value = state.from;
    byId("logTo").value = state.to;
  }
  const sel = byId("logProject");
  const current = sel.value;
  sel.innerHTML = `<option value="">كل المشاريع</option>` +
    get("projects").map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
  sel.value = state.project || current;
  load();
}

async function load() {
  byId("logBody").innerHTML = `<tr><td colspan="9"><div class="skeleton" style="height:18px"></div></td></tr>`;
  try {
    const { rows, count } = await txns.list({ ...state, size: APP.logPageSize });
    state.rows = rows; state.count = count;
    paint();
  } catch (err) { toastError(err.message); }
}

function paint() {
  fillTable(byId("logBody"), state.rows.map((t) => `
    <tr>
      <td><span class="pill ${t.type}">${t.type === "in" ? "وارد" : "صرف"}</span></td>
      <td class="code">${esc(t.voucher_no)}</td>
      <td>${fmtDate(t.txn_date)}</td>
      <td>${esc(t.item_name)}</td>
      <td class="num center">${fmtNum(t.qty)}</td>
      <td>${esc(t.party || "-")}</td>
      <td>${esc(t.project || "-")}</td>
      <td>${esc(t.created_by_name || "-")}</td>
      ${can("delete_voucher")
        ? `<td><button class="btn ghost small" data-del="${esc(t.voucher_no)}">حذف الإذن</button></td>` : ""}
    </tr>`), 9, "لا توجد حركات مطابقة");

  const from = state.count ? state.page * APP.logPageSize + 1 : 0;
  const to = Math.min((state.page + 1) * APP.logPageSize, state.count);
  byId("logCount").textContent = `عرض ${fmtNum(from)}–${fmtNum(to)} من ${fmtNum(state.count)} حركة`;
  byId("logPage").textContent = `صفحة ${state.page + 1}`;
  byId("logPrev").disabled = state.page === 0;
  byId("logNext").disabled = to >= state.count;
}

function currentRows() {
  return state.rows.map((t) => ({
    "النوع": t.type === "in" ? "وارد" : "صرف",
    "رقم الإذن": t.voucher_no, "التاريخ": t.txn_date, "الصنف": t.item_name,
    "الكمية": t.qty, "الجهة": t.party, "المشروع": t.project, "بواسطة": t.created_by_name,
  }));
}

async function exportCurrent() {
  const rows = currentRows();
  if (!rows.length) return toastError("لا توجد بيانات للتصدير");
  await exportRows(rows, "سجل_الحركات", "الحركات");
  toast("تم تنزيل ملف Excel");
}

function printCurrent() {
  const rows = currentRows();
  if (!rows.length) return toastError("لا توجد بيانات للطباعة");
  printTable({
    title: "سجل حركات المخزن",
    subtitle: `عدد الحركات المعروضة: ${rows.length}`,
    headers: Object.keys(rows[0]),
    rows: rows.map((r) => Object.values(r)),
  });
}
