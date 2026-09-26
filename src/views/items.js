/** شاشة الأصناف — بحث فوري، إضافة وتعديل مع تحقق كامل. */
import { byId, fillTable, esc, debounce, onClick } from "../core/dom.js";
import { fmtNum, moneyHtml, itemLabel, arSort } from "../core/format.js";
import { get, on, set } from "../core/store.js";
import { items as itemsRepo, lists } from "../data/repo.js";
import { can, gate } from "../auth/roles.js";
import { toast, toastError, confirmDialog, openModal, withBusy } from "../core/ui.js";
import { validate, rules, paintErrors } from "../core/validation.js";
import { exportRows } from "../data/excel.js";
import { printTable } from "./print.js";

let filters = { search: "", category: "", stock: "" };
let mounted = false;

export function init() {
  if (mounted) return;
  mounted = true;

  byId("itemSearch").addEventListener("input", debounce((e) => {
    filters.search = e.target.value.trim().toLowerCase();
    paint();
  }));
  byId("itemCategoryFilter").addEventListener("change", (e) => { filters.category = e.target.value; paint(); });
  byId("itemStockFilter").addEventListener("change", (e) => { filters.stock = e.target.value; paint(); });
  byId("btnAddItem").hidden = !can("add_item");
  byId("btnAddItem").addEventListener("click", () => itemForm(null));
  byId("btnExportItems").addEventListener("click", exportList);
  byId("btnPrintItems").addEventListener("click", printList);
  gate(byId("btnExportItems"), "export_items");
  gate(byId("btnPrintItems"), "print_items");

  onClick(byId("itemsBody"), "[data-act]", async (btn) => {
    const item = get("itemsById").get(btn.dataset.id);
    if (!item) return;
    if (btn.dataset.act === "edit") itemForm(item);
    if (btn.dataset.act === "archive") {
      const ok = await confirmDialog({
        title: "أرشفة صنف",
        message: `سيُخفى «${itemLabel(item)}» من القوائم مع الاحتفاظ بكل حركاته السابقة.`,
        confirmText: "أرشفة", danger: true,
      });
      if (!ok) return;
      try {
        await itemsRepo.archive(item.id, true);
        set({ items: get("items").filter((i) => i.id !== item.id) });
        toast("تمت أرشفة الصنف");
      } catch (err) { toastError(err.message); }
    }
  });

  on("items", () => { if (byId("view-items").classList.contains("active")) paint(); });
}

export function render(params = {}) {
  init();
  fillCategoryFilter();
  // مرشّحات قادمة من لوحة القيادة (مثل: أصناف تحت الحد الأدنى)
  if (params.stock !== undefined || params.category !== undefined || params.q !== undefined) {
    filters = {
      search: (params.q || "").toLowerCase(),
      category: params.category || "",
      stock: params.stock || "",
    };
    byId("itemSearch").value = params.q || "";
    byId("itemCategoryFilter").value = filters.category;
    byId("itemStockFilter").value = filters.stock;
  }
  paint();
}

function fillCategoryFilter() {
  const select = byId("itemCategoryFilter");
  const current = select.value;
  const cats = [...new Set(get("items").map((i) => i.category))].sort(arSort);
  select.innerHTML = `<option value="">كل الفئات</option>` +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  select.value = current;
}

/** يطبّق المرشّحات في الذاكرة — لا رحلة للخادم مع كل حرف. */
export function filtered() {
  const list = get("items");
  return list.filter((i) => {
    if (filters.category && i.category !== filters.category) return false;
    if (filters.stock === "low"  && !(i.balance > 0 && i.balance <= i.threshold)) return false;
    if (filters.stock === "zero" && i.balance > 0) return false;
    if (filters.stock === "ok"   && i.balance <= i.threshold) return false;
    if (filters.search) {
      const blob = `${i.code} ${i.brand} ${i.name} ${i.spec} ${i.category}`.toLowerCase();
      if (!filters.search.split(/\s+/).every((word) => blob.includes(word))) return false;
    }
    return true;
  });
}

function statusPill(i) {
  if (i.balance <= 0) return `<span class="pill zero">نفد</span>`;
  if (i.balance <= i.threshold) return `<span class="pill low">تحت الحد</span>`;
  return `<span class="pill ok">متاح</span>`;
}

