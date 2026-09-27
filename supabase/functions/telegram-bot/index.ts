// supabase/functions/telegram-bot/index.ts
//
// بوت تليجرام للاستعلام عن الأصناف والتسعير (27_telegram_bot.sql).
//
//  - ابعت اسم الصنف أو جزء منه ← قايمة بالأصناف المطابقة (أزرار)
//  - اضغط على صنف ← الرصيد الحالي والسعر
//  - «➕ أضف للتسعيرة» ← يسألك الكمية ← يحسب التكلفة
//  - /quote ← التسعيرة كاملة بالإجمالي، و /quote 15 تضيف ربح ١٥٪
//
// لازم تتنشر بـ --no-verify-jwt: تليجرام مش بيبعت توكن Supabase.
// الحماية بدلها: كلمة السر اللي تليجرام بيبعتها في الهيدر، وقايمة
// المسموح لهم. البوت للقراءة فقط.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type Item = {
  id: string; code: string; name: string; brand: string; spec: string;
  category: string; unit: string; balance: number; unit_price: number;
  threshold: number; matched?: number; fuzzy?: boolean;
};
type CartLine = { id: string; qty: number };

let TOKEN = "";

// ---------------- أدوات ----------------
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const money = (n: number) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ج.م";

const qtyFmt = (n: number) => Number(n || 0).toLocaleString("en-US");

// الأرقام العربية ١٢٣ والفاصلة العربية ← أرقام عادية
const toLatin = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
   .replace(/[٫,]/g, ".").trim();

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({}));
}

const send = (chat: number, text: string, keyboard?: unknown[][]) =>
  tg("sendMessage", {
    chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });

function itemLabel(i: Item) {
  return [i.name, i.brand, i.spec].filter((x) => x && String(x).trim()).join(" · ");
}

function itemCard(i: Item) {
  const low = i.balance <= 0 ? "🔴 <b>نفد من المخزن</b>"
    : i.balance <= i.threshold ? "🟠 <b>تحت حد الطلب</b>" : "🟢 متوفر";
  return [
    `📦 <b>${esc(i.name)}</b>`,
    i.brand ? `الماركة: ${esc(i.brand)}` : "",
    i.spec ? `المواصفات: ${esc(i.spec)}` : "",
    `التصنيف: ${esc(i.category)}  |  الكود: <code>${esc(i.code)}</code>`,
    "",
    `الرصيد: <b>${qtyFmt(i.balance)} ${esc(i.unit)}</b>  ${low}`,
    `سعر الوحدة: <b>${money(i.unit_price)}</b>`,
    `قيمة الرصيد: ${money(i.balance * i.unit_price)}`,
  ].filter((l) => l !== "").join("\n");
}

// ---------------- الجلسة (التسعيرة) ----------------
async function getSession(key: string) {
  const { data } = await db.from("bot_sessions").select("*").eq("key", key).maybeSingle();
  return data ?? { key, pending_item: null, cart: [] as CartLine[] };
}
async function saveSession(key: string, patch: Record<string, unknown>) {
  await db.from("bot_sessions").upsert({ key, ...patch, updated_at: new Date().toISOString() });
}

async function loadItem(id: string): Promise<Item | null> {
  const { data } = await db.rpc("bot_item", { p_id: id });
  return (data && data[0]) || null;
}

// ---------------- الأوامر ----------------
const HELP = [
  "🔎 <b>البحث:</b> ابعت اسم الصنف أو جزء منه أو الكود",
  "مثال: <code>قاطع 32</code> أو <code>كابل 4 مم</code>",
  "(في الجروب اكتب قبله <code>/s</code>)",
  "",
  "🧾 <b>التسعيرة:</b> من كارت الصنف اضغط «➕ أضف للتسعيرة» واكتب الكمية",
  "<code>/quote</code> — تعرض التسعيرة بالإجمالي",
  "<code>/quote 15</code> — نفس التسعيرة + ربح ١٥٪",
  "<code>/clear</code> — تمسح التسعيرة وتبدأ من جديد",
].join("\n");

async function doSearch(chat: number, q: string) {
  const { data, error } = await db.rpc("bot_search", { p_q: q, p_limit: 10 });
  if (error) return send(chat, "⚠️ حصلت مشكلة في البحث، جرّب تاني.");
  const rows = (data ?? []) as Item[];

  if (!rows.length) {
    return send(chat, `مفيش أصناف فيها «${esc(q)}».\nجرّب كلمة أقصر أو جزء من الاسم.`);
  }
  if (rows.length === 1 && !rows[0].fuzzy) return showItem(chat, rows[0]);

  const total = rows[0].matched ?? rows.length;
  const head = rows[0].fuzzy
    ? `مالقيتش «${esc(q)}» بالظبط — يمكن تقصد:`
    : `لقيت ${total} صنف${total > rows.length ? ` (أول ${rows.length} — اكتب أكتر عشان تضيّق)` : ""}:`;

  const kb = rows.map((i) => [{
    text: `${itemLabel(i)} — ${qtyFmt(i.balance)}`.slice(0, 60),
    callback_data: `i:${i.id}`,
  }]);
  return send(chat, `${head}\nاختار الصنف:`, kb);
}

