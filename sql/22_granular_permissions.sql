-- ============================================================
--  22) صلاحيات تفصيلية لكل إجراء + تخصيص لكل مستخدم
--  شغّله بعد 21_dashboard_visibility.sql
--
--  الفكرة:
--   - كل شاشة وكل إجراء (إضافة مورد/مشروع/فئة، كل تقرير، التصدير،
--     الطباعة، النسخة الاحتياطية...) له رمز صلاحية في جدول permissions
--     فيظهر تلقائيًا في مصفوفة "الأدوار والصلاحيات".
--   - جدول user_permissions يتيح لمدير النظام أن يمنح أو يمنع أي
--     صلاحية لشخص بعينه فوق صلاحيات دوره (سماح / منع / حسب الدور).
--   - can() تقرأ تخصيص المستخدم أولًا ثم دوره — فكل RLS وكل دالة
--     تستخدم can() تحترم التخصيص تلقائيًا.
--
--  آمن على البيانات: الصلاحيات الجديدة تُمنح للأدوار التي كانت تملك
--  الإجراء فعلًا، فلا يتغيّر ما يستطيعه أحد لحظة التشغيل. ومفاتيح
--  profiles القديمة (can_receive/can_issue/can_view_price/
--  can_view_dashboard) تُنقل إلى user_permissions.
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1) كتالوج الصلاحيات (إضافة الجديد + ترتيب وتصنيف الكل)
-- ------------------------------------------------------------
insert into public.permissions (code, label, category, sort) values
  -- الشاشات
  ('view_dashboard',   'فتح لوحة القيادة',                      'الشاشات',           10),
  ('view_log',         'فتح سجل الحركات',                       'الشاشات',           20),
  ('view_reports',     'فتح شاشة التقارير',                     'الشاشات',           30),
  -- الأصناف
  ('add_item',         'إضافة صنف جديد',                        'الأصناف',          110),
  ('manage_items',     'تعديل وأرشفة الأصناف',                  'الأصناف',          120),
  ('delete_item',      'حذف الأصناف نهائيًا',                   'الأصناف',          130),
  ('edit_price',       'تعديل الأسعار والتكاليف',               'الأصناف',          140),
  ('view_pricing',     'رؤية الأسعار وشاشة التسعير',            'الأصناف',          150),
  -- الأذون
  ('voucher_in',       'تسجيل إذن وارد',                        'الأذون',           210),
  ('voucher_out',      'تسجيل إذن صرف',                         'الأذون',           220),
  ('delete_voucher',   'حذف الأذون',                            'الأذون',           230),
  -- القوائم
  ('add_supplier',     'إضافة مورد',                            'القوائم',          310),
  ('add_project',      'إضافة مشروع',                           'القوائم',          320),
  ('add_category',     'إضافة فئة',                             'القوائم',          330),
  -- المخزن
  ('stocktake',        'تنفيذ الجرد وترحيله',                   'المخزن',           410),
  ('delete_stocktake', 'حذف عمليات الجرد',                      'المخزن',           420),
  ('recalc_balances',  'إعادة حساب كل الأرصدة',                 'المخزن',           430),
  -- التقارير
  ('report_movement',  'تقرير حركة صنف خلال فترة',              'التقارير',         510),
  ('report_project',   'تقرير مصروفات مشروع',                   'التقارير',         520),
  ('report_top',       'تقرير الأصناف الأكثر صرفًا',            'التقارير',         530),
  ('report_low',       'تقرير أصناف تحت الحد الأدنى',           'التقارير',         540),
  -- التصدير والطباعة
  ('print_vouchers',   'طباعة الأذون',                          'التصدير والطباعة', 610),
  ('export_items',     'تنزيل الأصناف Excel',                   'التصدير والطباعة', 620),
  ('print_items',      'طباعة قائمة الأصناف',                   'التصدير والطباعة', 630),
  ('export_log',       'تنزيل سجل الحركات Excel',               'التصدير والطباعة', 640),
  ('print_log',        'طباعة سجل الحركات',                     'التصدير والطباعة', 650),
  ('export_reports',   'تنزيل التقارير Excel',                  'التصدير والطباعة', 660),
  ('print_reports',    'طباعة التقارير',                        'التصدير والطباعة', 670),
  ('export_pricing',   'تنزيل التسعير Excel',                   'التصدير والطباعة', 680),
  ('print_pricing',    'طباعة التسعير',                         'التصدير والطباعة', 690),
  ('export_accounting','تنزيل المحاسبة Excel',                  'التصدير والطباعة', 700),
  ('print_accounting', 'طباعة المحاسبة',                        'التصدير والطباعة', 710),
  ('export_audit',     'تنزيل سجل التدقيق Excel',               'التصدير والطباعة', 720),
  ('export_dashboard', 'تنزيل وطباعة قوائم لوحة القيادة',       'التصدير والطباعة', 730),
  -- المحاسبة
  ('accounting',       'فتح شاشة المحاسبة',                     'المحاسبة',         810),
  ('review_voucher',   'مراجعة أذون الشراء ومطابقة الفواتير',   'المحاسبة',         820),
  -- الإدارة
  ('view_audit',       'قراءة سجل التدقيق',                     'الإدارة',          910),
  ('view_auth_log',    'قراءة سجل محاولات الدخول',              'الإدارة',          920),
  ('view_presence',    'رؤية المستخدمين المتصلين الآن',         'الإدارة',          930),
  ('manage_users',     'إدارة المستخدمين والأدوار والصلاحيات',  'الإدارة',          940),
  ('manage_settings',  'تعديل إعدادات النظام',                  'الإدارة',          950),
  ('backup_data',      'تنزيل النسخة الاحتياطية الكاملة',       'الإدارة',          960),
  ('import_data',      'الإدخال المباشر واستيراد البيانات',     'الإدارة',          970)
