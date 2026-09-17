-- ============================================================
--  الأدوار والصلاحيات — من ثابتة في الكود إلى قابلة للتعديل
--  شغّله بعد 06_login_guard.sql
--
--  قبل هذا الملف: الصلاحيات مكتوبة في CASE داخل can()، وأي تغيير
--  يعني تعديل كود ونشرًا جديدًا.
--  بعده: جداول يعدّلها مدير النظام من الواجهة، وcan() تقرأ منها —
--  فالواجهة وقاعدة البيانات يستمدّان من مصدر واحد ولا يختلفان.
--
--  آمن على البيانات القائمة: يزرع نفس المصفوفة الحالية بالحرف،
--  فلا تتغيّر صلاحية أحد لحظة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الصلاحيات المتاحة في النظام
--    هذه قائمة يحدّدها الكود لا المستخدم: كل رمز هنا يقابل
--    فحصًا فعليًا في can() أو في الواجهة. إضافة رمز جديد بلا كود
--    يفحصه لا تفعل شيئًا، لذا الجدول يُزرع ولا يُعدَّل من الواجهة.
-- ------------------------------------------------------------
create table if not exists public.permissions (
  code     text primary key,
  label    text not null,
  category text not null default 'عام',
  sort     integer not null default 100
);

insert into public.permissions (code, label, category, sort) values
  ('manage_items',   'إدارة الأصناف (إضافة وتعديل وأرشفة)', 'الأصناف',   10),
  ('edit_price',     'تعديل الأسعار والتكاليف',              'الأصناف',   20),
  ('view_pricing',   'فتح شاشة التسعير',                     'الأصناف',   30),
  ('create_voucher', 'تسجيل أذون الوارد والصرف',             'الأذون',    40),
  ('delete_voucher', 'حذف الأذون',                           'الأذون',    50),
  ('stocktake',      'تنفيذ الجرد وترحيله',                  'المخزن',    60),
  ('accounting',     'فتح شاشة المحاسبة والمراجعة',          'المحاسبة',  70),
  ('view_audit',     'قراءة سجل التدقيق',                    'الإدارة',   80),
  ('manage_users',   'إدارة المستخدمين والأدوار',            'الإدارة',   90)
on conflict (code) do update
  set label = excluded.label, category = excluded.category, sort = excluded.sort;

-- ------------------------------------------------------------
-- 2) الأدوار
--    is_system: الأدوار الخمسة الأصلية — تُعدَّل صلاحياتها لكن لا تُحذف،
--    لأن الكود وملفات التوثيق تشير إليها بالاسم.
-- ------------------------------------------------------------
create table if not exists public.roles (
  code       text primary key,
  label      text not null,
  is_system  boolean not null default false,
  sort       integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.roles (code, label, is_system, sort) values
  ('admin',          'مدير النظام',      true, 10),
  ('deputy_manager', 'نائب مدير المخزن', true, 20),
  ('accountant',     'محاسب',            true, 30),
  ('staff',          'أمين مخزن',        true, 40),
  ('viewer',         'مُطّلع',            true, 50)
on conflict (code) do update
  set label = excluded.label, is_system = true, sort = excluded.sort;

-- ------------------------------------------------------------
-- 3) أي دور له أي صلاحيات — هذا هو الجدول الذي يعدّله المدير
-- ------------------------------------------------------------
create table if not exists public.role_permissions (
  role_code       text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

-- زرع المصفوفة الحالية كما هي بالحرف — لا تتغيّر صلاحية أحد الآن
insert into public.role_permissions (role_code, permission_code) values
  ('admin','manage_items'),   ('admin','edit_price'),     ('admin','view_pricing'),
  ('admin','create_voucher'), ('admin','delete_voucher'), ('admin','stocktake'),
  ('admin','accounting'),     ('admin','view_audit'),     ('admin','manage_users'),

  ('deputy_manager','manage_items'),   ('deputy_manager','edit_price'),
  ('deputy_manager','view_pricing'),   ('deputy_manager','create_voucher'),
  ('deputy_manager','stocktake'),

  ('accountant','edit_price'),     ('accountant','view_pricing'),
  ('accountant','delete_voucher'), ('accountant','accounting'),
  ('accountant','view_audit'),

  ('staff','create_voucher')
on conflict do nothing;

-- ------------------------------------------------------------
-- 4) ربط profiles.role بجدول الأدوار
--    كان قيد CHECK بقائمة ثابتة؛ يصبح مفتاحًا أجنبيًا حتى يصحّ
--    إنشاء أدوار جديدة. الأدوار الخمسة مزروعة أعلاه فلا يفشل القيد.
-- ------------------------------------------------------------
do $$
begin
  -- أي صف يحمل دورًا غير معروف يُعاد إلى أقل صلاحية بدل أن يفشل القيد
  update public.profiles p set role = 'viewer'
   where not exists (select 1 from public.roles r where r.code = p.role);

  if exists (
    select 1 from pg_constraint
     where conname = 'profiles_role_check'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles drop constraint profiles_role_check;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_role_fkey'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_fkey
      foreign key (role) references public.roles(code) on update cascade;
  end if;
end $$;

create index if not exists idx_profiles_role on public.profiles (role);

-- ------------------------------------------------------------
-- 5) can() تقرأ من الجدول بدل CASE الثابت
--    security definer: تتجاوز RLS على role_permissions، فلا يحتاج
--    المستخدم صلاحية قراءة الجدول لتُفحص صلاحيته.
-- ------------------------------------------------------------
create or replace function public.can(p_action text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.role_permissions rp
     where rp.role_code = public.my_role()
       and rp.permission_code = p_action
  );
