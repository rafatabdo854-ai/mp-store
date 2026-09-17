// تحديث التطبيق دون أن يمسح المستخدم ذاكرة المتصفح.
//
// المشكلة التي يحلّها: عامل الخدمة يفحص وجود نسخة جديدة عند تحميل
// الصفحة فقط. وأمين المخزن يفتح التطبيق صباحًا ولا يغلقه طوال اليوم،
// فقد يظل على نسخة قديمة أيامًا بعد النشر.
//
// الحل: نسأل المتصفح عن نسخة جديدة كل CHECK_EVERY_MS وعند كل عودة
// للتبويب. إن وُجدت، نعرض شريطًا يضغطه المستخدم وقتما يناسبه.
//
// لماذا لا نُحدّث تلقائيًا؟ لأن إعادة التحميل وسط إدخال إذن فيه عشرة
// أصناف تضيّع العمل. القرار للمستخدم، والشريط يبقى حتى يقرّر.

const CHECK_EVERY_MS = 10 * 60 * 1000;   // فحص كل 10 دقائق

let registration = null;
let waiting = null;
let shown = false;

export function startUpdateWatch() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;
    registration = reg;

    // نسخة جاهزة ومنتظرة من جلسة سابقة
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);

    reg.addEventListener("updatefound", () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener("statechange", () => {
        // وجود controller يعني أنها ليست أول زيارة، فهذه ترقية لا تثبيت
        if (incoming.state === "installed" && navigator.serviceWorker.controller) {
          announce(incoming);
        }
      });
    });

    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.addEventListener("online", check);
  }).catch(() => {});

  // العامل الجديد تولّى القيادة — أعد التحميل مرة واحدة فقط
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function check() {
  if (!registration || document.visibilityState === "hidden") return;
  registration.update().catch(() => {});
}

function announce(worker) {
  waiting = worker;
  if (shown) return;
  shown = true;
  showBar();
}

function showBar() {
  if (document.getElementById("updateBar")) return;

  const bar = document.createElement("div");
  bar.id = "updateBar";
  bar.setAttribute("role", "status");
  bar.style.cssText =
    "position:fixed; inset-inline:0; bottom:0; z-index:9999;" +
    "display:flex; gap:12px; align-items:center; justify-content:center;" +
    "flex-wrap:wrap; padding:12px 16px;" +
    "background:#2d6a86; color:#fff;" +
    "font-size:.86rem; box-shadow:0 -2px 12px rgba(0,0,0,.25);";

  const text = document.createElement("span");
  text.textContent = "صدرت نسخة جديدة من التطبيق.";

  const now = document.createElement("button");
  now.type = "button";
  now.textContent = "تحديث الآن";
  now.style.cssText =
    "padding:6px 14px;border:0;border-radius:6px;cursor:pointer;" +
    "background:#fff;color:#13303B;font:inherit;font-weight:600";

  const later = document.createElement("button");
  later.type = "button";
  later.textContent = "لاحقًا";
  later.style.cssText =
    "padding:6px 10px;border:0;border-radius:6px;cursor:pointer;" +
    "background:transparent;color:#fff;font:inherit;opacity:.85";

  now.onclick = () => {
    bar.remove();
    // skipWaiting يُطلق controllerchange أعلاه، وهو من يعيد التحميل
    if (waiting) waiting.postMessage("skip-waiting");
    else location.reload();
  };

  later.onclick = () => {
    bar.remove();
    shown = false;   // سيظهر ثانية عند الفحص التالي
  };

  bar.append(text, now, later);
  document.body.append(bar);
}
