-- ============================================================
--  18_login_guard_ip.sql
--  إصلاح تعطيل الخدمة في قفل الدخول
--  شغّله بعد 17_signup_hardening.sql
--
--  المشكلة: register_failed_login ممنوحة لـ anon وتقفل الحساب نفسه
--  بعد ٥ نداءات. لا شيء يربط النداء بمحاولة دخول حقيقية، فأي شخص
--  ينادي الدالة خمس مرات باسم "admin" ويُبقي المدير خارج النظام.
--
--  الحل: العدّ يصير لكل (اسم مستخدم + مصدر)، لا لكل اسم مستخدم.
--  من يخمّن يقفل نفسه فقط، والمستخدم الحقيقي من جهازه يدخل عاديًا.
--
--  حدّ هذا الحل: هجوم موزّع من عناوين كثيرة لا يوقفه هذا وحده —
--  توقفه حدود Supabase في Authentication > Rate Limits، فاضبطها،
--  وتنبيه 15_login_alerts.sql يبلّغك بالموجة وقت حدوثها.
-- ============================================================

-- ------------------------------------------------------------
-- 1) مصدر الطلب
--
--    PostgREST يمرّر ترويسات الطلب إلى SQL. نأخذ أول عنوان في
--    x-forwarded-for ونخزّن بصمته فقط (md5) — يكفي للتمييز بين
--    المصادر، ولا يبقى عندنا عنوان أحد مكتوبًا بوضوح.
-- ------------------------------------------------------------
create or replace function public.client_fingerprint()
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_headers json;
  v_ip text;
begin
  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    return 'unknown';
  end;
  if v_headers is null then return 'unknown'; end if;

  v_ip := coalesce(
    v_headers->>'cf-connecting-ip',
    split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1),
    v_headers->>'x-real-ip'
  );
  v_ip := nullif(trim(v_ip), '');
  if v_ip is null then return 'unknown'; end if;

  return md5(v_ip);
end $$;

-- ------------------------------------------------------------
-- 2) جدول المحاولات — بديل العدّاد الموجود على profiles
-- ------------------------------------------------------------
create table if not exists public.login_attempts (
  username     text not null,
  fingerprint  text not null,
  attempts     integer not null default 0,
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  locked_until timestamptz,
  primary key (username, fingerprint)
);

create index if not exists idx_login_attempts_last
  on public.login_attempts (last_at desc);

--  لا سياسات: الجدول مغلق تمامًا أمام العميل، ولا يُلمس إلا من
--  داخل الدوال أدناه (security definer).
alter table public.login_attempts enable row level security;

