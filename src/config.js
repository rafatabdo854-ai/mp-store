/**
 * إعدادات الاتصال بقاعدة البيانات.
 *
 * املأ القيمتين من:  Supabase Dashboard > Project Settings > API
 *   SUPABASE_URL      = Project URL
 *   SUPABASE_ANON_KEY = anon public key
 *
 * ملاحظة أمنية: مفتاح anon مُصمَّم ليكون علنيًا. الحماية الحقيقية
 * مصدرها سياسات RLS في ملفات sql/. لا تضع مفتاح service_role هنا إطلاقًا.
 */
export const SUPABASE_URL = "https://zanjzbgnmwruvoliikhi.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inphbmp6YmdubXdydXZvbGlpa2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NzI4NDUsImV4cCI6MjEwNTE0ODg0NX0.UyYvDnfiodLZUARh109EY4E16QsNLePlRQ-zP-2m77g";

/** نطاق البريد الوهمي: المستخدم يدخل باسم مستخدم فقط، والنظام يحوّله لبريد. */
export const LOGIN_DOMAIN = "mp-store.local";

/** إعدادات عامة */
export const APP = {
  name: "إدارة مخزن مستلزمات الكهرباء",
  /** اسم الشركة كما يظهر في ترويسة كل تقرير وإذن مطبوع */
  company: "El Hana Electric",
  /** سطر حر يظهر أسفل لوحة "عن النظام" — اتركه فارغًا لإخفائه */
  note: "Elhana Electric Company",
  /** اسم المطوّر كما يظهر في لوحة "عن النظام" */
  developer: "Eng. Mahmoud Fouad",
  /** مسار اللوجو داخل المستودع — ضع الصورة في assets/img/ */
  logo: "assets/img/logo.png",
  /** ارتفاع اللوجو في الترويسة (بكسل) */
  logoHeight: 52,
  currency: "ج.م",
  version: "10.1.0",
  /** عدد صفوف سجل الحركات في الصفحة الواحدة */
  logPageSize: 100,
  /** تحديث مباشر عند تعديل أي مستخدم آخر */
  realtime: true,
};

/** يسمح بتجاوز الإعدادات وقت التشغيل (مفيد أثناء التجربة قبل النشر). */
export function resolveConfig() {
  const override = (() => {
    try { return JSON.parse(localStorage.getItem("mpstore.config") || "{}"); }
    catch { return {}; }
  })();
  return {
    url: override.url || SUPABASE_URL,
    anonKey: override.anonKey || SUPABASE_ANON_KEY,
    domain: override.domain || LOGIN_DOMAIN,
  };
}

export function saveConfigOverride({ url, anonKey, domain }) {
  localStorage.setItem("mpstore.config", JSON.stringify({ url, anonKey, domain }));
}
