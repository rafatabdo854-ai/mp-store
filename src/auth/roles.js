/**
 * الصلاحيات في الواجهة — تُقرأ من قاعدة البيانات لا من قائمة ثابتة.
 *
 * عند الدخول تُحمَّل صلاحيات المستخدم من my_permissions() وأسماء الأدوار
 * من جدول roles، فتخفي الواجهة ما تمنعه سياسات RLS بالضبط، ولا يحدث أن
 * يظهر زر يرفضه الخادم.
 *
 * الواجهة تخفي، وقاعدة البيانات هي التي تمنع فعليًا.
 */
import { get, set } from "../core/store.js";

/**
 * مصفوفة احتياطية = نفس التوزيع الأصلي قبل نقل الصلاحيات للجداول.
 * تُستخدم فقط إذا تعذّر تحميل الصلاحيات (شبكة منقطعة، أو 09_permissions.sql
 * لم يُشغَّل بعد). بدونها يفقد كل مستخدم كل صلاحياته عند أول عطل شبكة،
 * وهو أسوأ من التوزيع القديم بمراحل.
 */
const FALLBACK = {
  admin:          ["manage_items", "edit_price", "view_pricing", "create_voucher",
                   "delete_voucher", "stocktake", "accounting", "view_audit", "manage_users"],
  deputy_manager: ["manage_items", "edit_price", "view_pricing", "create_voucher", "stocktake"],
  accountant:     ["edit_price", "view_pricing", "delete_voucher", "accounting", "view_audit"],
  staff:          ["create_voucher"],
  viewer:         [],
};

/** أسماء الأدوار المعروضة. كائن حيّ: تُملأ مفاتيحه عند التحميل،
 *  فمن يقرأه بـ Object.entries وقت العرض يرى أحدث قائمة. */
export const ROLES = {
  admin: "مدير النظام",
  deputy_manager: "نائب مدير المخزن",
  accountant: "محاسب",
  staff: "أمين مخزن",
  viewer: "مُطّلع",
};

export const role = () => get("profile")?.role || "viewer";
export const roleLabel = (r = role()) => ROLES[r] || r;

/** صلاحيات المستخدم الحالي — المحمّلة، أو الاحتياطية إن تعذّر التحميل. */
export function myPermissions() {
  const loaded = get("myPermissions");
  if (Array.isArray(loaded)) return loaded;
  return FALLBACK[role()] || [];
}

/**
 * صلاحية الوارد/الصرف لكل مستخدم (profiles.can_receive / can_issue)
 * فوق صلاحية الدور create_voucher. القيمة الغائبة تُعامل كمسموح حتى لا
 * يُقفل أحد قبل تشغيل ترحيل قاعدة البيانات — والخادم هو من يمنع فعليًا.
 */
export function canVoucher(type) {
  if (!myPermissions().includes("create_voucher")) return false;
  const flag = type === "in" ? "can_receive" : "can_issue";
  return get("profile")?.[flag] !== false;
}

/** صلاحيتا voucher_in / voucher_out مشتقّتان لا تُخزَّنان في الجداول. */
export const can = (action) => {
  if (action === "voucher_in")  return canVoucher("in");
  if (action === "voucher_out") return canVoucher("out");
  // رؤية الأسعار: صلاحية الدور + مفتاح المستخدم profiles.can_view_price
  if (action === "view_pricing") {
    return myPermissions().includes("view_pricing") && get("profile")?.can_view_price !== false;
  }
  return myPermissions().includes(action);
};

/** تُستدعى من main.js بعد الدخول. تفشل بهدوء وتترك المصفوفة الاحتياطية. */
export function applyPermissions(list) {
  if (Array.isArray(list)) set({ myPermissions: list });
}

/** تحديث أسماء الأدوار من جدول roles. */
export function applyRoles(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  for (const key of Object.keys(ROLES)) delete ROLES[key];
  for (const r of rows) ROLES[r.code] = r.label;
  set({ roleList: rows });
}

/** قائمة الأدوار مرتبة — للقوائم المنسدلة. */
export function roleOptions() {
  const rows = get("roleList");
  if (Array.isArray(rows) && rows.length) return rows;
  return Object.entries(ROLES).map(([code, label]) => ({ code, label }));
}