function showItem(chat: number, i: Item) {
  return send(chat, itemCard(i), [[{ text: "➕ أضف للتسعيرة", callback_data: `a:${i.id}` }]]);
}

async function showQuote(chat: number, key: string, marginArg?: string) {
  const s = await getSession(key);
  const cart = (s.cart ?? []) as CartLine[];
  if (!cart.length) {
    return send(chat, "التسعيرة فاضية.\nابحث عن صنف واضغط «➕ أضف للتسعيرة».");
  }

  const margin = marginArg ? Number(toLatin(marginArg)) : 0;
  if (marginArg && (!isFinite(margin) || margin < 0 || margin > 500)) {
    return send(chat, "نسبة الربح لازم تبقى رقم، مثلًا: <code>/quote 15</code>");
  }

  const lines: string[] = [];
  const kb: unknown[][] = [];
  let total = 0;
  let short = 0;

  for (const [n, c] of cart.entries()) {
    const i = await loadItem(c.id);
    if (!i) { lines.push(`${n + 1}) صنف لم يعد موجودًا — اتشال`); continue; }
    const sub = c.qty * i.unit_price;
    total += sub;
    const warn = c.qty > i.balance ? `  ⚠️ المتاح ${qtyFmt(i.balance)} بس` : "";
    if (warn) short++;
    lines.push(
      `${n + 1}) ${esc(itemLabel(i))}\n` +
      `    ${qtyFmt(c.qty)} ${esc(i.unit)} × ${money(i.unit_price)} = <b>${money(sub)}</b>${warn}`,
    );
    kb.push([{ text: `🗑 شيل: ${itemLabel(i)}`.slice(0, 60), callback_data: `r:${c.id}` }]);
  }

  const out = ["🧾 <b>التسعيرة</b>", "", ...lines, "", `الإجمالي (تكلفة): <b>${money(total)}</b>`];
  if (margin > 0) {
    out.push(`ربح ${margin}٪: ${money(total * margin / 100)}`);
    out.push(`<b>السعر للعميل: ${money(total * (1 + margin / 100))}</b>`);
  }
  if (short) out.push("", `⚠️ ${short} صنف الكمية المطلوبة منه أكبر من الموجود في المخزن`);
  out.push("", "الأسعار حسب سعر الوحدة الحالي في النظام.");

  kb.push([{ text: "🧹 مسح التسعيرة", callback_data: "c" }]);
  return send(chat, out.join("\n"), kb);
}

// ---------------- الاستقبال ----------------
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const { data: cfg } = await db.rpc("bot_config");
  if (!cfg?.token || !cfg?.secret) return new Response("not configured", { status: 503 });

  // أي طلب مش جاي من تليجرام بكلمة السر ← مرفوض
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== cfg.secret) {
    return new Response("forbidden", { status: 401 });
  }
  TOKEN = cfg.token;

  const update = await req.json().catch(() => null);
  if (!update) return new Response("ok");

  try {
    await handle(update, cfg);
  } catch (e) {
    console.error(e);
  }
  // دايمًا 200، وإلا تليجرام يفضل يعيد نفس الرسالة
  return new Response("ok");
});

