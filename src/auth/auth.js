/** تسجيل الدخول والخروج وجلب بيانات المستخدم. */
import { db, loginDomain, run, translateError, AppError, makeTempClient } from "../data/client.js";
import { set, get, clearCache } from "../core/store.js";

/** اسم المستخدم يتحوّل داخليًا إلى بريد حتى يعمل نظام Supabase Auth. */
export const toEmail = (username) =>
  String(username).includes("@") ? String(username).trim()
                                 : `${String(username).trim().toLowerCase()}@${loginDomain()}`;

export async function signIn(username, password) {
  const { data, error } = await db().auth.signInWithPassword({
    email: toEmail(username), password,
  });
  if (error) throw translateError(error);
  const profile = await loadProfile(data.user.id);
  if (!profile) throw new AppError("لا يوجد ملف مستخدم مرتبط بهذا الحساب. راجع مدير النظام.", "NO_PROFILE");
  if (!profile.is_active) {
    await db().auth.signOut();
    throw new AppError("هذا الحساب موقوف. راجع مدير النظام.", "INACTIVE");
  }
  set({ session: data.session, profile });
  return profile;
}

export async function signOut() {
  try { await db().auth.signOut(); } finally {
    clearCache();
    set({ session: null, profile: null, items: [], summary: null });
  }
}

export async function loadProfile(userId) {
  const rows = await run(db().from("profiles").select("*").eq("id", userId).limit(1));
  return rows?.[0] || null;
}

/** يستعيد الجلسة المحفوظة عند فتح الصفحة (لا يحتاج تسجيل دخول كل مرة). */
export async function restoreSession() {
  const { data } = await db().auth.getSession();
  if (!data?.session) return null;
  const profile = await loadProfile(data.session.user.id);
  if (!profile || !profile.is_active) { await signOut(); return null; }
  set({ session: data.session, profile });
  return profile;
}

export async function changePassword(newPassword) {
  const { error } = await db().auth.updateUser({ password: newPassword });
  if (error) throw translateError(error);
}

/** إنشاء مستخدم جديد (يُستدعى من شاشة الإعدادات — المدير فقط). */
export async function createUser({ username, fullName, password, role }) {
  // عميل منفصل حتى لا يُستبدَل تسجيل دخول المدير الحالي بالمستخدم الجديد
  const temp = makeTempClient();
  const { data, error } = await temp.auth.signUp({
    email: toEmail(username),
    password,
    options: { data: { username, full_name: fullName, role } },
  });
  if (error) throw translateError(error);
  return data.user;
}

export const currentUser = () => get("profile");
