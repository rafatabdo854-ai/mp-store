/**
 * طبقة التحقق من المدخلات.
 * تعمل على شكل قواعد صغيرة قابلة للتركيب، ونفس القواعد
 * مطبَّقة أيضًا في قاعدة البيانات (constraints + triggers) كخط دفاع ثانٍ.
 */
import { todayISO, toInt, toNum } from "./format.js";

export const rules = {
  required: (msg = "هذا الحقل مطلوب") => (v) =>
    (v === null || v === undefined || String(v).trim() === "") ? msg : null,

  minLen: (n, msg) => (v) =>
    String(v ?? "").trim().length < n ? (msg || `أدخل ${n} أحرف على الأقل`) : null,

  maxLen: (n, msg) => (v) =>
    String(v ?? "").length > n ? (msg || `الحد الأقصى ${n} حرفًا`) : null,

  intMin: (n, msg) => (v) =>
    toInt(v, NaN) < n || Number.isNaN(toInt(v, NaN))
      ? (msg || `أدخل رقمًا صحيحًا لا يقل عن ${n}`) : null,

  numMin: (n, msg) => (v) =>
    !Number.isFinite(toNum(v, NaN)) || toNum(v, NaN) < n
      ? (msg || `أدخل رقمًا لا يقل عن ${n}`) : null,

  positiveInt: (msg = "الكمية يجب أن تكون رقمًا صحيحًا أكبر من صفر") => (v) => {
    const n = toInt(v, NaN);
    return (!Number.isFinite(n) || n <= 0) ? msg : null;
  },

  date: (msg = "أدخل تاريخًا صحيحًا") => (v) =>
    (!v || Number.isNaN(new Date(v).getTime())) ? msg : null,

  notFuture: (msg = "التاريخ لا يمكن أن يكون في المستقبل") => (v) =>
    (v && v > todayISO()) ? msg : null,

  /** لا يسمح بتكرار قيمة داخل قائمة موجودة (مثل كود الصنف). */
  unique: (list, msg = "القيمة مستخدمة بالفعل") => (v) =>
    list.some((x) => String(x).trim().toLowerCase() === String(v).trim().toLowerCase())
      ? msg : null,

  username: (msg = "اسم المستخدم: حروف إنجليزية وأرقام و_ فقط") => (v) =>
    /^[a-zA-Z0-9_.-]{3,32}$/.test(String(v ?? "").trim()) ? null : msg,
};

/**
 * يتحقق من كائن كامل.
 * @param {object} values  القيم
 * @param {object} schema  { field: [rule, rule...] }
 * @returns {{ok:boolean, errors:Record<string,string>, first:string|null}}
 */
export function validate(values, schema) {
  const errors = {};
  for (const [field, list] of Object.entries(schema)) {
    for (const rule of list) {
      const msg = rule(values[field], values);
      if (msg) { errors[field] = msg; break; }
    }
  }
  const keys = Object.keys(errors);
  return { ok: keys.length === 0, errors, first: keys.length ? errors[keys[0]] : null };
}

/** يعرض الأخطاء بجانب الحقول ويعيد التركيز لأول حقل خاطئ. */
export function paintErrors(formRoot, errors) {
  formRoot.querySelectorAll("[data-field]").forEach((input) => {
    const name = input.dataset.field;
    const holder = formRoot.querySelector(`[data-error-for="${name}"]`);
    const msg = errors[name];
    input.classList.toggle("invalid", Boolean(msg));
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (holder) holder.textContent = msg || "";
  });
  const firstKey = Object.keys(errors)[0];
  if (firstKey) formRoot.querySelector(`[data-field="${firstKey}"]`)?.focus();
}

export function clearErrors(formRoot) {
  paintErrors(formRoot, {});
}
