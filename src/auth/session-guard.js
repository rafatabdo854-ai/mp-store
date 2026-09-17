// حارس الجلسة: إنهاء تلقائي عند الخمول، وسقف أقصى لعمر الجلسة.
//
// المبدأ الأساسي: لا نعتمد على مؤقّتات setTimeout طويلة، لأن المتصفح يبطّئها
// في التبويبات الخلفية ويوقفها تمامًا عند سبات الجهاز. بدلًا من ذلك ننبض كل
// CHECK_EVERY_MS ونقارن الوقت الفعلي (Date.now) بآخر نشاط مسجَّل — فيصحّ
// الحساب مهما نام الجهاز أو أُخفي التبويب.
//
// - خمول: خروج تلقائي بعد IDLE_LIMIT_MS بدون حركة فأرة/لوحة مفاتيح/لمس.
// - تحذير: عدّ تنازلي قبل الخروج بـ WARNING_MS مع زر "تمديد الجلسة".
// - سقف الجلسة: خروج إجباري بعد MAX_SESSION_MS من وقت الدخول مهما كان النشاط.
// - عند فتح الصفحة: تُفحص الجلسة المستعادة قبل الدخول (isSessionStale)، فلا
//   يعود المستخدم لجلسة تُركت مفتوحة أمس لمجرد أنه أغلق المتصفح وفتحه.
// - تزامن التبويبات: خروج في تبويب يُغلق الباقي، ونشاط في أي تبويب يُبقي الجميع.

import { signOut, currentUser } from "./auth.js";
import { openModal } from "../core/ui.js";

const IDLE_LIMIT_MS  = 30 * 60 * 1000;        // 30 دقيقة خمول
const WARNING_MS     = 60 * 1000;             // تحذير قبل الخروج بدقيقة
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;   // 12 ساعة سقف مطلق
const CHECK_EVERY_MS = 15 * 1000;             // نبضة الفحص
const WRITE_EVERY_MS = 10 * 1000;             // أقصى تكرار لكتابة "آخر نشاط"

const LS_LAST_ACTIVITY = "mpstore.lastActivity";
const LS_LOGIN_AT      = "mpstore.loginAt";
const LS_LOGOUT_SIGNAL = "mpstore.logoutSignal";
const LS_EXPIRY_REASON = "mpstore.expiredReason";

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "wheel", "scroll"];

const REASON_TEXT = {
  idle: "انتهت الجلسة تلقائيًا بسبب عدم النشاط.",
  max: "انتهت مدة الجلسة القصوى. سجّل الدخول من جديد.",
  "logout-elsewhere": "تم تسجيل الخروج من نافذة أخرى.",
};

let heartbeat = null;
let countdown = null;
let warningModal = null;
let channel = null;
let lastWrite = 0;
let started = false;
let onExpire = () => {};

const num = (key) => Number(localStorage.getItem(key) || 0);

function writeActivity(now = Date.now(), force = false) {
  // خنق الكتابة: mousemove يتكرر مئات المرات في الدقيقة
  if (!force && now - lastWrite < WRITE_EVERY_MS) return;
  lastWrite = now;
  try { localStorage.setItem(LS_LAST_ACTIVITY, String(now)); } catch (e) {}
  if (channel) channel.postMessage({ type: "activity", at: now });
}

// هل الجلسة المحفوظة منتهية فعليًا؟ تُستدعى عند فتح الصفحة قبل الدخول.
// ترجع false أو "idle" أو "max".
export function isSessionStale() {
  const now = Date.now();
  const loginAt = num(LS_LOGIN_AT);
  const lastActivity = num(LS_LAST_ACTIVITY);
  if (loginAt && now - loginAt >= MAX_SESSION_MS) return "max";
  if (lastActivity && now - lastActivity >= IDLE_LIMIT_MS) return "idle";
  return false;
}

// يسجّل سبب انتهاء الجلسة ليُعرض على شاشة الدخول بعد إعادة التحميل.
export function markExpiry(reason) {
  try { localStorage.setItem(LS_EXPIRY_REASON, reason); } catch (e) {}
}

// يقرأ سبب آخر انتهاء ويمسحه (يُقرأ مرة واحدة فقط).
export function takeExpiryReason() {
  const reason = localStorage.getItem(LS_EXPIRY_REASON);
  if (!reason) return null;
  localStorage.removeItem(LS_EXPIRY_REASON);
  return REASON_TEXT[reason] || null;
}

// يُستدعى مرة واحدة بعد نجاح الدخول أو استعادة الجلسة.
export function startSessionGuard(expireHandler) {
  onExpire = expireHandler || (() => location.reload());
  if (started) { writeActivity(Date.now(), true); return; }
  started = true;

  if (!num(LS_LOGIN_AT)) localStorage.setItem(LS_LOGIN_AT, String(Date.now()));
  writeActivity(Date.now(), true);

  // متصفح قديم بلا BroadcastChannel — نكتفي بحدث storage أدناه
  try {
    channel = new BroadcastChannel("mpstore-session");
    channel.onmessage = onChannel;
  } catch (e) {
    channel = null;
  }

  ACTIVITY_EVENTS.forEach((evt) =>
    document.addEventListener(evt, onLocalActivity, { passive: true }));
  window.addEventListener("storage", onStorageEvent);
  document.addEventListener("visibilitychange", onVisible);

  heartbeat = setInterval(check, CHECK_EVERY_MS);
  check();
}

