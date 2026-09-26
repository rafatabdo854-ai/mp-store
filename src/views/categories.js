/**
 * شاشة الفئات — إضافة، تعديل، حذف.
 *
 * التعديل يسري على كل أصناف الفئة (والمؤرشفة):
 *  - تغيير الاسم  → يتغيّر حقل الفئة في كل أصنافها.
 *  - تغيير البادئة → تتغيّر أكواد أصنافها (ACB-0001 → NEW-0001) ومعها
 *    الأكواد المحفوظة في كشوف الجرد.
 * الحذف متاح فقط لفئة بلا أصناف. كل ذلك يُفحص على الخادم.
 */
import { byId, esc, fillTable, debounce, onClick } from "../core/dom.js";
import { fmtNum, arSort } from "../core/format.js";
import { get, set } from "../core/store.js";
import { lists, items as itemsRepo, categoriesRepo } from "../data/repo.js";
import { can, gate } from "../auth/roles.js";
import { toast, toastError, toastWarn, confirmDialog, openModal, withBusy } from "../core/ui.js";
import { validate, rules, paintErrors } from "../core/validation.js";
import { exportRows } from "../data/excel.js";
import { printTable } from "./print.js";

let built = false;
let usage = new Map();
let search = "";

const PREFIX_RE = /^[A-Z0-9]{2,6}$/;