function paint() {
  const rows = filtered();
  const showPrice = can("view_pricing");
  byId("itemsCount").textContent = `${fmtNum(rows.length)} صنف من ${fmtNum(get("items").length)}`;

  fillTable(byId("itemsBody"), rows.map((i) => `
    <tr>
      <td class="code"><span class="plate">${esc(i.code)}</span></td>
      <td>${esc(itemLabel(i))}${i.spec ? `<div class="hint">${esc(i.spec)}</div>` : ""}</td>
      <td>${esc(i.category)}</td>
      <td class="center">${esc(i.unit)}</td>
      <td class="num center">${fmtNum(i.balance)}</td>
      <td class="num center">${fmtNum(i.threshold)}</td>
      <td class="center">${statusPill(i)}</td>
      ${showPrice ? `<td class="num">${moneyHtml(i.unit_price, { blankWhenZero: true })}</td>` : ""}
      <td><div class="row-actions">
        ${can("manage_items") || can("edit_price")
          ? `<button class="btn ghost small" data-act="edit" data-id="${esc(i.id)}">تعديل</button>` : ""}
        ${can("manage_items")
          ? `<button class="btn ghost small" data-act="archive" data-id="${esc(i.id)}">أرشفة</button>` : ""}
      </div></td>
    </tr>`), showPrice ? 9 : 8, "لا توجد أصناف مطابقة للبحث");

  document.querySelectorAll("#view-items [data-col='price']").forEach((n) => { n.hidden = !showPrice; });
}

/* ------------------------- نموذج الإضافة والتعديل ------------------------- */
function itemForm(item) {
  const isNew = !item;
  const priceOnly = !isNew && !can("manage_items") && can("edit_price");
  const cats = get("categories").map((c) => c.name);
  const known = [...new Set([...cats, ...get("items").map((i) => i.category)])].sort(arSort);

  const { root, close } = openModal({
    title: isNew ? "إضافة صنف جديد" : `تعديل: ${itemLabel(item)}`,
    bodyHtml: `
      <form id="itemForm" class="fields" novalidate>
        <div class="field">
          <label class="req" for="f_category">الفئة</label>
          <input id="f_category" data-field="category" list="catList" ${priceOnly ? "disabled" : ""}
                 value="${esc(item?.category || "")}" placeholder="اختر أو اكتب فئة جديدة">
          <datalist id="catList">${known.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
          <div class="field-error" data-error-for="category"></div>
        </div>
        <div class="field">
          <label for="f_brand">الماركة</label>
          <input id="f_brand" data-field="brand" value="${esc(item?.brand || "")}"
                 ${priceOnly ? "disabled" : ""} placeholder="ABB">
          <div class="field-error" data-error-for="brand"></div>
        </div>
        <div class="field full">
          <label class="req" for="f_name">اسم الصنف / الموديل</label>
          <input id="f_name" data-field="name" value="${esc(item?.name || "")}" ${priceOnly ? "disabled" : ""}>
          <div class="field-error" data-error-for="name"></div>
        </div>
        <div class="field full">
          <label for="f_spec">المواصفة</label>
          <input id="f_spec" data-field="spec" value="${esc(item?.spec || "")}"
                 ${priceOnly ? "disabled" : ""} placeholder="2000A | 66KA">
        </div>
        <div class="field">
          <label for="f_unit">الوحدة</label>
          <input id="f_unit" data-field="unit" value="${esc(item?.unit || "قطعة")}" ${priceOnly ? "disabled" : ""}>
        </div>
        <div class="field">
          <label class="req" for="f_threshold">الحد الأدنى</label>
          <input id="f_threshold" data-field="threshold" type="number" min="0"
                 value="${item?.threshold ?? 5}" ${priceOnly ? "disabled" : ""}>
          <div class="field-error" data-error-for="threshold"></div>
        </div>
        ${isNew ? `
        <div class="field">
          <label for="f_opening">الرصيد الافتتاحي</label>
          <input id="f_opening" data-field="opening_balance" type="number" min="0" value="0">
          <div class="field-error" data-error-for="opening_balance"></div>
        </div>` : `
        <div class="field">
          <label>الرصيد الحالي</label>
          <input value="${fmtNum(item.balance)}" readonly>
          <div class="hint">الرصيد يتغيّر عبر الأذون فقط</div>
        </div>`}
        ${can("edit_price") ? `
        <div class="field">
          <label for="f_base">سعر الشراء</label>
          <input id="f_base" data-field="base_price" type="number" min="0" step="0.01" value="${item?.base_price ?? 0}">
          <div class="field-error" data-error-for="base_price"></div>
        </div>
        <div class="field">
          <label for="f_extra">مصاريف إضافية</label>
          <input id="f_extra" data-field="extra_costs" type="number" min="0" step="0.01" value="${item?.extra_costs ?? 0}">
          <div class="field-error" data-error-for="extra_costs"></div>
        </div>` : ""}
      </form>`,
    actions: [{
      label: isNew ? "حفظ الصنف" : "حفظ التعديلات",
      onClick: async (modalRoot, closeModal) => {
        const form = modalRoot.querySelector("#itemForm");
        const values = {
          category: form.querySelector("#f_category")?.value.trim() || item?.category,
          brand: form.querySelector("#f_brand")?.value.trim() || "",
          name: form.querySelector("#f_name")?.value.trim() || item?.name,
          spec: form.querySelector("#f_spec")?.value.trim() || "",
          unit: form.querySelector("#f_unit")?.value.trim() || "قطعة",
          threshold: form.querySelector("#f_threshold")?.value ?? item?.threshold ?? 5,
          opening_balance: form.querySelector("#f_opening")?.value ?? 0,
          base_price: form.querySelector("#f_base")?.value ?? item?.base_price ?? 0,
          extra_costs: form.querySelector("#f_extra")?.value ?? item?.extra_costs ?? 0,
        };

        const schema = {
          category: [rules.required("اختر الفئة"), rules.maxLen(80)],
          name: [rules.required("أدخل اسم الصنف"), rules.minLen(2), rules.maxLen(120)],
          threshold: [rules.intMin(0)],
          base_price: [rules.numMin(0)],
          extra_costs: [rules.numMin(0)],
        };
        if (isNew) schema.opening_balance = [rules.intMin(0)];

        const result = validate(values, schema);
        paintErrors(form, result.errors);
        if (!result.ok) return;

        // منع تكرار نفس الصنف بنفس الاسم والمواصفة داخل الفئة
        if (isNew) {
          const dup = get("items").find((i) =>
            i.category === values.category &&
            i.name.trim().toLowerCase() === values.name.toLowerCase() &&
            (i.spec || "").trim().toLowerCase() === values.spec.toLowerCase());
          if (dup) {
            paintErrors(form, { name: `الصنف موجود بالفعل بالكود ${dup.code}` });
            return;
          }
        }

        const button = modalRoot.querySelector("[data-action='0']");
        await withBusy(button, async () => {
          try {
            if (isNew) {
              if (!get("categories").some((c) => c.name === values.category)) {
                await lists.addCategory(values.category,
                  values.category.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "GEN").catch(() => {});
              }
              const created = await itemsRepo.create({
                ...values,
                threshold: Number(values.threshold),
                opening_balance: Number(values.opening_balance),
                base_price: Number(values.base_price),
                extra_costs: Number(values.extra_costs),
              });
              set({ items: [...get("items"), created] });
              toast(`تمت إضافة الصنف بالكود ${created.code}`);
            } else {
              const patch = priceOnly
                ? { base_price: Number(values.base_price), extra_costs: Number(values.extra_costs) }
                : { ...values, threshold: Number(values.threshold),
                    base_price: Number(values.base_price), extra_costs: Number(values.extra_costs) };
              delete patch.opening_balance;
              const updated = await itemsRepo.update(item.id, patch);
              set({ items: get("items").map((i) => (i.id === item.id ? updated : i)) });
              toast("تم حفظ التعديلات");
            }
            closeModal();
            paint();
          } catch (err) { toastError(err.message); }
        }, "جارٍ الحفظ...");
      },
    }],
  });
  root.querySelector("#f_category, #f_name")?.focus();
}

