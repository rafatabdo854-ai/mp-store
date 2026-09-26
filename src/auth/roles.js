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
// ما كان متاحًا للجميع قبل الصلاحيات التفصيلية (22_granular_permissions.sql)
const BASIC = ["view_dashboard", "view_log", "view_log_in", "view_log_out", "view_reports",
  "report_movement", "report_project", "report_top", "report_low",
  "print_vouchers", "export_items", "print_items", "export_log", "print_log",
  "export_reports", "print_reports", "export_dashboard", "backup_data",
  "view_suppliers", "view_projects", "export_suppliers", "export_projects"];
const VOUCHERS = ["voucher_in", "voucher_out", "add_supplier", "add_project"];
const ITEMS    = ["add_item", "manage_items", "add_category", "recalc_balances",
  "edit_supplier", "block_supplier", "edit_project", "block_project"];
const PRICING  = ["view_pricing", "export_pricing", "print_pricing"];
const ACCOUNT  = ["accounting", "export_accounting", "print_accounting"];

const FALLBACK = {
  admin:          [...BASIC, ...VOUCHERS, ...ITEMS, ...PRICING, ...ACCOUNT, "edit_price",
                   "delete_voucher", "stocktake", "view_audit", "export_audit", "manage_users",
                   "delete_supplier", "delete_project"],
  deputy_manager: [...BASIC, ...VOUCHERS, ...ITEMS, ...PRICING, "edit_price", "stocktake"],
  accountant:     [...BASIC, ...PRICING, ...ACCOUNT, "edit_price", "delete_voucher",
                   "view_audit", "export_audit"],
  staff:          [...BASIC, ...VOUCHERS],
  viewer:         [...BASIC],
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
 * كل صلاحية تأتي جاهزة من my_permissions(): تخصيص المستخدم (سماح/منع)
 * فوق صلاحيات دوره — محسوبة في قاعدة البيانات بنفس منطق can() هناك.
 * create_voucher مشتقّة: وارد أو صرف.
 */
export const can = (action) => {
  const list = myPermissions();
  if (action === "voucher_in")  return canVoucher("in");
  if (action === "voucher_out") return canVoucher("out");
  if (action === "create_voucher") {
    return list.includes("create_voucher") || list.includes("voucher_in") || list.includes("voucher_out");
  }
  return list.includes(action);
};

/** صلاحية نوع الإذن: in = voucher_in ، out = voucher_out */
export function canVoucher(type) {
  const list = myPermissions();
  // قبل تشغيل 22_granular_permissions.sql كانت هناك صلاحية واحدة للنوعين
  if (!list.includes("voucher_in") && !list.includes("voucher_out")) {
    return list.includes("create_voucher");
  }
  return list.includes(type === "in" ? "voucher_in" : "voucher_out");
}

/** يُخفي عنصرًا لا يملك المستخدم صلاحيته (إن وُجد العنصر). */
export function gate(node, action) {
  if (node) node.hidden = !can(action);
}

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
