-- ============================================================
--  حضور المستخدمين — من يعمل على النظام الآن ومتى ظهر آخر مرة
--  شغّله بعد 09_permissions.sql
--
--  طبقتان:
--   1) "متصل الآن" فورية عبر Supabase Realtime Presence — بلا أي كتابة
--      في قاعدة البيانات، وتختفي وحدها لحظة إغلاق التبويب.
--   2) "آخر ظهور" دائمة في هذا العمود — تبقى بعد الخروج، وتجيب عن
--      سؤال مختلف: من لم يستخدم النظام منذ شهر؟
-- ============================================================

-- ------------------------------------------------------------
--  صلاحيتان جديدتان: كل قيد في النظام يجب أن يمرّ عبر can()
--  لا عبر اسم دور مكتوب في الكود، وإلا لزم تعديل SQL لتغييره.
--
--  view_presence : من يرى من يعمل على النظام الآن
--  view_auth_log : من يقرأ سجل محاولات الدخول
--
--  كانا مربوطين باسم الدور مباشرة، وهذا يخلط بين أمرين مختلفين:
--  "يرى من يعمل الآن" ليس بالضرورة "يدير المستخدمين".
-- ------------------------------------------------------------
insert into public.permissions (code, label, category, sort) values
  ('view_presence', 'رؤية المستخدمين المتصلين الآن', 'الإدارة', 84),
  ('view_auth_log', 'قراءة سجل محاولات الدخول',      'الإدارة', 86)
on conflict (code) do update
  set label = excluded.label, category = excluded.category, sort = excluded.sort;

-- تُمنح ابتداءً لمن كان يملكها فعليًا قبل هذا الملف، فلا يتغيّر شيء الآن
insert into public.role_permissions (role_code, permission_code) values
  ('admin', 'view_presence'),
  ('admin', 'view_auth_log')
on conflict do nothing;

alter table public.profiles
  add column if not exists last_seen timestamptz;

create index if not exists idx_profiles_last_seen
  on public.profiles (last_seen desc nulls last);

-- ------------------------------------------------------------
--  نبضة الحضور: كل مستخدم يحدّث صفّه هو فقط
--
--  عمدًا ليست UPDATE مباشرة عبر PostgREST: ذلك يتطلب سياسة كتابة
--  على profiles لكل مستخدم، وهي تفتح الباب لتعديل حقول أخرى.
--  الدالة تكتب حقلًا واحدًا لصفّ واحد ولا شيء غيره.
-- ------------------------------------------------------------
create or replace function public.touch_last_seen()
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  update public.profiles set last_seen = v_now where id = auth.uid();
  return v_now;
end $$;

revoke all on function public.touch_last_seen() from public, anon, authenticated;
grant execute on function public.touch_last_seen() to authenticated;

-- ------------------------------------------------------------
--  من ظهر مؤخرًا — للوحة المدير
--  النافذة بالدقائق: من لم تُسجَّل له نبضة خلالها يُعدّ غير متصل.
-- ------------------------------------------------------------
create or replace function public.active_users(p_minutes integer default 5)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x.last_seen desc nulls last), '[]'::jsonb) from (
    select p.id, p.username, p.full_name, p.role, p.is_active,
           p.last_seen,
           (p.last_seen is not null
            and p.last_seen > now() - make_interval(mins => greatest(p_minutes, 1))) as online
      from public.profiles p
     where public.can('view_presence') or p.id = auth.uid()
  ) x;
$$;

grant execute on function public.active_users(integer) to authenticated;

-- ------------------------------------------------------------
--  سجل الدخول: من اسم دور ثابت إلى صلاحية قابلة للتوزيع
--  كان 06_login_guard.sql يشترط my_role() = 'admin' مباشرة.
-- ------------------------------------------------------------
drop policy if exists p_auth_events_read on public.auth_events;
create policy p_auth_events_read on public.auth_events
  for select to authenticated
  using (public.can('view_auth_log'));

-- ------------------------------------------------------------
--  نبضة الحضور لا تُسجَّل في سجل التدقيق
--
--  trg_audit_profile يسجّل كل UPDATE على profiles. بدون هذا الاستثناء
--  يمتلئ السجل بآلاف الأسطر يوميًا ويصير عديم الفائدة — وهو يسجّل
--  تغيّر الدور والحالة فقط أصلًا، فنجعل ذلك صريحًا في شرط المُشغِّل.
-- ------------------------------------------------------------
drop trigger if exists trg_audit_profile on public.profiles;
create trigger trg_audit_profile
  after update on public.profiles
  for each row
  when (old.role is distinct from new.role
     or old.is_active is distinct from new.is_active)
  execute function public.audit_profile_change();

-- ------------------------------------------------------------
--  والحارس كذلك: لا داعي لفحص "آخر مدير" عند كل نبضة حضور
-- ------------------------------------------------------------
drop trigger if exists trg_guard_admin_profile on public.profiles;
create trigger trg_guard_admin_profile
  after update of role, is_active or delete on public.profiles
  for each statement execute function public.guard_last_admin();

-- ------------------------------------------------------------
--  تحقّق: من يملك الصلاحيتين الجديدتين الآن؟
-- ------------------------------------------------------------
-- select r.label, p.code
--   from public.role_permissions rp
--   join public.roles r on r.code = rp.role_code
--   join public.permissions p on p.code = rp.permission_code
--  where p.code in ('view_presence', 'view_auth_log')
--  order by r.sort;
