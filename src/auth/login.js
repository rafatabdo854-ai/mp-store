/**
 * شاشة الدخول التفاعلية.
 * الفكرة: المستخدم لا يضغط زرًا — بل يغلق قاطعًا كهربائيًا.
 * القاطع لا يعمل إلا بعد اكتمال البيانات، والمصابيح تشرح سبب أي تعطّل.
 */
import { byId, $ } from "../core/dom.js";
import { signIn } from "./auth.js";
import { resolveConfig, saveConfigOverride } from "../config.js";
import { initClient, isConfigured } from "../data/client.js";

const LAST_USER_KEY = "mpstore.lastUser";

let onSuccess = () => {};
let busy = false;

export function mountLogin(successHandler) {
  onSuccess = successHandler;

  const scene    = byId("loginScene");
  const form     = byId("loginForm");
  const username = byId("loginUsername");
  const password = byId("loginPassword");
  const breaker  = byId("breaker");
  const circuit  = byId("circuit");
  const errorBox = byId("loginError");
  const hint     = byId("loginHint");

  const lampDb   = byId("lampDb");
  const lampCred = byId("lampCred");
  const lampSess = byId("lampSess");

  // اسم المستخدم الأخير — يوفّر كتابة متكررة كل صباح
  const last = localStorage.getItem(LAST_USER_KEY);
  if (last) { username.value = last; setTimeout(() => password.focus(), 60); }

  /* --------- حالة الدائرة: تضيء عند اكتمال البيانات --------- */
  const refreshCircuit = () => {
    const ready = username.value.trim().length >= 2 && password.value.length >= 4;
    circuit.classList.toggle("energised", ready);
    lampCred.dataset.on = ready ? "green" : "amber";
    breaker.disabled = !ready || busy;
    breaker.querySelector(".sub").textContent = ready
      ? "اضغط لغلق القاطع" : "بانتظار بيانات الدخول";
    return ready;
  };

  [username, password].forEach((input) => {
    input.addEventListener("input", () => { hideError(); refreshCircuit(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (refreshCircuit()) attempt(); }
      hint.textContent = e.getModifierState?.("CapsLock") ? "تنبيه: مفتاح Caps Lock مُفعَّل" : "";
    });
  });

  breaker.addEventListener("click", () => { if (refreshCircuit()) attempt(); });
  form.addEventListener("submit", (e) => e.preventDefault());

  /* --------- فحص الوصول للخادم --------- */
  checkServer(lampDb);

  /* --------- شاشة الإعداد الأولي عند غياب المفاتيح --------- */
  if (!isConfigured()) showSetup();

  refreshCircuit();

  /* --------- محاولة الدخول --------- */
  async function attempt() {
    if (busy) return;
    busy = true;
    breaker.dataset.state = "busy";
    breaker.querySelector(".cap").textContent = "جارٍ التحقق";
    breaker.disabled = true;
    lampSess.dataset.on = "blink";
    hideError();

    try {
      const profile = await signIn(username.value.trim(), password.value);
      localStorage.setItem(LAST_USER_KEY, username.value.trim());
      breaker.dataset.state = "on";
      breaker.querySelector(".cap").textContent = "الدائرة مغلقة";
      breaker.querySelector(".sub").textContent = `أهلًا ${profile.full_name}`;
      lampSess.dataset.on = "green";
      setTimeout(() => {
        scene.hidden = true;
        document.body.classList.remove("is-locked");
        onSuccess(profile);
      }, 420);
    } catch (err) {
      busy = false;
      breaker.dataset.state = "off";
      breaker.querySelector(".cap").textContent = "غلق القاطع";
      lampSess.dataset.on = "red";
      $(".enclosure").classList.add("trip");
      setTimeout(() => $(".enclosure").classList.remove("trip"), 400);
      showError(err.message || "تعذّر تسجيل الدخول");
      password.select();
      refreshCircuit();
    }
  }

  function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
  function hideError() { errorBox.hidden = true; }
}

/** يتحقق من أن الخادم مفتوح قبل أن يحاول المستخدم الدخول. */
async function checkServer(lamp) {
  const cfg = resolveConfig();
  if (!cfg.url) { lamp.dataset.on = "red"; return; }
  lamp.dataset.on = "blink";
  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: cfg.anonKey },
    });
    lamp.dataset.on = res.ok ? "green" : "amber";
  } catch {
    lamp.dataset.on = "red";
  }
}

/** نموذج إدخال بيانات الاتصال لأول مرة (بديل عن تعديل config.js يدويًا). */
function showSetup() {
  const holder = byId("setupNote");
  holder.hidden = false;
  holder.innerHTML = `
    <div>لم يتم ضبط الاتصال بعد. أدخل بيانات مشروع Supabase مرة واحدة،
    أو عدّل الملف <code>src/config.js</code> قبل الرفع.</div>
    <div class="login-field" style="margin-top:10px">
      <label for="cfgUrl">Project URL</label>
      <input id="cfgUrl" type="url" placeholder="https://xxxx.supabase.co" autocomplete="off">
    </div>
    <div class="login-field">
      <label for="cfgKey">anon public key</label>
      <input id="cfgKey" type="text" placeholder="eyJhbGciOi..." autocomplete="off">
    </div>
    <button class="btn small" id="cfgSave" type="button">حفظ بيانات الاتصال</button>`;
  byId("cfgSave").onclick = () => {
    const url = byId("cfgUrl").value.trim().replace(/\/$/, "");
    const anonKey = byId("cfgKey").value.trim();
    if (!url || !anonKey) return;
    saveConfigOverride({ url, anonKey });
    initClient();
    location.reload();
  };
}