-- ------------------------------------------------------------
-- 3) هل الدخول موقوف الآن؟
--
--    شرطان مستقلّان:
--      أ) قفل من هذا المصدر بعد محاولات فاشلة متكررة
--      ب) إيقاف يدوي وضعه مدير على profiles.locked_until
-- ------------------------------------------------------------
create or replace function public.is_locked(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_fp text := public.client_fingerprint();
begin
  if exists (
    select 1 from public.login_attempts
     where username = lower(trim(p_username))
       and fingerprint = v_fp
       and locked_until is not null
       and locked_until > now()
  ) then
    return true;
  end if;

  return coalesce((
    select locked_until is not null and locked_until > now()
      from public.profiles
     where username = lower(trim(p_username))
  ), false);
end $$;

-- ------------------------------------------------------------
-- 4) تسجيل محاولة فاشلة
--
--    الدالة لا تفرّق بين اسم موجود واسم غير موجود في ما تُرجعه،
--    حتى لا تصير وسيلة لمعرفة أي أسماء الحسابات حقيقية.
--
--    نافذة العدّ ١٥ دقيقة: خمس محاولات داخلها تقفل هذا المصدر
--    خمس دقائق، والمحاولة بعد انقضاء النافذة تبدأ عدًّا جديدًا.
-- ------------------------------------------------------------
create or replace function public.register_failed_login(p_username text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user text := lower(trim(p_username));
  v_fp   text := public.client_fingerprint();
  v_n    integer;
  v_id   uuid;
begin
  if v_user = '' then return; end if;

  insert into public.login_attempts (username, fingerprint, attempts)
  values (v_user, v_fp, 1)
  on conflict (username, fingerprint) do update
    set attempts = case
          when public.login_attempts.first_at < now() - interval '15 minutes'
          then 1
          else public.login_attempts.attempts + 1
        end,
        first_at = case
          when public.login_attempts.first_at < now() - interval '15 minutes'
          then now()
          else public.login_attempts.first_at
        end,
        last_at = now()
  returning attempts into v_n;

  if v_n >= 5 then
    update public.login_attempts
       set locked_until = now() + interval '5 minutes'
     where username = v_user and fingerprint = v_fp;
  end if;

  --  السجل يُكتب سواء كان الاسم حقيقيًا أو لا: موجة محاولات على
  --  أسماء غير موجودة إشارة مفيدة بذاتها.
  select id into v_id from public.profiles where username = v_user;
  insert into public.auth_events (event, username, user_id, ip_hint)
  values ('login_failed', v_user, v_id, left(v_fp, 8));
end $$;

-- ------------------------------------------------------------
-- 5) دخول ناجح: تصفير محاولات هذا المصدر
-- ------------------------------------------------------------
create or replace function public.clear_failed_logins(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user text;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  select username into v_user from public.profiles where id = p_user_id;

  delete from public.login_attempts
   where username = v_user and fingerprint = public.client_fingerprint();

  --  العمودان القديمان لم يعودا مستخدَمين في العدّ؛ نصفّرهما حتى
  --  لا يبقى قفل قديم عالقًا من قبل تشغيل هذا الملف.
  update public.profiles
     set failed_attempts = 0, locked_until = null
   where id = p_user_id;

  insert into public.auth_events (event, username, user_id, ip_hint)
  values ('login_success', v_user, p_user_id, left(public.client_fingerprint(), 8));
end $$;

-- ------------------------------------------------------------
-- 6) إيقاف يدوي من المدير — بديل مقصود للقفل التلقائي القديم
-- ------------------------------------------------------------
create or replace function public.lock_account(p_username text, p_minutes integer default 60)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.can('manage_users') then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  update public.profiles
     set locked_until = case when p_minutes > 0
                        then now() + make_interval(mins => p_minutes)
                        else null end
   where username = lower(trim(p_username));

  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(), 'update', 'account_lock',
          lower(trim(p_username)), jsonb_build_object('minutes', p_minutes));
end $$;

-- ------------------------------------------------------------
-- 7) صيانة: الجدول يكبر بمحاولات المهاجمين
-- ------------------------------------------------------------
create or replace function public.prune_login_attempts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  delete from public.login_attempts where last_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ------------------------------------------------------------
-- 8) الصلاحيات
-- ------------------------------------------------------------
revoke all on function public.client_fingerprint()          from public, anon, authenticated;
revoke all on function public.is_locked(text)               from public, anon, authenticated;
revoke all on function public.register_failed_login(text)   from public, anon, authenticated;
revoke all on function public.lock_account(text, integer)   from public, anon, authenticated;
revoke all on function public.prune_login_attempts()        from public, anon, authenticated;

--  هاتان تُستدعيان قبل وجود جلسة، فتبقيان متاحتين لغير المسجّل —
--  وقد صارتا غير مؤذيتين بعد ربط العدّ بالمصدر.
grant execute on function public.is_locked(text)             to anon, authenticated;
grant execute on function public.register_failed_login(text) to anon, authenticated;
grant execute on function public.lock_account(text, integer) to authenticated;
grant execute on function public.prune_login_attempts()      to authenticated;

-- ------------------------------------------------------------
-- 9) تحقّق بعد التشغيل
-- ------------------------------------------------------------
--  فكّ أي قفل عالق من النظام القديم:
-- update public.profiles set failed_attempts = 0, locked_until = null
--  where locked_until is not null;

--  المحاولات الجارية الآن (لمراجعة هجوم وقت حدوثه):
-- select username, left(fingerprint,8) src, attempts, locked_until
--   from public.login_attempts
--  where last_at > now() - interval '1 hour'
--  order by attempts desc;
