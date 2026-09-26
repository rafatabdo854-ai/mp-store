/**
 * شاشتا الموردين والمشاريع — نفس الشاشة بإعدادين.
 *
 * إضافة، تعديل (والاسم الجديد يسري على الأذون القديمة)، منع التعامل /
 * إيقاف المشروع، وحذف ما لم يُسجَّل عليه أي إذن. كل زر يظهر بصلاحيته،
 * والخادم يفحص نفس الصلاحية في كل دالة (23_suppliers_projects.sql).
 */
import { byId, esc, fillTable, debounce, onClick } from "../core/dom.js";
import { fmtNum, fmtDate, arSort } from "../core/format.js";
import { get, set } from "../core/store.js";
import { lists, directory } from "../data/repo.js";
import { can, gate } from "../auth/roles.js";
import { toast, toastError, confirmDialog, openModal, withBusy } from "../core/ui.js";
import { validate, rules, paintErrors } from "../core/validation.js";
import { exportRows } from "../data/excel.js";
import { printTable } from "./print.js";

const KINDS = {
  supplier: {
    view: "suppliers",
    storeKey: "suppliers",
    load: () => lists.suppliers(),
    title: "الموردون",
    one: "المورد",
    addLabel: "إضافة مورد",
    usageLabel: "أذون الوارد",
    blockedPill: "ممنوع التعامل",
    blockAction: "منع التعامل",
    unblockAction: "السماح بالتعامل",
    blockTitle: (n) => `منع التعامل مع ${n}`,
    blockHint: "لن يُقبل أي إذن وارد جديد من هذا المورد. الأذون السابقة تبقى كما هي.",
    deleteHint: "يُحذف المورد من القائمة. غير مسموح إن كان مسجَّلًا عليه أي إذن.",
    perms: { add: "add_supplier", edit: "edit_supplier", block: "block_supplier", del: "delete_supplier",
             export: "export_suppliers" },
    hasPhone: true,
    save: (old, v) => directory.saveSupplier(old, v),
    block: (n, b, r) => directory.blockSupplier(n, b, r),
    remove: (n) => directory.deleteSupplier(n),
  },
  project: {
    view: "projects",
    storeKey: "projects",
    load: () => lists.projects(),
    title: "المشاريع",
    one: "المشروع",
    addLabel: "إضافة مشروع",
    usageLabel: "الأذون",
    blockedPill: "موقوف",
    blockAction: "إيقاف",
    unblockAction: "تفعيل",
    blockTitle: (n) => `إيقاف المشروع ${n}`,
    blockHint: "لن يُقبل أي إذن جديد على هذا المشروع. الأذون السابقة وتقاريرها تبقى كما هي.",
    deleteHint: "يُحذف المشروع من القائمة. غير مسموح إن كان مسجَّلًا عليه أي إذن.",
    perms: { add: "add_project", edit: "edit_project", block: "block_project", del: "delete_project",
             export: "export_projects" },
    hasPhone: false,
    save: (old, v) => directory.saveProject(old, v),
    block: (n, b, r) => directory.blockProject(n, b, r),
    remove: (n) => directory.deleteProject(n),
  },
};

