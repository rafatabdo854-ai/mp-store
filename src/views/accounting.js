/**
 * شاشة المحاسبة — متاحة للمحاسب ومدير النظام فقط.
 * أربع أدوات: تقييم المخزون، تكلفة المشاريع، مطابقة الفواتير، مراجعة الأسعار.
 * كل الأرقام هنا مبنية على تكلفة الوحدة وقت الحركة، لا على السعر الحالي،
 * حتى لا تتغيّر تقارير الشهر الماضي عند تعديل سعر اليوم.
 */
import { byId, esc, fillTable, onClick } from "../core/dom.js";
import { fmtNum, fmtMoney, moneyHtml, moneyText, EMPTY, fmtDate, fmtDateTime, todayISO, toNum } from "../core/format.js";
import { accounting } from "../data/repo.js";
import { can } from "../auth/roles.js";
import { toast, toastError, confirmDialog, openModal, withBusy } from "../core/ui.js";
import { exportRows, exportSheets } from "../data/excel.js";
import { printTable } from "./print.js";

let built = false;
let tab = "valuation";
let cache = {};

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const TABS = [
  { id: "valuation", label: "تقييم المخزون" },
  { id: "projects",  label: "تكلفة المشاريع" },
  { id: "purchases", label: "مطابقة الفواتير" },
  { id: "prices",    label: "مراجعة الأسعار" },
];

