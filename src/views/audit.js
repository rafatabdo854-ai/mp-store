/**
 * سجل التدقيق — من فعل ماذا ومتى.
 *
 * لسانان:
 *  - التعديلات: من جدول audit_log (أذون، جرد، مراجعة محاسبية، أصناف، مستخدمون)
 *  - الدخول: من جدول auth_events (ناجح وفاشل) — للمدير وحده، تفرضه سياسة RLS
 *
 * الترشيح والترقيم على الخادم، لأن السجل ينمو ولا يتوقف ولا يصحّ تحميله كله.
 */
import { byId, esc, fillTable, debounce, onClick } from "../core/dom.js";
import { fmtDateTime, fmtNum } from "../core/format.js";
import { audit, users } from "../data/repo.js";
import { can, gate } from "../auth/roles.js";
import { toast, toastError, openModal, confirmDialog } from "../core/ui.js";
import { exportRows } from "../data/excel.js";

const PAGE_SIZE = 100;

/** ترجمة رموز السجل إلى عربية مفهومة */
const ACTIONS = {
  create: "إنشاء",
  update: "تعديل",
  delete: "حذف",
  post: "ترحيل",
};

const ENTITIES = {
  voucher: "إذن",
  stocktake: "جرد",
  voucher_review: "مراجعة محاسبية",
  item: "صنف",
  profile: "مستخدم",
};

const EVENTS = {
  login_success: "دخول ناجح",
  login_failed: "محاولة فاشلة",
  logout: "خروج",
};

let built = false;
let tab = "changes";
let people = [];

let changes = { action: "", entity: "", actor: "", from: "", to: "", search: "",
                page: 0, count: 0, rows: [] };
let logins  = { event: "", username: "", from: "", to: "",
                page: 0, count: 0, rows: [] };

// لسان الدخول يتبع صلاحية لا اسم دور، فيستطيع المدير منحه لغيره
const canSeeLogins = () => can("view_auth_log");

