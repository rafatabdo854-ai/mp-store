/** التقارير — أربعة تقارير جاهزة، كلها قابلة للطباعة والتصدير. */
import { byId, esc, fillTable } from "../core/dom.js";
import { fmtDate, fmtNum, fmtMoney, moneyText, todayISO, itemFullLabel, itemLabel } from "../core/format.js";
import { get } from "../core/store.js";
import { reports } from "../data/repo.js";
import { can, gate } from "../auth/roles.js";
import { toast, toastError } from "../core/ui.js";
import { exportRows } from "../data/excel.js";
import { printTable } from "./print.js";
import { monthStart } from "./shared.js";

let built = false;
let last = { title: "", headers: [], rows: [], subtitle: "" };

function build() {
  byId("view-reports").innerHTML = `
    <div class="panel">
      <h2>اختر التقرير</h2>
      <div class="fields">
        <div class="field">
          <label for="rpKind">نوع التقرير</label>
          <select id="rpKind">
            <option value="movement">حركة صنف خلال فترة</option>
            <option value="project">مصروفات مشروع</option>
            <option value="top">الأصناف الأكثر صرفًا</option>
            <option value="low">أصناف تحت الحد الأدنى</option>
          </select>
        </div>
        <div class="field" id="rpItemWrap">
          <label for="rpItem">الصنف</label>
          <input id="rpItem" list="rpItemList" placeholder="اكتب الكود أو الاسم">
          <datalist id="rpItemList"></datalist>
        </div>
        <div class="field" id="rpProjectWrap" hidden>
          <label for="rpProject">المشروع</label>
          <select id="rpProject"></select>
        </div>
        <div class="field" id="rpFromWrap">
          <label for="rpFrom">من تاريخ</label>
          <input type="date" id="rpFrom" value="${monthStart()}">
        </div>
        <div class="field" id="rpToWrap">
          <label for="rpTo">إلى تاريخ</label>
          <input type="date" id="rpTo" value="${todayISO()}">
        </div>
        <div class="field">
          <span class="field-spacer" aria-hidden="true">&nbsp;</span>
          <button class="btn" id="rpRun">تشغيل التقرير</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none" id="rpTitle">النتيجة</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="rpExport">تنزيل Excel</button>
        <button class="btn ghost small" id="rpPrint">طباعة</button>
      </div>
      <div class="hint" id="rpSubtitle"></div>
      <div class="stat-grid" id="rpCards"></div>
      <div class="table-wrap">
        <table><thead><tr id="rpHead"></tr></thead><tbody id="rpBody"></tbody></table>
      </div>
    </div>`;

  // كل تقرير بصلاحيته: تُحذف الخيارات غير المسموحة
  const kindSel = byId("rpKind");
  [...kindSel.options].forEach((o) => { if (!can(`report_${o.value}`)) o.remove(); });
  if (!kindSel.options.length) {
    kindSel.innerHTML = `<option value="">لا توجد تقارير متاحة لك</option>`;
    byId("rpRun").disabled = true;
  }
  gate(byId("rpExport"), "export_reports");
  gate(byId("rpPrint"), "print_reports");

  byId("rpKind").addEventListener("change", toggleFields);
  byId("rpRun").addEventListener("click", run);
  byId("rpExport").addEventListener("click", async () => {
    if (!last.rows.length) return toastError("شغّل التقرير أولًا");
    await exportRows(last.rows.map((r) => Object.fromEntries(last.headers.map((h, i) => [h, r[i]]))),
      last.title.replace(/\s+/g, "_"), "تقرير");
    toast("تم تنزيل ملف Excel");
  });
  byId("rpPrint").addEventListener("click", () => {
    if (!last.rows.length) return toastError("شغّل التقرير أولًا");
    printTable({ title: last.title, subtitle: last.subtitle, headers: last.headers, rows: last.rows });
  });
  built = true;
}

export function render() {
  if (!built) build();
  byId("rpItemList").innerHTML = get("items").map((i) => `<option value="${esc(itemFullLabel(i))}">`).join("");
  byId("rpProject").innerHTML = get("projects").map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")
    || `<option value="">لا توجد مشاريع</option>`;
  toggleFields();
}

function toggleFields() {
  const kind = byId("rpKind").value;
  byId("rpItemWrap").hidden    = kind !== "movement";
  byId("rpProjectWrap").hidden = kind !== "project";
  const needsDates = kind !== "low";
  byId("rpFromWrap").hidden = !needsDates;
  byId("rpToWrap").hidden   = !needsDates;
}

function show({ title, subtitle, headers, rows, cards = [] }) {
  last = { title, subtitle, headers, rows };
  byId("rpTitle").textContent = title;
  byId("rpSubtitle").textContent = subtitle;
  byId("rpCards").innerHTML = cards.map((c) =>
    `<div class="stat ${c.kind || ""}"><div class="label">${esc(c.label)}</div>
     <div class="value">${esc(c.value)}</div></div>`).join("");
  byId("rpHead").innerHTML = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  fillTable(byId("rpBody"), rows.map((r) =>
    `<tr>${r.map((c, i) => `<td class="${i === 0 ? "code" : ""}">${esc(c)}</td>`).join("")}</tr>`),
    headers.length, "لا توجد بيانات في هذه الفترة");
}