function build() {
  byId("view-accounting").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2 style="margin:0">أدوات المحاسبة</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="acRecalc">إعادة بناء التكاليف</button>
      </div>
      <div class="period" id="acTabs">
        ${TABS.map((t) => `<button data-tab="${t.id}">${esc(t.label)}</button>`).join("")}
      </div>
      <div class="fields" style="margin-top:14px">
        <div class="field">
          <label for="acFrom">من تاريخ</label>
          <input type="date" id="acFrom" value="${monthStart()}">
        </div>
        <div class="field">
          <label for="acTo">إلى تاريخ</label>
          <input type="date" id="acTo" value="${todayISO()}">
        </div>
        <div class="field">
          <span class="field-spacer" aria-hidden="true">&nbsp;</span>
          <button class="btn" id="acRun">عرض</button>
        </div>
        <div class="field">
          <span class="field-spacer" aria-hidden="true">&nbsp;</span>
          <button class="btn ghost" id="acQuickMonth">الشهر الحالي</button>
        </div>
      </div>
      <div class="hint">التكلفة محسوبة بالمتوسط المرجّح المتحرك.</div>
    </div>

    <div class="kpi-strip" id="acCards"></div>

    <div class="panel">
      <div class="panel-head">
        <h2 style="margin:0" id="acTitle">تقييم المخزون</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="acExport">تنزيل Excel</button>
        <button class="btn ghost small" id="acPrint">طباعة</button>
      </div>
      <div class="hint" id="acSubtitle"></div>
      <div class="table-wrap">
        <table><thead><tr id="acHead"></tr></thead><tbody id="acBody"></tbody></table>
      </div>
      <div class="hint" id="acFoot"></div>
    </div>`;

  onClick(byId("acTabs"), "[data-tab]", (btn) => {
    tab = btn.dataset.tab;
    markTab();
    run();
  });

  byId("acRun").onclick = run;
  byId("acQuickMonth").onclick = () => {
    byId("acFrom").value = monthStart();
    byId("acTo").value = todayISO();
    run();
  };
  byId("acExport").onclick = exportCurrent;
  byId("acPrint").onclick = printCurrent;
  byId("acRecalc").onclick = recalcCost;

  // مطابقة فاتورة عند الضغط على صف إذن شراء
  onClick(byId("acBody"), "[data-review]", (btn) => reviewDialog(btn.dataset.review));
  onClick(byId("acBody"), "[data-project]", (btn) => projectDetail(btn.dataset.project));

  markTab();
  built = true;
}

const markTab = () => byId("acTabs").querySelectorAll("[data-tab]")
  .forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));

export function render() {
  if (!can("accounting")) return;
  if (!built) build();
  run();
}

const range = () => ({
  from: byId("acFrom").value || monthStart(),
  to: byId("acTo").value || todayISO(),
});

async function run() {
  const { from, to } = range();
  if (from > to) return toastError("تاريخ البداية بعد تاريخ النهاية");
  byId("acBody").innerHTML = `<tr><td colspan="8"><div class="skeleton" style="height:18px"></div></td></tr>`;
  try {
    if (tab === "valuation") return await runValuation(from, to);
    if (tab === "projects")  return await runProjects(from, to);
    if (tab === "purchases") return await runPurchases(from, to);
    return await runPrices();
  } catch (err) {
    const missing = /valuation_report|price_review|purchase_vouchers|PGRST202/i.test(err.message || "");
    toastError(missing ? "شغّل ملف sql/06_accounting.sql في Supabase أولًا" : err.message);
  }
}

function show({ title, subtitle, headers, rows, cards = [], foot = "" }) {
  cache = { title, subtitle, headers, rows, foot };
  byId("acTitle").textContent = title;
  byId("acSubtitle").textContent = subtitle;
  byId("acFoot").textContent = foot;
  byId("acCards").innerHTML = cards.map((c) => `
    <div class="seg t-${c.tone || "brand"}">
      <span class="s-label">${esc(c.label)}</span>
      <span class="s-value${c.money ? " sm" : ""}">${esc(c.value)}</span>
      <span class="s-sub">${esc(c.sub || "")}</span>
    </div>`).join("");
  byId("acHead").innerHTML = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  fillTable(byId("acBody"), rows, headers.length, "لا توجد بيانات في هذه الفترة");
}

/* ------------------------- ١) تقييم المخزون ------------------------- */
async function runValuation(from, to) {
  const data = await accounting.valuation(from, to);
  const t = data.totals;

  show({
    title: "تقييم المخزون",
    subtitle: `من ${fmtDate(from)} إلى ${fmtDate(to)} — ${fmtNum(t.items)} صنف متحرّك أو له رصيد`,
    headers: ["الكود", "الصنف", "أول المدة", "قيمة أول المدة", "وارد", "قيمة الوارد",
              "منصرف", "تكلفة المنصرف", "آخر المدة", "قيمة آخر المدة"],
    cards: [
      { label: "قيمة أول المدة", value: moneyText(t.opening_val, { blankWhenZero: true }), money: true, tone: "brand" },
      { label: "قيمة المشتريات", value: moneyText(t.in_val, { blankWhenZero: true }), money: true, tone: "in",
        sub: "إجمالي الوارد بالتكلفة" },
      { label: "تكلفة المنصرف", value: moneyText(t.out_val, { blankWhenZero: true }), money: true, tone: "out",
        sub: "يُحمَّل على المشاريع" },
      { label: "قيمة آخر المدة", value: moneyText(t.closing_val, { blankWhenZero: true }), money: true, tone: "copper",
        sub: "رصيد المخزون في نهاية الفترة" },
    ],
    rows: (data.rows || []).map((r) => `
      <tr>
        <td class="code"><span class="plate">${esc(r.code)}</span></td>
        <td>${esc(r.label)}</td>
        <td class="num center">${fmtNum(r.opening_qty)}</td>
        <td class="num">${moneyHtml(r.opening_val, { blankWhenZero: true })}</td>
        <td class="num center">${fmtNum(r.in_qty)}</td>
        <td class="num">${moneyHtml(r.in_val, { blankWhenZero: true })}</td>
        <td class="num center">${fmtNum(r.out_qty)}</td>
        <td class="num">${moneyHtml(r.out_val, { blankWhenZero: true })}</td>
        <td class="num center">${fmtNum(r.closing_qty)}</td>
        <td class="num">${moneyHtml(r.closing_val, { blankWhenZero: true })}</td>
      </tr>`),
    foot: `المعادلة: قيمة أول المدة + المشتريات − تكلفة المنصرف = قيمة آخر المدة`,
  });

  cache.raw = (data.rows || []).map((r) => ({
    "الكود": r.code, "الصنف": r.label, "الفئة": r.category,
    "كمية أول المدة": r.opening_qty, "قيمة أول المدة": Number(r.opening_val),
    "كمية الوارد": r.in_qty, "قيمة الوارد": Number(r.in_val),
    "كمية المنصرف": r.out_qty, "تكلفة المنصرف": Number(r.out_val),
    "كمية آخر المدة": r.closing_qty, "متوسط التكلفة": Number(r.avg_cost),
    "قيمة آخر المدة": Number(r.closing_val),
  }));
}

/* ------------------------- ٢) تكلفة المشاريع ------------------------- */
async function runProjects(from, to) {
  const rows = await accounting.projectCost(from, to);
  const total = rows.reduce((s, r) => s + Number(r.cost), 0);
  const top = rows[0];

  show({
    title: "تكلفة الصرف لكل مشروع",
    subtitle: `من ${fmtDate(from)} إلى ${fmtDate(to)} — ${fmtNum(rows.length)} مشروع`,
    headers: ["المشروع", "الأذون", "الأصناف", "الكميات", "التكلفة", "النسبة", ""],
    cards: [
      { label: "إجمالي التكلفة المحمّلة", value: moneyText(total, { blankWhenZero: true }), money: true, tone: "out" },
      { label: "عدد المشاريع", value: fmtNum(rows.length), tone: "brand" },
      { label: "أعلى مشروع", value: top ? top.project : "—", money: true, tone: "copper",
        sub: top ? fmtMoney(top.cost) : "" },
    ],
    rows: rows.map((r) => `
      <tr>
        <td>${esc(r.project)}</td>
        <td class="num center">${fmtNum(r.vouchers)}</td>
        <td class="num center">${fmtNum(r.items)}</td>
        <td class="num center">${fmtNum(r.qty)}</td>
        <td class="num">${moneyHtml(r.cost, { blankWhenZero: true })}</td>
        <td class="num center">${total > 0 ? fmtNum((Number(r.cost) / total) * 100, 1) : 0}%</td>
        <td><button class="btn ghost small" data-project="${esc(r.project)}">تفصيل</button></td>
      </tr>`),
    foot: `التكلفة محسوبة بسعر الوحدة وقت الصرف.`,
  });

  cache.raw = rows.map((r) => ({
    "المشروع": r.project, "عدد الأذون": r.vouchers, "عدد الأصناف": r.items,
    "الكميات": r.qty, "التكلفة": Number(r.cost),
  }));
}

async function projectDetail(project) {
  const { from, to } = range();
  try {
    const rows = await accounting.projectDetail(project, from, to);
    const total = rows.reduce((s, r) => s + Number(r.cost), 0);
    openModal({
      title: `تفصيل: ${project}`,
      bodyHtml: `<div class="hint">${fmtDate(from)} — ${fmtDate(to)}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>الصنف</th><th class="center">الكمية</th>
            <th>متوسط التكلفة</th><th>الإجمالي</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${esc(r.item_name)}</td>
            <td class="num center">${fmtNum(r.qty)}</td>
            <td class="num">${moneyHtml(r.avg_cost, { blankWhenZero: true })}</td>
            <td class="num">${moneyHtml(r.cost, { blankWhenZero: true })}</td></tr>`).join("")}</tbody>
        </table></div>
        <div class="hint">الإجمالي: ${fmtMoney(total)}</div>`,
      actions: [{
        label: "طباعة", kind: "ghost",
        onClick: () => printTable({
          title: `تكلفة مشروع: ${project}`,
          subtitle: `من ${fmtDate(from)} إلى ${fmtDate(to)}`,
          headers: ["الصنف", "الكمية", "متوسط التكلفة", "الإجمالي"],
          rows: rows.map((r) => [r.item_name, r.qty, Number(r.avg_cost).toFixed(2), Number(r.cost).toFixed(2)]),
          footer: `إجمالي تكلفة المشروع: ${fmtMoney(total)}`,
        }),
      }],
    });
  } catch (err) { toastError(err.message); }
}

