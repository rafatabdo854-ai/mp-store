/** تسجيل الدخول والخروج وجلب بيانات المستخدم. */
import { db, loginDomain, run, translateError, AppError } from "../data/client.js";
import { resolveConfig } from "../config.js";
import { set, get, clearCache } from "../core/store.js";

/** اسم المستخدم يتحوّل داخليًا إلى بريد حتى يعمل نظام Supabase Auth. */
export const toEmail = (username) =>
  String(username).includes("@") ? String(username).trim()
                                 : `${String(username).trim().toLowerCase()}@${loginDomain()}`;

/* ------------------------------------------------------------
 * حماية من محاولات الدخول المتكررة (Brute-force) على مستوى المتصفح.
 * هذه طبقة أولى فقط لإبطاء أي محاولة تخمين آلية من نفس الجهاز؛
 * الحماية الحقيقية يجب ضبطها من Supabase Dashboard > Authentication > Rate Limits
 * لأن القفل هنا محلي بالمتصفح ولا يمنع مهاجمًا يغيّر جهازه أو يمسح localStorage.
 * ------------------------------------------------------------ */
const LOCK_KEY = "mpstore.loginLock";
const MAX_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 10 * 60 * 1000;   // نافذة عدّ المحاولات: 10 دقائق
const LOCK_DURATION_MS = 5 * 60 * 1000;  // مدة القفل بعد تجاوز الحد: 5 دقائق

function readLock() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "null"); }
  catch { return null; }
}
function writeLock(state) {
  try { localStorage.setItem(LOCK_KEY, JSON.stringify(state)); } catch { /* تجاهل */ }
}

/** يرمي خطأً إن كان الحساب مقفولًا مؤقّتًا؛ وإلا لا يفعل شيئًا. */
function assertNotLocked() {
  const lock = readLock();
  if (!lock) return;
  const now = Date.now();
  if (lock.until && now < lock.until) {
    const secondsLeft = Math.ceil((lock.until - now) / 1000);
    throw new AppError(
      `تم إيقاف محاولات الدخول مؤقتًا بسبب محاولات فاشلة متكررة. حاول بعد ${secondsLeft} ثانية.`,
      "LOCKED"
    );
  }
  if (lock.until && now >= lock.until) writeLock(null); // انتهى القفل — تنظيف
}

function recordFailedAttempt() {
  const now = Date.now();
  const lock = readLock() || { count: 0, windowStart: now, until: null };
  if (now - lock.windowStart > LOCK_WINDOW_MS) {
    lock.count = 0;
    lock.windowStart = now;
  }
  lock.count += 1;
  if (lock.count >= MAX_ATTEMPTS) {
    lock.until = now + LOCK_DURATION_MS;
  }
  writeLock(lock);
}

function clearLoginLock() { writeLock(null); }

export async function signIn(username, password) {
  assertNotLocked(); // قفل محلي سريع (تجربة مستخدم أفضل، لا يُعتمد عليه وحده)

  const cleanUsername = String(username).trim().toLowerCase();

  // القفل الحقيقي مصدره الخادم: مرتبط باسم المستخدم ومصدر الطلب معًا،
  // فيعمل حتى لو مسح المهاجم بيانات المتصفح، ولا يمكّنه في الوقت نفسه
  // من إقفال حساب شخص آخر من جهازه هو (راجع sql/18_login_guard_ip.sql).
  try {
    const { data: locked } = await db().rpc("is_locked", { p_username: cleanUsername });
    if (locked) {
      throw new AppError("محاولات الدخول من هذا الجهاز موقوفة مؤقتًا. حاول بعد قليل.", "LOCKED");
    }
  } catch (err) {
    if (err instanceof AppError && err.code === "LOCKED") throw err;
    // فشل التحقق من القفل (مثلاً دالة is_locked غير مُنشأة بعد) — نكمل، لأن
    // القفل المحلي أعلاه ما زال يوفّر حدًّا أدنى من الحماية.
  }

  const { data, error } = await db().auth.signInWithPassword({
    email: toEmail(username), password,
  });
  if (error) {
    recordFailedAttempt();
    try { await db().rpc("register_failed_login", { p_username: cleanUsername }); } catch { /* تجاهل */ }
    throw translateError(error);
  }
  const profile = await loadProfile(data.user.id);
  if (!profile) {
    await db().auth.signOut();
    throw new AppError("لا يوجد ملف مستخدم مرتبط بهذا الحساب. راجع مدير النظام.", "NO_PROFILE");
  }
  if (!profile.is_active) {
    await db().auth.signOut();
    throw new AppError("هذا الحساب موقوف. راجع مدير النظام.", "INACTIVE");
  }
  clearLoginLock();
  try { await db().rpc("clear_failed_logins", { p_user_id: profile.id }); } catch { /* تجاهل */ }
  markLoginNow();
  set({ session: data.session, profile });
  return profile;
}

