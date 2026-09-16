/** لوحة القيادة — كل الأرقام تأتي من نداء واحد dashboard_summary(). */
import { byId, fillTable, esc } from "../core/dom.js";
import { fmtNum, fmtMoney, fmtDate } from "../core/format.js";
import { reports } from "../data/repo.js";
import { set, get, on } from "../core/store.js";
import { can } from "../auth/roles.js";
import { toastError } from "../core/ui.js";

let subscribed = false;

export async function render() {
  if (!subscribed) { on("summary", (s) => { if (s) paint(s); }); subscribed = true; }
  const cards = byId("dashCards");
  if (!get("summary")) {
    cards.innerHTML = Array.from({ length: 5 },
      () => `<div class="stat"><div class="skeleton" style="width:60%"></div>
             <div class="skeleton" style="width:40%;height:24px;margin-top:8px"></div></div>`).join("");
  }
  try {
    const s = await reports.summary();
    set({ summary: s });
    paint(s);
  } catch (err) {
    toastError(err.message);
  }
}

function paint(s) {
  const money = can("view_pricing")
    ? `<div class="stat money"><div class="label">قيمة المخزون</div>
       <div class="value">${fmtMoney(s.stock_value)}</div></div>` : "";

  byId("dashCards").innerHTML = `
    <div class="stat"><div class="label">عدد الأصناف</div><div class="value">${fmtNum(s.items_count)}</div></div>
    <div class="stat"><div class="label">إجمالي الكميات</div><div class="value">${fmtNum(s.total_stock)}</div></div>
    <div class="stat warn"><div class="label">تحت الحد الأدنى</div><div class="value">${fmtNum(s.low_stock)}</div></div>
    <div class="stat danger"><div class="label">نفدت من المخزن</div><div class="value">${fmtNum(s.out_of_stock)}</div></div>
    <div class="stat"><div class="label">حركات اليوم</div><div class="value">${fmtNum(s.txn_today)}</div></div>
    ${money}`;

  const top = s.top_out || [];
  const max = Math.max(1, ...top.map((t) => Number(t.qty)));
  byId("dashTopBars").innerHTML = top.length ? top.map((t) => `
    <div class="bar-row">
      <div class="bar-track">
        <div class="bar-fill" style="width:${(Number(t.qty) / max * 100).toFixed(1)}%"></div>
        <span class="bar-label">${esc(t.item_name)}</span>
      </div>
      <div class="num">${fmtNum(t.qty)}</div>
    </div>`).join("")
    : `<div class="empty">لا توجد حركات صرف خلال آخر ٩٠ يومًا</div>`;

  fillTable(byId("dashCategoryBody"), (s.by_category || []).map((c) => `
    <tr>
      <td>${esc(c.category)}</td>
      <td class="num center">${fmtNum(c.items)}</td>
      <td class="num center">${fmtNum(c.qty)}</td>
      ${can("view_pricing") ? `<td class="num">${fmtMoney(c.value)}</td>` : ""}
    </tr>`), 4, "لا توجد أصناف بعد");

  fillTable(byId("dashRecentBody"), (s.recent || []).map((t) => `
    <tr>
      <td><span class="pill ${t.type}">${t.type === "in" ? "وارد" : "صرف"}</span></td>
      <td class="code">${esc(t.voucher_no)}</td>
      <td>${fmtDate(t.txn_date)}</td>
      <td>${esc(t.item_name)}</td>
      <td class="num center">${fmtNum(t.qty)}</td>
      <td>${esc(t.party || t.project || "-")}</td>
      <td>${esc(t.created_by_name || "-")}</td>
    </tr>`), 7, "لم تُسجَّل أي حركة بعد");

  // إخفاء عمود القيمة لمن لا يملك صلاحية التسعير
  document.querySelectorAll("[data-col='value']").forEach((n) => {
    n.hidden = !can("view_pricing");
  });
}