function build() {
  byId("view-audit").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">سجل التدقيق</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="auExport">تنزيل Excel</button>
      </div>

      <div class="toolbar">
        <button class="btn ghost small active" data-tab="changes">التعديلات</button>
        ${canSeeLogins() ? `<button class="btn ghost small" data-tab="logins">الدخول</button>` : ""}
        ${canSeeLogins() ? `<span class="spacer"></span>
          <button class="btn ghost small" id="auLocked">الحسابات المقفولة</button>` : ""}
      </div>

      <!-- ===================== التعديلات ===================== -->
      <div id="auPaneChanges">
        <div class="toolbar">
          <input type="search" id="auSearch" placeholder="رقم إذن، اسم مستخدم...">
          <select id="auAction">
            <option value="">كل الإجراءات</option>
            ${Object.entries(ACTIONS).map(([k, v]) =>
              `<option value="${k}">${v}</option>`).join("")}
          </select>
          <select id="auEntity">
            <option value="">كل الأنواع</option>
            ${Object.entries(ENTITIES).map(([k, v]) =>
              `<option value="${k}">${v}</option>`).join("")}
          </select>
          <select id="auActor"><option value="">كل المستخدمين</option></select>
          <input type="date" id="auFrom" title="من تاريخ">
          <input type="date" id="auTo" title="إلى تاريخ">
          <button class="btn ghost small" id="auReset">إعادة ضبط</button>
        </div>
        <div class="hint" id="auCount"></div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>الوقت</th><th>المستخدم</th><th>الإجراء</th>
              <th>النوع</th><th>المرجع</th><th>التفاصيل</th>
            </tr></thead>
            <tbody id="auBody"></tbody>
          </table>
        </div>
      </div>

      <!-- ===================== الدخول ===================== -->
      <div id="auPaneLogins" hidden>
        <div class="toolbar">
          <input type="search" id="auUser" placeholder="اسم المستخدم...">
          <select id="auEvent">
            <option value="">كل الأحداث</option>
            ${Object.entries(EVENTS).map(([k, v]) =>
              `<option value="${k}">${v}</option>`).join("")}
          </select>
          <input type="date" id="auLFrom" title="من تاريخ">
          <input type="date" id="auLTo" title="إلى تاريخ">
          <button class="btn ghost small" id="auLReset">إعادة ضبط</button>
        </div>
        <div class="hint" id="auLCount"></div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>الوقت</th><th>المستخدم</th><th>الحدث</th>
            </tr></thead>
            <tbody id="auLBody"></tbody>
          </table>
        </div>
      </div>

      <div class="toolbar" style="margin-top:12px">
        <button class="btn ghost small" id="auPrev">السابق</button>
        <span class="hint" id="auPage"></span>
        <button class="btn ghost small" id="auNext">التالي</button>
      </div>
    </div>`;

  onClick(byId("view-audit"), "[data-tab]", (btn) => switchTab(btn.dataset.tab));

  /* ---------- مرشّحات التعديلات ---------- */
  const reload = debounce(() => { changes.page = 0; load(); }, 260);
  byId("auSearch").addEventListener("input", (e) => {
    changes.search = e.target.value.trim(); reload();
  });
  ["auAction:action", "auEntity:entity", "auActor:actor", "auFrom:from", "auTo:to"]
    .forEach((pair) => {
      const [id, key] = pair.split(":");
      byId(id).addEventListener("change", (e) => {
        changes[key] = e.target.value; changes.page = 0; load();
      });
    });
  byId("auReset").addEventListener("click", () => {
    changes = { ...changes, action: "", entity: "", actor: "", from: "", to: "",
                search: "", page: 0 };
    ["auSearch", "auAction", "auEntity", "auActor", "auFrom", "auTo"]
      .forEach((id) => { byId(id).value = ""; });
    load();
  });

  /* ---------- مرشّحات الدخول ---------- */
  if (canSeeLogins()) {
    const reloadL = debounce(() => { logins.page = 0; load(); }, 260);
    byId("auUser").addEventListener("input", (e) => {
      logins.username = e.target.value.trim(); reloadL();
    });
    ["auEvent:event", "auLFrom:from", "auLTo:to"].forEach((pair) => {
      const [id, key] = pair.split(":");
      byId(id).addEventListener("change", (e) => {
        logins[key] = e.target.value; logins.page = 0; load();
      });
    });
    byId("auLReset").addEventListener("click", () => {
      logins = { ...logins, event: "", username: "", from: "", to: "", page: 0 };
      ["auUser", "auEvent", "auLFrom", "auLTo"].forEach((id) => { byId(id).value = ""; });
      load();
    });
    byId("auLocked").addEventListener("click", showLocked);
  }

  /* ---------- ترقيم مشترك بين اللسانين ---------- */
  byId("auPrev").addEventListener("click", () => {
    const s = current();
    if (s.page > 0) { s.page--; load(); }
  });
  byId("auNext").addEventListener("click", () => {
    const s = current();
    if ((s.page + 1) * PAGE_SIZE < s.count) { s.page++; load(); }
  });

  byId("auExport").addEventListener("click", exportCurrent);
  gate(byId("auExport"), "export_audit");

  // تفاصيل الصف كاملة — بعض السجلات تحمل jsonb لا يتسع لعمود
  onClick(byId("auBody"), "[data-row]", (btn) => {
    const row = changes.rows[Number(btn.dataset.row)];
    if (!row) return;
    openModal({
      title: `${ACTIONS[row.action] || row.action} — ${ENTITIES[row.entity] || row.entity}`,
      bodyHtml: `
        <p class="hint">${esc(fmtDateTime(row.at))} — ${esc(row.actor_name || "غير معروف")}</p>
        <p><b>المرجع:</b> ${esc(row.entity_id || "-")}</p>
        <pre class="code" style="white-space:pre-wrap;word-break:break-word">${
          esc(JSON.stringify(row.details ?? {}, null, 2))}</pre>`,
    });
  });

  built = true;
}

const current = () => (tab === "logins" ? logins : changes);

function switchTab(next) {
  if (next === "logins" && !canSeeLogins()) return;
  tab = next;
  document.querySelectorAll("#view-audit [data-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab));
  byId("auPaneChanges").hidden = tab !== "changes";
  byId("auPaneLogins").hidden = tab !== "logins";
  load();
}

export function render() {
  if (!built) build();
  fillActors();
  load();
}

/** قائمة المستخدمين للترشيح — تفشل بهدوء لمن لا يملك قراءة profiles */
async function fillActors() {
  if (people.length) return;
  try {
    people = await users.list();
    const sel = byId("auActor");
    sel.innerHTML = `<option value="">كل المستخدمين</option>` +
      people.map((p) => `<option value="${esc(p.id)}">${esc(p.full_name)}</option>`).join("");
  } catch { /* الترشيح بالمستخدم غير متاح — الباقي يعمل */ }
}

async function load() {
  const s = current();
  const body = tab === "logins" ? byId("auLBody") : byId("auBody");
  const cols = tab === "logins" ? 3 : 6;
  body.innerHTML = `<tr><td colspan="${cols}"><div class="skeleton" style="height:18px"></div></td></tr>`;

  try {
    const result = tab === "logins"
      ? await audit.authEvents({ ...logins, size: PAGE_SIZE })
      : await audit.list({ ...changes, size: PAGE_SIZE });
    s.rows = result.rows;
    s.count = result.count;
    paint();
  } catch (err) {
    body.innerHTML = "";
    toastError(err.message);
  }
}

function paint() {
  const s = current();

  if (tab === "logins") {
    fillTable(byId("auLBody"), s.rows.map((e) => `
      <tr>
        <td>${fmtDateTime(e.created_at)}</td>
        <td>${esc(e.username || "-")}</td>
        <td><span class="pill ${e.event === "login_failed" ? "out" : "in"}">${
          esc(EVENTS[e.event] || e.event)}</span></td>
      </tr>`), 3, "لا توجد أحداث دخول في هذه الفترة");
    byId("auLCount").textContent = rangeText(s);
  } else {
    fillTable(byId("auBody"), s.rows.map((a, i) => `
      <tr>
        <td>${fmtDateTime(a.at)}</td>
        <td>${esc(a.actor_name || "غير معروف")}</td>
        <td>${esc(ACTIONS[a.action] || a.action)}</td>
        <td>${esc(ENTITIES[a.entity] || a.entity)}</td>
        <td class="code"><span class="plate">${esc(a.entity_id || "-")}</span></td>
        <td><button class="btn ghost small" data-row="${i}">عرض</button></td>
      </tr>`), 6, "لا توجد تعديلات مطابقة");
    byId("auCount").textContent = rangeText(s);
  }

  const to = Math.min((s.page + 1) * PAGE_SIZE, s.count);
  byId("auPage").textContent = `صفحة ${s.page + 1}`;
  byId("auPrev").disabled = s.page === 0;
  byId("auNext").disabled = to >= s.count;
}

function rangeText(s) {
  const from = s.count ? s.page * PAGE_SIZE + 1 : 0;
  const to = Math.min((s.page + 1) * PAGE_SIZE, s.count);
  return `عرض ${fmtNum(from)}–${fmtNum(to)} من ${fmtNum(s.count)} سجل`;
}

/* ------------------------- الحسابات المقفولة ------------------------- */
async function showLocked() {
  let rows = [];
  try {
    rows = await audit.locked();
  } catch (err) {
    return toastError(err.message);
  }

  const modal = openModal({
    title: "الحسابات المقفولة حاليًا",
    bodyHtml: rows.length
      ? `<div class="table-wrap"><table>
           <thead><tr><th>المستخدم</th><th class="center">محاولات</th>
             <th>حتى</th><th></th></tr></thead>
           <tbody>${rows.map((r) => `
             <tr>
               <td>${esc(r.full_name)} <span class="hint">(${esc(r.username)})</span></td>
               <td class="num center">${fmtNum(r.failed_attempts)}</td>
               <td>${fmtDateTime(r.locked_until)}</td>
               <td><button class="btn ghost small" data-unlock="${esc(r.id)}">فكّ القفل</button></td>
             </tr>`).join("")}
           </tbody></table></div>
         <p class="hint">القفل ينتهي وحده بعد ٥ دقائق من آخر محاولة فاشلة.</p>`
      : `<p>لا توجد حسابات مقفولة الآن.</p>`,
  });

  onClick(modal.root, "[data-unlock]", async (btn) => {
    const ok = await confirmDialog({
      title: "فكّ القفل",
      message: "سيتمكن هذا المستخدم من المحاولة فورًا. تأكد أن المحاولات الفاشلة كانت منه هو.",
      confirmText: "فكّ القفل",
    });
    if (!ok) return;
    try {
      await audit.unlock(btn.dataset.unlock);
      btn.closest("tr").remove();
      toast("تم فكّ القفل");
    } catch (err) { toastError(err.message); }
  });
}

/* ------------------------- التصدير ------------------------- */
async function exportCurrent() {
  const s = current();
  if (!s.rows.length) return toastError("لا توجد بيانات للتصدير");

  const rows = tab === "logins"
    ? s.rows.map((e) => ({
        "الوقت": fmtDateTime(e.created_at),
        "المستخدم": e.username || "",
        "الحدث": EVENTS[e.event] || e.event,
      }))
    : s.rows.map((a) => ({
        "الوقت": fmtDateTime(a.at),
        "المستخدم": a.actor_name || "",
        "الإجراء": ACTIONS[a.action] || a.action,
        "النوع": ENTITIES[a.entity] || a.entity,
        "المرجع": a.entity_id || "",
        "التفاصيل": JSON.stringify(a.details ?? {}),
      }));

  await exportRows(rows, tab === "logins" ? "سجل_الدخول" : "سجل_التعديلات", "السجل");
  toast("تم تنزيل ملف Excel");
}
