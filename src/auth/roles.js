/**
 * الصلاحيات في الواجهة — نسخة مطابقة لدالة can() في قاعدة البيانات.
 * الواجهة تخفي الأزرار، وقاعدة البيانات هي التي تمنع فعليًا.
 */
import { get } from "../core/store.js";

export const ROLES = {
  admin:          "مدير النظام",
  deputy_manager: "نائب مدير المخزن",
  accountant:     "محاسب",
  staff:          "أمين مخزن",
  viewer:         "مُطّلع",
};

const MATRIX = {
  manage_items:   ["admin", "deputy_manager"],
  edit_price:     ["admin", "deputy_manager", "accountant"],
  create_voucher: ["admin", "deputy_manager", "staff"],
  delete_voucher: ["admin", "accountant"],
  stocktake:      ["admin", "deputy_manager"],
  manage_users:   ["admin"],
  view_pricing:   ["admin", "deputy_manager", "accountant"],
  view_audit:     ["admin", "accountant"],
};

export const role = () => get("profile")?.role || "viewer";
export const roleLabel = (r = role()) => ROLES[r] || r;
export const can = (action) => (MATRIX[action] || []).includes(role());