function build() {
  byId("view-categories").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">الفئات</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="catExport">تنزيل Excel</button>
        <button class="btn ghost small" id="catPrint">طباعة</button>
        <button class="btn small" id="catAdd">إضافة فئة</button>
      </div>
      <p class="hint">
        البادئة هي أول جزء في كود الصنف (مثل ACB في ACB-0001). تعديل الاسم أو البادئة
        يُطبَّق على كل أصناف الفئة فورًا.
      </p>
      <div class="toolbar">
        <input id="catSearch" placeholder="بحث بالاسم أو البادئة" style="flex:1;min-width:180px">
      </div>
      <div class="hint" id="catCount"></div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الفئة</th><th class="center">البادئة</th>
            <th class="center">الأصناف</th><th class="center">المؤرشف</th>
            <th class="center">إجمالي الرصيد</th><th>إجراء</th>
          </tr></thead>
          <tbody id="catBody"></tbody>
        </table>
      </div>
    </div>`;

  gate(byId("catAdd"), "add_category");
  gate(byId("catExport"), "export_categories");
  gate(byId("catPrint"), "export_categories");

  byId("catAdd").addEventListener("click", () => form(null));
  byId("catExport").addEventListener("click", exportList);
  byId("catPrint").addEventListener("click", printList);
  byId("catSearch").addEventListener("input", debounce((e) => {
    search = e.target.value.trim().toLowerCase(); paint();
  }));

  onClick(byId("catBody"), "[data-act]", (btn) => {
    const row = all().find((c) => c.name === btn.dataset.name);
    if (!row) return;
    if (btn.dataset.act === "edit")   form(row);
    if (btn.dataset.act === "delete") remove(row);
    if (btn.dataset.act === "items" && window.mpGo) window.mpGo("items", { category: row.name });
  });

  built = true;
}

const all = () => get("categories") || [];

function rows() {
  return all()
    .filter((c) => !search || c.name.toLowerCase().includes(search) || (c.prefix || "").toLowerCase().includes(search))
    .sort((a, b) => arSort(a.name, b.name));
}

function paint() {
  const list = rows();
  fillTable(byId("catBody"), list.map((c) => {
    const u = usage.get(c.name) || { items: 0, active_items: 0, total_balance: 0 };
    const archived = (u.items || 0) - (u.active_items || 0);
    const acts = [
      can("edit_category") ? `<button class="btn ghost small" data-act="edit" data-name="${esc(c.name)}">تعديل</button>` : "",
      can("delete_category") && !u.items
        ? `<button class="btn ghost small" data-act="delete" data-name="${esc(c.name)}">حذف</button>` : "",
    ].join("");
    return `
      <tr>
        <td><b>${esc(c.name)}</b></td>
        <td class="center code" dir="ltr">${esc(c.prefix || "-")}</td>
        <td class="num center">
          ${u.active_items
            ? `<button class="btn ghost small" data-act="items" data-name="${esc(c.name)}">${fmtNum(u.active_items)}</button>`
            : "0"}
        </td>
        <td class="num center">${archived ? fmtNum(archived) : "-"}</td>
        <td class="num center">${fmtNum(u.total_balance || 0)}</td>
        <td><div class="row-actions">${acts || `<span class="hint">—</span>`}</div></td>
      </tr>`;
  }), 6, all().length ? "لا توجد نتائج مطابقة" : "لا توجد فئات بعد");

  byId("catCount").textContent = `${fmtNum(list.length)} من ${fmtNum(all().length)} فئة`;
}

async function reload({ items = false } = {}) {
  const [cats, use, itemRows] = await Promise.all([
    lists.categories(),
    categoriesRepo.usage().catch(() => []),
    items ? itemsRepo.list() : Promise.resolve(null),
  ]);
  set(itemRows ? { categories: cats, items: itemRows } : { categories: cats });
  usage = new Map((use || []).map((u) => [u.name, u]));
  paint();
}

/* ---------- إضافة / تعديل ---------- */
function form(row) {
  const isNew = !row;
  const count = row ? (usage.get(row.name)?.items || 0) : 0;

  const { root } = openModal({
    title: isNew ? "إضافة فئة" : `تعديل الفئة: ${row.name}`,
    bodyHtml: `
      <form class="fields" id="catForm" novalidate>
        <div class="field full">
          <label class="req" for="c_name">اسم الفئة</label>
          <input id="c_name" data-field="name" value="${esc(row?.name || "")}">
          <div class="field-error" data-error-for="name"></div>
        </div>
        <div class="field">
          <label class="req" for="c_prefix">البادئة</label>
          <input id="c_prefix" data-field="prefix" dir="ltr" maxlength="6"
                 style="text-transform:uppercase" value="${esc(row?.prefix || "")}" placeholder="ACB">
          <div class="field-error" data-error-for="prefix"></div>
          <div class="hint">من 2 إلى 6 حروف إنجليزية أو أرقام</div>
        </div>
        ${!isNew && count ? `
        <div class="field full">
          <div class="hint" id="c_effect">سيُطبَّق التعديل على ${fmtNum(count)} صنف في هذه الفئة.</div>
        </div>` : ""}
      </form>`,
    actions: [{
      label: isNew ? "حفظ" : "حفظ التعديلات",
      onClick: async (modalRoot, close) => {
        const f = modalRoot.querySelector("#catForm");
        const values = {
          name: f.querySelector("#c_name").value.trim(),
          prefix: f.querySelector("#c_prefix").value.trim().toUpperCase(),
        };
        const result = validate(values, {
          name: [rules.required("أدخل اسم الفئة"), rules.minLen(2), rules.maxLen(80)],
          prefix: [rules.required("أدخل البادئة")],
        });
        if (result.ok && !PREFIX_RE.test(values.prefix)) {
          result.ok = false;
          result.errors.prefix = "من 2 إلى 6 حروف إنجليزية أو أرقام (مثل ACB)";
        }
        const dupName = all().find((c) => c.name.toLowerCase() === values.name.toLowerCase() && c.name !== row?.name);
        if (dupName) { result.ok = false; result.errors.name = "توجد فئة بهذا الاسم"; }
        const dupPrefix = all().find((c) => c.prefix === values.prefix && c.name !== row?.name);
        if (dupPrefix && values.prefix !== row?.prefix) {
          result.ok = false; result.errors.prefix = `البادئة مستخدمة للفئة "${dupPrefix.name}"`;
        }
        paintErrors(f, result.errors);
        if (!result.ok) return;

        const renamed = !isNew && values.name !== row.name;
        const recoded = !isNew && values.prefix !== row.prefix;
        if (count && (renamed || recoded)) {
          const parts = [];
          if (renamed) parts.push(`اسم الفئة في ${fmtNum(count)} صنف`);
          if (recoded) parts.push(`أكواد الأصناف من ${row.prefix}-xxxx إلى ${values.prefix}-xxxx`);
          const ok = await confirmDialog({
            title: "تأكيد التعديل على الأصناف",
            message: `سيتغيّر: ${parts.join("، و")}.` +
              (recoded ? " من يستخدم الكود القديم (ملصقات أو أوراق مطبوعة) يحتاج تحديثها." : ""),
            confirmText: "تطبيق",
          });
          if (!ok) return;
        }

        await withBusy(modalRoot.querySelector("[data-action='0']"), async () => {
          try {
            const res = await categoriesRepo.save(isNew ? null : row.name, values);
            const msg = [];
            if (res?.items_renamed) msg.push(`${fmtNum(res.items_renamed)} صنف انتقل للاسم الجديد`);
            if (res?.codes_changed) msg.push(`${fmtNum(res.codes_changed)} كود تغيّر`);
            toast(msg.length ? `تم الحفظ — ${msg.join("، ")}` : (isNew ? "تمت الإضافة" : "تم الحفظ"));
            close();
            await reload({ items: Boolean(res?.items_renamed || res?.codes_changed) });
          } catch (err) { toastError(err.message); }
        });
      },
    }],
  });

  // تنبيه فوري إن تغيّرت البادئة لفئة بها أصناف
  if (!isNew && count) {
    root.querySelector("#c_prefix").addEventListener("input", (e) => {
      const v = e.target.value.trim().toUpperCase();
      root.querySelector("#c_effect").textContent = v && v !== row.prefix
        ? `سيُطبَّق التعديل على ${fmtNum(count)} صنف، وستتغيّر أكوادها إلى ${v}-xxxx.`
        : `سيُطبَّق التعديل على ${fmtNum(count)} صنف في هذه الفئة.`;
    });
  }
}

/* ---------- حذف ---------- */
async function remove(row) {
  const ok = await confirmDialog({
    title: "حذف فئة", message: `ستُحذف الفئة "${row.name}". (متاح فقط لفئة بلا أصناف)`,
    confirmText: "حذف", danger: true,
  });
  if (!ok) return;
  try { await categoriesRepo.remove(row.name); toast("تم الحذف"); await reload(); }
  catch (err) { toastError(err.message); }
}

/* ---------- تصدير وطباعة ---------- */
function tableRows() {
  return rows().map((c) => {
    const u = usage.get(c.name) || {};
    return {
      "الفئة": c.name, "البادئة": c.prefix || "",
      "الأصناف": u.active_items || 0,
      "المؤرشف": (u.items || 0) - (u.active_items || 0),
      "إجمالي الرصيد": u.total_balance || 0,
    };
  });
}

async function exportList() {
  const data = tableRows();
  if (!data.length) return toastError("لا توجد بيانات للتصدير");
  await exportRows(data, "الفئات", "الفئات");
  toast("تم تنزيل ملف Excel");
}

function printList() {
  const data = tableRows();
  if (!data.length) return toastError("لا توجد بيانات للطباعة");
  printTable({
    title: "الفئات", subtitle: `العدد: ${fmtNum(data.length)}`,
    headers: Object.keys(data[0]), rows: data.map((r) => Object.values(r)),
  });
}

export async function render() {
  if (!built) build();
  paint();
  try { await reload(); }
  catch (err) { toastWarn(err.message); }
}