/* ------------------------- ٣) مطابقة الفواتير ------------------------- */
const STATUS = {
  pending:  `<span class="pill low">بانتظار المراجعة</span>`,
  matched:  `<span class="pill ok">مطابق</span>`,
  disputed: `<span class="pill zero">به فرق</span>`,
};

async function runPurchases(from, to) {
  const rows = await accounting.purchases(from, to);
  const total = rows.reduce((s, r) => s + Number(r.voucher_value), 0);
  const pending = rows.filter((r) => r.status === "pending").length;
  const disputed = rows.filter((r) => r.status === "disputed").length;

  show({
    title: "مطابقة فواتير الموردين",
    subtitle: `أذون الوارد من ${fmtDate(from)} إلى ${fmtDate(to)}`,
    headers: ["رقم الإذن", "التاريخ", "المورد", "الأصناف", "قيمة الإذن",
              "رقم الفاتورة", "قيمة الفاتورة", "الفرق", "الحالة", ""],
    cards: [
      { label: "إجمالي المشتريات", value: moneyText(total, { blankWhenZero: true }), money: true, tone: "in" },
      { label: "أذون بانتظار المراجعة", value: fmtNum(pending), tone: "warn",
        sub: `من ${fmtNum(rows.length)} إذن` },
      { label: "أذون بها فروقات", value: fmtNum(disputed), tone: "out" },
    ],
    rows: rows.map((r) => {
      const diff = Number(r.diff || 0);
      return `
      <tr>
        <td class="code"><span class="plate">${esc(r.voucher_no)}</span></td>
        <td>${fmtDate(r.txn_date)}</td>
        <td>${esc(r.party || "-")}</td>
        <td class="num center">${fmtNum(r.lines)}</td>
        <td class="num">${moneyHtml(r.voucher_value, { blankWhenZero: true })}</td>
        <td class="code"><span class="plate">${esc(r.invoice_no || "-")}</span></td>
        <td class="num">${r.invoice_amount === null || r.invoice_amount === undefined
            ? `<span class="val-none">${EMPTY}</span>` : moneyHtml(r.invoice_amount)}</td>
        <td class="num">${r.invoice_amount === null || r.invoice_amount === undefined
            ? `<span class="val-none">${EMPTY}</span>`
            : `<span class="${Math.abs(diff) < 0.01 ? "diff-ok" : "diff-off"}">${moneyHtml(diff)}</span>`}</td>
        <td class="center">${STATUS[r.status] || STATUS.pending}</td>
        <td><button class="btn ghost small" data-review="${esc(r.voucher_no)}">مراجعة</button></td>
      </tr>`;
    }),
    foot: `الفرق = قيمة الفاتورة − قيمة الإذن. الموجب يعني أن الفاتورة أعلى من المستلم فعليًا.`,
  });

  cache.raw = rows.map((r) => ({
    "رقم الإذن": r.voucher_no, "التاريخ": r.txn_date, "المورد": r.party,
    "عدد الأصناف": r.lines, "الكميات": r.qty, "قيمة الإذن": Number(r.voucher_value),
    "رقم الفاتورة": r.invoice_no || "", "قيمة الفاتورة": r.invoice_amount ?? "",
    "الفرق": r.invoice_amount === null ? "" : Number(r.diff),
    "الحالة": r.status, "روجع بواسطة": r.reviewed_by_name || "",
  }));
  cache.rowsData = rows;
}

