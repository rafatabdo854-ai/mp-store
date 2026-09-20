// supabase/functions/create-user/index.ts
//
// إنشاء حساب مستخدم جديد — البديل عن signUp من المتصفح.
//
// بعد إقفال التسجيل الذاتي في Supabase، لم يعد المتصفح يستطيع إنشاء
// حسابات، وهذا هو المقصود. الإنشاء ينتقل إلى هنا: مفتاح service_role
// لا يغادر الخادم، والدور يُكتب من كود نثق به بعد التأكد من أن الطالب
// يملك manage_users فعلًا.
//
// النشر:
//   supabase functions deploy create-user
// المفاتيح (SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY وSUPABASE_ANON_KEY)
// تُحقن تلقائيًا في بيئة الدوال، فلا تضعها في أي ملف.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

// حصر النطاق على أصل الموقع وحده — لا "*"
const ALLOWED_ORIGIN = "https://elhana-electric.pages.dev";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const LOGIN_DOMAIN = "mp-store.local";
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "طريقة غير مدعومة" }, 405);

  // ---- ١) من الطالب؟ ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "غير مصرح" }, 401);
  }

  // عميل بصلاحية الطالب نفسه: يتحقق من الرمز ويقرأ صلاحياته تحت RLS
  const asCaller = createClient(URL_, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "جلسة غير صالحة" }, 401);

  // الصلاحية تُقرأ من القاعدة، لا من أي شيء في الطلب
  const { data: perms } = await asCaller.rpc("my_permissions");
  if (!Array.isArray(perms) || !perms.includes("manage_users")) {
    return json({ error: "ليس لديك صلاحية إنشاء المستخدمين" }, 403);
  }

  // ---- ٢) تحقّق من المدخلات ----
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "طلب غير صالح" }, 400);
  }

  const username = String(body.username ?? "").trim().toLowerCase();
  const fullName = String(body.fullName ?? "").trim();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "viewer").trim();

  if (!USERNAME_RE.test(username)) {
    return json({ error: "اسم المستخدم: حروف إنجليزية وأرقام فقط، ٣ إلى ٣٢ خانة" }, 400);
  }
  if (fullName.length < 2 || fullName.length > 80) {
    return json({ error: "الاسم الكامل مطلوب" }, 400);
  }
  if (password.length < 10) {
    return json({ error: "كلمة المرور يجب ألّا تقل عن ١٠ خانات" }, 400);
  }

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // الدور يجب أن يكون موجودًا في جدول الأدوار — لا نص حر
  const { data: roleRow } = await admin
    .from("roles").select("code").eq("code", role).maybeSingle();
  if (!roleRow) return json({ error: "دور غير معروف" }, 400);

  // ---- ٣) الإنشاء ----
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${username}@${LOGIN_DOMAIN}`,
    password,
    email_confirm: true,                       // لا بريد حقيقي يُرسل إليه
    user_metadata: { username, full_name: fullName },
  });

  if (createErr) {
    const dup = /already|exists|registered/i.test(createErr.message);
    return json({ error: dup ? "اسم المستخدم مستخدم من قبل" : createErr.message }, dup ? 409 : 400);
  }

  // التريجر أنشأ الملف بدور viewer. الدور المطلوب يُكتب من هنا،
  // بعد أن تأكدنا من صلاحية الطالب — وليس من بيانات أرسلها المتصفح.
  const { error: roleErr } = await admin
    .from("profiles")
    .update({ role, full_name: fullName, username })
    .eq("id", created.user.id);

  if (roleErr) {
    // لا نترك حسابًا معلّقًا بلا دور صحيح
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: "تعذّر ضبط دور الحساب، فأُلغي الإنشاء" }, 500);
  }

  await admin.from("audit_log").insert({
    actor: userData.user.id,
    actor_name: userData.user.email,
    action: "create",
    entity: "profile",
    entity_id: created.user.id,
    details: { username, role },
  });

  return json({ id: created.user.id, username, role });
});

