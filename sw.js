/**
 * عامل الخدمة — يجعل التطبيق يفتح فورًا وبلا انتظار الشبكة.
 *
 * ما يُخزَّن: ملفات التطبيق نفسه (HTML/CSS/JS/أيقونات) والخطوط ومكتبة Supabase.
 * ما لا يُخزَّن أبدًا: أي نداء لقاعدة البيانات. البيانات تأتي من الشبكة دائمًا،
 * وإلا رأى أمين المخزن رصيدًا قديمًا وصرف على أساسه. النسخة المحلية الوحيدة
 * للبيانات هي cache في core/store.js، وهي تُعرض بوضوح كـ"آخر نسخة محفوظة".
 *
 * عند تعديل أي ملف في src/ أو assets/: ارفع رقم CACHE_VERSION — وإلا بقي
 * المستخدمون على النسخة القديمة حتى تنتهي صلاحية الملف في المتصفح.
 */
const CACHE_VERSION = "v10.14.0";
const SHELL_CACHE = `mpstore-shell-${CACHE_VERSION}`;
const CDN_CACHE   = `mpstore-cdn-${CACHE_VERSION}`;

/** ملفات التطبيق — تُحمَّل كلها عند أول زيارة */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",

  "./assets/css/main.css",
  "./assets/css/login.css",
  "./assets/css/print.css",
  "./assets/css/responsive.css",

  "./assets/img/logo.png",
  "./assets/img/icon-192.png",
  "./assets/img/icon-512.png",
  "./assets/img/icon-maskable-192.png",
  "./assets/img/icon-maskable-512.png",

  "./src/config.js",
  "./src/main.js",
  "./src/core/dom.js",
  "./src/core/format.js",
  "./src/core/i18n.js",
  "./src/core/presence.js",
  "./src/core/responsive.js",
  "./src/core/store.js",
  "./src/core/updates.js",
  "./src/core/ui.js",
  "./src/core/validation.js",
  "./src/data/client.js",
  "./src/data/excel.js",
  "./src/data/realtime.js",
  "./src/data/repo.js",
  "./src/auth/auth.js",
  "./src/auth/login.js",
  "./src/auth/roles.js",
  "./src/auth/session-guard.js",
  "./src/views/accounting.js",
  "./src/views/audit.js",
  "./src/views/dashboard.js",
  "./src/views/items.js",
  "./src/views/log.js",
  "./src/views/pricing.js",
  "./src/views/print.js",
  "./src/views/reports.js",
  "./src/views/roles.js",
  "./src/views/settings.js",
  "./src/views/shared.js",
  "./src/views/stocktake.js",
  "./src/views/voucher.js",
];

/** مصادر خارجية يُسمح بتخزينها: عناوينها ثابتة بنسخة محدّدة */
const CDN_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll تفشل كلها لو فشل ملف واحد — نضيف كل ملف على حدة حتى لا
    // يمنع ملف واحد مفقود تثبيت عامل الخدمة بالكامل
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: "reload" })).catch((err) =>
        console.warn("[sw] تعذّر تخزين", url, err.message))));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith("mpstore-") && k !== SHELL_CACHE && k !== CDN_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** يسمح للصفحة بطلب تفعيل النسخة الجديدة فورًا بدل انتظار إغلاق كل التبويبات */
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // قاعدة البيانات والمصادقة: لا تخزين ولا اعتراض — دائمًا من الشبكة
  if (url.hostname.endsWith(".supabase.co")) return;

  // التنقّل (فتح الصفحة): الشبكة أولًا حتى تصل التحديثات، والمخزَّن عند الانقطاع
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  // ملفات التطبيق: من المخزَّن فورًا، مع تحديثه في الخلفية للزيارة القادمة
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // الخطوط ومكتبة Supabase: عناوين ثابتة، المخزَّن أولًا
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  // ignoreSearch: main.js?v=10.2 يجب أن يطابق main.js المخزَّن
  const cached = await cache.match(request, { ignoreSearch: true });

  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || (await network) || Response.error();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === "opaque")) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}
