/** تنسيق التواريخ والأرقام والعملة. */
import { APP } from "../config.js";

// لغة العرض تُقرأ من الصفحة لا من متغيّر محلّي: i18n يضبط lang على
// عنصر html، فيتبعه التنسيق تلقائيًا دون استيراد متبادل بين الوحدتين.
const locale = () =>
  (document.documentElement.getAttribute("lang") === "en" ? "en-GB" : "ar-EG");

const currency = () =>
  (document.documentElement.getAttribute("lang") === "en" ? "EGP" : APP.currency);

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(locale(), { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function fmtDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
}

export function fmtNum(value, digits = 0) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

export function fmtMoney(value) {
  return `${fmtNum(value, 2)} ${currency()}`;
}

/** ما يُعرض مكان قيمة لم تُدخل بعد. */
export const EMPTY = "—";

/**
 * مبلغ للعرض داخل الواجهة: الرقم أحادي المسافة والوحدة أصغر ومكتومة.
 *
 * `blankWhenZero` للأعمدة التي يكون فيها الصفر معناه "لم نُدخل السعر"
 * لا "السعر صفر" — التسعير وقيمة الرصيد. الخلط بين الحالتين يجعل
 * تقرير قيمة المخزون يبدو صحيحًا وهو ناقص.
 *
 * تُعيد HTML، فتُستعمل داخل قالب لا مع textContent.
 */
export function moneyHtml(value, { blankWhenZero = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || (blankWhenZero && n === 0)) {
    return `<span class="val-none">${EMPTY}</span>`;
  }
  return `<span class="val${n < 0 ? " neg" : ""}">` +
         `<span class="val-n">${fmtNum(n, 2)}</span>` +
         `<span class="val-u">${currency()}</span></span>`;
}

/**
 * نفس القاعدة لكن كنص عادي، للمواضع التي تُمرَّر عبر esc أو تذهب
 * إلى تصدير أو طباعة أو رسالة — حيث لا يصلح HTML.
 */
export function moneyText(value, { blankWhenZero = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || (blankWhenZero && n === 0)) return EMPTY;
  return `${fmtNum(n, 2)} ${currency()}`;
}

/** عدد بلا وحدة، بنفس قواعد العرض أعلاه. */
export function numHtml(value, { digits = 0, blankWhenZero = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || (blankWhenZero && n === 0)) {
    return `<span class="val-none">${EMPTY}</span>`;
  }
  return `<span class="val${n < 0 ? " neg" : ""}">` +
         `<span class="val-n">${fmtNum(n, digits)}</span></span>`;
}

export const toInt = (v, def = 0) => {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
};

export const toNum = (v, def = 0) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : def;
};

export const itemLabel = (item) =>
  [item?.brand, item?.name].filter(Boolean).join(" ") || item?.code || "-";

export const itemFullLabel = (item) =>
  `${item?.code ?? ""} — ${itemLabel(item)}${item?.spec ? ` (${item.spec})` : ""}`;

/** ترتيب عربي صحيح للأسماء. */
export const arSort = (a, b) => String(a).localeCompare(String(b), "ar");