on conflict (code) do update
  set label = excluded.label, category = excluded.category, sort = excluded.sort;

-- ------------------------------------------------------------
-- 2) منح الجديد لمن كان يملك الإجراء فعلًا (لا يتغيّر شيء الآن)
-- ------------------------------------------------------------
-- ما كان متاحًا للجميع بلا صلاحية
insert into public.role_permissions (role_code, permission_code)
select r.code, p.code
  from public.roles r
 cross join (values ('view_dashboard'), ('view_log'), ('view_reports'),
                    ('report_movement'), ('report_project'), ('report_top'), ('report_low'),
                    ('print_vouchers'), ('export_items'), ('print_items'),
                    ('export_log'), ('print_log'), ('export_reports'), ('print_reports'),
                    ('export_dashboard'), ('backup_data')) as p(code)
on conflict do nothing;

-- مشتقّة من صلاحية قائمة
insert into public.role_permissions (role_code, permission_code)
select rp.role_code, x.new_code
  from public.role_permissions rp
  join (values ('create_voucher', 'voucher_in'),
               ('create_voucher', 'voucher_out'),
               ('create_voucher', 'add_supplier'),
               ('create_voucher', 'add_project'),
               ('manage_items',   'add_item'),
               ('manage_items',   'add_category'),
               ('manage_items',   'recalc_balances'),
               ('view_pricing',   'export_pricing'),
               ('view_pricing',   'print_pricing'),
               ('accounting',     'export_accounting'),
               ('accounting',     'print_accounting'),
               ('view_audit',     'export_audit')) as x(old_code, new_code)
    on x.old_code = rp.permission_code
on conflict do nothing;

-- create_voucher صارت مشتقّة (وارد أو صرف) — لا تظهر في المصفوفة
delete from public.role_permissions where permission_code = 'create_voucher';
delete from public.permissions      where code = 'create_voucher';

-- ------------------------------------------------------------
-- 3) تخصيص الصلاحيات لكل مستخدم
-- ------------------------------------------------------------
create table if not exists public.user_permissions (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  granted         boolean not null,           -- true = سماح ، false = منع
  updated_at      timestamptz not null default now(),
  updated_by      uuid default auth.uid(),
  primary key (user_id, permission_code)
);

alter table public.user_permissions enable row level security;
grant select, insert, update, delete on public.user_permissions to authenticated;

-- ------------------------------------------------------------
-- 4) can() / my_permissions() / can_do_txn() — التخصيص أولًا ثم الدور
-- ------------------------------------------------------------
create or replace function public.can(p_action text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select case
    -- مشتقّة: من يسجّل وارد أو صرف "يسجّل أذونًا"
    when p_action = 'create_voucher' then
      public.can('voucher_in') or public.can('voucher_out')
    else coalesce(
      (select up.granted from public.user_permissions up
        where up.user_id = auth.uid() and up.permission_code = p_action),
      exists (select 1 from public.role_permissions rp
               where rp.role_code = public.my_role()
                 and rp.permission_code = p_action))
  end;
$$;

create or replace function public.my_permissions()
returns text[]
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(c order by c), '{}')
    from (select code as c from public.permissions
          union select 'create_voucher') x
   where public.can(c);
$$;
grant execute on function public.my_permissions() to authenticated;

create or replace function public.can_do_txn(t text)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select case t
    when 'in'  then public.can('voucher_in')
    when 'out' then public.can('voucher_out')
    else true
  end;
