-- ============================================================
--  23) شاشتا الموردين والمشاريع: إضافة، تعديل، حذف، منع التعامل
--  شغّله بعد 22_granular_permissions.sql
--
--  - الاسم هو المفتاح، والأذون تحفظه نصًّا — فتعديل الاسم يُحدِّث
--    الأذون القديمة معه حتى تبقى التقارير صحيحة.
--  - الحذف مسموح فقط لمن لم يُسجَّل عليه أي إذن؛ غير ذلك يُستخدم
--    "منع التعامل" فيبقى التاريخ ويُرفض أي إذن جديد عليه.
--  - كل التعديلات عبر دوال security definer تفحص الصلاحية وتسجّل
--    في سجل التدقيق.
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1) أعمدة الحالة
-- ------------------------------------------------------------
alter table public.suppliers
  add column if not exists is_blocked   boolean not null default false,
  add column if not exists block_reason text    not null default '';

alter table public.projects
  add column if not exists is_blocked   boolean not null default false,
  add column if not exists block_reason text    not null default '';

-- ------------------------------------------------------------
-- 2) الصلاحيات
-- ------------------------------------------------------------
insert into public.permissions (code, label, category, sort) values
  ('view_suppliers',  'فتح شاشة الموردين',            'الموردون', 305),
  ('add_supplier',    'إضافة مورد',                   'الموردون', 310),
  ('edit_supplier',   'تعديل بيانات مورد',            'الموردون', 311),
  ('block_supplier',  'منع / السماح بالتعامل مع مورد','الموردون', 312),
  ('delete_supplier', 'حذف مورد',                     'الموردون', 313),
  ('view_projects',   'فتح شاشة المشاريع',            'المشاريع', 315),
  ('add_project',     'إضافة مشروع',                  'المشاريع', 320),
  ('edit_project',    'تعديل بيانات مشروع',           'المشاريع', 321),
  ('block_project',   'إيقاف / تفعيل مشروع',          'المشاريع', 322),
  ('delete_project',  'حذف مشروع',                    'المشاريع', 323),
  ('add_category',    'إضافة فئة',                    'الفئات',   330),
  ('export_suppliers','تنزيل وطباعة قائمة الموردين',  'التصدير والطباعة', 735),
  ('export_projects', 'تنزيل وطباعة قائمة المشاريع',  'التصدير والطباعة', 736)
on conflict (code) do update
  set label = excluded.label, category = excluded.category, sort = excluded.sort;

-- الشاشتان كانتا ظاهرتين للجميع داخل الإعدادات
insert into public.role_permissions (role_code, permission_code)
select r.code, p.code
  from public.roles r
 cross join (values ('view_suppliers'), ('view_projects'),
                    ('export_suppliers'), ('export_projects')) as p(code)
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code)
select rp.role_code, x.new_code
  from public.role_permissions rp
  join (values ('manage_items', 'edit_supplier'),
               ('manage_items', 'block_supplier'),
               ('manage_items', 'edit_project'),
               ('manage_items', 'block_project'),
               ('manage_users', 'delete_supplier'),
               ('manage_users', 'delete_project')) as x(old_code, new_code)
    on x.old_code = rp.permission_code
on conflict do nothing;

-- ------------------------------------------------------------
-- 3) تعديل اسم في الأذون دون المساس بالأرصدة
--    trigger الرصيد كان يعكس ويعيد تطبيق الحركة عند أي UPDATE؛
--    الآن يتجاهل التحديث الذي لا يغيّر النوع أو الصنف أو الكمية.
-- ------------------------------------------------------------
create or replace function public.apply_txn_to_balance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_allow_negative boolean;
  v_new_balance integer;
begin
  if (tg_op = 'UPDATE'
      and new.type    is not distinct from old.type
      and new.item_id is not distinct from old.item_id
      and new.qty     is not distinct from old.qty) then
    return new;                       -- تعديل وصفي (اسم مورد/مشروع/ملاحظة)
  end if;

  select coalesce((value->>'allow_negative_stock')::boolean, false)
    into v_allow_negative from public.settings where key = 'stock';

  if (tg_op = 'DELETE') then
    update public.items
       set balance = balance - (case when old.type='in' then old.qty else -old.qty end),
           updated_at = now()
     where id = old.item_id;
    return old;
  end if;

  if (tg_op = 'UPDATE') then
    update public.items
       set balance = balance - (case when old.type='in' then old.qty else -old.qty end)
     where id = old.item_id;
  end if;

  update public.items
     set balance = balance + (case when new.type='in' then new.qty else -new.qty end),
         updated_at = now()
   where id = new.item_id
   returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'الصنف % غير موجود', new.item_id using errcode = 'P0002';
  end if;

  if v_new_balance < 0 and coalesce(v_allow_negative,false) = false then
    raise exception 'الرصيد لا يكفي للصنف % (الرصيد سيصبح %)', new.item_id, v_new_balance
      using errcode = 'P0001';
  end if;

  return new;
