/** تنسيق التواريخ والأرقام والعملة. */
import { APP } from "../config.js";

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function fmtDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

export function fmtNum(value, digits = 0) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

export function fmtMoney(value) {
  return `${fmtNum(value, 2)} ${APP.currency}`;
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