$$;

-- ------------------------------------------------------------
-- 5) سياسات user_permissions + حارس + سجل تدقيق
-- ------------------------------------------------------------
drop policy if exists p_uperm_read on public.user_permissions;
create policy p_uperm_read on public.user_permissions
  for select to authenticated
  using (user_id = auth.uid() or (select public.can('manage_users')));

drop policy if exists p_uperm_write on public.user_permissions;
create policy p_uperm_write on public.user_permissions
  for all to authenticated
  using ((select public.can('manage_users')))
  with check ((select public.can('manage_users')));

create or replace function public.guard_user_permission()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  -- لا يسحب المدير من نفسه إدارة المستخدمين (فيُقفل النظام عليه)
  if r.user_id = auth.uid() and r.permission_code = 'manage_users'
     and (tg_op = 'DELETE' or new.granted = false) then
    raise exception 'لا يمكنك سحب صلاحية إدارة المستخدمين من نفسك.'
      using errcode = '42501';
  end if;

  -- سجل التدقيق (يُتخطّى عند التشغيل من SQL Editor حيث لا يوجد مستخدم)
  if auth.uid() is not null then
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), public.my_name(), lower(tg_op), 'user_permission', r.user_id::text,
            jsonb_build_object('permission', r.permission_code,
                               'from', case when tg_op = 'INSERT' then null else old.granted end,
                               'to',   case when tg_op = 'DELETE' then null else new.granted end));
  end if;

  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_guard_user_permission on public.user_permissions;
create trigger trg_guard_user_permission
  before insert or update or delete on public.user_permissions
  for each row execute function public.guard_user_permission();

-- ------------------------------------------------------------
-- 6) نقل مفاتيح profiles القديمة إلى التخصيص (المنع فقط)
--    (تُنفَّذ بعد إنشاء الحارس؛ auth.uid() = null من SQL Editor)
-- ------------------------------------------------------------
insert into public.user_permissions (user_id, permission_code, granted)
select id, 'voucher_in', false from public.profiles where can_receive = false
union all
select id, 'voucher_out', false from public.profiles where can_issue = false
union all
select id, 'view_pricing', false from public.profiles where can_view_price = false
union all
select id, 'view_dashboard', false from public.profiles where can_view_dashboard = false
on conflict (user_id, permission_code) do nothing;

-- ------------------------------------------------------------
-- 7) ربط القيود في قاعدة البيانات بالصلاحيات الجديدة
-- ------------------------------------------------------------
drop policy if exists p_sup_write on public.suppliers;
create policy p_sup_write on public.suppliers for all to authenticated
  using ((select public.can('add_supplier')))
  with check ((select public.can('add_supplier')));

drop policy if exists p_prj_write on public.projects;
create policy p_prj_write on public.projects for all to authenticated
  using ((select public.can('add_project')))
  with check ((select public.can('add_project')));

drop policy if exists p_cat_write on public.categories;
create policy p_cat_write on public.categories for all to authenticated
  using ((select public.can('add_category')))
  with check ((select public.can('add_category')));

drop policy if exists p_items_insert on public.items;
create policy p_items_insert on public.items
  for insert to authenticated
  with check ((select public.can('add_item')));

