-- ============================================================
--  تنبيهات تليجرام الفورية من قاعدة البيانات
--  شغّله بعد 12_hardening.sql
--
--  التنبيهان اليوميان (ملخّص الأصناف المهدَّدة وتأكيد النسخة) يرسلهما
--  GitHub Actions. أما "إذن صرف كبير" فلا يصلح له جدول زمني: قيمته في
--  أنه يصلك خلال ثوانٍ من تسجيل الإذن، لا صباح اليوم التالي.
--  لذلك يُرسَل من داخل قاعدة البيانات عبر pg_net.
-- ============================================================

create extension if not exists pg_net;

-- ------------------------------------------------------------
-- 1) مكان آمن لتوكن البوت
--
--  لا يوضع في جدول settings: سياسة قراءته using(true)، فكل مستخدم
--  مسجَّل يقرأه — والتوكن يعني التحكّم الكامل في البوت.
--
--  هذا الجدول عليه RLS بلا أي سياسة قراءة إطلاقًا. النتيجة: لا يصله
--  أحد عبر الـ API مهما كان دوره، وتقرؤه فقط دوال security definer
--  التي تعمل بصلاحية المالك. حتى مدير النظام لا يراه من الواجهة.
-- ------------------------------------------------------------
create table if not exists public.private_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.private_config enable row level security;
-- بلا سياسات: هذا مقصود، وليس سهوًا

revoke all on public.private_config from anon, authenticated;

-- ------------------------------------------------------------
-- 2) ضبط الإعدادات — تُستدعى مرة واحدة من SQL Editor
-- ------------------------------------------------------------
create or replace function public.set_telegram(
  p_token text,
  p_chat_id text,
  p_min_qty integer default 50,
  p_min_value numeric default 5000
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.private_config (key, value)
  values ('telegram', jsonb_build_object(
    'token', p_token,
    'chat_id', p_chat_id,
    'min_qty', p_min_qty,
    'min_value', p_min_value,
    'enabled', true))
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  return 'تم الضبط. جرّب: select public.telegram_test();';
end $$;

-- لا تُمنح لأحد: تُستدعى من SQL Editor بصلاحية المالك فقط
revoke all on function public.set_telegram(text, text, integer, numeric)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3) الإرسال
--
--  net.http_post غير متزامنة: تضع الطلب في طابور وتعود فورًا. هذا
--  مقصود — لو انتظرنا ردّ تليجرام لتأخّر حفظ الإذن بثوانٍ، وتعطُّل
--  تليجرام كان سيمنع أمين المخزن من تسجيل أذونه.
--  التنبيه مساعد، لا يجوز أن يعطّل العملية الأصلية.
-- ------------------------------------------------------------
create or replace function public.telegram_send(p_text text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cfg jsonb;
  v_id bigint;
begin
  select value into v_cfg from public.private_config where key = 'telegram';

  if v_cfg is null or coalesce((v_cfg->>'enabled')::boolean, false) = false then
    return null;
  end if;

  select net.http_post(
    url := 'https://api.telegram.org/bot' || (v_cfg->>'token') || '/sendMessage',
    body := jsonb_build_object(
      'chat_id', v_cfg->>'chat_id',
      'text', p_text,
      'parse_mode', 'HTML',
      'disable_web_page_preview', true
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 5000
  ) into v_id;

  return v_id;
end $$;

revoke all on function public.telegram_send(text) from public, anon, authenticated;

create or replace function public.telegram_test()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.telegram_send(
    '<b>مخزن الهنا الكتريك</b>' || E'\n' ||
    'رسالة تجريبية — الربط يعمل.');
  return 'أُرسلت. تحقّق من تليجرام خلال ثوانٍ.';
end $$;

revoke all on function public.telegram_test() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4) تنبيه إذن الصرف الكبير
--
--  مُشغِّل على مستوى الجملة لا الصف: الإذن الواحد يُدخِل عشرة أصناف
--  في جملة واحدة، ومُشغِّل الصف كان سيرسل عشر رسائل عن إذن واحد.
--  جدول الانتقال (new_rows) يتيح رؤية كل صفوف الجملة معًا.
-- ------------------------------------------------------------
create or replace function public.notify_big_issue()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cfg jsonb;
  v_min_qty integer;
  v_min_value numeric;
  r record;
begin
  select value into v_cfg from public.private_config where key = 'telegram';
  if v_cfg is null or coalesce((v_cfg->>'enabled')::boolean, false) = false then
    return null;
  end if;

  v_min_qty   := coalesce((v_cfg->>'min_qty')::integer, 50);
  v_min_value := coalesce((v_cfg->>'min_value')::numeric, 5000);

  for r in
    select n.voucher_no,
           max(n.txn_date)          as txn_date,
           max(n.project)           as project,
           max(n.party)             as party,
           max(n.created_by_name)   as who,
           count(*)                 as lines,
           sum(n.qty)               as qty,
           round(sum(n.qty * coalesce(n.unit_cost, 0)), 2) as value
      from new_rows n
     where n.type = 'out'
     group by n.voucher_no
    having sum(n.qty) >= v_min_qty
        or sum(n.qty * coalesce(n.unit_cost, 0)) >= v_min_value
  loop
    perform public.telegram_send(
      '⚠️ <b>إذن صرف كبير</b>' || E'\n' ||
      'رقم: <code>' || r.voucher_no || '</code>' || E'\n' ||
      'التاريخ: ' || r.txn_date || E'\n' ||
      'الجهة: ' || coalesce(nullif(r.party, ''), '—') || E'\n' ||
      'المشروع: ' || coalesce(nullif(r.project, ''), '—') || E'\n' ||
      'الأصناف: ' || r.lines || '   الكميات: ' || r.qty || E'\n' ||
      'التكلفة: ' || r.value || ' ج.م' || E'\n' ||
      'بواسطة: ' || coalesce(r.who, 'غير معروف'));
  end loop;

  return null;
end $$;

drop trigger if exists trg_notify_big_issue on public.transactions;
create trigger trg_notify_big_issue
  after insert on public.transactions
  referencing new table as new_rows
  for each statement execute function public.notify_big_issue();

-- ------------------------------------------------------------
-- 5) تشغيل وإيقاف التنبيهات دون فقد الإعدادات
-- ------------------------------------------------------------
create or replace function public.telegram_toggle(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.can('manage_settings') then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  update public.private_config
     set value = jsonb_set(value, '{enabled}', to_jsonb(p_on)), updated_at = now()
   where key = 'telegram';

  return p_on;
end $$;

grant execute on function public.telegram_toggle(boolean) to authenticated;

-- ------------------------------------------------------------
-- 6) الضبط — املأ القيم وشغّل السطرين، ثم احذفهما من المحرّر
-- ------------------------------------------------------------
-- select public.set_telegram(
--   '1234567890:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  -- توكن البوت
--   '-1001234567890',                                   -- معرّف المحادثة
--   50,                                                 -- حد الكمية
--   5000                                                -- حد القيمة بالجنيه
-- );
-- select public.telegram_test();

-- لمتابعة حالة الطلبات المرسلة:
-- select id, status_code, created from net._http_response order by created desc limit 10;