function reviewDialog(voucherNo) {
  const row = (cache.rowsData || []).find((r) => r.voucher_no === voucherNo);
  if (!row) return;

  openModal({
    title: `مراجعة الإذن ${voucherNo}`,
    bodyHtml: `
      <div class="hint">المورد: ${esc(row.party || "-")} — التاريخ: ${fmtDate(row.txn_date)}
        — قيمة الإذن بالتكلفة: <b>${fmtMoney(row.voucher_value)}</b></div>
      <form id="revForm" class="fields" novalidate style="margin-top:12px">
        <div class="field">
          <label for="rv_no">رقم فاتورة المورد</label>
          <input id="rv_no" dir="ltr" value="${esc(row.invoice_no || "")}">
        </div>
        <div class="field">
          <label for="rv_amount">قيمة الفاتورة</label>
          <input id="rv_amount" type="number" step="0.01" min="0"
                 value="${row.invoice_amount ?? ""}">
        </div>
        <div class="field">
          <label for="rv_status">الحالة</label>
          <select id="rv_status">
            <option value="pending">بانتظار المراجعة</option>
            <option value="matched">مطابق</option>
            <option value="disputed">به فرق</option>
          </select>
        </div>
        <div class="field full">
          <label for="rv_notes">ملاحظات</label>
          <textarea id="rv_notes" rows="2">${esc(row.notes || "")}</textarea>
        </div>
      </form>
      <div class="hint" id="rv_diff"></div>`,
    actions: [{
      label: "حفظ المراجعة",
      onClick: async (root, close) => {
        const amount = root.querySelector("#rv_amount").value;
        await withBusy(root.querySelector("[data-action='0']"), async () => {
          try {
            await accounting.review({
              voucher_no: voucherNo,
              invoice_no: root.querySelector("#rv_no").value.trim(),
              invoice_amount: amount === "" ? null : toNum(amount, 0),
              status: root.querySelector("#rv_status").value,
              notes: root.querySelector("#rv_notes").value.trim(),
            });
            toast("تم حفظ المراجعة");
            close();
            run();
          } catch (err) { toastError(err.message); }
        }, "جارٍ الحفظ...");
      },
    }],
  });

  const statusSelect = document.querySelector("#rv_status");
  if (statusSelect) statusSelect.value = row.status || "pending";

  // يحسب الفرق أثناء الكتابة ويقترح الحالة
  const amountInput = document.querySelector("#rv_amount");
  const diffHint = document.querySelector("#rv_diff");
  const update = () => {
    const value = amountInput.value;
    if (value === "") { diffHint.textContent = ""; return; }
    const diff = toNum(value, 0) - Number(row.voucher_value);
    diffHint.textContent = Math.abs(diff) < 0.01
      ? "الفاتورة مطابقة لقيمة الإذن تمامًا."
      : `فرق ${fmtMoney(diff)} ${diff > 0 ? "لصالح المورد" : "لصالحنا"}.`;
    if (statusSelect.value === "pending") {
      statusSelect.value = Math.abs(diff) < 0.01 ? "matched" : "disputed";
    }
  };
  amountInput?.addEventListener("input", update);
  update();
}

