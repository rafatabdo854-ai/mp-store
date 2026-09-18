-- ============================================================
--  تنبيه محاولات الدخول الفاشلة
--  شغّله بعد 13_telegram.sql
--
--  قرار التصميم: لا تنبيه عند كل محاولة فاشلة.
--
--  أمين المخزن يخطئ في كلمة مروره صباحًا فتصلك رسالة، وبعد أسبوع
--  تتجاهل الرسائل كلها — فحين تأتي محاولة اختراق حقيقية لا تراها.
--  التنبيه الذي يصل كل يوم بلا سبب يُفقد التنبيه قيمته.
--
--  فالتنبيه يُرسل في حالتين فقط:
--   1) قفل حساب — خمس محاولات فاشلة متتالية. هذا لم يعد خطأ كتابة.
--   2) محاولة دخول باسم مستخدم غير موجود — لا يخطئ فيها موظف يعرف
--      اسمه، وهي العلامة الأولى لمن يجرّب أسماء عشوائية.
-- ============================================================

-- ------------------------------------------------------------
-- 0) صياغة الأرقام في الرسائل
-- ------------------------------------------------------------
create or replace function public.fmt_count(n integer)
returns text
language sql
immutable
as $$ select n::text $$;

-- ------------------------------------------------------------
-- 1) خنق التنبيهات
--
--  register_failed_login متاحة لغير المسجَّلين بالضرورة — تُستدعى
--  قبل وجود جلسة. ومفتاح anon علني بحكم تصميمه. فمن يملك المفتاح
--  يستطيع استدعاءها آلاف المرات.
--
--  بلا خنق يتحوّل هذا إلى قناة إزعاج: آلاف الرسائل على هاتفك حتى
--  تُغلق البوت، وتحتها تمرّ المحاولة الحقيقية.
--  رسالة واحدة لكل اسم مستخدم كل عشر دقائق.
-- ------------------------------------------------------------
create or replace function public.should_alert(p_key text, p_minutes integer default 10)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_last timestamptz;
  v_now  timestamptz := now();
begin
  select (value->>'at')::timestamptz into v_last
    from public.private_config where key = 'alert:' || p_key;

  if v_last is not null and v_last > v_now - make_interval(mins => greatest(p_minutes, 1)) then
    return false;
  end if;

  insert into public.private_config (key, value)
  values ('alert:' || p_key, jsonb_build_object('at', v_now))
  on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return true;
end $$;

revoke all on function public.should_alert(text, integer) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2) محاولة فاشلة — مع التنبيه
-- ------------------------------------------------------------
create or replace function public.register_failed_login(p_username text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id       uuid;
  v_name     text;
  v_attempts integer;
  v_recent   integer;
begin
  select id, full_name into v_id, v_name
    from public.profiles where username = p_username;

  -- اسم مستخدم غير موجود: لا نكشف ذلك للمتصل، لكنه إشارة تستحق
  -- التنبيه — الموظف لا يخطئ في اسمه، والمجرِّب يخطئ فيه دائمًا
  if v_id is null then
    insert into public.auth_events (event, username)
    values ('login_unknown', left(coalesce(p_username, ''), 60));

    select count(*) into v_recent
      from public.auth_events
     where event = 'login_unknown'
       and created_at > now() - interval '15 minutes';

    -- محاولة واحدة قد تكون خطأ؛ ثلاث محاولات في ربع ساعة ليست كذلك
    if v_recent >= 3 and public.should_alert('unknown_user', 30) then
      perform public.telegram_send(
        '🔍 <b>محاولات دخول بأسماء غير موجودة</b>' || E'\n' ||
        fmt_count(v_recent) || ' محاولة خلال ١٥ دقيقة.' || E'\n' ||
        'آخر اسم مُجرَّب: <code>' || left(coalesce(p_username, '—'), 40) || '</code>' || E'\n' ||
        'راجع سجل الدخول في شاشة سجل التدقيق.');
    end if;

    return;
  end if;

  update public.profiles
     set failed_attempts = failed_attempts + 1,
         locked_until = case
           when failed_attempts + 1 >= 5 then now() + interval '5 minutes'
           else locked_until
         end
   where id = v_id
   returning failed_attempts into v_attempts;

  insert into public.auth_events (event, username, user_id)
  values ('login_failed', p_username, v_id);

  -- التنبيه عند القفل فقط، ومرة واحدة: الشرط = بالضبط عند الخامسة،
  -- فلا تتكرّر الرسالة مع كل محاولة بعدها
  if v_attempts = 5 and public.should_alert('lock:' || p_username, 10) then
    perform public.telegram_send(
      '🔒 <b>قُفل حساب بعد محاولات فاشلة</b>' || E'\n' ||
      'المستخدم: ' || coalesce(v_name, p_username) ||
        ' (<code>' || p_username || '</code>)' || E'\n' ||
      'خمس محاولات فاشلة متتالية.' || E'\n' ||
      'القفل ينتهي تلقائيًا بعد ٥ دقائق.' || E'\n' ||
      'إن لم يكن هو، غيّر كلمة مروره فورًا.');
  end if;
end $$;

-- تُستدعى قبل وجود جلسة، فلا بدّ أن تبقى متاحة لغير المسجَّلين
revoke all on function public.register_failed_login(text) from public, anon, authenticated;
grant execute on function public.register_failed_login(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 4) دخول ناجح من حساب كان مقفولًا
--
--  هذا هو التسلسل الذي يستحق الانتباه فعلًا: محاولات فاشلة ثم نجاح.
--  إما أن صاحب الحساب تذكّر كلمته، أو أن أحدًا وصل إليها.
-- ------------------------------------------------------------
create or replace function public.clear_failed_logins(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_attempts integer;
  v_username text;
  v_name     text;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  select failed_attempts, username, full_name
    into v_attempts, v_username, v_name
    from public.profiles where id = p_user_id;

  update public.profiles
     set failed_attempts = 0, locked_until = null
   where id = p_user_id;

  insert into public.auth_events (event, username, user_id)
  values ('login_success', v_username, p_user_id);

  if coalesce(v_attempts, 0) >= 3
     and public.should_alert('recovered:' || v_username, 30) then
    perform public.telegram_send(
      '✅ <b>دخول ناجح بعد محاولات فاشلة</b>' || E'\n' ||
      'المستخدم: ' || coalesce(v_name, v_username) || E'\n' ||
      'سبقته ' || v_attempts || ' محاولة فاشلة.' || E'\n' ||
      'إن لم يكن هو، أوقف الحساب فورًا.');
  end if;
end $$;

revoke all on function public.clear_failed_logins(uuid) from public, anon, authenticated;
grant execute on function public.clear_failed_logins(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) سجل الأحداث يقبل النوع الجديد
-- ------------------------------------------------------------
-- login_unknown يُسجَّل بلا user_id، والعمود يسمح بذلك أصلًا

-- ------------------------------------------------------------
-- 6) تجربة
-- ------------------------------------------------------------
-- حاول الدخول بكلمة مرور خاطئة خمس مرات بنفس اسم المستخدم،
-- أو ثلاث مرات باسم غير موجود مثل xyz123.

-- لمراجعة ما سُجِّل:
-- select event, username, created_at from public.auth_events
--  order by created_at desc limit 20;