end $$;

-- ------------------------------------------------------------
-- 4) الاستخدام: عدد الأذون وآخر تعامل
-- ------------------------------------------------------------
create or replace function public.directory_usage(p_kind text)
returns table (name text, vouchers bigint, qty bigint, last_date date)
language sql stable security definer set search_path = public as $$
  select case when p_kind = 'supplier' then t.party else t.project end,
         count(distinct t.voucher_no), sum(t.qty)::bigint, max(t.txn_date)
    from public.transactions t
   where (p_kind = 'supplier' and t.type = 'in' and t.party <> '')
      or (p_kind = 'project' and t.project <> '')
   group by 1;
$$;
grant execute on function public.directory_usage(text) to authenticated;

-- ------------------------------------------------------------
-- 5) الموردون
-- ------------------------------------------------------------
create or replace function public.save_supplier(
  p_old_name text, p_name text, p_phone text, p_notes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_rows integer := 0;
begin
  if v_name = '' then
    raise exception 'أدخل اسم المورد' using errcode = '22023';
  end if;

  if p_old_name is null then
    if not public.can('add_supplier') then
      raise exception 'ليس لديك صلاحية إضافة مورد' using errcode = '42501';
    end if;
    if exists (select 1 from public.suppliers where name = v_name) then
      raise exception 'المورد "%" موجود بالفعل', v_name using errcode = '23505';
    end if;
    insert into public.suppliers (name, phone, notes)
    values (v_name, coalesce(p_phone,''), coalesce(p_notes,''));
  else
    if not public.can('edit_supplier') then
      raise exception 'ليس لديك صلاحية تعديل الموردين' using errcode = '42501';
    end if;
    if not exists (select 1 from public.suppliers where name = p_old_name) then
      raise exception 'المورد غير موجود' using errcode = 'P0002';
    end if;
    if v_name <> p_old_name and exists (select 1 from public.suppliers where name = v_name) then
      raise exception 'يوجد مورد آخر بالاسم "%"', v_name using errcode = '23505';
    end if;
    update public.suppliers
       set name = v_name, phone = coalesce(p_phone,''), notes = coalesce(p_notes,'')
     where name = p_old_name;
    if v_name <> p_old_name then
      update public.transactions set party = v_name
       where type = 'in' and party = p_old_name;
      get diagnostics v_rows = row_count;
    end if;
  end if;

  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(),
          case when p_old_name is null then 'create' else 'update' end,
          'supplier', v_name,
          jsonb_build_object('old_name', p_old_name, 'phone', p_phone, 'renamed_rows', v_rows));

  return jsonb_build_object('name', v_name, 'renamed_rows', v_rows);
end $$;

