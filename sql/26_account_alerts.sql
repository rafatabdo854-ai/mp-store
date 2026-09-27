-- ============================================================
--  26) تغيير كلمة مرور المستخدم من الإدارة + تنبيهات تليجرام
--      للحسابات والمشاريع والصلاحيات الحساسة
--  شغّله بعد 25_categories.sql
--
--  ما يضيفه:
--   1) صلاحية reset_password تظهر في مصفوفة الأدوار والصلاحيات
--      (تُمنح تلقائيًا لكل دور يملك manage_users الآن).
--   2) account_event(): تستدعيها دالة Create-user على الخادم بعد
--      إنشاء حساب أو تغيير كلمة مرور — تسجّل في التدقيق وترسل تليجرام.
--   3) تنبيهات فورية:
--        إيقاف حساب / إعادة تفعيله / تغيير دور مستخدم
--        مشروع جديد / إيقاف مشروع / إعادة تفعيله / حذف مشروع
--        منح صلاحية حساسة لدور أو لمستخدم
--
--  كل التنبيهات تمر عبر telegram_send() من 13_telegram.sql، فهي لا
--  تعطّل العملية الأصلية أبدًا حتى لو تعطّل تليجرام.
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 0) أدوات مساعدة
-- ------------------------------------------------------------
-- الرسائل تُرسَل بـ parse_mode=HTML: اسم مشروع فيه "<" كان سيجعل
-- تليجرام يرفض الرسالة كلها بصمت. نُهرّب كل نص يكتبه المستخدم.
create or replace function public.tg_esc(p text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

create or replace function public.role_label(p_code text)
returns text
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce((select label from public.roles where code = p_code), p_code);
$$;

-- من فعل؟ من الواجهة = اسم المستخدم، من SQL Editor = لا يوجد مستخدم
create or replace function public.actor_label()
returns text
language sql
stable security definer
set search_path to 'public'
as $$
  select case when auth.uid() is null then 'النظام / SQL Editor'
              else public.my_name() end;
$$;

-- إنهاء كل جلسات مستخدم (بعد إيقافه أو تغيير كلمة مروره).
-- محاط بـ exception: لو منعت Supabase الكتابة على auth.sessions في
-- مشروعك، يستمر كل شيء ويبقى session-guard في الواجهة هو خط الدفاع.
create or replace function public.kill_user_sessions(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  begin
    delete from auth.sessions where user_id = p_user;
  exception when others then
    null;
  end;
end $$;

revoke all on function public.kill_user_sessions(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 1) الصلاحية الجديدة
-- ------------------------------------------------------------
insert into public.permissions (code, label, category, sort) values
  ('reset_password', 'تغيير كلمة مرور المستخدمين', 'الإدارة', 945)
on conflict (code) do update
  set label = excluded.label, category = excluded.category, sort = excluded.sort;

-- من يدير المستخدمين اليوم يملكها — لا يتغيّر شيء لحظة التشغيل
insert into public.role_permissions (role_code, permission_code)
select role_code, 'reset_password'
  from public.role_permissions
 where permission_code = 'manage_users'
on conflict do nothing;

-- ------------------------------------------------------------
-- 2) أحداث الحساب القادمة من دالة الخادم (Create-user)
--
--  لا تُمنح للمتصفح إطلاقًا: فقط service_role (مفتاح الخادم) يستدعيها،
--  بعد أن تحقّقت الدالة من صلاحية الطالب.
-- ------------------------------------------------------------
create or replace function public.account_event(
  p_event  text,     -- 'created' | 'password_reset'
  p_actor  uuid,
  p_target uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  t record;
begin
  select full_name, username into a from public.profiles where id = p_actor;
  select full_name, username, role into t from public.profiles where id = p_target;

  if t.username is null then
    raise exception 'المستخدم غير موجود' using errcode = 'P0002';
  end if;

  if p_event = 'password_reset' then
    -- كلمة مرور جديدة = بداية نظيفة: فكّ القفل وأنهِ الجلسات القديمة
    update public.profiles
       set failed_attempts = 0, locked_until = null
     where id = p_target;
    perform public.kill_user_sessions(p_target);

    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (p_actor, coalesce(a.full_name, 'غير معروف'), 'password_reset', 'profile',
            p_target::text, jsonb_build_object('username', t.username));

    perform public.telegram_send(
      '🔑 <b>تغيير كلمة مرور مستخدم</b>' || E'\n' ||
      'المستخدم: ' || tg_esc(t.full_name) || ' (<code>' || tg_esc(t.username) || '</code>)' || E'\n' ||
      'الدور: ' || tg_esc(role_label(t.role)) || E'\n' ||
      '<b>بواسطة: ' || tg_esc(coalesce(a.full_name, 'غير معروف')) || '</b>' || E'\n' ||
      'أُنهيت جلساته المفتوحة، وعليه الدخول بالكلمة الجديدة.');

  elsif p_event = 'created' then
    perform public.telegram_send(
      '👤 <b>حساب مستخدم جديد</b>' || E'\n' ||
      'الاسم: ' || tg_esc(t.full_name) || E'\n' ||
      'اسم المستخدم: <code>' || tg_esc(t.username) || '</code>' || E'\n' ||
      'الدور: ' || tg_esc(role_label(t.role)) || E'\n' ||
      '<b>أنشأه: ' || tg_esc(coalesce(a.full_name, 'غير معروف')) || '</b>');

  else
    raise exception 'حدث غير معروف: %', p_event using errcode = '22023';
  end if;
end $$;

revoke all on function public.account_event(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.account_event(text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- 3) إيقاف / تفعيل حساب، وتغيير الدور
-- ------------------------------------------------------------
create or replace function public.notify_profile_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_who text := public.actor_label();
begin
  if new.is_active is distinct from old.is_active then
    if not new.is_active then
      perform public.kill_user_sessions(new.id);
      perform public.telegram_send(
        '⛔ <b>تم إيقاف حساب</b>' || E'\n' ||
        'المستخدم: ' || tg_esc(new.full_name) || ' (<code>' || tg_esc(new.username) || '</code>)' || E'\n' ||
        'الدور: ' || tg_esc(role_label(new.role)) || E'\n' ||
        '<b>أوقفه: ' || tg_esc(v_who) || '</b>' || E'\n' ||
        'لن يستطيع الدخول، وأُنهيت جلساته المفتوحة.');
    else
      perform public.telegram_send(
        '✅ <b>إعادة تفعيل حساب</b>' || E'\n' ||
        'المستخدم: ' || tg_esc(new.full_name) || ' (<code>' || tg_esc(new.username) || '</code>)' || E'\n' ||
        'الدور: ' || tg_esc(role_label(new.role)) || E'\n' ||
        '<b>فعّله: ' || tg_esc(v_who) || '</b>');
    end if;
  end if;

  -- تغيير الدور من الواجهة فقط. عند إنشاء حساب تضبط دالة الخادم الدور
  -- بعد التريجر (auth.uid() = null)، ورسالة "حساب جديد" تكفي عنها.
  if new.role is distinct from old.role and auth.uid() is not null then
    perform public.telegram_send(
      '🔁 <b>تغيير دور مستخدم</b>' || E'\n' ||
      'المستخدم: ' || tg_esc(new.full_name) || ' (<code>' || tg_esc(new.username) || '</code>)' || E'\n' ||
      'من: ' || tg_esc(role_label(old.role)) || '  ←  إلى: <b>' || tg_esc(role_label(new.role)) || '</b>' || E'\n' ||
      '<b>بواسطة: ' || tg_esc(v_who) || '</b>');
  end if;

  return null;
end $$;

drop trigger if exists trg_notify_profile_change on public.profiles;
create trigger trg_notify_profile_change
  after update of is_active, role on public.profiles
  for each row
  when (old.is_active is distinct from new.is_active
     or old.role      is distinct from new.role)
  execute function public.notify_profile_change();

-- ------------------------------------------------------------
-- 4) المشاريع
--
--  مُشغِّل الإضافة على مستوى الجملة: الاستيراد من Excel قد يُدخل
--  عشرات المشاريع مرة واحدة — رسالة ملخّصة بدل عشرات الرسائل.
-- ------------------------------------------------------------
create or replace function public.notify_project_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_count integer;
  v_who text := public.actor_label();
begin
  select count(*) into v_count from new_rows;

  if v_count > 5 then
    perform public.telegram_send(
      '🏗 <b>إضافة مشاريع جديدة</b>' || E'\n' ||
      'العدد: ' || v_count || ' مشروع' || E'\n' ||
      '<b>بواسطة: ' || tg_esc(v_who) || '</b>');
    return null;
  end if;

  for r in select * from new_rows loop
    perform public.telegram_send(
      '🏗 <b>مشروع جديد</b>' || E'\n' ||
      'المشروع: <b>' || tg_esc(r.name) || '</b>' || E'\n' ||
      case when coalesce(r.notes, '') <> ''
           then 'ملاحظات: ' || tg_esc(left(r.notes, 300)) || E'\n' else '' end ||
      '<b>أضافه: ' || tg_esc(v_who) || '</b>');
  end loop;

  return null;
end $$;

drop trigger if exists trg_notify_project_insert on public.projects;
create trigger trg_notify_project_insert
  after insert on public.projects
  referencing new table as new_rows
  for each statement execute function public.notify_project_insert();

create or replace function public.notify_project_block()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_who text := public.actor_label();
begin
  if new.is_blocked then
    perform public.telegram_send(
      '⏸ <b>تم إيقاف مشروع</b>' || E'\n' ||
      'المشروع: <b>' || tg_esc(new.name) || '</b>' || E'\n' ||
      'السبب: ' || coalesce(nullif(tg_esc(new.block_reason), ''), '—') || E'\n' ||
      '<b>أوقفه: ' || tg_esc(v_who) || '</b>' || E'\n' ||
      'لن يُقبل عليه أي إذن جديد.');
  else
    perform public.telegram_send(
      '▶️ <b>إعادة تفعيل مشروع</b>' || E'\n' ||
      'المشروع: <b>' || tg_esc(new.name) || '</b>' || E'\n' ||
      '<b>فعّله: ' || tg_esc(v_who) || '</b>');
  end if;
  return null;
end $$;

drop trigger if exists trg_notify_project_block on public.projects;
create trigger trg_notify_project_block
  after update of is_blocked on public.projects
  for each row
  when (old.is_blocked is distinct from new.is_blocked)
  execute function public.notify_project_block();

create or replace function public.notify_project_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_who text := public.actor_label();
begin
  for r in select * from old_rows loop
    perform public.telegram_send(
      '🗑 <b>حذف مشروع</b>' || E'\n' ||
      'المشروع: <b>' || tg_esc(r.name) || '</b>' || E'\n' ||
      '<b>حذفه: ' || tg_esc(v_who) || '</b>');
  end loop;
  return null;
end $$;

drop trigger if exists trg_notify_project_delete on public.projects;
create trigger trg_notify_project_delete
  after delete on public.projects
  referencing old table as old_rows
  for each statement execute function public.notify_project_delete();

-- ------------------------------------------------------------
-- 5) منح صلاحية حساسة
--
--  من يملك هذه الصلاحيات يملك النظام عمليًا: يدير الحسابات، ويغيّر
--  كلمات المرور، ويستورد البيانات مباشرة. منحها لأحد يستحق رسالة.
--  (تُتخطّى عند التشغيل من SQL Editor، ومنها تشغيل هذا الملف نفسه.)
-- ------------------------------------------------------------
create or replace function public.is_sensitive_permission(p_code text)
returns boolean
language sql
immutable
as $$
  select p_code in ('manage_users', 'reset_password', 'manage_settings', 'import_data');
$$;

create or replace function public.notify_role_grant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_label text;
begin
  if auth.uid() is null or not public.is_sensitive_permission(new.permission_code) then
    return null;
  end if;
  select label into v_label from public.permissions where code = new.permission_code;

  perform public.telegram_send(
    '🛡 <b>منح صلاحية حساسة لدور</b>' || E'\n' ||
    'الصلاحية: <b>' || tg_esc(coalesce(v_label, new.permission_code)) || '</b>' || E'\n' ||
    'الدور: ' || tg_esc(role_label(new.role_code)) || E'\n' ||
    '<b>بواسطة: ' || tg_esc(public.my_name()) || '</b>');
  return null;
end $$;

drop trigger if exists trg_notify_role_grant on public.role_permissions;
create trigger trg_notify_role_grant
  after insert on public.role_permissions
  for each row execute function public.notify_role_grant();

create or replace function public.notify_user_grant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_label text;
  t record;
begin
  if auth.uid() is null
     or not new.granted
     or not public.is_sensitive_permission(new.permission_code)
     or (tg_op = 'UPDATE' and old.granted) then
    return null;
  end if;

  select label into v_label from public.permissions where code = new.permission_code;
  select full_name, username into t from public.profiles where id = new.user_id;

  perform public.telegram_send(
    '🛡 <b>منح صلاحية حساسة لمستخدم</b>' || E'\n' ||
    'الصلاحية: <b>' || tg_esc(coalesce(v_label, new.permission_code)) || '</b>' || E'\n' ||
    'المستخدم: ' || tg_esc(t.full_name) || ' (<code>' || tg_esc(t.username) || '</code>)' || E'\n' ||
    '<b>بواسطة: ' || tg_esc(public.my_name()) || '</b>');
  return null;
end $$;

drop trigger if exists trg_notify_user_grant on public.user_permissions;
create trigger trg_notify_user_grant
  after insert or update of granted on public.user_permissions
  for each row execute function public.notify_user_grant();

commit;

-- ------------------------------------------------------------
-- 6) تجربة
-- ------------------------------------------------------------
-- أضف مشروعًا تجريبيًا من الواجهة، ثم أوقفه، ثم احذفه — ثلاث رسائل.
-- أوقف حسابًا تجريبيًا ثم فعّله — رسالتان.
--
-- للتأكد أن الصلاحية الجديدة ظهرت ومن يملكها:
-- select r.label from public.role_permissions rp
--   join public.roles r on r.code = rp.role_code
--  where rp.permission_code = 'reset_password';
--
-- لمتابعة حالة الرسائل المرسلة:
-- select id, status_code, created from net._http_response order by created desc limit 10;
