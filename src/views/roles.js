/**
 * الأدوار والصلاحيات — مدير النظام يوزّع الصلاحيات دون تعديل كود.
 *
 * مصفوفة: صف لكل دور، عمود لكل صلاحية، ومربع اختيار عند التقاطع.
 * كل نقرة كتابة مستقلة على الخادم — لا زرّ "حفظ" يجمع التغييرات، لأن
 * حفظًا جزئيًا يفشل في منتصفه يترك توزيعًا لا يعرفه أحد.
 *
 * حدّان تفرضهما قاعدة البيانات لا هذه الشاشة:
 *  - لا يجوز أن يخلو النظام من مدير يملك manage_users
 *  - أدوار النظام الخمسة تُعدَّل صلاحياتها ولا تُحذف
 */
import { byId, esc, onClick } from "../core/dom.js";
import { fmtNum } from "../core/format.js";
import { rbac, users, userPerms } from "../data/repo.js";
import { can, applyPermissions, applyRoles, roleLabel } from "../auth/roles.js";
import { toast, toastError, confirmDialog, openModal } from "../core/ui.js";
import { currentUser } from "../auth/auth.js";
import { onPresence, onlineUsers } from "../core/presence.js";

let built = false;
let roles = [];
let perms = [];
let granted = new Set();     // "role_code|permission_code"
let usage = {};
let stopWatch = null;

const key = (r, p) => `${r}|${p}`;

let overrides = new Map();   // user_id -> Map(permission_code -> granted)
let userRows = [];