export async function signOut() {
  try { await db().auth.signOut(); } finally {
    clearCache();
    clearLoginAt();
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
  // جلسة مُستعادة (تحديث صفحة) ولم يُسجَّل وقت دخول محليًا بعد — سجّله الآن
  // حتى يعمل سقف الجلسة القصوى بشكل صحيح، بدل أن يُمنح المستخدم 12 ساعة جديدة
  // في كل مرة يُحدّث فيها الصفحة.
  if (!localStorage.getItem(LOGIN_AT_KEY)) markLoginNow();
  set({ session: data.session, profile });
  return profile;
}

export async function changePassword(newPassword) {
  const { error } = await db().auth.updateUser({ password: newPassword });
  if (error) throw translateError(error);
}

/**
 * إنشاء مستخدم جديد — عبر دالة على الخادم، لا signUp من المتصفح.
 *
 * كان الإنشاء يتم بمفتاح anon وتُرسل معه role داخل الميتاداتا، وهي
 * بيانات يملك العميل تغييرها، فكان أي طلب signUp قادرًا على منح صاحبه
 * دور admin. الآن الدور يُكتب على الخادم بعد التأكد من أن الطالب يملك
 * manage_users فعلًا (راجع supabase/functions/create-user/index.ts).
 */
export async function createUser({ username, fullName, password, role }) {
  const { data: { session } } = await db().auth.getSession();
  if (!session) throw new AppError("انتهت الجلسة. سجّل الدخول من جديد.", "AUTH");

  const { url } = resolveConfig();
  let res;
  try {
    res = await fetch(`${url}/functions/v1/create-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ username, fullName, password, role }),
    });
  } catch {
    throw new AppError("تعذّر الوصول إلى الخادم. تأكد من الاتصال.", "NETWORK");
  }

  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) {
      throw new AppError("دالة إنشاء المستخدمين غير منشورة بعد على الخادم.", "NOT_DEPLOYED");
    }
    throw new AppError(out.error || "تعذّر إنشاء الحساب", "CREATE_USER");
  }
  return out;
}

/* ---------- وقت بدء الجلسة (يستخدمه session-guard لسقف الـ 12 ساعة) ---------- */
const LOGIN_AT_KEY = "mpstore.loginAt";
function markLoginNow() {
  try { localStorage.setItem(LOGIN_AT_KEY, String(Date.now())); } catch { /* تجاهل */ }
}
function clearLoginAt() {
  try { localStorage.removeItem(LOGIN_AT_KEY); } catch { /* تجاهل */ }
}

export const currentUser = () => get("profile");
export async function signOut() {
  try { await db().auth.signOut(); } finally {
    clearCache();
    clearLoginAt();
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
  // جلسة مُستعادة (تحديث صفحة) ولم يُسجَّل وقت دخول محليًا بعد — سجّله الآن
  // حتى يعمل سقف الجلسة القصوى بشكل صحيح، بدل أن يُمنح المستخدم 12 ساعة جديدة
  // في كل مرة يُحدّث فيها الصفحة.
  if (!localStorage.getItem(LOGIN_AT_KEY)) markLoginNow();
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

/* ---------- وقت بدء الجلسة (يستخدمه session-guard لسقف الـ 12 ساعة) ---------- */
const LOGIN_AT_KEY = "mpstore.loginAt";
function markLoginNow() {
  try { localStorage.setItem(LOGIN_AT_KEY, String(Date.now())); } catch { /* تجاهل */ }
}
function clearLoginAt() {
  try { localStorage.removeItem(LOGIN_AT_KEY); } catch { /* تجاهل */ }
}

export const currentUser = () => get("profile");
