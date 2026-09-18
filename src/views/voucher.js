/**
 * شاشة الأذون — تُستخدم للوارد والصرف معًا.
 * الإذن كله يُرسل في نداء واحد ذرّي: إمّا تُسجَّل كل الأسطر أو لا شيء.
 */
import { byId, esc, fillTable, onClick, debounce } from "../core/dom.js";
import { todayISO, fmtDate, fmtNum, itemFullLabel, toInt, toNum } from "../core/format.js";
import { get, set, on } from "../core/store.js";
import { txns, lists } from "../data/repo.js";
import { can } from "../auth/roles.js";
import { toast, toastError, toastWarn, confirmDialog, withBusy, openModal } from "../core/ui.js";
import { validate, rules, paintErrors, clearErrors } from "../core/validation.js";
import { printTable } from "./print.js";
import { refreshSummary } from "./shared.js";

export function makeVoucherView(type) {
  const isIn = type === "in";
  const root = byId(`view-${isIn ? "voucherIn" : "voucherOut"}`);
  let cart = [];
  let built = false;

  function build() {
    root.innerHTML = `
      <div class="panel">
        <h2>${isIn ? "إذن وارد — استلام مخزون" : "إذن صرف — تسليم مخزون"}</h2>
        <form class="fields" id="vh_${type}" novalidate>
          <div class="field">
            <label class="req" for="v_date_${type}">تاريخ الإذن</label>
            <input type="date" id="v_date_${type}" data-field="date" value="${todayISO()}">
            <div class="field-error" data-error-for="date"></div>
          </div>
          <div class="field">
            <label class="req" for="v_party_${type}">${isIn ? "المورد / جهة التوريد" : "الجهة المستلمة"}</label>
            <input id="v_party_${type}" data-field="party" list="partyList_${type}" autocomplete="off">
            <datalist id="partyList_${type}"></datalist>
            <div class="field-error" data-error-for="party"></div>
          </div>
          ${!isIn ? `
          <div class="field">
            <label class="req" for="v_project_${type}">المشروع</label>
            <input id="v_project_${type}" data-field="project" list="projectList_${type}" autocomplete="off">
            <datalist id="projectList_${type}"></datalist>
            <div class="field-error" data-error-for="project"></div>
          </div>` : ""}
          <div class="field full">
            <label for="v_notes_${type}">ملاحظات</label>
            <textarea id="v_notes_${type}" data-field="notes" rows="2"></textarea>
          </div>
        </form>
      </div>

      <div class="panel">
        <h2>إضافة صنف إلى الإذن</h2>
        <form class="fields" id="vl_${type}" novalidate>
          <div class="field full">
            <label class="req" for="v_item_${type}">الصنف</label>
            <input id="v_item_${type}" data-field="item" list="itemList_${type}" autocomplete="off"
                   placeholder="اكتب الكود أو الاسم">
            <datalist id="itemList_${type}"></datalist>
            <div class="field-error" data-error-for="item"></div>
            <div class="hint" id="v_stock_${type}"></div>
          </div>
          <div class="field">
            <label class="req" for="v_qty_${type}">الكمية</label>
            <input type="number" id="v_qty_${type}" data-field="qty" min="1" step="1">
            <div class="field-error" data-error-for="qty"></div>
          </div>
          ${isIn && can("edit_price") ? `
          <div class="field">
            <label for="v_price_${type}">سعر الشراء للوحدة</label>
            <input type="number" id="v_price_${type}" data-field="base_price" min="0" step="0.01" placeholder="اتركه فارغًا لعدم التغيير">
          </div>
          <div class="field">
            <label for="v_extra_${type}">مصاريف إضافية للوحدة</label>
            <input type="number" id="v_extra_${type}" data-field="extra_costs" min="0" step="0.01">
          </div>` : ""}
          <div class="field full">
            <button type="button" class="btn ghost" id="v_add_${type}">إضافة الصنف إلى الإذن</button>
          </div>
        </form>

        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead><tr><th>الصنف</th><th class="center">الكمية</th><th class="center">إجراء</th></tr></thead>
            <tbody id="v_cart_${type}"></tbody>
          </table>
        </div>

        <div class="toolbar" style="margin-top:14px">
          <button class="btn" id="v_submit_${type}">${isIn ? "تسجيل إذن الوارد" : "تسجيل إذن الصرف"}</button>
          <button class="btn ghost" id="v_clear_${type}">تفريغ الإذن</button>
          <span class="spacer"></span>
          <span class="hint" id="v_total_${type}"></span>
        </div>
      </div>

      <div class="panel">
        <h2>آخر الأذون</h2>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>رقم الإذن</th><th>التاريخ</th><th class="center">الأصناف</th>
              <th class="center">الكمية</th><th>${isIn ? "المورد" : "الجهة"}</th><th>بواسطة</th><th>إجراء</th>
            </tr></thead>
            <tbody id="v_log_${type}"></tbody>
          </table>
        </div>
      </div>`;

    byId(`v_add_${type}`).addEventListener("click", addLine);
    byId(`v_submit_${type}`).addEventListener("click", submit);
    byId(`v_clear_${type}`).addEventListener("click", async () => {
      if (!cart.length) return;
      if (await confirmDialog({ title: "تفريغ الإذن", message: "سيتم حذف كل الأصناف المضافة للإذن الحالي." })) {
        cart = []; paintCart();
      }
    });
    byId(`v_item_${type}`).addEventListener("input", debounce(showStock, 120));
    byId(`v_qty_${type}`).addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addLine(); }
    });

    onClick(byId(`v_log_${type}`), "[data-act]", async (btn) => {
      const no = btn.dataset.id;
      if (btn.dataset.act === "print") return printVoucher(no);
      if (btn.dataset.act === "delete") {
        const ok = await confirmDialog({
          title: "حذف إذن",
          message: `سيُحذف الإذن ${no} بكل أسطره وتُعاد الأرصدة كما كانت. لا يمكن التراجع.`,
          confirmText: "حذف نهائي", danger: true,
        });
        if (!ok) return;
        try {
          await txns.deleteVoucher(no);
          toast(`تم حذف الإذن ${no}`);
          await Promise.all([paintLog(), refreshSummary()]);
        } catch (err) { toastError(err.message); }
      }
    });

    built = true;
  }

  function fillLists() {
    byId(`itemList_${type}`).innerHTML = get("items")
      .map((i) => `<option value="${esc(itemFullLabel(i))}">`).join("");
    byId(`partyList_${type}`).innerHTML = (isIn ? get("suppliers") : get("projects"))
      .map((s) => `<option value="${esc(s.name)}">`).join("");
    if (!isIn) {
      byId(`projectList_${type}`).innerHTML = get("projects")
        .map((p) => `<option value="${esc(p.name)}">`).join("");
    }
  }

  /** يطابق ما كتبه المستخدم مع صنف حقيقي (بالكود أولًا ثم الاسم). */
  function resolveItem() {
    const raw = byId(`v_item_${type}`).value.trim();
    if (!raw) return null;
    const code = raw.split("—")[0].trim().toLowerCase();
    const list = get("items");
    return list.find((i) => i.code.toLowerCase() === code)
        || list.find((i) => itemFullLabel(i) === raw)
        || list.find((i) => `${i.brand} ${i.name}`.trim().toLowerCase() === raw.toLowerCase())
        || null;
  }

  function showStock() {
    const item = resolveItem();
    const hint = byId(`v_stock_${type}`);
    if (!item) { hint.textContent = ""; return; }
    const reserved = cart.filter((l) => l.item_id === item.id).reduce((s, l) => s + l.qty, 0);
    hint.textContent = `الرصيد الحالي: ${fmtNum(item.balance)} ${item.unit}` +
      (reserved ? ` — محجوز في هذا الإذن: ${fmtNum(reserved)}` : "");
  }

  function addLine() {
    const form = byId(`vl_${type}`);
    const item = resolveItem();
    const qtyRaw = byId(`v_qty_${type}`).value;
    const values = { item: item ? item.id : "", qty: qtyRaw };

    const result = validate(values, {
      item: [rules.required("اختر صنفًا من القائمة")],
      qty: [rules.positiveInt()],
    });
    paintErrors(form, result.errors);
    if (!result.ok) return;

    const qty = toInt(qtyRaw);
    if (!isIn) {
      const reserved = cart.filter((l) => l.item_id === item.id).reduce((s, l) => s + l.qty, 0);
      if (qty + reserved > item.balance) {
        paintErrors(form, {
          qty: `الرصيد لا يكفي. المتاح ${fmtNum(item.balance - reserved)} ${item.unit}`,
        });
        return;
      }
    }

    const line = { item_id: item.id, qty, label: itemFullLabel(item) };
    if (isIn && can("edit_price")) {
      const base = byId(`v_price_${type}`)?.value;
      const extra = byId(`v_extra_${type}`)?.value;
      if (base !== "" && base !== undefined) {
        line.base_price = toNum(base, 0);
        line.extra_costs = toNum(extra, 0);
      }
    }

    // دمج نفس الصنف في سطر واحد ما لم يكن له سعر مختلف
    const same = cart.find((l) => l.item_id === line.item_id && l.base_price === line.base_price);
    if (same) same.qty += qty; else cart.push(line);

    clearErrors(form);
    byId(`v_qty_${type}`).value = "";
    byId(`v_item_${type}`).value = "";
    byId(`v_stock_${type}`).textContent = "";
    if (byId(`v_price_${type}`)) { byId(`v_price_${type}`).value = ""; byId(`v_extra_${type}`).value = ""; }
    byId(`v_item_${type}`).focus();
    paintCart();
  }

  function paintCart() {
    fillTable(byId(`v_cart_${type}`), cart.map((l, idx) => `
      <tr>
        <td>${esc(l.label)}${l.base_price !== undefined
            ? `<div class="hint">سعر الوحدة: ${fmtNum(l.base_price + (l.extra_costs || 0), 2)}</div>` : ""}</td>
        <td class="num center">${fmtNum(l.qty)}</td>
        <td class="center"><button class="btn ghost small" data-remove="${idx}">إزالة</button></td>
      </tr>`), 3, "لم تُضف أصناف بعد");

    byId(`v_cart_${type}`).querySelectorAll("[data-remove]").forEach((btn) => {
      btn.onclick = () => { cart.splice(Number(btn.dataset.remove), 1); paintCart(); };
    });

    const total = cart.reduce((s, l) => s + l.qty, 0);
    byId(`v_total_${type}`).textContent = cart.length
      ? `${cart.length} صنف — إجمالي ${fmtNum(total)} وحدة` : "";
    byId(`v_submit_${type}`).disabled = cart.length === 0;
  }

  async function submit() {
    const form = byId(`vh_${type}`);
    const values = {
      date: byId(`v_date_${type}`).value,
      party: byId(`v_party_${type}`).value.trim(),
      project: isIn ? "" : byId(`v_project_${type}`).value.trim(),
      notes: byId(`v_notes_${type}`).value.trim(),
    };
    const schema = {
      date: [rules.required("أدخل تاريخ الإذن"), rules.date(), rules.notFuture()],
      party: [rules.required(isIn ? "أدخل اسم المورد" : "أدخل الجهة المستلمة"), rules.maxLen(120)],
    };
    if (!isIn) schema.project = [rules.required("أدخل اسم المشروع"), rules.maxLen(120)];

    const result = validate(values, schema);
    paintErrors(form, result.errors);
    if (!result.ok) return;
    if (!cart.length) return toastWarn("أضف صنفًا واحدًا على الأقل");

    await withBusy(byId(`v_submit_${type}`), async () => {
      try {
        const res = await txns.createVoucher({
          type,
          date: values.date,
          party: values.party,
          project: values.project,
          notes: values.notes,
          lines: cart.map(({ item_id, qty, base_price, extra_costs }) => ({
            item_id, qty,
            ...(base_price !== undefined ? { base_price, extra_costs: extra_costs || 0 } : {}),
          })),
        });
        // إيصال بدل إشعار عابر: رقم الإذن هو ما يكتبه أمين المخزن على
        // الورقة ويحتفظ به. الإشعار يختفي بعد ثوانٍ، وقد يكون وقتها
        // منشغلًا بالكرتونة في يده — فيضيع الرقم ولا يعرف كيف يستعيده.
        showReceipt(res, values);
        cart = [];
        byId(`v_notes_${type}`).value = "";
        paintCart();
        clearErrors(form);
        await Promise.all([paintLog(), refreshSummary(), refreshLists()]);
      } catch (err) { toastError(err.message); }
    }, "جارٍ التسجيل...");
  }

  /** إيصال ما بعد الحفظ — رقم الإذن كبير، وطباعة بضغطة واحدة. */
  function showReceipt(res, values) {
    const label = type === "in" ? "إذن وارد" : "إذن صرف";
    const party = (values.party || "").trim();
    const project = (values.project || "").trim();

    const modal = openModal({
      title: "تم تسجيل " + label,
      bodyHtml: `
        <div class="receipt">
          <div class="stamp">مُسجَّل</div>
          <div class="meta">رقم الإذن</div>
          <div class="no" data-type="${type}">${esc(res.voucher_no)}</div>
          <div class="meta">
            ${fmtNum(res.lines)} صنف &nbsp;•&nbsp; ${fmtNum(res.total_qty)} وحدة
          </div>
          <div class="meta">${esc(fmtDate(values.date))}</div>
          ${party ? `<div class="meta">${type === "in" ? "المورد" : "الجهة"}: ${esc(party)}</div>` : ""}
          ${project ? `<div class="meta">المشروع: ${esc(project)}</div>` : ""}
        </div>`,
      actions: [
        {
          label: "طباعة الإذن",
          onClick: (root, close) => { close(); printVoucher(res.voucher_no); },
        },
        {
          label: "إذن جديد",
          kind: "ghost",
          onClick: (root, close) => {
            close();
            byId(`v_party_${type}`)?.focus();
          },
        },
      ],
    });

    return modal;
  }

  async function refreshLists() {
    try {
      const [sup, prj] = await Promise.all([lists.suppliers(), lists.projects()]);
      set({ suppliers: sup, projects: prj });
      fillLists();
    } catch { /* تجاهل — القوائم مساعدة فقط */ }
  }

  async function paintLog() {
    try {
      const rows = await txns.vouchers(type, 20);
      fillTable(byId(`v_log_${type}`), rows.map((v) => `
        <tr>
          <td class="code">${esc(v.voucher_no)}</td>
          <td>${fmtDate(v.txn_date)}</td>
          <td class="num center">${fmtNum(v.lines)}</td>
          <td class="num center">${fmtNum(v.qty)}</td>
          <td>${esc(isIn ? v.party : v.project || v.party)}</td>
          <td>${esc(v.created_by_name || "-")}</td>
          <td><div class="row-actions">
            <button class="btn ghost small" data-act="print" data-id="${esc(v.voucher_no)}">طباعة</button>
            ${can("delete_voucher")
              ? `<button class="btn ghost small" data-act="delete" data-id="${esc(v.voucher_no)}">حذف</button>` : ""}
          </div></td>
        </tr>`), 7, "لا توجد أذون بعد");
    } catch (err) { toastError(err.message); }
  }

  async function printVoucher(no) {
    try {
      const rows = await txns.byVoucher(no);
      if (!rows.length) return toastError("الإذن غير موجود");
      const head = rows[0];
      printTable({
        title: `${isIn ? "إذن وارد" : "إذن صرف"} رقم ${no}`,
        subtitle: `التاريخ: ${fmtDate(head.txn_date)} — ${isIn ? "المورد" : "الجهة"}: ${head.party}` +
                  (head.project ? ` — المشروع: ${head.project}` : "") +
                  (head.notes ? ` — ملاحظات: ${head.notes}` : ""),
        headers: ["م", "الصنف", "الكمية"],
        rows: rows.map((r, i) => [i + 1, r.item_name, r.qty]),
        footer: `عدد الأصناف: ${rows.length} — إجمالي الكميات: ${rows.reduce((s, r) => s + r.qty, 0)}`,
      });
    } catch (err) { toastError(err.message); }
  }

  return {
    render() {
      if (!built) build();
      fillLists();
      paintCart();
      paintLog();
      if (!byId(`v_date_${type}`).value) byId(`v_date_${type}`).value = todayISO();
    },
  };
}

// إعادة رسم القوائم عند وصول تعديل من مستخدم آخر
on("items", () => {
  ["in", "out"].forEach((t) => {
    const list = byId(`itemList_${t}`);
    if (list) list.innerHTML = get("items").map((i) => `<option value="${esc(itemFullLabel(i))}">`).join("");
  });
});