create or replace function public.set_supplier_blocked(
  p_name text, p_blocked boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can('block_supplier') then
    raise exception 'ليس لديك صلاحية منع التعامل مع الموردين' using errcode = '42501';
  end if;
  update public.suppliers
     set is_blocked = p_blocked,
         block_reason = case when p_blocked then coalesce(p_reason,'') else '' end
   where name = p_name;
  if not found then
    raise exception 'المورد غير موجود' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(), case when p_blocked then 'block' else 'unblock' end,
          'supplier', p_name, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.delete_supplier(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.can('delete_supplier') then
    raise exception 'ليس لديك صلاحية حذف الموردين' using errcode = '42501';
  end if;
  select count(distinct voucher_no) into v_n
    from public.transactions where type = 'in' and party = p_name;
  if v_n > 0 then
    raise exception 'لا يمكن حذف المورد: مسجَّل عليه % إذن. استخدم «منع التعامل» بدلًا من الحذف.', v_n
      using errcode = '23503';
  end if;
  delete from public.suppliers where name = p_name;
  if not found then
    raise exception 'المورد غير موجود' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(), 'delete', 'supplier', p_name, '{}'::jsonb);
end $$;

-- ------------------------------------------------------------
-- 6) المشاريع
-- ------------------------------------------------------------
create or replace function public.save_project(
  p_old_name text, p_name text, p_notes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_rows integer := 0;
begin
  if v_name = '' then
    raise exception 'أدخل اسم المشروع' using errcode = '22023';
  end if;

  if p_old_name is null then
    if not public.can('add_project') then
      raise exception 'ليس لديك صلاحية إضافة مشروع' using errcode = '42501';
    end if;
    if exists (select 1 from public.projects where name = v_name) then
      raise exception 'المشروع "%" موجود بالفعل', v_name using errcode = '23505';
    end if;
    insert into public.projects (name, notes) values (v_name, coalesce(p_notes,''));
  else
    if not public.can('edit_project') then
      raise exception 'ليس لديك صلاحية تعديل المشاريع' using errcode = '42501';
    end if;
    if not exists (select 1 from public.projects where name = p_old_name) then
      raise exception 'المشروع غير موجود' using errcode = 'P0002';
    end if;
    if v_name <> p_old_name and exists (select 1 from public.projects where name = v_name) then
      raise exception 'يوجد مشروع آخر بالاسم "%"', v_name using errcode = '23505';
    end if;
    update public.projects set name = v_name, notes = coalesce(p_notes,'')
     where name = p_old_name;
    if v_name <> p_old_name then
      update public.transactions set project = v_name where project = p_old_name;
      get diagnostics v_rows = row_count;
    end if;
  end if;

  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(),
          case when p_old_name is null then 'create' else 'update' end,
          'project', v_name,
          jsonb_build_object('old_name', p_old_name, 'renamed_rows', v_rows));

  return jsonb_build_object('name', v_name, 'renamed_rows', v_rows);
end $$;

create or replace function public.set_project_blocked(
  p_name text, p_blocked boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can('block_project') then
    raise exception 'ليس لديك صلاحية إيقاف المشاريع' using errcode = '42501';
  end if;
  update public.projects
     set is_blocked = p_blocked,
         block_reason = case when p_blocked then coalesce(p_reason,'') else '' end,
         status = case when p_blocked then 'closed' else 'active' end
   where name = p_name;
  if not found then
    raise exception 'المشروع غير موجود' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(), case when p_blocked then 'block' else 'unblock' end,
          'project', p_name, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.delete_project(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.can('delete_project') then
    raise exception 'ليس لديك صلاحية حذف المشاريع' using errcode = '42501';
  end if;
  select count(distinct voucher_no) into v_n
    from public.transactions where project = p_name;
  if v_n > 0 then
    raise exception 'لا يمكن حذف المشروع: مسجَّل عليه % إذن. استخدم «إيقاف» بدلًا من الحذف.', v_n
      using errcode = '23503';
  end if;
  delete from public.projects where name = p_name;
  if not found then
    raise exception 'المشروع غير موجود' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(), 'delete', 'project', p_name, '{}'::jsonb);
end $$;

grant execute on function public.save_supplier(text,text,text,text),
                          public.set_supplier_blocked(text,boolean,text),
                          public.delete_supplier(text),
                          public.save_project(text,text,text),
                          public.set_project_blocked(text,boolean,text),
                          public.delete_project(text)
  to authenticated;

-- الكتابة المباشرة على الجدولين: الإضافة فقط (التعديل والحذف عبر الدوال)
drop policy if exists p_sup_write on public.suppliers;
create policy p_sup_write on public.suppliers for insert to authenticated
  with check ((select public.can('add_supplier')));

drop policy if exists p_prj_write on public.projects;
create policy p_prj_write on public.projects for insert to authenticated
  with check ((select public.can('add_project')));

-- ------------------------------------------------------------
-- 7) create_voucher: رفض مورد ممنوع أو مشروع موقوف
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
  v_reason text;
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

  -- مورد ممنوع التعامل معه
  if p_type = 'in' and coalesce(p_party,'') <> '' then
    select block_reason into v_reason from public.suppliers
     where name = p_party and is_blocked;
    if found then
      raise exception 'المورد "%" ممنوع التعامل معه%', p_party,
        case when v_reason <> '' then ' — ' || v_reason else '' end
        using errcode = '42501';
    end if;
  end if;

  -- مشروع موقوف
  if coalesce(p_project,'') <> '' then
    select block_reason into v_reason from public.projects
     where name = p_project and is_blocked;
    if found then
      raise exception 'المشروع "%" موقوف ولا يُسجَّل عليه أذون%', p_project,
        case when v_reason <> '' then ' — ' || v_reason else '' end
        using errcode = '42501';
    end if;
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