function build() {
  byId("view-roles").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">الأدوار والصلاحيات</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="rbNewRole">دور جديد</button>
      </div>

      <p class="hint">
        علّم المربع لمنح الصلاحية، وأزل التعليم لسحبها. التغيير يُحفظ فورًا
        ويُسجَّل في سجل التدقيق. المستخدم المتأثّر يرى الصلاحية الجديدة عند
        تحديث الصفحة أو دخوله التالي.
      </p>

      <div class="table-wrap">
        <table id="rbMatrix">
          <thead><tr><th>الصلاحية</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">تعيين الأدوار للمستخدمين</h2>
        <span class="spacer"></span>
        ${can("view_presence") ? `<span class="pill" id="rbOnlineCount">—</span>` : ""}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>المستخدم</th><th>الدور</th>
            <th class="center">صلاحيات خاصة</th>
            <th class="center">الحالة</th>
            ${can("view_presence") ? `<th class="center">الحضور</th>` : ""}</tr></thead>
          <tbody id="rbUsers"></tbody>
        </table>
      </div>
    </div>`;

  byId("rbNewRole").addEventListener("click", newRole);

  // تفويض الأحداث: مستمع واحد للمصفوفة كلها بدل مستمع لكل مربع
  onClick(byId("rbMatrix"), "[data-cell]", toggleCell);
  onClick(byId("rbMatrix"), "[data-role-menu]", roleMenu);

  // إعادة رسم عمود الحضور وحده كلما دخل أحد أو خرج
  stopWatch = onPresence(() => { if (built) paintPresence(); });

  byId("rbUsers").addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-user-role]");
    if (!sel) return;
    const id = sel.dataset.userRole;
    const previous = sel.dataset.previous;
    try {
      await users.updateRole(id, sel.value);
      sel.dataset.previous = sel.value;
      toast("تم تحديث الدور");
      usage = await rbac.roleUsage();
      paintMatrix();
      if (id === currentUser()?.id) await reloadMine();
    } catch (err) {
      sel.value = previous;          // الخادم رفض — أعد المعروض لحقيقته
      toastError(err.message);
    }
  });

  // تخصيص صلاحيات مستخدم بعينه
  onClick(byId("rbUsers"), "[data-user-perms]", (btn) => userPermsDialog(btn.dataset.userPerms));

  built = true;
}

export async function render() {
  if (!built) build();
  await load();
}

async function load() {
  try {
    const [roleRows, permRows, mapRows, usageMap] = await Promise.all([
      rbac.roles(), rbac.permissions(), rbac.map(), rbac.roleUsage(),
    ]);
    roles = roleRows;
    perms = permRows;
    usage = usageMap;
    granted = new Set(mapRows.map((m) => key(m.role_code, m.permission_code)));
    applyRoles(roleRows);
    paintMatrix();
    await paintUsers();
  } catch (err) {
    toastError(err.message);
  }
}

/* ------------------------- المصفوفة ------------------------- */
function paintMatrix() {
  const table = byId("rbMatrix");

  table.querySelector("thead").innerHTML = `<tr>
    <th>الصلاحية</th>
    ${roles.map((r) => `
      <th class="center">
        <button class="btn ghost small" data-role-menu="${esc(r.code)}"
                title="${r.is_system ? "دور أساسي" : "دور مخصّص"}">
          ${esc(r.label)}${r.is_system ? "" : " ✎"}
        </button>
        <div class="hint">${fmtNum(usage[r.code] || 0)} مستخدم</div>
      </th>`).join("")}
  </tr>`;

  // تجميع بالفئة حتى تُقرأ المصفوفة، لا تُفحص خانة خانة
  const groups = [];
  for (const p of perms) {
    const last = groups[groups.length - 1];
    if (last && last.name === p.category) last.items.push(p);
    else groups.push({ name: p.category, items: [p] });
  }

  table.querySelector("tbody").innerHTML = groups.map((g) => `
    <tr><td colspan="${roles.length + 1}" style="font-weight:600;opacity:.75">
      ${esc(g.name)}
    </td></tr>
    ${g.items.map((p) => `
      <tr>
        <td>${esc(p.label)} <span class="hint code">${esc(p.code)}</span></td>
        ${roles.map((r) => `
          <td class="center">
            <input type="checkbox"
                   data-cell="${esc(r.code)}|${esc(p.code)}"
                   ${granted.has(key(r.code, p.code)) ? "checked" : ""}>
          </td>`).join("")}
      </tr>`).join("")}`).join("");
}

async function toggleCell(box) {
  const [roleCode, permCode] = box.dataset.cell.split("|");
  const wanted = box.checked;
  box.disabled = true;

  try {
    if (wanted) await rbac.grant(roleCode, permCode);
    else await rbac.revoke(roleCode, permCode);

    granted[wanted ? "add" : "delete"](key(roleCode, permCode));
    toast(`${wanted ? "مُنحت" : "سُحبت"} الصلاحية من «${roleLabel(roleCode)}»`);

    // غيّر المدير صلاحيات دوره — يجب أن تعكس واجهته التغيير فورًا
    if (roleCode === currentUser()?.role) await reloadMine();
  } catch (err) {
    box.checked = !wanted;           // الحارس رفض — أعد المربع لحقيقته
    toastError(err.message);
  } finally {
    box.disabled = false;
  }
}

/** إعادة تحميل صلاحياتي بعد تغيير يمسّ دوري. */
async function reloadMine() {
  try {
    applyPermissions(await rbac.myPermissions());
    toast("تغيّرت صلاحياتك — حدّث الصفحة لتطبيق التغيير على القائمة");
  } catch { /* المصفوفة الاحتياطية تتولّى الأمر */ }
}

/* ------------------------- إدارة الأدوار ------------------------- */
function roleMenu(btn) {
  const code = btn.dataset.roleMenu;
  const row = roles.find((r) => r.code === code);
  if (!row) return;

  const actions = [
    {
      label: "تغيير الاسم",
      onClick: async (root, close) => {
        const value = root.querySelector("#rbLabel").value.trim();
        if (!value) return toastError("الاسم مطلوب");
        try {
          await rbac.renameRole(code, value);
          close();
          toast("تم تغيير الاسم");
          await load();
        } catch (err) { toastError(err.message); }
      },
    },
  ];

  if (!row.is_system) {
    actions.push({
      label: "حذف الدور",
      kind: "danger",
      onClick: async (root, close) => {
        const ok = await confirmDialog({
          title: "حذف دور",
          message: `سيُحذف الدور «${row.label}» وكل صلاحياته.`,
          confirmText: "حذف", danger: true,
        });
        if (!ok) return;
        try {
          await rbac.removeRole(code);
          close();
          toast("تم حذف الدور");
          await load();
        } catch (err) { toastError(err.message); }
      },
    });
  }

  openModal({
    title: `الدور: ${row.label}`,
    bodyHtml: `
      <div class="field">
        <label for="rbLabel">الاسم المعروض</label>
        <input id="rbLabel" value="${esc(row.label)}">
      </div>
      <p class="hint">الرمز <span class="code">${esc(row.code)}</span> ثابت لا يتغيّر،
        لأن سياسات قاعدة البيانات تشير إليه.</p>
      ${row.is_system
        ? `<p class="hint">هذا أحد أدوار النظام الأساسية: تُعدَّل صلاحياته ولا يُحذف.</p>`
        : `<p class="hint">مرتبط حاليًا بـ ${fmtNum(usage[row.code] || 0)} مستخدم.</p>`}`,
    actions,
  });
}

function newRole() {
  openModal({
    title: "دور جديد",
    bodyHtml: `
      <div class="field">
        <label for="rbNewLabel">الاسم المعروض</label>
        <input id="rbNewLabel" placeholder="مثال: مشرف وردية">
      </div>
      <div class="field">
        <label for="rbNewCode">الرمز</label>
        <input id="rbNewCode" placeholder="shift_supervisor" dir="ltr">
      </div>
      <p class="hint">الرمز بحروف إنجليزية صغيرة وشرطة سفلية، ولا يمكن تغييره بعد الإنشاء.
        الدور الجديد يُنشأ بلا أي صلاحية — علّم ما يحتاجه من المصفوفة بعد الإنشاء.</p>`,
    actions: [{
      label: "إنشاء",
      onClick: async (root, close) => {
        const label = root.querySelector("#rbNewLabel").value.trim();
        const code = root.querySelector("#rbNewCode").value.trim().toLowerCase();

        if (!label) return toastError("الاسم مطلوب");
        if (!/^[a-z][a-z0-9_]{2,30}$/.test(code)) {
          return toastError("الرمز: حروف إنجليزية صغيرة وأرقام وشرطة سفلية، ٣ أحرف على الأقل");
        }

        try {
          await rbac.createRole({ code, label });
          close();
          toast("تم إنشاء الدور");
          await load();
        } catch (err) { toastError(err.message); }
      },
    }],
  });
}

/* ------------------------- تعيين الأدوار ------------------------- */
async function paintUsers() {
  let rows = [];
  try {
    rows = await users.list();
    await loadOverrides();
  } catch (err) {
    byId("rbUsers").innerHTML = `<tr><td colspan="4" class="empty">${esc(err.message)}</td></tr>`;
    return;
  }

  userRows = rows;
  const me = currentUser()?.id;
  lastSeenMap.clear();
  rows.forEach((u) => lastSeenMap.set(u.id, u.last_seen));

  byId("rbUsers").innerHTML = rows.map((u) => `
    <tr>
      <td>${esc(u.full_name)} <span class="hint">(${esc(u.username)})</span>
        ${u.id === me ? `<span class="pill">أنت</span>` : ""}</td>
      <td>
        <select style="min-width:150px" data-user-role="${esc(u.id)}" data-previous="${esc(u.role)}"
                ${can("manage_users") ? "" : "disabled"}>
          ${roles.map((r) => `
            <option value="${esc(r.code)}" ${u.role === r.code ? "selected" : ""}>
              ${esc(r.label)}
            </option>`).join("")}
        </select>
      </td>
      <td class="center">
        <button class="btn ghost small" data-user-perms="${esc(u.id)}"
                ${can("manage_users") ? "" : "disabled"}>
          تخصيص${overrideCount(u.id) ? ` <span class="pill">${fmtNum(overrideCount(u.id))}</span>` : ""}
        </button>
      </td>
      <td class="center">
        <span class="pill ${u.is_active ? "in" : "out"}">${u.is_active ? "نشط" : "موقوف"}</span>
      </td>
      ${can("view_presence") ? `
      <td class="center" data-presence="${esc(u.id)}">
        <span class="hint">${lastSeenText(u.last_seen)}</span>
      </td>` : ""}
    </tr>`).join("");

  paintPresence();
}

// "متصل الآن" تأتي من Presence لا من قاعدة البيانات: تختفي لحظة إغلاق
// التبويب، فلا تُظهر أحدًا متصلًا وهو ليس كذلك.
function paintPresence() {
  const live = new Map(onlineUsers().map((u) => [u.id, u]));

  document.querySelectorAll("#rbUsers [data-presence]").forEach((cell) => {
    const here = live.get(cell.dataset.presence);
    if (here) {
      cell.innerHTML = `<span class="pill in">● متصل الآن</span>` +
        (here.tabs > 1 ? `<div class="hint">${fmtNum(here.tabs)} نوافذ</div>` : "");
    } else {
      const row = lastSeenMap.get(cell.dataset.presence);
      cell.innerHTML = `<span class="hint">${lastSeenText(row)}</span>`;
    }
  });

  const count = live.size;
  const label = byId("rbOnlineCount");
  if (label) {
    label.textContent = count ? `${fmtNum(count)} متصل الآن` : "لا أحد متصل";
  }
}

const lastSeenMap = new Map();

// "منذ ٣ دقائق" أوضح من طابع زمني كامل حين يكون السؤال: هل هو هنا؟
function lastSeenText(value) {
  if (!value) return "لم يدخل بعد";
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${fmtNum(mins)} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${fmtNum(hours)} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `منذ ${fmtNum(days)} يوم`;
  return new Date(value).toLocaleDateString("ar-EG");
}

/* ------------------------- تخصيص صلاحيات مستخدم ------------------------- */
// سماح/منع لشخص بعينه فوق صلاحيات دوره. القاعدة في can() على الخادم:
// التخصيص إن وُجد، وإلا صلاحية الدور.

async function loadOverrides() {
  overrides = new Map();
  let rows = [];
  try { rows = await userPerms.all(); }
  catch { return; }                  // 22_granular_permissions.sql لم يُشغَّل بعد
  for (const r of rows) {
    if (!overrides.has(r.user_id)) overrides.set(r.user_id, new Map());
    overrides.get(r.user_id).set(r.permission_code, r.granted);
  }
}

function overrideCount(userId) { return overrides.get(userId)?.size || 0; }

function permGroups() {
  const groups = [];
  for (const p of perms) {
    const last = groups[groups.length - 1];
    if (last && last.name === p.category) last.items.push(p);
    else groups.push({ name: p.category, items: [p] });
  }
  return groups;
}

function userPermsDialog(userId) {
  const u = userRows.find((x) => x.id === userId);
  if (!u) return;
  const mine = () => overrides.get(userId) || new Map();
  const fromRole = (code) => granted.has(key(u.role, code));

  const rowHtml = (p) => {
    const o = mine().get(p.code);
    const state = o === undefined ? "role" : (o ? "allow" : "deny");
    const effective = o === undefined ? fromRole(p.code) : o;
    return `
      <tr data-perm-row="${esc(p.code)}">
        <td>${esc(p.label)}</td>
        <td class="center"><span class="hint">${fromRole(p.code) ? "✓ مسموح" : "✗ ممنوع"}</span></td>
        <td class="center">
          <select data-perm="${esc(p.code)}" style="min-width:130px">
            <option value="role"  ${state === "role"  ? "selected" : ""}>حسب الدور</option>
            <option value="allow" ${state === "allow" ? "selected" : ""}>سماح</option>
            <option value="deny"  ${state === "deny"  ? "selected" : ""}>منع</option>
          </select>
        </td>
        <td class="center" data-effective>
          <span class="pill ${effective ? "in" : "out"}">${effective ? "مسموح" : "ممنوع"}</span>
        </td>
      </tr>`;
  };

  const { root } = openModal({
    title: `صلاحيات ${u.full_name}`,
    bodyHtml: `
      <p class="hint">
        الدور: <b>${esc(roleLabel(u.role))}</b>. «حسب الدور» يأخذ صلاحية الدور كما في المصفوفة،
        و«سماح» أو «منع» يخصّ هذا المستخدم وحده. التغيير يُحفظ فورًا ويُسجَّل في سجل التدقيق،
        ويسري عند تحديث المستخدم للصفحة.
      </p>
      <div class="toolbar" style="margin-bottom:8px">
        <input id="upSearch" placeholder="بحث في الصلاحيات" style="flex:1">
        <button class="btn ghost small" id="upReset">رجوع الكل لحسب الدور</button>
      </div>
      <div class="table-wrap" style="max-height:60vh;overflow:auto">
        <table>
          <thead><tr><th>الصلاحية</th><th class="center">الدور</th>
            <th class="center">لهذا المستخدم</th><th class="center">النتيجة</th></tr></thead>
          <tbody>
            ${permGroups().map((g) => `
              <tr data-group><td colspan="4" style="font-weight:600;opacity:.75">${esc(g.name)}</td></tr>
              ${g.items.map(rowHtml).join("")}`).join("")}
          </tbody>
        </table>
      </div>`,
  });

  const repaintRow = (code) => {
    const p = perms.find((x) => x.code === code);
    const tr = root.querySelector(`[data-perm-row="${CSS.escape(code)}"]`);
    if (p && tr) tr.outerHTML = rowHtml(p);
  };

  const refreshCount = () => paintUsers();

  root.addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-perm]");
    if (!sel) return;
    const code = sel.dataset.perm;
    const value = sel.value;
    sel.disabled = true;
    try {
      if (value === "role") await userPerms.clear(userId, code);
      else await userPerms.set(userId, code, value === "allow");
      if (!overrides.has(userId)) overrides.set(userId, new Map());
      if (value === "role") overrides.get(userId).delete(code);
      else overrides.get(userId).set(code, value === "allow");
      toast("تم حفظ الصلاحية");
      if (userId === currentUser()?.id) await reloadMine();
    } catch (err) {
      toastError(err.message);           // الخادم رفض — يُعاد رسم الصف بحقيقته
    }
    repaintRow(code);
    refreshCount();
  });

  root.querySelector("#upSearch").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    root.querySelectorAll("[data-perm-row]").forEach((tr) => {
      tr.hidden = q && !tr.textContent.toLowerCase().includes(q);
    });
    root.querySelectorAll("[data-group]").forEach((g) => { g.hidden = Boolean(q); });
  });

  root.querySelector("#upReset").addEventListener("click", async () => {
    const codes = [...mine().keys()];
    if (!codes.length) return toast("لا توجد تخصيصات لهذا المستخدم");
    const ok = await confirmDialog({
      title: "رجوع لصلاحيات الدور",
      message: `سيُلغى ${fmtNum(codes.length)} تخصيص ويعود المستخدم لصلاحيات دوره فقط.`,
    });
    if (!ok) return;
    for (const code of codes) {
      try {
        await userPerms.clear(userId, code);
        overrides.get(userId)?.delete(code);
      } catch (err) { toastError(err.message); }
      repaintRow(code);
    }
    toast("تم الرجوع لصلاحيات الدور");
    if (userId === currentUser()?.id) await reloadMine();
    refreshCount();
  });
}
