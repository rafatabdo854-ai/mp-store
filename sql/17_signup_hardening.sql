-- ============================================================
--  17_signup_hardening.sql
--  إغلاق ثغرة رفع الصلاحية عند التسجيل
--  شغّله بعد 16_delete_alerts.sql
--
--  المشكلة: handle_new_user كانت تأخذ الدور من raw_user_meta_data،
--  وهي بيانات يرسلها العميل. أي طلب signUp بمفتاح anon يستطيع أن
--  يحمل role:"admin" فيخرج صاحبه مديرًا للنظام.
--
--  المبدأ: لا يُشتق أي دور من بيانات يرسلها العميل. الحساب الجديد
--  يولد "مُطّلع" دائمًا، والترقية عملية منفصلة محمية بـ manage_users.
-- ============================================================

-- ------------------------------------------------------------
-- 1) التسجيل ينتج دائمًا دور viewer
--
--    username وfull_name يبقيان من الميتاداتا لأنهما اسمان للعرض
--    لا يمنحان شيئًا؛ والدور وحده هو ما يُتجاهل.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, full_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''),
             split_part(new.email, '@', 1)),
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
             split_part(new.email, '@', 1)),
    'viewer'          -- ثابت: لا يُقرأ من العميل إطلاقًا
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2) حارس على تغيير الدور
--
--    سياسة p_profiles_write تشترط manage_users بالفعل، لكن هذا
--    التريجر يضيف طبقتين لا تغطيهما السياسة:
--      أ) لا أحد يرقّي نفسه — حتى المدير — فيبقى كل ترقٍّ فعلًا
--         يقوم به شخص آخر ويظهر في سجل التدقيق باسمه.
--      ب) لا يجوز أن يبقى النظام بلا مدير نشط واحد على الأقل.
-- ------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admins integer;
begin
  -- (أ) منع ترقية النفس
  if new.role is distinct from old.role and new.id = auth.uid() then
    raise exception 'لا يمكنك تغيير دورك بنفسك. اطلب ذلك من مدير آخر.'
      using errcode = '42501';
  end if;

  -- (ب) آخر مدير نشط
  if (old.role = 'admin' and new.role <> 'admin')
     or (old.role = 'admin' and old.is_active and not new.is_active) then
    select count(*) into v_admins
      from public.profiles
     where role = 'admin' and is_active and id <> old.id;
    if v_admins = 0 then
      raise exception 'لا يمكن إزالة آخر مدير نشط في النظام.'
        using errcode = 'P0001';
    end if;
  end if;

  -- أثر واضح في سجل التدقيق لكل تغيير دور أو تفعيل
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active then
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), public.my_name(), 'update', 'profile', old.id::text,
            jsonb_build_object(
              'from_role', old.role, 'to_role', new.role,
              'from_active', old.is_active, 'to_active', new.is_active));
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_profile_role on public.profiles;
create trigger trg_guard_profile_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ------------------------------------------------------------
-- 3) تنظيف ما قد يكون تسرّب
--
--    شغّل هذا الاستعلام وراجع النتيجة بعينك قبل أي شيء: أي حساب
--    لا تعرفه، أو أُنشئ في وقت لم تكن تنشئ فيه حسابات، هو مشتبه به.
-- ------------------------------------------------------------
-- select p.id, p.username, p.full_name, p.role, p.is_active, u.created_at
--   from public.profiles p
--   join auth.users u on u.id = p.id
--  order by u.created_at desc;

--  ولتعطيل حساب مشبوه فورًا (بدل حذفه، حتى يبقى أثره في السجل):
-- update public.profiles set is_active = false, role = 'viewer'
--  where username = 'اسم_الحساب_المشبوه';

-- ------------------------------------------------------------
-- 4) تحقّق بعد التشغيل — يجب ألّا يعود أي صف
-- ------------------------------------------------------------
--  دالة التسجيل ما زالت تقرأ الدور من العميل؟
-- select 1 from pg_proc
--  where proname = 'handle_new_user'
--    and prosrc like '%raw_user_meta_data->>''role''%';
