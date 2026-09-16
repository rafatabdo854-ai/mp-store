/** إنشاء عميل Supabase وتوفيره لباقي الوحدات. */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { resolveConfig } from "../config.js";

let client = null;
let configured = false;

export function initClient() {
  const cfg = resolveConfig();
  if (!cfg.url || !cfg.anonKey) { configured = false; return null; }
  client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "mpstore.auth" },
    realtime: { params: { eventsPerSecond: 4 } },
    db: { schema: "public" },
  });
  configured = true;
  return client;
}

export function db() {
  if (!client) initClient();
  if (!client) throw new AppError("لم يتم ضبط الاتصال بقاعدة البيانات بعد", "NO_CONFIG");
  return client;
}

export const isConfigured = () => configured;

/**
 * عميل مؤقّت بمخزن جلسة منفصل.
 * يُستخدم عند إنشاء مستخدم جديد حتى لا تُستبدل جلسة المدير الحالي.
 */
export function makeTempClient() {
  const cfg = resolveConfig();
  return createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: "mpstore.temp" },
  });
}
export const loginDomain = () => resolveConfig().domain;

/** خطأ موحّد برسالة عربية مفهومة. */
export class AppError extends Error {
  constructor(message, code = "APP", cause = null) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

/** يترجم أخطاء Postgres/Supabase إلى رسائل يفهمها المستخدم. */
export function translateError(error) {
  if (!error) return new AppError("خطأ غير معروف");
  const msg = String(error.message || "");
  const code = error.code || "";

  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return new AppError("تعذّر الوصول إلى الخادم. تأكد من اتصال الإنترنت ثم أعد المحاولة.", "NETWORK", error);
  }
  if (msg.includes("Invalid login credentials")) {
    return new AppError("اسم المستخدم أو كلمة المرور غير صحيحة.", "AUTH", error);
  }
  if (msg.includes("Email not confirmed")) {
    return new AppError("الحساب لم يُفعَّل بعد. راجع مدير النظام.", "AUTH", error);
  }
  if (code === "23505") {
    return new AppError("القيمة مستخدمة من قبل (تكرار غير مسموح).", "DUPLICATE", error);
  }
  if (code === "23503") {
    return new AppError("لا يمكن الحذف: توجد حركات مرتبطة بهذا السجل.", "FK", error);
  }
  if (code === "42501" || msg.includes("row-level security") || msg.includes("صلاحية")) {
    return new AppError(msg.includes("صلاحية") ? msg : "ليس لديك صلاحية لتنفيذ هذه العملية.", "FORBIDDEN", error);
  }
  if (code === "P0001" || code === "P0002" || code === "22023" || code === "22007") {
    return new AppError(msg, "RULE", error);
  }
  return new AppError(msg || "حدث خطأ أثناء تنفيذ العملية.", code || "UNKNOWN", error);
}

/** غلاف يرمي خطأً مترجَمًا بدل إرجاع { data, error }. */
export async function run(promise) {
  const { data, error } = await promise;
  if (error) throw translateError(error);
  return data;
}