export function makeDirectoryView(kind) {
  const K = KINDS[kind];
  const rootId = `view-${K.view}`;
  const ids = (s) => `dir_${kind}_${s}`;
  let built = false;
  let usage = new Map();
  let filters = { search: "", status: "" };

  function build() {
    byId(rootId).innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <h2 style="border:0;margin:0;padding:0;background:none">${esc(K.title)}</h2>
          <span class="spacer"></span>
          <button class="btn ghost small" id="${ids("export")}">تنزيل Excel</button>
          <button class="btn ghost small" id="${ids("print")}">طباعة</button>
          <button class="btn small" id="${ids("add")}">${esc(K.addLabel)}</button>
        </div>
        <div class="toolbar">
          <input id="${ids("search")}" placeholder="بحث بالاسم${K.hasPhone ? " أو الهاتف" : ""} أو الملاحظات" style="flex:1;min-width:180px">
          <select id="${ids("status")}">
            <option value="">الكل</option>
            <option value="active">نشط</option>
            <option value="blocked">${esc(K.blockedPill)}</option>
            <option value="unused">بدون أذون</option>
          </select>
        </div>
        <div class="hint" id="${ids("count")}"></div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>الاسم</th>
              ${K.hasPhone ? "<th>الهاتف</th>" : ""}
              <th>ملاحظات</th>
              <th class="center">${esc(K.usageLabel)}</th>
              <th class="center">آخر تعامل</th>
              <th class="center">الحالة</th>
              <th>إجراء</th>
            </tr></thead>
            <tbody id="${ids("body")}"></tbody>
          </table>
        </div>
      </div>`;

    gate(byId(ids("add")), K.perms.add);
    gate(byId(ids("export")), K.perms.export);
    gate(byId(ids("print")), K.perms.export);

    byId(ids("add")).addEventListener("click", () => form(null));
    byId(ids("export")).addEventListener("click", exportList);
    byId(ids("print")).addEventListener("click", printList);
    byId(ids("search")).addEventListener("input", debounce((e) => {
      filters.search = e.target.value.trim().toLowerCase(); paint();
    }));
    byId(ids("status")).addEventListener("change", (e) => { filters.status = e.target.value; paint(); });

    onClick(byId(ids("body")), "[data-act]", (btn) => {
      const row = rowsAll().find((r) => r.name === btn.dataset.name);
      if (!row) return;
      if (btn.dataset.act === "edit")   form(row);
      if (btn.dataset.act === "block")  blockDialog(row);
      if (btn.dataset.act === "unblock") unblock(row);
      if (btn.dataset.act === "delete") remove(row);
    });

    built = true;
  }

  const rowsAll = () => get(K.storeKey) || [];

  function rows() {
    const q = filters.search;
    return rowsAll()
      .filter((r) => {
        if (filters.status === "active"  && r.is_blocked) return false;
        if (filters.status === "blocked" && !r.is_blocked) return false;
        if (filters.status === "unused"  && usage.get(r.name)?.vouchers) return false;
        if (!q) return true;
        return [r.name, r.phone, r.notes, r.block_reason]
          .some((v) => String(v || "").toLowerCase().includes(q));
      })
      .sort((a, b) => arSort(a.name, b.name));
  }

  function paint() {
    const list = rows();
    const cols = K.hasPhone ? 7 : 6;
    fillTable(byId(ids("body")), list.map((r) => {
      const u = usage.get(r.name);
      const acts = [
        can(K.perms.edit) ? `<button class="btn ghost small" data-act="edit" data-name="${esc(r.name)}">تعديل</button>` : "",
        can(K.perms.block)
          ? (r.is_blocked
              ? `<button class="btn ghost small" data-act="unblock" data-name="${esc(r.name)}">${esc(K.unblockAction)}</button>`
              : `<button class="btn ghost small" data-act="block" data-name="${esc(r.name)}">${esc(K.blockAction)}</button>`)
          : "",
        can(K.perms.del) && !u?.vouchers
          ? `<button class="btn ghost small" data-act="delete" data-name="${esc(r.name)}">حذف</button>` : "",
      ].join("");
      return `
        <tr>
          <td><b>${esc(r.name)}</b></td>
          ${K.hasPhone ? `<td class="code" dir="ltr">${esc(r.phone || "-")}</td>` : ""}
          <td>${esc(r.notes || "-")}</td>
          <td class="num center">${u ? fmtNum(u.vouchers) : "0"}</td>
          <td class="center">${u?.last_date ? fmtDate(u.last_date) : "-"}</td>
          <td class="center">
            ${r.is_blocked
              ? `<span class="pill out">${esc(K.blockedPill)}</span>
                 ${r.block_reason ? `<div class="hint">${esc(r.block_reason)}</div>` : ""}`
              : `<span class="pill ok">نشط</span>`}
          </td>
          <td><div class="row-actions">${acts || `<span class="hint">—</span>`}</div></td>
        </tr>`;
    }), cols, rowsAll().length ? "لا توجد نتائج مطابقة" : `لا يوجد ${K.one} بعد`);

    const blocked = rowsAll().filter((r) => r.is_blocked).length;
    byId(ids("count")).textContent =
      `${fmtNum(list.length)} من ${fmtNum(rowsAll().length)}` +
      (blocked ? ` — ${fmtNum(blocked)} ${K.blockedPill}` : "");
  }

  async function reload() {
    const [fresh, use] = await Promise.all([K.load(), directory.usage(kind).catch(() => [])]);
    set({ [K.storeKey]: fresh });
    usage = new Map((use || []).map((u) => [u.name, u]));
    paint();
  }

  /* ---------- إضافة / تعديل ---------- */
  function form(row) {
    const isNew = !row;
    openModal({
      title: isNew ? K.addLabel : `تعديل ${K.one}: ${row.name}`,
      bodyHtml: `
        <form class="fields" id="${ids("form")}" novalidate>
          <div class="field full">
            <label class="req" for="${ids("f_name")}">الاسم</label>
            <input id="${ids("f_name")}" data-field="name" value="${esc(row?.name || "")}">
            <div class="field-error" data-error-for="name"></div>
            ${!isNew && usage.get(row.name)?.vouchers
              ? `<div class="hint">تغيير الاسم يُطبَّق على ${fmtNum(usage.get(row.name).vouchers)} إذن سابق أيضًا.</div>` : ""}
          </div>
          ${K.hasPhone ? `
          <div class="field">
            <label for="${ids("f_phone")}">الهاتف</label>
            <input id="${ids("f_phone")}" data-field="phone" dir="ltr" value="${esc(row?.phone || "")}">
            <div class="field-error" data-error-for="phone"></div>
          </div>` : ""}
          <div class="field full">
            <label for="${ids("f_notes")}">ملاحظات</label>
            <input id="${ids("f_notes")}" data-field="notes" value="${esc(row?.notes || "")}">
            <div class="field-error" data-error-for="notes"></div>
          </div>
        </form>`,
      actions: [{
        label: isNew ? "حفظ" : "حفظ التعديلات",
        onClick: async (modalRoot, close) => {
          const f = modalRoot.querySelector("form");
          const values = {
            name:  f.querySelector(`#${ids("f_name")}`).value.trim(),
            phone: f.querySelector(`#${ids("f_phone")}`)?.value.trim() || "",
            notes: f.querySelector(`#${ids("f_notes")}`).value.trim(),
          };
          const result = validate(values, {
            name:  [rules.required("أدخل الاسم"), rules.minLen(2), rules.maxLen(120)],
            phone: [rules.maxLen(40)],
            notes: [rules.maxLen(300)],
          });
          paintErrors(f, result.errors);
          if (!result.ok) return;

          const dup = rowsAll().find((r) =>
            r.name.trim().toLowerCase() === values.name.toLowerCase() && r.name !== row?.name);
          if (dup) return paintErrors(f, { name: "الاسم موجود بالفعل" });

          await withBusy(modalRoot.querySelector("[data-action='0']"), async () => {
            try {
              const res = await K.save(isNew ? null : row.name, values);
              toast(isNew ? "تمت الإضافة"
                : (res?.renamed_rows ? `تم الحفظ وتحديث ${fmtNum(res.renamed_rows)} سطر في الأذون` : "تم الحفظ"));
              close();
              await reload();
            } catch (err) { toastError(err.message); }
          });
        },
      }],
    });
  }

  /* ---------- منع / إيقاف ---------- */
  function blockDialog(row) {
    openModal({
      title: K.blockTitle(row.name),
      bodyHtml: `
        <p class="hint">${esc(K.blockHint)}</p>
        <div class="field full">
          <label for="${ids("b_reason")}">السبب (يظهر لمن يحاول تسجيل إذن)</label>
          <input id="${ids("b_reason")}" maxlength="200">
        </div>`,
      actions: [{
        label: K.blockAction, kind: "danger",
        onClick: async (modalRoot, close) => {
          const reason = modalRoot.querySelector(`#${ids("b_reason")}`).value.trim();
          await withBusy(modalRoot.querySelector("[data-action='0']"), async () => {
            try {
              await K.block(row.name, true, reason);
              toast("تم");
              close();
              await reload();
            } catch (err) { toastError(err.message); }
          });
        },
      }],
    });
  }

  async function unblock(row) {
    const ok = await confirmDialog({
      title: K.unblockAction,
      message: `${K.one} "${row.name}" سيعود متاحًا في الأذون الجديدة.`,
    });
    if (!ok) return;
    try { await K.block(row.name, false, ""); toast("تم"); await reload(); }
    catch (err) { toastError(err.message); }
  }

  /* ---------- حذف ---------- */
  async function remove(row) {
    const ok = await confirmDialog({
      title: `حذف ${K.one}`, message: `${K.deleteHint}\n\n"${row.name}"`,
      confirmText: "حذف", danger: true,
    });
    if (!ok) return;
    try { await K.remove(row.name); toast("تم الحذف"); await reload(); }
    catch (err) { toastError(err.message); }
  }

  /* ---------- تصدير وطباعة ---------- */
  function tableRows() {
    return rows().map((r) => {
      const u = usage.get(r.name);
      return {
        "الاسم": r.name,
        ...(K.hasPhone ? { "الهاتف": r.phone || "" } : {}),
        "ملاحظات": r.notes || "",
        [K.usageLabel]: u?.vouchers || 0,
        "آخر تعامل": u?.last_date || "",
        "الحالة": r.is_blocked ? K.blockedPill : "نشط",
        "السبب": r.block_reason || "",
      };
    });
  }

  async function exportList() {
    const data = tableRows();
    if (!data.length) return toastError("لا توجد بيانات للتصدير");
    await exportRows(data, K.title, K.title);
    toast("تم تنزيل ملف Excel");
  }

  function printList() {
    const data = tableRows();
    if (!data.length) return toastError("لا توجد بيانات للطباعة");
    printTable({
      title: K.title, subtitle: `العدد: ${fmtNum(data.length)}`,
      headers: Object.keys(data[0]), rows: data.map((r) => Object.values(r)),
    });
  }

  return {
    async render() {
      if (!built) build();
      paint();                                   // فورًا من النسخة المحلية
      try { await reload(); } catch (err) { toastError(err.message); }
    },
  };
}
