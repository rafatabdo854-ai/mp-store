-- 19) فصل صلاحية إذن الوارد عن إذن الصرف لكل مستخدم
-- (الجزء الأول نُفّذ يدويًا قبل هذا الملف، ومكرَّر هنا بصيغة آمنة لإعادة التشغيل)
alter table public.profiles
  add column if not exists can_receive boolean not null default true,
  add column if not exists can_issue   boolean not null default true;

create or replace function public.can_do_txn(t text)
returns boolean language sql stable security definer
set search_path = public as $$
  select case t
    when 'in'  then coalesce((select can_receive from profiles where id = auth.uid()), false)
    when 'out' then coalesce((select can_issue   from profiles where id = auth.uid()), false)
    else true
  end;
$$;

drop policy if exists txn_direction_guard on public.transactions;
create policy txn_direction_guard on public.transactions
  as restrictive for insert to authenticated with check (public.can_do_txn(type));
drop policy if exists txn_direction_guard_upd on public.transactions;
create policy txn_direction_guard_upd on public.transactions
  as restrictive for update to authenticated with check (public.can_do_txn(type));

-- =====================================================================
-- فصل صلاحية إذن الوارد عن إذن الصرف على مستوى كل مستخدم
-- يعتمد على: profiles.can_receive / profiles.can_issue + public.can_do_txn()
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) create_voucher: التحقق من صلاحية نوع الإذن (السطور الجديدة معلَّمة)
-- ---------------------------------------------------------------------
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
  if not public.can('create_voucher') then
    raise exception 'ليس لديك صلاحية تسجيل الأذون' using errcode = '42501';
  end if;
  if p_type not in ('in','out') then
    raise exception 'نوع إذن غير صحيح' using errcode = '22023';
  end if;

  -- >>> جديد: صلاحية الوارد/الصرف لكل مستخدم
  if not public.can_do_txn(p_type) then
    if p_type = 'in' then
      raise exception 'ليس لديك صلاحية تسجيل إذن وارد' using errcode = '42501';
    else
      raise exception 'ليس لديك صلاحية تسجيل إذن صرف' using errcode = '42501';
    end if;
  end if;
  -- <<< نهاية الجديد

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'الإذن لا يحتوي على أصناف' using errcode = '22023';
  end if;
  if p_date > (current_date + 1) then
    raise exception 'تاريخ الإذن في المستقبل' using errcode = '22007';
  end if;

  v_voucher := public.next_voucher_no(p_type);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    if v_qty <= 0 then
      raise exception 'الكمية يجب أن تكون أكبر من صفر' using errcode = '22023';
    end if;

    if v_line ? 'new_item' and v_line->'new_item' is not null
       and jsonb_typeof(v_line->'new_item') = 'object' then
      if not public.can('manage_items') then
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

    -- تحديث السعر عند الاستلام (إن أُرسل)
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

-- ---------------------------------------------------------------------
-- 2) delete_voucher: لا يحذف إلا نوع الإذن المسموح له به
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_voucher(p_voucher_no text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer;
begin
  if not public.can('delete_voucher') then
    raise exception 'ليس لديك صلاحية حذف الأذون' using errcode = '42501';
  end if;

  -- >>> جديد
  if exists (select 1 from public.transactions
             where voucher_no = p_voucher_no
               and not public.can_do_txn(type)) then
    raise exception 'ليس لديك صلاحية حذف هذا النوع من الأذون' using errcode = '42501';
  end if;
  -- <<< نهاية الجديد

  delete from public.transactions where voucher_no = p_voucher_no;
  get diagnostics v_n = row_count;
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(), 'delete', 'voucher', p_voucher_no,
          jsonb_build_object('rows', v_n));
  return v_n;
end $function$;

-- ---------------------------------------------------------------------
-- 3) guard_profile_role: قفل الثغرة — مدير النظام فقط يغيّر الصلاحيتين
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admins integer;
begin
  -- (أ) منع ترقية النفس
  if new.role is distinct from old.role and new.id = auth.uid() then
    raise exception 'لا يمكنك تغيير دورك بنفسك. اطلب ذلك من مدير آخر.'
      using errcode = '42501';
  end if;

  -- >>> جديد (ب2) صلاحيات الوارد/الصرف: مدير النظام فقط
  --     (auth.uid() يكون null عند التنفيذ من SQL Editor فيُسمح)
  if (new.can_receive is distinct from old.can_receive
      or new.can_issue is distinct from old.can_issue)
     and auth.uid() is not null
     and coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'تعديل صلاحيات الوارد/الصرف متاح لمدير النظام فقط.'
      using errcode = '42501';
  end if;
  -- <<< نهاية الجديد

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

  -- أثر واضح في سجل التدقيق (أُضيفت صلاحيتا الوارد/الصرف)
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.can_receive is distinct from old.can_receive
     or new.can_issue is distinct from old.can_issue then
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), public.my_name(), 'update', 'profile', old.id::text,
            jsonb_build_object(
              'from_role', old.role, 'to_role', new.role,
              'from_active', old.is_active, 'to_active', new.is_active,
              'from_can_receive', old.can_receive, 'to_can_receive', new.can_receive,
              'from_can_issue', old.can_issue, 'to_can_issue', new.can_issue));
  end if;

  return new;
end $function$;

commit;