/* ------------------------- ٤) مراجعة الأسعار ------------------------- */
async function runPrices() {
  const data = await accounting.priceReview(25);
  const s = data.summary;

  const missing = data.missing || [];
  const gap = data.gap || [];
  const zero = data.zero_cost_in || [];

  show({
    title: "مراجعة الأسعار",
    subtitle: `${fmtNum(missing.length)} صنف بلا سعر — ${fmtNum(gap.length)} صنف فرق سعره عن تكلفته ٢٥% أو أكثر`,
    headers: ["النوع", "الكود", "الصنف", "الرصيد", "آخر سعر", "متوسط التكلفة", "الفرق"],
    cards: [
      { label: "أصناف بلا سعر", value: fmtNum(s.missing_count), tone: "out",
        sub: `من ${fmtNum(s.items)} صنف` },
      { label: "قيمة المخزون بالتكلفة", value: moneyText(s.value_at_cost, { blankWhenZero: true }), money: true, tone: "copper",
        sub: "المتوسط المرجّح" },
      { label: "قيمته بآخر سعر شراء", value: moneyText(s.value_at_last, { blankWhenZero: true }), money: true, tone: "brand",
        sub: "للمقارنة فقط" },
      { label: "أذون وارد بلا تكلفة", value: fmtNum(zero.length), tone: "warn",
        sub: "استُلمت بدون سعر" },
    ],
    rows: [
      ...missing.map((r) => `
        <tr>
          <td><span class="pill zero">بلا سعر</span></td>
          <td class="code"><span class="plate">${esc(r.code)}</span></td>
          <td>${esc(r.label)}</td>
          <td class="num center">${fmtNum(r.balance)}</td>
          <td class="num">-</td><td class="num">-</td><td class="num">-</td>
        </tr>`),
      ...gap.map((r) => `
        <tr>
          <td><span class="pill low">فرق سعر</span></td>
          <td class="code"><span class="plate">${esc(r.code)}</span></td>
          <td>${esc(r.label)}</td>
          <td class="num center">${fmtNum(r.balance)}</td>
          <td class="num">${moneyHtml(r.unit_price, { blankWhenZero: true })}</td>
          <td class="num">${moneyHtml(r.avg_cost, { blankWhenZero: true })}</td>
          <td class="num center">${fmtNum(r.gap_pct)}%</td>
        </tr>`),
    ],
    foot: zero.length
      ? `${fmtNum(zero.length)} إذن وارد سُجِّل بدون سعر — راجعها حتى لا تتشوّه التكلفة.`
      : "",
  });

  cache.raw = [
    ...missing.map((r) => ({ "النوع": "بلا سعر", "الكود": r.code, "الصنف": r.label,
      "الرصيد": r.balance, "آخر سعر": "", "متوسط التكلفة": "", "الفرق %": "" })),
    ...gap.map((r) => ({ "النوع": "فرق سعر", "الكود": r.code, "الصنف": r.label,
      "الرصيد": r.balance, "آخر سعر": Number(r.unit_price),
      "متوسط التكلفة": Number(r.avg_cost), "الفرق %": Number(r.gap_pct) })),
  ];
}