/* ------------------------- تصدير وطباعة ------------------------- */
function rowsForOutput() {
  const showPrice = can("view_pricing");
  return filtered().map((i) => {
    const row = {
      "الكود": i.code, "الاسم": itemLabel(i), "المواصفة": i.spec,
      "الفئة": i.category, "الوحدة": i.unit,
      "الرصيد": i.balance, "الحد الأدنى": i.threshold,
      "الحالة": i.balance <= 0 ? "نفد" : i.balance <= i.threshold ? "تحت الحد" : "متاح",
    };
    if (showPrice) {
      row["سعر الوحدة"] = Number(i.unit_price);
      row["قيمة الرصيد"] = Number(i.unit_price) * i.balance;
    }
    return row;
  });
}

async function exportList() {
  try {
    await exportRows(rowsForOutput(), "قائمة_الأصناف", "الأصناف");
    toast("تم تنزيل ملف Excel");
  } catch (err) { toastError(err.message); }
}

function printList() {
  const rows = rowsForOutput();
  if (!rows.length) return toastError("لا توجد أصناف للطباعة");
  printTable({
    title: "قائمة أصناف المخزن",
    subtitle: `عدد الأصناف: ${rows.length}`,
    headers: Object.keys(rows[0]),
    rows: rows.map((r) => Object.values(r)),
  });
}