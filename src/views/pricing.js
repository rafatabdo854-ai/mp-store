/** التسعير وقيمة المخزون — متاح للمحاسب والمدير ونائبه. */
import { byId, esc, fillTable, debounce } from "../core/dom.js";
import { fmtNum, fmtMoney, moneyHtml, itemLabel, arSort, toNum } from "../core/format.js";
import { get, set } from "../core/store.js";
import { items as itemsRepo } from "../data/repo.js";
import { can } from "../auth/roles.js";
import { toast, toastError } from "../core/ui.js";
import { exportRows } from "../data/excel.js";
import { printTable } from "./print.js";

let built = false;
let search = "";
let category = "";

function build() {
  byId("view-pricing").innerHTML = `
    <div class="stat-grid" id="prCards"></div>
    <div class="panel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">تسعير الأصناف</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="prExport">تنزيل Excel</button>
        <button class="btn ghost small" id="prPrint">طباعة</button>
      </div>
      <div class="toolbar">
        <input type="search" id="prSearch" placeholder="بحث بالكود أو الاسم">
        <select id="prCategory"><option value="">كل الفئات</option></select>
        <span class="hint">${can("edit_price")
          ? "عدّل السعر في الجدول مباشرة ثم اضغط خارج الحقل للحفظ."
          : "العرض فقط — لا تملك صلاحية تعديل الأسعار."}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الكود</th><th>الصنف</th><th class="center">الرصيد</th>
            <th>سعر الشراء</th><th>مصاريف إضافية</th><th>سعر الوحدة</th><th>قيمة الرصيد</th>
          </tr></thead>
          <tbody id="prBody"></tbody>
        </table>
      </div>
    </div>`;

  byId("prSearch").addEventListener("input", debounce((e) => { search = e.target.value.toLowerCase().trim(); paint(); }));
  byId("prCategory").addEventListener("change", (e) => { category = e.target.value; paint(); });
  byId("prExport").addEventListener("click", async () => {
    await exportRows(rows().map(toRow), "تسعير_المخزون", "التسعير");
    toast("تم تنزيل ملف Excel");
  });
  byId("prPrint").addEventListener("click", () => {
    const data = rows().map(toRow);
    if (!data.length) return toastError("لا توجد بيانات");
    printTable({
      title: "تقرير تسعير المخزون",
      subtitle: `إجمالي القيمة: ${fmtMoney(total())}`,
      headers: Object.keys(data[0]), rows: data.map((r) => Object.values(r)),
    });
  });

  if (can("edit_price")) {
    byId("prBody").addEventListener("change", async (e) => {
      const input = e.target.closest("input[data-price-field]");
      if (!input) return;
      const id = input.dataset.id;
      const field = input.dataset.priceField;
      const value = toNum(input.value, 0);
      if (value < 0) { input.classList.add("invalid"); return toastError("السعر لا يمكن أن يكون سالبًا"); }
      input.classList.remove("invalid");
      try {
        const updated = await itemsRepo.update(id, { [field]: value });
        set({ items: get("items").map((i) => (i.id === id ? updated : i)) });
        toast("تم حفظ السعر");
        paint();
      } catch (err) { toastError(err.message); paint(); }
    });
  }
  built = true;
}

export function render() {
  if (!built) build();
  const sel = byId("prCategory");
  const current = sel.value;
  sel.innerHTML = `<option value="">كل الفئات</option>` +
    [...new Set(get("items").map((i) => i.category))].sort(arSort)
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = current;
  paint();
}

const rows = () => get("items").filter((i) => {
  if (category && i.category !== category) return false;
  if (!search) return true;
  return `${i.code} ${i.brand} ${i.name} ${i.spec}`.toLowerCase().includes(search);
});

const total = () => rows().reduce((s, i) => s + Number(i.unit_price) * i.balance, 0);

const toRow = (i) => ({
  "الكود": i.code, "الصنف": itemLabel(i), "الفئة": i.category, "الرصيد": i.balance,
  "سعر الشراء": Number(i.base_price), "مصاريف إضافية": Number(i.extra_costs),
  "سعر الوحدة": Number(i.unit_price), "قيمة الرصيد": Number(i.unit_price) * i.balance,
});

function paint() {
  const list = rows();
  const priced = list.filter((i) => Number(i.unit_price) > 0).length;
  const done = list.length > 0 && priced === list.length;
  // نسبة صغيرة غير صفرية تُبقي خيط اللون ظاهرًا، فيُقرأ الشريط كشريط
  // تقدّم بدأ فعلًا لا كخط فارغ لا معنى له
  const pct = list.length ? Math.max(1.5, (priced / list.length) * 100) : 0;

  // "مُسعَّر" بدل "بلا سعر": العدّاد الذي يرتفع أثناء العمل يدلّ على
  // التقدّم، والعدّاد الذي ينخفض يقيس ما تبقّى من العبء
  byId("prCards").innerHTML = `
    <div class="stat money">
      <div class="label">قيمة المخزون</div>
      <div class="value">${moneyHtml(total(), { blankWhenZero: true })}</div>
    </div>
    <div class="stat">
      <div class="label">الأصناف</div>
      <div class="value">${fmtNum(list.length)}</div>
    </div>
    <div class="stat${done ? "" : " warn"}">
      <div class="label">مُسعَّر</div>
      <div class="value">${fmtNum(priced)}</div>
    </div>
    <div class="stat-progress">
      <div class="progress ${done ? "ok" : "warn"}"><i style="width:${pct.toFixed(1)}%"></i></div>
      <span class="count">${fmtNum(priced)} / ${fmtNum(list.length)}</span>
    </div>`;

  const editable = can("edit_price");
  fillTable(byId("prBody"), list.map((i) => `
    <tr>
      <td class="code"><span class="plate">${esc(i.code)}</span></td>
      <td>${esc(itemLabel(i))}</td>
      <td class="num center span-row">${fmtNum(i.balance)}</td>
      <td>${editable
        ? `<input type="number" min="0" step="0.01" style="max-width:120px"
             data-price-field="base_price" data-id="${esc(i.id)}" value="${Number(i.base_price)}">`
        : moneyHtml(i.base_price, { blankWhenZero: true })}</td>
      <td>${editable
        ? `<input type="number" min="0" step="0.01" style="max-width:120px"
             data-price-field="extra_costs" data-id="${esc(i.id)}" value="${Number(i.extra_costs)}">`
        : moneyHtml(i.extra_costs, { blankWhenZero: true })}</td>
      <td class="num">${moneyHtml(i.unit_price, { blankWhenZero: true })}</td>
      <td class="num">${moneyHtml(Number(i.unit_price) * i.balance, { blankWhenZero: true })}</td>
    </tr>`), 7, "لا توجد أصناف");
}