// يُستدعى عند الخروج اليدوي: ينظّف كل شيء ويُبلّغ بقية التبويبات.
export function stopSessionGuard(options) {
  const broadcast = !options || options.broadcast !== false;
  if (broadcast) signalLogout();
  started = false;
  clearInterval(heartbeat); heartbeat = null;
  stopCountdown();
  closeWarning();
  ACTIVITY_EVENTS.forEach((evt) => document.removeEventListener(evt, onLocalActivity));
  window.removeEventListener("storage", onStorageEvent);
  document.removeEventListener("visibilitychange", onVisible);
  if (channel) { channel.close(); channel = null; }
  localStorage.removeItem(LS_LOGIN_AT);
  localStorage.removeItem(LS_LAST_ACTIVITY);
}

function signalLogout() {
  try { localStorage.setItem(LS_LOGOUT_SIGNAL, String(Date.now())); } catch (e) {}
  if (channel) channel.postMessage({ type: "logout" });
}

// ------------------------- النشاط -------------------------

function onLocalActivity() {
  // أثناء التحذير لا تُمدَّد الجلسة إلا بضغطة صريحة
  if (!started || warningModal) return;
  writeActivity();
}

function onVisible() {
  // فحص فوري عند العودة للتبويب بدل انتظار النبضة
  if (document.visibilityState === "visible") check();
}

function onChannel(e) {
  if (!started) return;
  const data = e.data || {};
  if (data.type === "logout") return leaveQuietly();
  if (data.type === "activity" && !warningModal) lastWrite = data.at || Date.now();
}

function onStorageEvent(e) {
  if (!started) return;
  if (e.key === LS_LOGOUT_SIGNAL && e.newValue) leaveQuietly();
}

// خروج تمّ في تبويب آخر — لا نستدعي signOut مرة ثانية.
function leaveQuietly() {
  started = false;
  clearInterval(heartbeat);
  stopCountdown();
  closeWarning();
  markExpiry("logout-elsewhere");
  onExpire("logout-elsewhere");
}

// ------------------------- النبضة -------------------------

function check() {
  if (!started) return;
  const now = Date.now();
  const loginAt = num(LS_LOGIN_AT) || now;
  const lastActivity = num(LS_LAST_ACTIVITY) || now;

  if (now - loginAt >= MAX_SESSION_MS) return expireSession("max");

  const idleFor = now - lastActivity;
  if (idleFor >= IDLE_LIMIT_MS) return expireSession("idle");

  if (idleFor >= IDLE_LIMIT_MS - WARNING_MS) {
    showWarning();
  } else if (warningModal) {
    // مُدِّدت الجلسة من تبويب آخر
    closeWarning();
    stopCountdown();
  }
}

// ------------------------- التحذير -------------------------

function secondsLeft() {
  const lastActivity = num(LS_LAST_ACTIVITY) || Date.now();
  return Math.max(0, Math.ceil((IDLE_LIMIT_MS - (Date.now() - lastActivity)) / 1000));
}

function showWarning() {
  if (warningModal) return;

  warningModal = openModal({
    title: "الجلسة على وشك الانتهاء",
    bodyHtml:
      '<p>لم يُسجَّل أي نشاط منذ فترة. سيتم تسجيل الخروج تلقائيًا خلال ' +
      '<b id="idleCountdown">' + secondsLeft() + '</b> ثانية لحماية حسابك.</p>',
    actions: [
      {
        label: "تمديد الجلسة",
        onClick: (root, close) => {
          close();
          warningModal = null;
          stopCountdown();
          writeActivity(Date.now(), true);
        },
      },
    ],
  });

  // قرار صريح مطلوب: لا إغلاق بالنقر خارج النافذة ولا زر "إغلاق"، حتى لا
  // يظن المستخدم أن الجلسة مُدِّدت وهي لم تُمدَّد.
  const root = warningModal.root;
  root.onclick = (e) => { if (e.target === root) e.stopPropagation(); };
  const closeBtn = root.querySelector("[data-close]");
  if (closeBtn) closeBtn.remove();
  root.classList.add("session-warning");

  const countEl = root.querySelector("#idleCountdown");
  stopCountdown();
  countdown = setInterval(() => {
    const left = secondsLeft();
    if (countEl) countEl.textContent = String(left);
    if (left <= 0) { stopCountdown(); expireSession("idle"); }
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdown);
  countdown = null;
}

function closeWarning() {
  if (warningModal) { warningModal.close(); warningModal = null; }
}

// ------------------------- الإنهاء -------------------------

async function expireSession(reason) {
  if (!started) return;
  started = false;
  clearInterval(heartbeat);
  stopCountdown();
  closeWarning();

  markExpiry(reason);
  signalLogout();

  // المستخدم خارج بأي حال
  try { await signOut(); } catch (e) {}

  onExpire(reason);
}

// معلومات الجلسة — تُستخدم في شاشة "عن النظام" إن رغبت بعرضها.
export function sessionInfo() {
  const loginAt = num(LS_LOGIN_AT);
  return {
    user: currentUser(),
    loginAt,
    maxExpiresAt: loginAt ? loginAt + MAX_SESSION_MS : null,
    idleLimitMs: IDLE_LIMIT_MS,
    idleExpiresAt: (num(LS_LAST_ACTIVITY) || 0) + IDLE_LIMIT_MS,
  };
}