// deno-lint-ignore no-explicit-any
async function handle(update: any, cfg: { chat_id: string }) {
  const msg = update.message;
  const cb = update.callback_query;
  const from = (msg ?? cb)?.from;
  const chat: number | undefined = msg?.chat?.id ?? cb?.message?.chat?.id;
  const chatType: string = msg?.chat?.type ?? cb?.message?.chat?.type ?? "private";
  if (!from || chat === undefined) return;

  // ---- الصلاحية ----
  let allowed = String(chat) === String(cfg.chat_id) || String(from.id) === String(cfg.chat_id);
  if (!allowed) {
    const { data } = await db.from("bot_users").select("telegram_id").eq("telegram_id", from.id).maybeSingle();
    allowed = !!data;
  }
  if (!allowed) {
    if (cb) await tg("answerCallbackQuery", { callback_query_id: cb.id });
    if (chatType === "private") {
      await send(chat,
        "🔒 البوت ده خاص بمخزن الهنا إليكتريك.\n" +
        `رقمك: <code>${from.id}</code>\nابعته لمدير النظام عشان يضيفك.`);
      await notifyDenied(cfg.chat_id, from);
    }
    return;
  }

  const key = `${chat}:${from.id}`;

  // ---- الأزرار ----
  if (cb) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const data: string = cb.data ?? "";
    const [op, id] = [data.slice(0, 1), data.slice(2)];

    if (op === "i") {
      const i = await loadItem(id);
      return i ? showItem(chat, i) : send(chat, "الصنف ده مش موجود دلوقتي.");
    }
    if (op === "a") {
      const i = await loadItem(id);
      if (!i) return send(chat, "الصنف ده مش موجود دلوقتي.");
      await saveSession(key, { pending_item: id, cart: (await getSession(key)).cart ?? [] });
      return tg("sendMessage", {
        chat_id: chat, parse_mode: "HTML",
        text: `كام ${esc(i.unit)} من «${esc(itemLabel(i))}»؟\nاكتب الكمية رقم بس.`,
        reply_markup: { force_reply: true, input_field_placeholder: "الكمية" },
      });
    }
    if (op === "r") {
      const s = await getSession(key);
      await saveSession(key, { cart: (s.cart as CartLine[]).filter((c) => c.id !== id), pending_item: null });
      return showQuote(chat, key);
    }
    if (op === "q") return showQuote(chat, key);
    if (op === "c") {
      await saveSession(key, { cart: [], pending_item: null });
      return send(chat, "🧹 اتمسحت التسعيرة. ابدأ من جديد.");
    }
    return;
  }

  // ---- الرسائل ----
  const text: string = (msg.text ?? "").trim();
  if (!text) return;

  // إزالة @اسم_البوت من الأوامر في الجروبات
  const cmdMatch = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
  const cmd = cmdMatch?.[1]?.toLowerCase();
  const arg = cmdMatch?.[2]?.trim() ?? "";

  if (cmd === "start" || cmd === "help") return send(chat, HELP);
  if (cmd === "quote") return showQuote(chat, key, arg || undefined);
  if (cmd === "clear") {
    await saveSession(key, { cart: [], pending_item: null });
    return send(chat, "🧹 اتمسحت التسعيرة.");
  }
  if (cmd === "s") {
    return arg ? doSearch(chat, arg) : send(chat, "اكتب اسم الصنف بعد /s — مثال: <code>/s قاطع 32</code>");
  }
  if (cmd) return send(chat, HELP);

  // هل مستنيين كمية؟
  const s = await getSession(key);
  if (s.pending_item) {
    const n = Number(toLatin(text));
    if (isFinite(n) && n > 0 && /^[\d٠-٩.,٫\s]+$/.test(text)) {
      const cart = ((s.cart ?? []) as CartLine[]).filter((c) => c.id !== s.pending_item);
      cart.push({ id: s.pending_item, qty: n });
      await saveSession(key, { cart, pending_item: null });
      const i = await loadItem(s.pending_item);
      const warn = i && n > i.balance ? `\n⚠️ المتاح في المخزن ${qtyFmt(i.balance)} بس` : "";
      return send(chat,
        `✅ اتضاف: ${qtyFmt(n)} × ${esc(i ? itemLabel(i) : "")}${warn}\n` +
        `التسعيرة فيها ${cart.length} صنف.`,
        [[{ text: "🧾 اعرض التسعيرة", callback_data: "q" }]]);
    }
    // كتب كلام مش رقم ← نعتبره بحث جديد وننسى الكمية
    await saveSession(key, { pending_item: null });
  }

  // في الجروب منردش إلا على الأوامر، عشان مانتدخلش في الكلام العادي
  if (chatType !== "private") return;
  return doSearch(chat, text);
}

// تنبيه للجروب لما حد غريب يحاول يستخدم البوت (مرة كل ساعة لنفس الشخص)
// deno-lint-ignore no-explicit-any
async function notifyDenied(adminChat: string, from: any) {
  const key = `denied:${from.id}`;
  const { data } = await db.from("bot_sessions").select("updated_at").eq("key", key).maybeSingle();
  if (data && Date.now() - new Date(data.updated_at).getTime() < 3600_000) return;
  await saveSession(key, {});
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
  await send(Number(adminChat),
    "🔒 <b>محاولة استخدام البوت من شخص غير مضاف</b>\n" +
    `الاسم: ${esc(name)}${from.username ? ` (@${esc(from.username)})` : ""}\n` +
    `الرقم: <code>${from.id}</code>\n\n` +
    "لو تعرفه، ضيفه من SQL Editor:\n" +
    `<code>select public.bot_allow(${from.id}, '${esc(name).replace(/'/g, "")}');</code>`);
}
