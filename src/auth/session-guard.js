/**
 * حارس الجلسة: إنهاء تلقائي عند عدم النشاط، وسقف أقصى لعمر الجلسة.
 *
 * - خمول: تسجيل خروج تلقائي بعد IDLE_LIMIT_MS بدون أي حركة فأرة/لوحة مفاتيح/لمس.
 * - تحذير: نافذة عدّ تنازلي قبل الخمول بـ WARNING_MS، مع زر "تمديد الجلسة".
 * - سقف الجلسة: تسجيل خروج إجباري بعد MAX_SESSION_MS من وقت الدخول، حتى لو كان
 *   المستخدم نشطًا طوال الوقت (يحدّ من خطر جلسة مفتوحة لفترة طويلة جدًا على
 *   جهاز قد يُترك دون إشراف، أو من محاولة إبقاء الجلسة حيّة بشكل غير طبيعي).
 * - تزامن بين التبويبات: خروج في تبويب يُغلق كل التبويبات المفتوحة لنفس المتصفح،
 *   ونشاط في أي تبويب يُبقي الجميع نشطًا (بدل أن يُنهي تبويب "القراءة" الجلسة
 *   بينما المستخدم يعمل فعليًا في تبويب آخر).
 */
import { signOut, currentUser } from "./auth.js";
import { openModal } from "../core/ui.js";

const IDLE_LIMIT_MS   = 30 * 60 * 1000;   // 30 دقيقة خمول
const WARNING_MS      = 60 * 1000;        // تحذير قبل الخروج بدقيقة واحدة
const MAX_SESSION_MS  = 12 * 60 * 60 * 1000; // 12 ساعة سقف مطلق للجلسة

const LS_LAST_ACTIVITY = "mpstore.lastActivity";
const LS_LOGIN_AT      = "mpstore.loginAt";
const LS_LOGOUT_SIGNAL = "mpstore.logoutSignal";

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "wheel", "scroll"];

let idleTimer = null;
let warnTimer = null;
let maxTimer  = null;
let warningModal = null;
let started = false;
let onExpire = () => {};

/** يُستدعى مرة واحدة بعد نجاح الدخول (أو استعادة الجلسة). */
export function startSessionGuard(expireHandler) {
  onExpire = expireHandler || (() => location.reload());
  if (started) { resetIdleTimer(); return; }
  started = true;

  if (!localStorage.getItem(LS_LOGIN_AT)) {
    localStorage.setItem(LS_LOGIN_AT, String(Date.now()));
  }

  ACTIVITY_EVENTS.forEach((evt) =>
    document.addEventListener(evt, onLocalActivity, { passive: true }));

  // مستمع تبويبات أخرى: نشاط أو خروج في تبويب آخر ينعكس هنا فورًا
  window.addEventListener("storage", onStorageEvent);

  resetIdleTimer();
  armMaxSessionTimer();
}

/** يُستدعى عند تسجيل الخروج اليدوي حتى تُنظَّف المؤقّتات ومفاتيح التخزين. */
export function stopSessionGuard() {
  started = false;
  clearTimeout(idleTimer); clearTimeout(warnTimer); clearTimeout(maxTimer);
  ACTIVITY_EVENTS.forEach((evt) => document.removeEventListener(evt, onLocalActivity));
  window.removeEventListener("storage", onStorageEvent);
  closeWarning();
  localStorage.removeItem(LS_LOGIN_AT);
  localStorage.removeItem(LS_LAST_ACTIVITY);
}

function onLocalActivity() {
  if (!started || warningModal) return; // نتجاهل الحركة أثناء عرض تحذير الخروج
  const now = Date.now();
  localStorage.setItem(LS_LAST_ACTIVITY, String(now));
  resetIdleTimer();
}

function onStorageEvent(e) {
  if (e.key === LS_LOGOUT_SIGNAL && e.newValue) {
    // خرج المستخدم من تبويب آخر — أغلق هذا التبويب فورًا دون استدعاء signOut مجددًا
    closeWarning();
    onExpire("logout-elsewhere");
  }
  if (e.key === LS_LAST_ACTIVITY && e.newValue && !warningModal) {
    resetIdleTimer();
  }
}

function resetIdleTimer() {
  clearTimeout(idleTimer); clearTimeout(warnTimer);
  warnTimer = setTimeout(showWarning, IDLE_LIMIT_MS - WARNING_MS);
  idleTimer = setTimeout(() => expireSession("idle"), IDLE_LIMIT_MS);
}

function armMaxSessionTimer() {
  const loginAt = Number(localStorage.getItem(LS_LOGIN_AT) || Date.now());
  const remaining = MAX_SESSION_MS - (Date.now() - loginAt);
  clearTimeout(maxTimer);
  if (remaining <= 0) { expireSession("max"); return; }
  maxTimer = setTimeout(() => expireSession("max"), remaining);
}

function showWarning() {
  if (warningModal) return;
  let secondsLeft = Math.round(WARNING_MS / 1000);
  const countEl = { current: null };

  warningModal = openModal({
    title: "الجلسة على وشك الانتهاء",
    bodyHtml: `
      <p>لم يُسجَّل أي نشاط منذ فترة. سيتم تسجيل الخروج تلقائيًا خلال
        <b id="idleCountdown">${secondsLeft}</b> ثانية لحماية حسابك.</p>`,
    actions: [
      {
        label: "تمديد الجلسة",
        onClick: (root, close) => {
          close();
          warningModal = null;
          onLocalActivityForce();
        },
      },
    ],
  });

  countEl.current = warningModal.root.querySelector("#idleCountdown");
  const tick = setInterval(() => {
    secondsLeft -= 1;
    if (countEl.current) countEl.current.textContent = String(Math.max(secondsLeft, 0));
    if (secondsLeft <= 0) clearInterval(tick);
  }, 1000);

  // هذا التحذير مقصود منه إجبار قرار صريح: تمديد أو خروج تلقائي عند انتهاء
  // العدّ. لا نسمح بإغلاقه بالنقر خارج النافذة أو بزر "إغلاق" العام حتى لا
  // يظنّ المستخدم أن الجلسة مُدِّدت بينما هي لم تُمدَّد فعليًا.
  const root = warningModal.root;
  root.onclick = (e) => { if (e.target === root) e.stopPropagation(); };
  const closeBtn = root.querySelector("[data-close]");
  if (closeBtn) closeBtn.remove();

  root.classList.add("session-warning");
}

function onLocalActivityForce() {
  const now = Date.now();
  localStorage.setItem(LS_LAST_ACTIVITY, String(now));
  resetIdleTimer();
}

function closeWarning() {
  if (warningModal) { warningModal.close(); warningModal = null; }
}

async function expireSession(reason) {
  if (!started) return;
  started = false;
  clearTimeout(idleTimer); clearTimeout(warnTimer); clearTimeout(maxTimer);
  closeWarning();

  // إشارة لباقي التبويبات حتى تُغلق نفسها دون كل واحدة تستدعي signOut على حدة
  try { localStorage.setItem(LS_LOGOUT_SIGNAL, String(Date.now())); } catch { /* تجاهل */ }

  try { await signOut(); } catch { /* المستخدم يخرج بأي حال */ }

  onExpire(reason);
}

/** للاستخدام في شاشة "معلومات الجلسة" إن رغبت بعرضها لاحقًا. */
export function sessionInfo() {
  const loginAt = Number(localStorage.getItem(LS_LOGIN_AT) || 0);
  return {
    user: currentUser(),
    loginAt,
    maxExpiresAt: loginAt ? loginAt + MAX_SESSION_MS : null,
    idleLimitMs: IDLE_LIMIT_MS,
  };
}