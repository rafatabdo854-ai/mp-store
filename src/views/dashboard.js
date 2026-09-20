/**
 * لوحة القيادة الذكية.
 * مبنية على سؤال واحد: "ما الذي يحتاج تدخّلي اليوم؟"
 * كل رقم فيها قابل للضغط ويأخذك للشاشة المناسبة بالمرشّح جاهزًا.
 */
import { byId, esc, fillTable, onClick } from "../core/dom.js";
import { fmtNum, fmtMoney, moneyHtml, moneyText, fmtDate, fmtDateTime } from "../core/format.js";
import { reports } from "../data/repo.js";
import { set, get } from "../core/store.js";
import { can } from "../auth/roles.js";
import { toast, toastError } from "../core/ui.js";
import { exportRows } from "../data/excel.js";
import { printTable } from "./print.js";

const PERIOD_KEY = "mpstore.dash.period";
let built = false;
let period = Number(localStorage.getItem(PERIOD_KEY)) || 30;
let data = null;

/* ------------------------- البناء ------------------------- */
function build() {
  byId("view-dashboard").innerHTML = `
    <div class="dash-head">
      <div class="period" role="group" aria-label="فترة التحليل">
        ${[7, 30, 90].map((d) => `<button data-period="${d}">${d} يوم</button>`).join("")}
      </div>
      <span class="spacer"></span>
      <span class="hint" id="dashStamp"></span>
    </div>

    <div id="dashAlerts" class="alerts"></div>

    <div class="kpi-strip" id="dashCards"></div>

    <div class="grid-main" style="margin-bottom:16px">
      <div class="panel">
        <div class="panel-head">
          <h2 style="margin:0">حركة المخزن</h2>
          <span class="spacer"></span>
          <span class="legend"><i class="sw in"></i>وارد <i class="sw out"></i>صرف</span>
        </div>
        <div id="dashChart" class="chart-box"></div>
        <div class="hint" id="dashTrend"></div>
      </div>

      <div class="panel">
        <h2>توزيع المخزن</h2>
        <div class="donuts" id="dashDonuts"></div>
      </div>
    </div>

    <div class="panel" id="negativePanel" hidden>
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">أصناف تحتاج شراء فوري (رصيد سالب)</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="negativeExport">تنزيل Excel</button>
      </div>
      <div class="hint">صُرف من هذه الأصناف أكثر مما هو متوفر فعليًا — راجعها وابدأ أمر شراء (PR) حالًا.</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الكود</th><th>الصنف</th><th class="center">الرصيد</th>
            <th data-col="value">قيمة العجز</th>
            <th>آخر إذن طلبه</th><th>بواسطة</th><th>التاريخ</th><th></th>
          </tr></thead>
          <tbody id="negativeBody"></tbody>
        </table>
      </div>
    </div>

    <div class="panel" id="riskPanel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">أصناف على وشك النفاد</h2>
        <span class="spacer"></span>
        <span class="hint">التقدير من متوسط الصرف خلال ٩٠ يومًا</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الكود</th><th>الصنف</th><th class="center">الرصيد</th>
            <th class="center">معدل الصرف اليومي</th><th class="center">يكفي</th><th></th>
          </tr></thead>
          <tbody id="riskBody"></tbody>
        </table>
      </div>
    </div>

    <div class="panel" id="reorderPanel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">اقتراح طلب شراء</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" id="reorderExport">تنزيل Excel</button>
        <button class="btn ghost small" id="reorderPrint">طباعة</button>
      </div>
      <div class="hint">كميات تكفي ٤٥ يومًا من الاستهلاك الحالي للأصناف المهدَّدة.</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الكود</th><th>الصنف</th><th class="center">الرصيد</th>
            <th class="center">الكمية المقترحة</th><th data-col="value">التكلفة التقديرية</th>
          </tr></thead>
          <tbody id="reorderBody"></tbody>
        </table>
      </div>
      <div class="hint" id="reorderTotal"></div>
    </div>

    <div class="dash-cols">
      <div class="panel">
        <h2>الأكثر صرفًا</h2>
        <div id="dashTopBars"></div>
      </div>
      <div class="panel">
        <h2>أنشط المشاريع</h2>
        <div id="dashProjects"></div>
      </div>
    </div>

    <div class="panel" id="stagnantPanel">
      <h2>رأس مال راكد</h2>
      <div class="hint">أصناف لها رصيد ولم تُصرف منذ أكثر من ٦ أشهر.</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>الكود</th><th>الصنف</th><th class="center">الرصيد</th>
            <th>آخر صرف</th><th data-col="value">القيمة المجمّدة</th></tr></thead>
          <tbody id="stagnantBody"></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h2>الأرصدة حسب الفئة</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>الفئة</th><th class="center">الأصناف</th><th class="center">الكمية</th>
            <th class="center">تحت الحد</th><th data-col="value">القيمة</th></tr></thead>
          <tbody id="dashCategoryBody"></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2 style="border:0;margin:0;padding:0;background:none">آخر الحركات</h2>
        <span class="spacer"></span>
        <button class="btn ghost small" data-goto="log">عرض السجل كاملًا</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>النوع</th><th>رقم الإذن</th><th>التاريخ</th><th>الصنف</th>
            <th class="center">الكمية</th><th>الجهة / المشروع</th><th>بواسطة</th></tr></thead>
          <tbody id="dashRecentBody"></tbody>
        </table>
      </div>
    </div>`;

  // تبديل الفترة
  onClick(byId("view-dashboard"), "[data-period]", (btn) => {
    period = Number(btn.dataset.period);
    localStorage.setItem(PERIOD_KEY, String(period));
    markPeriod();
    load();
  });

  // كل ما هو قابل للضغط ينقل لشاشة بمرشّح جاهز
  onClick(byId("view-dashboard"), "[data-goto]", (node) => {
    const view = node.dataset.goto;
    const params = Object.fromEntries(new URLSearchParams(node.dataset.params || ""));
    if (window.mpGo) window.mpGo(view, params);
    else location.hash = view;
  });

  onClick(byId("view-dashboard"), "[data-scroll]", (node) => {
    byId(node.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  byId("reorderExport").onclick = exportReorder;
  byId("reorderPrint").onclick = printReorder;
  byId("negativeExport").onclick = exportNegative;

  markPeriod();
  built = true;
}

const markPeriod = () => {
  byId("view-dashboard").querySelectorAll("[data-period]").forEach((b) =>
    b.classList.toggle("on", Number(b.dataset.period) === period));
};

/* ------------------------- التحميل ------------------------- */
export async function render() {
  if (!built) build();
  if (data) paint();
  await load();
}

async function load() {
  if (!data) skeleton();
  try {
    data = await reports.insights(period);
    set({ summary: data.kpi });
    paint();
  } catch (err) {
    // الدالة غير موجودة = ملف sql/05_dashboard.sql لم يُشغَّل بعد
    const missing = /dashboard_insights|function .* does not exist|PGRST202/i.test(err.message || "");
    byId("dashAlerts").innerHTML = `
      <div class="alert warn"><span class="dot"></span><span class="txt">
        <b>${missing ? "لوحة القيادة الذكية غير مفعّلة" : "تعذّر تحميل اللوحة"}</b>
        <span>${missing
          ? "شغّل ملف sql/05_dashboard.sql مرة واحدة في Supabase SQL Editor ثم حدّث الصفحة."
          : (err.message || "")}</span></span></div>`;
    byId("dashCards").innerHTML = "";
    if (!missing) toastError(err.message);
  }
}

function skeleton() {
  byId("dashCards").innerHTML = Array.from({ length: 6 }, () =>
    `<div class="seg"><div class="skeleton" style="width:70%"></div>
     <div class="skeleton" style="width:45%;height:24px;margin-top:10px"></div>
     <div class="skeleton" style="width:85%;height:9px;margin-top:10px"></div></div>`).join("");
}

/* ------------------------- الرسم ------------------------- */
function paint() {
  const k = data.kpi;
  const showValue = can("view_pricing");

  byId("dashStamp").textContent = `آخر تحديث ${fmtDateTime(new Date())}`;
  paintAlerts(k, data.movement);

  paintKpi(k, data.movement, showValue);

  paintDonuts(k, showValue);
  paintChart(data.series);
  paintTrend(data.movement);
  paintNegative(showValue);
  paintRisk();
  paintReorder(showValue);
  paintBars();
  paintProjects();
  paintStagnant(showValue);
  paintCategories(showValue);
  paintRecent();

  document.querySelectorAll("#view-dashboard [data-col='value']").forEach((n) => { n.hidden = !showValue; });
}

/** بطاقات المؤشرات: رقم كبير + سطر يفسّره، وكل بطاقة تنقل لمكانها. */
function paintKpi(k, mv, showValue) {
  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const trend = mv.out_change === null || mv.out_change === undefined
    ? `${fmtNum(mv.out_now)} وحدة منصرفة`
    : `الصرف ${Number(mv.out_change) >= 0 ? "أعلى" : "أقل"} ${fmtNum(Math.abs(Number(mv.out_change)))}% عن السابق`;

  const cards = [];

  // كارت السالب أولًا وبأعلى أولوية — لا يظهر إلا لو فيه فعلًا أصناف سالبة
  if (k.negative_count > 0) cards.push({
    tone: "out", label: "رصيد سالب — شراء فوري", value: fmtNum(k.negative_count),
    sub: "أصناف صُرف منها أكثر من المتاح",
    scroll: "negativePanel",
  });

  cards.push(
    {
      tone: "brand", label: "الأصناف النشطة", value: fmtNum(k.items_count),
      sub: `${fmtNum(k.total_stock)} وحدة في المخزن`,
      goto: "items",
    },
    {
      tone: "warn", label: "تحت الحد الأدنى", value: fmtNum(k.low_stock),
      sub: `${fmtNum(pct(k.low_stock, k.items_count))}% من الأصناف`,
      goto: "items", params: { stock: "low" },
    },
    {
      tone: "out", label: "نفد من المخزن", value: fmtNum(k.out_of_stock),
      sub: "لا يمكن الصرف منها",
      goto: "items", params: { stock: "zero" },
    },
    {
      tone: "out", label: "يكفي ١٤ يومًا أو أقل", value: fmtNum(k.urgent),
      sub: "حسب معدل الصرف الفعلي",
      scroll: "riskPanel",
    },
    {
      tone: "in", label: `أذون خلال ${period} يوم`, value: fmtNum(mv.vouchers_now),
      sub: trend,
      goto: "log",
    },
  );

  if (showValue) cards.push({
    tone: "copper", label: "قيمة المخزون", value: moneyText(k.stock_value, { blankWhenZero: true }), money: true,
    sub: k.unpriced > 0 ? `${fmtNum(k.unpriced)} صنف بلا سعر` : "كل الأصناف مسعّرة",
    goto: "pricing",
  });

  byId("dashCards").innerHTML = cards.map((c) => {
    const tag = (c.goto || c.scroll) ? "button" : "div";
    const attrs = c.goto
      ? `data-goto="${c.goto}" data-params="${esc(new URLSearchParams(c.params || {}).toString())}"`
      : c.scroll ? `data-scroll="${c.scroll}"` : "";
    return `<${tag} class="seg t-${c.tone}" ${attrs}>
      <span class="s-label">${esc(c.label)}</span>
      <span class="s-value${c.money ? " sm" : ""}">${esc(c.value)}</span>
      <span class="s-sub">${esc(c.sub)}</span>
    </${tag}>`;
  }).join("");
}

/* ------------------------- الدونات ------------------------- */
const TONES = {
  ok: "#2B7A5B", warn: "#B8790B", out: "#AE3B33",
  brand: "#0F6E8C", copper: "#8C5A2B", in: "#2A6BA3", mute: "#C7D2DC",
};

/**
 * حلقة مقسّمة بالـ SVG: كل قطعة شريحة من محيط الدائرة.
 * أبسط وأخف من تحميل مكتبة رسم كاملة.
 */
function donut({ title, segments, big, cap }) {
  const R = 52, SW = 14, C = 2 * Math.PI * R;
  const total = segments.reduce((sum, seg) => sum + Number(seg.value), 0);
  let offset = 0;

  const rings = total > 0 ? segments.filter((seg) => Number(seg.value) > 0).map((seg) => {
    const len = (Number(seg.value) / total) * C;
    const node = `<circle class="ring" cx="64" cy="64" r="${R}" stroke="${seg.color}"
        stroke-width="${SW}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"><title>${esc(seg.label)}: ${fmtNum(seg.value)}</title></circle>`;
    offset += len;
    return node;
  }).join("") : "";

  return `
    <div class="donut">
      <div class="title">${esc(title)}</div>
      <div class="hub">
        <svg viewBox="0 0 128 128" role="img" aria-label="${esc(title)}">
          <circle class="ring-bg" cx="64" cy="64" r="${R}" stroke-width="${SW}"></circle>
          ${rings}
        </svg>
        <div class="mid"><div class="big">${esc(big)}</div><div class="cap">${esc(cap)}</div></div>
      </div>
      <div class="keys">
        ${segments.map((seg) => `<div class="key" title="${esc(seg.label)}">
          <i style="background:${seg.color}"></i>
          <span class="nm">${esc(seg.label)}</span><b>${fmtNum(seg.value)}</b></div>`).join("")}
      </div>
    </div>`;
}

function paintDonuts(k, showValue) {
  const healthy = Math.max(0, k.items_count - k.low_stock - k.out_of_stock);
  const parts = [
    donut({
      title: "حالة الأرصدة",
      big: fmtNum(k.items_count), cap: "صنف",
      segments: [
        { label: "متاح", value: healthy, color: TONES.ok },
        { label: "تحت الحد", value: k.low_stock, color: TONES.warn },
        { label: "نفد", value: k.out_of_stock, color: TONES.out },
      ],
    }),
  ];

  const cats = (data.by_category || []).slice();
  if (cats.length) {
    const palette = [TONES.brand, TONES.in, TONES.copper, TONES.ok, TONES.warn];
    const totalValue = cats.reduce((sum, c) => sum + Number(c.value), 0);
    const byValue = showValue && totalValue > 0;
    const key = byValue ? "value" : "qty";
    const sorted = cats.sort((a, b) => Number(b[key]) - Number(a[key]));
    const top = sorted.slice(0, 4).map((c, i) => ({
      label: c.category,
      value: Math.round(Number(c[key])), color: palette[i],
    }));
    const rest = sorted.slice(4).reduce((sum, c) => sum + Number(c[key]), 0);
    if (rest > 0) top.push({ label: "باقي الفئات", value: Math.round(rest), color: TONES.mute });

    parts.push(donut({
      title: byValue ? "القيمة حسب الفئة" : "الكميات حسب الفئة",
      big: fmtNum(sorted.length), cap: "فئة",
      segments: top,
    }));
  }

  if (showValue) {
    // k.unpriced يَعُدّ الأصناف التي لها رصيد وبلا سعر فقط، فطرحه من
    // إجمالي الأصناف كان يَحسب كلَّ صنف رصيده صفر على أنه "مسعّر":
    // لوحة تقول 20% مسعّر وشاشة التسعير تقول صفر. العدّ الآن من قائمة
    // الأصناف نفسها التي تعتمد عليها شاشة التسعير، فتتفق الشاشتان.
    const all = get("items") || [];
    const priced = all.filter((i) => Number(i.unit_price) > 0).length;
    const total = all.length || k.items_count || 0;
    parts.push(donut({
      title: "اكتمال التسعير",
      big: `${fmtNum(total ? Math.round((priced / total) * 100) : 0)}%`, cap: "مسعّر",
      segments: [
        { label: "مسعّر", value: priced, color: TONES.brand },
        { label: "بلا سعر", value: Math.max(0, total - priced), color: TONES.mute },
      ],
    }));
  }

  byId("dashDonuts").innerHTML = parts.join("");
}

/** مركز الإجراءات: لا يظهر إلا ما يحتاج تدخّلًا فعليًا. */
function paintAlerts(k, mv) {
  const alerts = [];

  // الأخطر: رصيد سالب فعليًا — صُرف أكثر مما هو موجود، يحتاج PR فوري
  if (k.negative_count > 0) alerts.push({
    kind: "danger", title: `${fmtNum(k.negative_count)} صنف برصيد سالب — يحتاج شراء فوري`,
    body: "صُرف أكثر مما هو متوفر فعليًا. راجع القائمة وابدأ أمر شراء (PR) حالًا.",
    action: "عرض القائمة", scroll: "negativePanel",
  });

  if (k.out_of_stock > 0) alerts.push({
    kind: "danger", title: `${fmtNum(k.out_of_stock)} صنف نفد بالكامل`,
    body: "لا يمكن الصرف منها حتى يتم التوريد.",
    action: "عرض الأصناف", goto: "items", params: { stock: "zero" },
  });

  if (k.urgent > 0) alerts.push({
    kind: "danger", title: `${fmtNum(k.urgent)} صنف يكفي ١٤ يومًا أو أقل`,
    body: "بمعدل الصرف الحالي ستنفد قبل نهاية الأسبوعين.",
    action: "عرض القائمة", scroll: "riskPanel",
  });

  if (k.low_stock > 0) alerts.push({
    kind: "warn", title: `${fmtNum(k.low_stock)} صنف تحت الحد الأدنى`,
    body: "راجع اقتراح طلب الشراء أسفل الصفحة.",
    action: "عرض الأصناف", goto: "items", params: { stock: "low" },
  });

  if (mv.out_change !== null && Number(mv.out_change) >= 40) alerts.push({
    kind: "warn", title: `الصرف ارتفع ${fmtNum(mv.out_change)}% عن الفترة السابقة`,
    body: `${fmtNum(mv.out_now)} وحدة خلال ${period} يوم مقابل ${fmtNum(mv.out_prev)} قبلها.`,
    action: "فحص السجل", goto: "log", params: { type: "out" },
  });

  if (can("view_pricing") && k.unpriced > 0) alerts.push({
    kind: "warn", title: `${fmtNum(k.unpriced)} صنف له رصيد بلا سعر`,
    body: "قيمة المخزون المعروضة أقل من الحقيقة.",
    action: "تسعير الأصناف", goto: "pricing",
  });

  if (can("view_pricing") && k.stagnant > 0 && Number(k.stagnant_value) > 0) alerts.push({
    kind: "info", title: `${fmtMoney(k.stagnant_value)} رأس مال راكد`,
    body: `${fmtNum(k.stagnant)} صنف بلا صرف منذ أكثر من ٦ أشهر.`,
    action: "عرض التفاصيل", scroll: "stagnantPanel",
  });

  byId("dashAlerts").innerHTML = alerts.length
    ? alerts.map((a) => {
        const attrs = a.goto
          ? `data-goto="${a.goto}" data-params="${esc(new URLSearchParams(a.params || {}).toString())}"`
          : `data-scroll="${a.scroll}"`;
        return `
        <button class="alert ${a.kind}" ${attrs}>
          <span class="dot"></span>
          <span class="txt"><b>${esc(a.title)}</b><span>${esc(a.body)}</span></span>
          <span class="cta">${esc(a.action)}</span>
        </button>`;
      }).join("")
    : `<div class="alert ok"><span class="dot"></span>
        <span class="txt"><b>كل الأرصدة في وضع آمن</b>
        <span>لا يوجد صنف نفد أو مهدَّد بالنفاد خلال الفترة القادمة.</span></span></div>`;
}

/** رسم بياني بالـ SVG — بلا مكتبات خارجية. */
function paintChart(series) {
  let points = series || [];
  if (!points.length) { byId("dashChart").innerHTML = `<div class="empty">لا توجد حركة</div>`; return; }

  // فوق شهر: اجمع أسبوعيًا حتى تبقى الأعمدة مقروءة
  if (points.length > 31) {
    const weeks = [];
    for (let i = 0; i < points.length; i += 7) {
      const chunk = points.slice(i, i + 7);
      weeks.push({
        day: chunk[0].day,
        label: `أسبوع ${fmtDate(chunk[0].day)}`,
        in_qty: chunk.reduce((s, p) => s + Number(p.in_qty), 0),
        out_qty: chunk.reduce((s, p) => s + Number(p.out_qty), 0),
      });
    }
    points = weeks;
  }

  const W = 800, H = 200, padB = 26, padT = 10;
  const max = Math.max(1, ...points.map((p) => Math.max(Number(p.in_qty), Number(p.out_qty))));
  const slot = W / points.length;
  const barW = Math.max(2, Math.min(14, slot / 2.6));
  const scale = (v) => (Number(v) / max) * (H - padB - padT);

  const bars = points.map((p, i) => {
    const cx = i * slot + slot / 2;
    const hIn = scale(p.in_qty), hOut = scale(p.out_qty);
    const label = p.label || fmtDate(p.day);
    return `
      <g>
        <title>${esc(label)} — وارد ${fmtNum(p.in_qty)} / صرف ${fmtNum(p.out_qty)}</title>
        <rect x="${(cx - barW - 1).toFixed(1)}" y="${(H - padB - hIn).toFixed(1)}"
              width="${barW}" height="${Math.max(hIn, 0).toFixed(1)}" class="b-in" rx="${(barW / 2).toFixed(1)}"></rect>
        <rect x="${(cx + 1).toFixed(1)}" y="${(H - padB - hOut).toFixed(1)}"
              width="${barW}" height="${Math.max(hOut, 0).toFixed(1)}" class="b-out" rx="${(barW / 2).toFixed(1)}"></rect>
      </g>`;
  }).join("");

  const ticks = [0, 0.5, 1].map((f) => {
    const y = (H - padB) - f * (H - padB - padT);
    return `<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" class="grid"></line>
            <text x="${W - 4}" y="${(y - 3).toFixed(1)}" class="tick" text-anchor="end">${fmtNum(Math.round(max * f))}</text>`;
  }).join("");

  const first = points[0], last = points[points.length - 1];
  byId("dashChart").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="حركة الوارد والصرف">
      ${ticks}${bars}
      <text x="4" y="${H - 8}" class="tick s">${esc(fmtDate(last.day))}</text>
      <text x="${W - 4}" y="${H - 8}" class="tick s" text-anchor="end">${esc(fmtDate(first.day))}</text>
    </svg>`;
}

function paintTrend(mv) {
  const arrow = (v) => (v === null || v === undefined ? ""
    : Number(v) > 0 ? `▲ ${fmtNum(v)}%`
    : Number(v) < 0 ? `▼ ${fmtNum(Math.abs(Number(v)))}%` : "بلا تغيير");
  byId("dashTrend").innerHTML =
    `وارد ${fmtNum(mv.in_now)} وحدة <span class="${Number(mv.in_change) > 0 ? "up" : "down"}">${arrow(mv.in_change)}</span>
     — صرف ${fmtNum(mv.out_now)} وحدة <span class="${Number(mv.out_change) > 0 ? "up" : "down"}">${arrow(mv.out_change)}</span>
     مقارنة بالـ ${period} يومًا السابقة.`;
}

function coverPill(days) {
  if (days === null || days === undefined) return `<span class="pill">—</span>`;
  const cls = days <= 7 ? "zero" : days <= 14 ? "out" : days <= 30 ? "low" : "ok";
  return `<span class="pill ${cls}">${fmtNum(days)} يوم</span>`;
}

/** أصناف رصيدها سالب فعليًا — تحتاج أمر شراء (PR) فوري. */
function paintNegative(showValue) {
  const rows = data.negative_stock || [];
  byId("negativePanel").hidden = rows.length === 0;
  if (!rows.length) return;

  fillTable(byId("negativeBody"), rows.map((r) => `
    <tr>
      <td class="code">${esc(r.code)}</td>
      <td>${esc(r.label)}</td>
      <td class="num center"><b style="color:var(--out,#c0392b)">${fmtNum(r.balance)}</b> ${esc(r.unit)}</td>
      ${showValue ? `<td class="num">${moneyHtml(r.shortfall_value, { blankWhenZero: true })}</td>` : ""}
      <td>${r.voucher_no ? esc(r.voucher_no) : "-"}</td>
      <td>${r.requested_by ? esc(r.requested_by) : "-"}</td>
      <td>${r.requested_at ? fmtDateTime(r.requested_at) : "-"}</td>
      <td><button class="btn ghost small" data-goto="log"
        data-params="${esc(new URLSearchParams({ search: r.code }).toString())}">حركته</button></td>
    </tr>`), showValue ? 8 : 7, "لا توجد أصناف برصيد سالب");

  document.querySelectorAll("#negativePanel [data-col='value']")
    .forEach((n) => { n.hidden = !showValue; });
}

/** تصدير قائمة الأصناف السالبة لإرفاقها بأمر الشراء (PR). */
async function exportNegative() {
  const rows = data?.negative_stock || [];
  if (!rows.length) return toastError("لا توجد أصناف برصيد سالب حاليًا");

  await exportRows(rows.map((r) => ({
    "الكود": r.code,
    "الصنف": r.label,
    "الرصيد": r.balance,
    "الوحدة": r.unit,
    "قيمة العجز": r.shortfall_value,
    "آخر إذن": r.voucher_no || "",
    "بواسطة": r.requested_by || "",
    "التاريخ": r.requested_at ? fmtDateTime(r.requested_at) : "",
    "الجهة / المشروع": r.party || r.project || "",
  })), "أصناف_رصيد_سالب", "PR");
  toast("تم تنزيل ملف Excel");
}

function paintRisk() {
  const rows = data.risk || [];
  byId("riskPanel").hidden = rows.length === 0;
  fillTable(byId("riskBody"), rows.map((r) => `
    <tr>
      <td class="code">${esc(r.code)}</td>
      <td>${esc(r.label)}</td>
      <td class="num center">${fmtNum(r.balance)} ${esc(r.unit)}</td>
      <td class="num center">${fmtNum(r.per_day, 2)}</td>
      <td class="center">${coverPill(r.days_cover)}</td>
      <td><button class="btn ghost small" data-goto="log"
        data-params="${esc(new URLSearchParams({ search: r.code }).toString())}">حركته</button></td>
    </tr>`), 6, "لا يوجد صنف مهدَّد بالنفاد");
}

function paintReorder(showValue) {
  const rows = data.reorder || [];
  byId("reorderPanel").hidden = rows.length === 0;
  fillTable(byId("reorderBody"), rows.map((r) => `
    <tr>
      <td class="code">${esc(r.code)}</td>
      <td>${esc(r.label)}</td>
      <td class="num center">${fmtNum(r.balance)}</td>
      <td class="num center"><b>${fmtNum(r.suggest_qty)}</b> ${esc(r.unit)}</td>
      ${showValue ? `<td class="num">${moneyHtml(r.suggest_value, { blankWhenZero: true })}</td>` : ""}
    </tr>`), showValue ? 5 : 4, "لا توجد أصناف تحتاج توريدًا");

  const total = rows.reduce((s, r) => s + Number(r.suggest_value || 0), 0);
  byId("reorderTotal").textContent = rows.length && showValue
    ? `${fmtNum(rows.length)} صنف — التكلفة التقديرية ${fmtMoney(total)}` : "";
}

function paintBars() {
  const rows = data.top_out || [];
  const max = Math.max(1, ...rows.map((t) => Number(t.qty)));
  byId("dashTopBars").innerHTML = rows.length ? rows.map((t) => `
    <div class="bar-row">
      <div class="bar-track">
        <div class="bar-fill" style="width:${(Number(t.qty) / max * 100).toFixed(1)}%"></div>
        <span class="bar-label">${esc(t.item_name)}</span>
      </div>
      <div class="num">${fmtNum(t.qty)}</div>
    </div>`).join("") : `<div class="empty">لا توجد حركات صرف في هذه الفترة</div>`;
}

function paintProjects() {
  const rows = data.busiest_projects || [];
  const max = Math.max(1, ...rows.map((p) => Number(p.qty)));
  byId("dashProjects").innerHTML = rows.length ? rows.map((p) => `
    <div class="bar-row">
      <div class="bar-track">
        <div class="bar-fill alt" style="width:${(Number(p.qty) / max * 100).toFixed(1)}%"></div>
        <span class="bar-label">${esc(p.project)} — ${fmtNum(p.vouchers)} إذن</span>
      </div>
      <div class="num">${fmtNum(p.qty)}</div>
    </div>`).join("") : `<div class="empty">لا توجد مشاريع بها صرف</div>`;
}

function paintStagnant(showValue) {
  const rows = data.stagnant || [];
  byId("stagnantPanel").hidden = rows.length === 0 || !showValue;
  fillTable(byId("stagnantBody"), rows.map((r) => `
    <tr>
      <td class="code">${esc(r.code)}</td>
      <td>${esc(r.label)}</td>
      <td class="num center">${fmtNum(r.balance)}</td>
      <td>${r.last_out ? fmtDate(r.last_out) : "لم يُصرف مطلقًا"}</td>
      ${showValue ? `<td class="num">${moneyHtml(r.value, { blankWhenZero: true })}</td>` : ""}
    </tr>`), showValue ? 5 : 4, "لا يوجد رصيد راكد");
}

function paintCategories(showValue) {
  fillTable(byId("dashCategoryBody"), (data.by_category || []).map((c) => `
    <tr class="click" data-goto="items"
        data-params="${esc(new URLSearchParams({ category: c.category }).toString())}">
      <td>${esc(c.category)}</td>
      <td class="num center">${fmtNum(c.items)}</td>
      <td class="num center">${fmtNum(c.qty)}</td>
      <td class="center">${Number(c.at_risk) > 0
        ? `<span class="pill low">${fmtNum(c.at_risk)}</span>` : `<span class="pill ok">0</span>`}</td>
      ${showValue ? `<td class="num">${moneyHtml(c.value, { blankWhenZero: true })}</td>` : ""}
    </tr>`), showValue ? 5 : 4, "لا توجد أصناف بعد");
}

function paintRecent() {
  fillTable(byId("dashRecentBody"), (data.recent || []).map((t) => `
    <tr>
      <td><span class="pill ${t.type}">${t.type === "in" ? "وارد" : "صرف"}</span></td>
      <td class="code">${esc(t.voucher_no)}</td>
      <td>${fmtDate(t.txn_date)}</td>
      <td>${esc(t.item_name)}</td>
      <td class="num center">${fmtNum(t.qty)}</td>
      <td>${esc(t.party || t.project || "-")}</td>
      <td>${esc(t.created_by_name || "-")}</td>
    </tr>`), 7, "لم تُسجَّل أي حركة بعد");
}

/* ------------------------- تصدير طلب الشراء ------------------------- */
function reorderRows() {
  const showValue = can("view_pricing");
  return (data?.reorder || []).map((r) => {
    const row = {
      "الكود": r.code, "الصنف": r.label, "الرصيد الحالي": r.balance,
      "الحد الأدنى": r.threshold,
      "يكفي (يوم)": r.days_cover ?? "",
      "الكمية المقترحة": r.suggest_qty, "الوحدة": r.unit,
    };
    if (showValue) {
      row["سعر الوحدة"] = Number(r.unit_price);
      row["التكلفة التقديرية"] = Number(r.suggest_value);
    }
    return row;
  });
}

async function exportReorder() {
  const rows = reorderRows();
  if (!rows.length) return toastError("لا توجد أصناف تحتاج توريدًا");
  await exportRows(rows, "اقتراح_طلب_شراء", "طلب شراء");
  toast("تم تنزيل طلب الشراء");
}

function printReorder() {
  const rows = reorderRows();
  if (!rows.length) return toastError("لا توجد أصناف تحتاج توريدًا");
  const total = (data.reorder || []).reduce((s, r) => s + Number(r.suggest_value || 0), 0);
  printTable({
    title: "اقتراح طلب شراء",
    subtitle: `مبني على متوسط الصرف خلال ٩٠ يومًا — عدد الأصناف: ${rows.length}`,
    headers: Object.keys(rows[0]),
    rows: rows.map((r) => Object.values(r)),
    footer: can("view_pricing") ? `التكلفة التقديرية الإجمالية: ${fmtMoney(total)}` : "",
  });
}