$$;

/** صلاحيات المستخدم الحالي — تحمّلها الواجهة عند الدخول. */
create or replace function public.my_permissions()
returns text[]
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(rp.permission_code order by rp.permission_code), '{}')
    from public.role_permissions rp
   where rp.role_code = public.my_role();
$$;

grant execute on function public.my_permissions() to authenticated;

-- ------------------------------------------------------------
-- 6) الحارس: لا يجوز أن يخلو النظام من مدير
--
--    مدير واحد يشيل manage_users من دوره بالغلط = النظام مقفول
--    إلى الأبد، ولا أحد — ولا هو — يقدر يرجّعها من الواجهة.
--    الفحص هنا في قاعدة البيانات لا في الواجهة، لأن إخفاء زر
--    لا يمنع نداء الـ API مباشرة.
-- ------------------------------------------------------------
create or replace function public.admin_capable_count()
returns integer
language sql
stable security definer
set search_path to 'public'
as $$
  select count(*)::integer
    from public.profiles p
    join public.role_permissions rp on rp.role_code = p.role
   where p.is_active
     and rp.permission_code = 'manage_users';
$$;

create or replace function public.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.admin_capable_count() = 0 then
    raise exception
      'هذا التغيير يترك النظام بلا مدير قادر على إدارة المستخدمين، ولن يستطيع أحد التراجع عنه'
      using errcode = 'P0001';
  end if;
  return null;
end $$;

-- يُفحص بعد كل تغيير قد يُفقد آخر مدير، ويُلغى التغيير كله إن فعل
drop trigger if exists trg_guard_admin_perms on public.role_permissions;
create trigger trg_guard_admin_perms
  after insert or update or delete on public.role_permissions
  for each statement execute function public.guard_last_admin();

drop trigger if exists trg_guard_admin_profile on public.profiles;
create trigger trg_guard_admin_profile
  after update or delete on public.profiles
  for each statement execute function public.guard_last_admin();

-- ------------------------------------------------------------
-- 7) حماية الأدوار الأصلية من الحذف
-- ------------------------------------------------------------
create or replace function public.guard_role_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  if old.is_system then
    raise exception 'الدور «%» من أدوار النظام الأساسية ولا يمكن حذفه', old.label
      using errcode = 'P0001';
  end if;

  select count(*) into v_n from public.profiles where role = old.code;
  if v_n > 0 then
    raise exception 'لا يمكن حذف الدور «%»: مرتبط بـ % مستخدم. انقلهم لدور آخر أولًا',
      old.label, v_n using errcode = 'P0001';
  end if;

  return old;
end $$;

