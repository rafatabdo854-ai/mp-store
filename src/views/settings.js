/** الإعدادات — الحساب والمستخدمون وإعدادات النظام والنسخ الاحتياطي. */
import { byId, esc, fillTable, onClick } from "../core/dom.js";
import { fmtNum } from "../core/format.js";
import { get, set } from "../core/store.js";
import { users, lists, settings as settingsRepo, items as itemsRepo, txns } from "../data/repo.js";
import { can, roleLabel, roleOptions, gate } from "../auth/roles.js";
import { createUser, changePassword, currentUser } from "../auth/auth.js";
import { toast, toastError, confirmDialog, openModal, withBusy } from "../core/ui.js";
import { validate, rules, paintErrors } from "../core/validation.js";
import { exportSheets } from "../data/excel.js";
import { APP } from "../config.js";

let built = false;

function build() {
  const admin = can("manage_users");
  byId("view-settings").innerHTML = `
    <div class="panel">
      <h2>حسابي</h2>
      <div class="fields">
        <div class="field"><label>الاسم</label><input id="myName" readonly></div>
        <div class="field"><label>اسم المستخدم</label><input id="myUser" readonly></div>
        <div class="field"><label>الدور</label><input id="myRole" readonly></div>
        <div class="field"><span class="field-spacer" aria-hidden="true">&nbsp;</span>
          <button class="btn ghost" id="btnChangePass">تغيير كلمة المرور</button></div>
      </div>
    </div>

    ${admin ? `
    <div class="panel">
      <div class="panel-head">
        <h2 style="margin:0">المستخدمون</h2>
        <span class="spacer"></span>
        <button class="btn small" id="btnAddUser">إضافة مستخدم</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th class="center">الحالة</th><th>إجراء</th></tr></thead>
          <tbody id="usersBody"></tbody>
        </table>
      </div>
      <div class="hint">الدور يحدّد ما يستطيع المستخدم فعله. التغيير يسري فور تسجيل الدخول التالي.</div>
    </div>` : ""}


    ${can("manage_settings") ? `
    <div class="panel">
      <h2>إعدادات النظام</h2>
      <div class="fields">
        <div class="field full">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="setNegative" style="width:auto">
            السماح بالصرف حتى لو أصبح الرصيد سالبًا
          </label>
          <div class="hint">الوضع الافتراضي: ممنوع — النظام يرفض أي إذن صرف يتجاوز الرصيد.</div>
        </div>
        <div class="field">
          <label for="setThreshold">الحد الأدنى الافتراضي للأصناف الجديدة</label>
          <input type="number" id="setThreshold" min="0">
        </div>
        <div class="field"><span class="field-spacer" aria-hidden="true">&nbsp;</span>
          <button class="btn ghost" id="btnSaveSettings">حفظ الإعدادات</button></div>
      </div>
    </div>` : ""}

    <div class="panel" id="pnlMaintenance">
      <h2>النسخ الاحتياطي والصيانة</h2>
      <div class="toolbar">
        ${can("backup_data") ? `<button class="btn" id="btnBackup">تنزيل نسخة كاملة (Excel)</button>` : ""}
        ${can("recalc_balances") ? `<button class="btn ghost" id="btnRecalc">إعادة حساب كل الأرصدة</button>` : ""}
      </div>
      <div class="hint">
        قاعدة البيانات نفسها محفوظة على خوادم Supabase وتُنسخ احتياطيًا تلقائيًا.
        النسخة هنا للأرشفة الورقية أو للمشاركة مع الإدارة.
      </div>
    </div>

    <div class="panel">
      <h2>عن النظام</h2>
      <div class="about">
        <div><span>النظام</span><b>${esc(APP.name)}</b></div>
        <div><span>الجهة</span><b>${esc(APP.company || "-")}</b></div>
        <div><span>الإصدار</span><b class="code">${esc(APP.version)}</b></div>
        <div><span>التطوير</span><b>${esc(APP.developer || "-")}</b></div>
        <div><span>الحالة</span><b>تحت التطوير المستمر</b></div>
      </div>
      ${APP.note ? `<div class="hint" style="margin-top:10px">${esc(APP.note)}</div>` : ""}
    </div>`;

  const me = currentUser();
  byId("myName").value = me?.full_name || "";
  byId("myUser").value = me?.username || "";
  byId("myRole").value = roleLabel(me?.role);

  byId("btnChangePass").onclick = passwordDialog;
  byId("btnBackup") && (byId("btnBackup").onclick = backup);
  byId("btnRecalc") && (byId("btnRecalc").onclick = recalc);
  byId("btnAddUser") && (byId("btnAddUser").onclick = userDialog);
  byId("btnSaveSettings") && (byId("btnSaveSettings").onclick = saveSettings);

  // لوحة الصيانة كلها تختفي إن لم يبقَ فيها زر
  if (!byId("btnBackup") && !byId("btnRecalc")) {
    byId("pnlMaintenance").hidden = true;
  }

  const usersBody = byId("usersBody");
  if (usersBody) {
    onClick(usersBody, "[data-act]", async (btn) => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "role") {
        const role = btn.dataset.role;
        try { await users.updateRole(id, role); toast("تم تحديث الدور"); loadUsers(); }
        catch (err) { toastError(err.message); }
      }
      if (btn.dataset.act === "toggle") {
        const active = btn.dataset.active === "true";
        const ok = await confirmDialog({
          title: active ? "إيقاف المستخدم" : "تفعيل المستخدم",
          message: active ? "لن يستطيع هذا المستخدم الدخول للنظام." : "سيستطيع المستخدم الدخول مرة أخرى.",
        });
        if (!ok) return;
        try { await users.setActive(id, !active); toast("تم التحديث"); loadUsers(); }
        catch (err) { toastError(err.message); }
      }
    });
    usersBody.addEventListener("change", async (e) => {
      const sel = e.target.closest("select[data-user]");
      if (!sel) return;
      try { await users.updateRole(sel.dataset.user, sel.value); toast("تم تحديث الدور"); }
      catch (err) { toastError(err.message); loadUsers(); }
    });
  }

  built = true;
}