create or replace function public.recalc_balances()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.can('recalc_balances') then
    raise exception 'غير مصرح لك بإعادة حساب الأرصدة' using errcode = '42501';
  end if;
  update public.items i
     set balance = i.opening_balance + coalesce(m.net, 0)
    from (select item_id, sum(case when type='in' then qty else -qty end) net
            from public.transactions group by item_id) m
   where m.item_id = i.id;
  update public.items i set balance = i.opening_balance
   where not exists (select 1 from public.transactions t where t.item_id = i.id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ------------------------------------------------------------
-- 8) create_voucher: صنف جديد = add_item، ومورد/مشروع جديد يحتاج صلاحيته
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_voucher(p_type text, p_date date, p_party text, p_project text, p_notes text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_voucher text;
  v_line jsonb;
  v_item public.items%rowtype;
  v_item_id text;
  v_qty integer;
  v_name text;
  v_actor uuid := auth.uid();
  v_actor_name text := public.my_name();
  v_count integer := 0;
  v_total integer := 0;
begin
  if p_type not in ('in','out') then
    raise exception 'نوع إذن غير صحيح' using errcode = '22023';
  end if;

  if not public.can_do_txn(p_type) then
    if p_type = 'in' then
      raise exception 'ليس لديك صلاحية تسجيل إذن وارد' using errcode = '42501';
    else
      raise exception 'ليس لديك صلاحية تسجيل إذن صرف' using errcode = '42501';
    end if;
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'الإذن لا يحتوي على أصناف' using errcode = '22023';
  end if;
  if p_date > (current_date + 1) then
    raise exception 'تاريخ الإذن في المستقبل' using errcode = '22007';
  end if;

  -- مورد / مشروع غير مسجَّل: يُضاف تلقائيًا فقط لمن يملك صلاحية إضافته
  if p_type = 'in' and coalesce(p_party,'') <> ''
     and not exists (select 1 from public.suppliers where name = p_party)
     and not public.can('add_supplier') then
    raise exception 'المورد "%" غير مسجَّل، وليس لديك صلاحية إضافة مورد جديد', p_party
      using errcode = '42501';
  end if;
  if coalesce(p_project,'') <> ''
     and not exists (select 1 from public.projects where name = p_project)
     and not public.can('add_project') then
    raise exception 'المشروع "%" غير مسجَّل، وليس لديك صلاحية إضافة مشروع جديد', p_project
      using errcode = '42501';
  end if;

  v_voucher := public.next_voucher_no(p_type);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    if v_qty <= 0 then
      raise exception 'الكمية يجب أن تكون أكبر من صفر' using errcode = '22023';
    end if;

    if v_line ? 'new_item' and v_line->'new_item' is not null
       and jsonb_typeof(v_line->'new_item') = 'object' then
      if not public.can('add_item') then
        raise exception 'ليس لديك صلاحية إضافة أصناف جديدة' using errcode = '42501';
      end if;
      v_item_id := public.next_item_id();
      insert into public.items (id, code, category, brand, name, spec, unit,
                                opening_balance, balance, threshold,
                                base_price, extra_costs, created_by)
      values (
        v_item_id,
        public.next_item_code(v_line->'new_item'->>'category'),
        coalesce(v_line->'new_item'->>'category','غير مصنّف'),
        coalesce(v_line->'new_item'->>'brand',''),
        coalesce(v_line->'new_item'->>'name','بدون اسم'),
        coalesce(v_line->'new_item'->>'spec',''),
        coalesce(v_line->'new_item'->>'unit','قطعة'),
        0, 0,
        coalesce((v_line->'new_item'->>'threshold')::integer, 5),
        coalesce((v_line->>'base_price')::numeric, 0),
        coalesce((v_line->>'extra_costs')::numeric, 0),
        v_actor
      );
    else
      v_item_id := v_line->>'item_id';
    end if;

    select * into v_item from public.items where id = v_item_id;
    if not found then
      raise exception 'الصنف % غير موجود', v_item_id using errcode = 'P0002';
    end if;
    if v_item.is_archived then
      raise exception 'الصنف % مؤرشف ولا يمكن استخدامه', v_item.code using errcode = '22023';
    end if;

    if p_type = 'in' and (v_line ? 'base_price') and public.can('edit_price') then
      update public.items
         set base_price  = coalesce((v_line->>'base_price')::numeric, base_price),
             extra_costs = coalesce((v_line->>'extra_costs')::numeric, extra_costs),
             updated_at  = now()
       where id = v_item_id;
    end if;

    v_name := trim(coalesce(v_item.brand,'') || ' ' || v_item.name);

    insert into public.transactions
      (type, voucher_no, txn_date, item_id, item_name, qty, unit_price,
       party, project, notes, created_by, created_by_name)
    values
      (p_type, v_voucher, p_date, v_item_id, v_name, v_qty,
       coalesce((v_line->>'base_price')::numeric, 0) + coalesce((v_line->>'extra_costs')::numeric, 0),
       coalesce(p_party,''), coalesce(p_project,''), coalesce(p_notes,''),
       v_actor, v_actor_name);

    v_count := v_count + 1;
    v_total := v_total + v_qty;
  end loop;

  if coalesce(p_party,'') <> '' and p_type = 'in' then
    insert into public.suppliers (name) values (p_party) on conflict do nothing;
  end if;
  if coalesce(p_project,'') <> '' then
    insert into public.projects (name) values (p_project) on conflict do nothing;
  end if;

  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (v_actor, v_actor_name, 'create', 'voucher', v_voucher,
          jsonb_build_object('type', p_type, 'lines', v_count, 'qty', v_total));

  return jsonb_build_object('voucher_no', v_voucher, 'lines', v_count, 'total_qty', v_total);
end $function$;

commit;

-- ------------------------------------------------------------
-- تحقّق بعد التشغيل:
--   select category, count(*) from public.permissions group by 1 order by min(sort);
--   select * from public.user_permissions;
--   select public.my_permissions();   -- من التطبيق، لا من SQL Editor
-- ------------------------------------------------------------