/* ------------------------- صيانة وتصدير ------------------------- */
async function recalcCost() {
  const ok = await confirmDialog({
    title: "إعادة بناء التكاليف",
    message: "سيُعاد حساب متوسط التكلفة لكل صنف بإعادة تشغيل كل حركاته بالترتيب،"
           + " وتُحدَّث تكلفة كل حركة قديمة. استخدمها بعد استيراد بيانات أو تعديل أسعار تاريخية.",
    confirmText: "إعادة البناء",
  });
  if (!ok) return;
  await withBusy(byId("acRecalc"), async () => {
    try {
      const n = await accounting.recalcCost();
      toast(`تمت إعادة بناء تكلفة ${fmtNum(n)} صنف`);
      run();
    } catch (err) { toastError(err.message); }
  }, "جارٍ الحساب...");
}

async function exportCurrent() {
  const rows = cache.raw || [];
  if (!rows.length) return toastError("لا توجد بيانات للتصدير");
  const { from, to } = range();
  await exportSheets(
    [{ name: cache.title.slice(0, 28), rows }],
    `${cache.title.replace(/\s+/g, "_")}_${from}_${to}`
  );
  toast("تم تنزيل الملف");
}

function printCurrent() {
  const rows = cache.raw || [];
  if (!rows.length) return toastError("لا توجد بيانات للطباعة");
  printTable({
    title: cache.title,
    subtitle: cache.subtitle,
    headers: Object.keys(rows[0]),
    rows: rows.map((r) => Object.values(r).map((v) =>
      typeof v === "number" ? fmtNum(v, Number.isInteger(v) ? 0 : 2) : v)),
    footer: cache.foot || "",
  });
}