drop trigger if exists trg_guard_role_delete on public.roles;
create trigger trg_guard_role_delete
  before delete on public.roles
  for each row execute function public.guard_role_delete();

-- ------------------------------------------------------------
-- 8) تسجيل كل تغيير في الصلاحيات
--    تغيير الصلاحيات أخطر من أي تعديل آخر في النظام: يوسّع ما
--    يستطيع الآخرون فعله. لا يجوز أن يمرّ بلا أثر.
-- ------------------------------------------------------------
create or replace function public.audit_role_permission()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (
    auth.uid(), public.my_name(),
    case tg_op when 'INSERT' then 'create' else 'delete' end,
    'role_permission',
    coalesce(new.role_code, old.role_code),
    jsonb_build_object('permission', coalesce(new.permission_code, old.permission_code))
  );
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit_role_perm on public.role_permissions;
create trigger trg_audit_role_perm
  after insert or delete on public.role_permissions
  for each row execute function public.audit_role_permission();

create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (
    auth.uid(), public.my_name(),
    case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    'role',
    coalesce(new.code, old.code),
    case tg_op
      when 'UPDATE' then jsonb_build_object('from', old.label, 'to', new.label)
      else jsonb_build_object('label', coalesce(new.label, old.label))
    end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit_role on public.roles;
create trigger trg_audit_role
  after insert or update or delete on public.roles
  for each row execute function public.audit_role_change();

/** تغيير دور مستخدم أو إيقافه — الفجوة الأكبر في السجل حتى الآن */
create or replace function public.audit_profile_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.role is distinct from old.role then
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), public.my_name(), 'update', 'profile', new.username,
            jsonb_build_object('field', 'role', 'from', old.role, 'to', new.role));
  end if;

  if new.is_active is distinct from old.is_active then
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), public.my_name(), 'update', 'profile', new.username,
            jsonb_build_object('field', 'is_active', 'to', new.is_active));
  end if;

  return new;
end $$;

drop trigger if exists trg_audit_profile on public.profiles;
create trigger trg_audit_profile
  after update on public.profiles
  for each row execute function public.audit_profile_change();

-- ------------------------------------------------------------
-- 9) المستخدم الجديد: دور غير معروف في البيانات الوصفية
--    كان يُقبل بفضل CHECK المتسامح؛ مع المفتاح الأجنبي سيفشل
--    الإنشاء كله، فنُعيده إلى 'viewer' بهدوء.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_role text;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'viewer');
  if not exists (select 1 from public.roles where code = v_role) then
    v_role := 'viewer';
  end if;

  insert into public.profiles (id, username, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    v_role
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ------------------------------------------------------------
-- 10) الحماية
--     القراءة للجميع: الواجهة تحتاج أسماء الأدوار لتعرضها.
--     الكتابة لمن يملك manage_users فقط.
--     جدول permissions للقراءة فقط — قائمته يحدّدها الكود.
-- ------------------------------------------------------------
alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;

drop policy if exists p_perm_read on public.permissions;
create policy p_perm_read on public.permissions
  for select to authenticated using (true);

drop policy if exists p_roles_read on public.roles;
create policy p_roles_read on public.roles
  for select to authenticated using (true);

drop policy if exists p_roles_write on public.roles;
create policy p_roles_write on public.roles
  for all to authenticated
  using (public.can('manage_users'))
  with check (public.can('manage_users'));

drop policy if exists p_rp_read on public.role_permissions;
create policy p_rp_read on public.role_permissions
  for select to authenticated using (true);

drop policy if exists p_rp_write on public.role_permissions;
create policy p_rp_write on public.role_permissions
  for all to authenticated
  using (public.can('manage_users'))
  with check (public.can('manage_users'));

-- ------------------------------------------------------------
-- 11) تحقّق بعد التشغيل — يجب أن تعطي نفس المصفوفة السابقة
-- ------------------------------------------------------------
-- select r.label, string_agg(p.label, ' | ' order by p.sort) as صلاحيات
--   from public.roles r
--   left join public.role_permissions rp on rp.role_code = r.code
--   left join public.permissions p on p.code = rp.permission_code
--  group by r.label, r.sort order by r.sort;

-- select public.admin_capable_count();   -- لا بد أن يكون ١ أو أكثر