export function render() {
  if (!built) build();
  if (can("manage_users")) loadUsers();
  if (can("manage_settings")) {
    const s = get("settings")?.stock || {};
    if (byId("setNegative")) byId("setNegative").checked = Boolean(s.allow_negative_stock);
    if (byId("setThreshold")) byId("setThreshold").value = s.default_threshold ?? 5;
  }
}


async function loadUsers() {
  try {
    const rows = await users.list();
    fillTable(byId("usersBody"), rows.map((u) => `
      <tr>
        <td>${esc(u.full_name)}</td>
        <td class="code">${esc(u.username)}</td>
        <td><select data-user="${esc(u.id)}" style="max-width:170px">
          ${roleOptions().map(({ code, label }) =>
            `<option value="${code}" ${u.role === code ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select></td>
        <td class="center">${u.is_active
          ? `<span class="pill ok">نشط</span>` : `<span class="pill zero">موقوف</span>`}</td>
        <td><button class="btn ghost small" data-act="toggle" data-id="${esc(u.id)}"
             data-active="${u.is_active}">${u.is_active ? "إيقاف" : "تفعيل"}</button></td>
      </tr>`), 5, "لا يوجد مستخدمون");
  } catch (err) { toastError(err.message); }
}

function userDialog() {
  openModal({
    title: "إضافة مستخدم جديد",
    bodyHtml: `
      <form id="userForm" class="fields" novalidate>
        <div class="field full">
          <label class="req" for="u_name">الاسم بالكامل</label>
          <input id="u_name" data-field="fullName">
          <div class="field-error" data-error-for="fullName"></div>
        </div>
        <div class="field">
          <label class="req" for="u_user">اسم المستخدم</label>
          <input id="u_user" data-field="username" dir="ltr" placeholder="ahmed.m">
          <div class="field-error" data-error-for="username"></div>
        </div>
        <div class="field">
          <label class="req" for="u_pass">كلمة المرور</label>
          <input id="u_pass" data-field="password" type="text" dir="ltr">
          <div class="field-error" data-error-for="password"></div>
        </div>
        <div class="field full">
          <label for="u_role">الدور</label>
          <select id="u_role">${roleOptions().map(({ code: v, label: l }) =>
            `<option value="${v}">${esc(l)}</option>`).join("")}</select>
        </div>
      </form>
      <div class="hint">اسم المستخدم يتحوّل داخليًا إلى بريد إلكتروني، والمستخدم يدخل باسم المستخدم فقط.</div>`,
    actions: [{
      label: "إنشاء الحساب",
      onClick: async (root, close) => {
        const form = root.querySelector("#userForm");
        const values = {
          fullName: form.querySelector("#u_name").value.trim(),
          username: form.querySelector("#u_user").value.trim().toLowerCase(),
          password: form.querySelector("#u_pass").value,
        };
        const result = validate(values, {
          fullName: [rules.required("أدخل الاسم"), rules.minLen(3)],
          username: [rules.required("أدخل اسم المستخدم"), rules.username()],
          password: [rules.required("أدخل كلمة المرور"), rules.minLen(6, "كلمة المرور ٦ أحرف على الأقل")],
        });
        paintErrors(form, result.errors);
        if (!result.ok) return;

        await withBusy(root.querySelector("[data-action='0']"), async () => {
          try {
            await createUser({ ...values, role: form.querySelector("#u_role").value });
            toast("تم إنشاء الحساب");
            close();
            loadUsers();
          } catch (err) { toastError(err.message); }
        }, "جارٍ الإنشاء...");
      },
    }],
  });
}

function passwordDialog() {
  openModal({
    title: "تغيير كلمة المرور",
    bodyHtml: `
      <form id="passForm" class="fields" novalidate>
        <div class="field full">
          <label class="req" for="p_new">كلمة المرور الجديدة</label>
          <input id="p_new" data-field="password" type="password" dir="ltr">
          <div class="field-error" data-error-for="password"></div>
        </div>
        <div class="field full">
          <label class="req" for="p_confirm">تأكيد كلمة المرور</label>
          <input id="p_confirm" data-field="confirm" type="password" dir="ltr">
          <div class="field-error" data-error-for="confirm"></div>
        </div>
      </form>`,
    actions: [{
      label: "حفظ",
      onClick: async (root, close) => {
        const form = root.querySelector("#passForm");
        const values = {
          password: form.querySelector("#p_new").value,
          confirm: form.querySelector("#p_confirm").value,
        };
        const result = validate(values, {
          password: [rules.required("أدخل كلمة المرور"), rules.minLen(6, "٦ أحرف على الأقل")],
          confirm: [(v, all) => (v !== all.password ? "كلمتا المرور غير متطابقتين" : null)],
        });
        paintErrors(form, result.errors);
        if (!result.ok) return;
        try { await changePassword(values.password); toast("تم تغيير كلمة المرور"); close(); }
        catch (err) { toastError(err.message); }
      },
    }],
  });
}


async function saveSettings() {
  try {
    await settingsRepo.set("stock", {
      allow_negative_stock: byId("setNegative").checked,
      default_threshold: Number(byId("setThreshold").value || 5),
    });
    set({ settings: await settingsRepo.all() });
    toast("تم حفظ الإعدادات");
  } catch (err) { toastError(err.message); }
}

async function recalc() {
  const ok = await confirmDialog({
    title: "إعادة حساب الأرصدة",
    message: "سيُعاد حساب رصيد كل صنف من الرصيد الافتتاحي وكل حركاته. استخدمها بعد استيراد بيانات أو عند الشك في رصيد.",
    confirmText: "إعادة الحساب",
  });
  if (!ok) return;
  try {
    const n = await itemsRepo.recalcBalances();
    const fresh = await itemsRepo.list();
    set({ items: fresh });
    toast(`تمت إعادة حساب ${fmtNum(n)} صنف`);
  } catch (err) { toastError(err.message); }
}

async function backup() {
  if (!can("backup_data")) return toastError("ليس لديك صلاحية تنزيل النسخة الاحتياطية");
  try {
    toast("جارٍ تجهيز النسخة...");
    const all = await txns.list({ page: 0, size: 5000 });
    await exportSheets([
      { name: "الأصناف", rows: get("items").map((i) => ({
          "المعرف": i.id, "الكود": i.code, "الفئة": i.category, "الماركة": i.brand,
          "الاسم": i.name, "المواصفة": i.spec, "الوحدة": i.unit,
          "الرصيد الافتتاحي": i.opening_balance, "الرصيد الحالي": i.balance,
          "الحد الأدنى": i.threshold, "سعر الشراء": Number(i.base_price),
          "مصاريف إضافية": Number(i.extra_costs) })) },
      { name: "الحركات", rows: all.rows.map((t) => ({
          "النوع": t.type === "in" ? "وارد" : "صرف", "رقم الإذن": t.voucher_no,
          "التاريخ": t.txn_date, "معرف الصنف": t.item_id, "اسم الصنف": t.item_name,
          "الكمية": t.qty, "الجهة": t.party, "المشروع": t.project,
          "ملاحظات": t.notes, "بواسطة": t.created_by_name })) },
      { name: "الموردون", rows: get("suppliers").map((s) => ({ "اسم المورد": s.name })) },
      { name: "المشاريع", rows: get("projects").map((p) => ({ "اسم المشروع": p.name })) },
    ], "نسخة_احتياطية_المخزن");
    toast("تم تنزيل النسخة الاحتياطية");
  } catch (err) { toastError(err.message); }
}