async function run() {
  const kind = byId("rpKind").value;
  if (!kind || !can(`report_${kind}`)) return toastError("ليس لديك صلاحية تشغيل هذا التقرير");
  const from = byId("rpFrom").value || monthStart();
  const to   = byId("rpTo").value || todayISO();
  if (from > to) return toastError("تاريخ البداية بعد تاريخ النهاية");

  try {
    if (kind === "movement") return await runMovement(from, to);
    if (kind === "project")  return await runProject(from, to);
    if (kind === "top")      return await runTop(from, to);
    return runLow();
  } catch (err) { toastError(err.message); }
}

async function runMovement(from, to) {
  const raw = byId("rpItem").value.trim();
  const code = raw.split("—")[0].trim().toLowerCase();
  const item = get("items").find((i) => i.code.toLowerCase() === code || itemFullLabel(i) === raw);
  if (!item) return toastError("اختر صنفًا من القائمة");

  const data = await reports.itemMovement(item.id, from, to);
  let running = Number(data.opening || 0);
  const rows = (data.rows || []).map((t) => {
    running += t.type === "in" ? t.qty : -t.qty;
    return [t.voucher_no, fmtDate(t.txn_date), t.type === "in" ? "وارد" : "صرف",
            fmtNum(t.qty), t.party || t.project || "-", fmtNum(running)];
  });

  show({
    title: `حركة صنف: ${itemLabel(item)}`,
    subtitle: `${item.code} — من ${fmtDate(from)} إلى ${fmtDate(to)}`,
    headers: ["رقم الإذن", "التاريخ", "النوع", "الكمية", "الجهة", "الرصيد بعد الحركة"],
    rows,
    cards: [
      { label: "رصيد أول المدة", value: fmtNum(data.opening) },
      { label: "إجمالي الوارد", value: fmtNum(data.total_in) },
      { label: "إجمالي المنصرف", value: fmtNum(data.total_out), kind: "warn" },
      { label: "الرصيد الحالي", value: fmtNum(item.balance) },
    ],
  });
}

async function runProject(from, to) {
  const project = byId("rpProject").value;
  if (!project) return toastError("اختر مشروعًا");
  const rows = await reports.project(project, from, to);
  const showValue = can("view_pricing");
  const totalQty = rows.reduce((s, r) => s + Number(r.qty), 0);
  const totalValue = rows.reduce((s, r) => s + Number(r.value), 0);

  show({
    title: `مصروفات مشروع: ${project}`,
    subtitle: `من ${fmtDate(from)} إلى ${fmtDate(to)} — ${rows.length} صنف`,
    headers: showValue ? ["الصنف", "الكمية", "سعر الوحدة", "القيمة"] : ["الصنف", "الكمية"],
    rows: rows.map((r) => showValue
      ? [r.item_name, fmtNum(r.qty), fmtMoney(r.unit_price), fmtMoney(r.value)]
      : [r.item_name, fmtNum(r.qty)]),
    cards: [
      { label: "عدد الأصناف", value: fmtNum(rows.length) },
      { label: "إجمالي الكميات", value: fmtNum(totalQty) },
      ...(showValue ? [{ label: "إجمالي القيمة", value: moneyText(totalValue, { blankWhenZero: true }), kind: "money" }] : []),
    ],
  });
}

async function runTop(from, to) {
  const rows = await reports.topConsumed(from, to, 30);
  show({
    title: "الأصناف الأكثر صرفًا",
    subtitle: `من ${fmtDate(from)} إلى ${fmtDate(to)}`,
    headers: ["#", "الصنف", "إجمالي المنصرف", "الرصيد الحالي"],
    rows: rows.map((r, i) => {
      const item = get("itemsById").get(r.item_id);
      return [i + 1, r.item_name, fmtNum(r.qty), fmtNum(item?.balance ?? "-")];
    }),
    cards: [{ label: "عدد الأصناف المتحركة", value: fmtNum(rows.length) }],
  });
}

function runLow() {
  const rows = get("items")
    .filter((i) => i.balance <= i.threshold)
    .sort((a, b) => (a.balance - a.threshold) - (b.balance - b.threshold));
  show({
    title: "أصناف تحت الحد الأدنى",
    subtitle: `تاريخ التقرير: ${fmtDate(todayISO())}`,
    headers: ["الكود", "الصنف", "الفئة", "الرصيد", "الحد الأدنى", "العجز"],
    rows: rows.map((i) => [i.code, itemLabel(i), i.category, fmtNum(i.balance),
                           fmtNum(i.threshold), fmtNum(Math.max(0, i.threshold - i.balance))]),
    cards: [
      { label: "أصناف نفدت", value: fmtNum(rows.filter((i) => i.balance <= 0).length), kind: "danger" },
      { label: "أصناف تحت الحد", value: fmtNum(rows.filter((i) => i.balance > 0).length), kind: "warn" },
    ],
  });
}
