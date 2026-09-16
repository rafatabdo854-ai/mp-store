-- ============================================================
--  الدوال والمُشغِّلات (Functions & Triggers)  — شغّله بعد 01_schema.sql
-- ============================================================

-- ------------------------------------------------------------
-- دور المستخدم الحالي (تُستخدم داخل سياسات الحماية)
-- ------------------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles
                   where id = auth.uid() and is_active), 'none');
$$;

create or replace function public.my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = auth.uid()), 'غير معروف');
$$;

-- من يملك صلاحية إنشاء الأذون / تعديل الأصناف / حذف الحركات
create or replace function public.can(p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_action
    when 'manage_items'   then public.my_role() in ('admin','deputy_manager')
    when 'edit_price'     then public.my_role() in ('admin','deputy_manager','accountant')
    when 'create_voucher' then public.my_role() in ('admin','deputy_manager','staff')
    when 'delete_voucher' then public.my_role() in ('admin','accountant')
    when 'stocktake'      then public.my_role() in ('admin','deputy_manager')
    when 'manage_users'   then public.my_role() = 'admin'
    else false end;
$$;

-- ------------------------------------------------------------
-- تسجيل مستخدم جديد -> إنشاء profile تلقائيًا
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'viewer')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- تحديث رصيد الصنف تلقائيًا مع كل حركة  (أسرع من حسابه وقت العرض)
-- ------------------------------------------------------------
create or replace function public.apply_txn_to_balance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_allow_negative boolean;
  v_new_balance integer;
begin
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

drop trigger if exists trg_txn_balance on public.transactions;
create trigger trg_txn_balance
  after insert or update or delete on public.transactions
  for each row execute function public.apply_txn_to_balance();

-- إعادة حساب كل الأرصدة من الحركات (للصيانة أو بعد الاستيراد)
create or replace function public.recalc_balances()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.can('manage_items') then
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
-- ترقيم الأذون: آمن حتى لو سجّل مستخدمان في نفس اللحظة
-- ------------------------------------------------------------
create or replace function public.next_voucher_no(p_type text)
returns text language plpgsql security definer set search_path = public as $$
declare v_no integer;
begin
  update public.voucher_counters set last_no = last_no + 1
   where type = p_type returning last_no into v_no;
  if v_no is null then
    raise exception 'نوع الإذن غير صحيح: %', p_type using errcode = '22023';
  end if;
  return (case when p_type = 'in' then 'IN-' else 'OUT-' end) || lpad(v_no::text, 5, '0');
end $$;

-- ضبط العدّاد بعد استيراد بيانات قديمة (المدير فقط)
create or replace function public.set_voucher_counter(p_type text, p_value integer)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  insert into public.voucher_counters (type, last_no) values (p_type, greatest(p_value, 0))
  on conflict (type) do update set last_no = greatest(excluded.last_no, public.voucher_counters.last_no);
  return p_value;
end $$;

-- كود صنف جديد داخل الفئة
create or replace function public.next_item_code(p_category text)
returns text language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_n integer;
begin
  select prefix into v_prefix from public.categories where name = p_category;
  if v_prefix is null then
    v_prefix := upper(left(regexp_replace(coalesce(p_category,'GEN'), '[^A-Za-z]', '', 'g'), 3));
    if v_prefix = '' then v_prefix := 'GEN'; end if;
    insert into public.categories (name, prefix) values (p_category, v_prefix)
      on conflict (name) do nothing;
  end if;
  select coalesce(max(nullif(regexp_replace(code, '^.*-', ''), '')::integer), 0) + 1
    into v_n from public.items where code like v_prefix || '-%';
  return v_prefix || '-' || lpad(v_n::text, 4, '0');
end $$;

create or replace function public.next_item_id()
returns text language sql security definer set search_path = public as $$
  select 'IT' || lpad((coalesce(max(nullif(regexp_replace(id,'^IT','') ,'')::integer),0) + 1)::text, 4, '0')
    from public.items;
$$;

-- ------------------------------------------------------------
-- إنشاء إذن كامل في عملية واحدة (Atomic) — كل الأسطر تنجح أو لا شيء
--   p_lines: [{"item_id":"IT0001","qty":5,"base_price":0,"extra_costs":0,
--              "new_item":{"category":"...","brand":"...","name":"...","spec":"...",
--                          "unit":"قطعة","threshold":5}}]
-- ------------------------------------------------------------
create or replace function public.create_voucher(
  p_type text, p_date date, p_party text, p_project text, p_notes text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
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
end $$;

-- حذف إذن كامل
create or replace function public.delete_voucher(p_voucher_no text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.can('delete_voucher') then
    raise exception 'ليس لديك صلاحية حذف الأذون' using errcode = '42501';
  end if;
  delete from public.transactions where voucher_no = p_voucher_no;
  get diagnostics v_n = row_count;
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(), 'delete', 'voucher', p_voucher_no,
          jsonb_build_object('rows', v_n));
  return v_n;
end $$;

-- ------------------------------------------------------------
-- ترحيل الجرد: يحفظ الجلسة ويُنشئ إذني تسوية (زيادة / عجز)
-- ------------------------------------------------------------
create or replace function public.post_stocktake(
  p_title text, p_date date, p_notes text, p_lines jsonb, p_post boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_line jsonb; v_diff integer;
  v_in text; v_out text; v_vouchers text[] := '{}';
  v_actor uuid := auth.uid(); v_actor_name text := public.my_name();
begin
  if not public.can('stocktake') then
    raise exception 'ليس لديك صلاحية تنفيذ الجرد' using errcode = '42501';
  end if;

  insert into public.stocktakes (title, stk_date, notes, created_by, created_by_name)
  values (coalesce(nullif(p_title,''),'جرد ' || to_char(p_date,'YYYY-MM-DD')),
          p_date, coalesce(p_notes,''), v_actor, v_actor_name)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.stocktake_lines
      (stocktake_id, item_id, item_code, item_name, system_qty, counted_qty, diff)
    values (v_id, v_line->>'item_id', coalesce(v_line->>'item_code',''),
            coalesce(v_line->>'item_name',''),
            coalesce((v_line->>'system_qty')::integer,0),
            coalesce((v_line->>'counted_qty')::integer,0),
            coalesce((v_line->>'counted_qty')::integer,0) - coalesce((v_line->>'system_qty')::integer,0));
  end loop;

  if p_post then
    if exists (select 1 from public.stocktake_lines where stocktake_id = v_id and diff > 0) then
      v_in := public.next_voucher_no('in');
      insert into public.transactions
        (type, voucher_no, txn_date, item_id, item_name, qty, party, notes, source,
         created_by, created_by_name)
      select 'in', v_in, p_date, l.item_id, l.item_name, l.diff,
             'تسوية جرد', 'ناتج عن جرد: ' || p_title, 'stocktake', v_actor, v_actor_name
        from public.stocktake_lines l where l.stocktake_id = v_id and l.diff > 0;
      v_vouchers := v_vouchers || v_in;
    end if;

    if exists (select 1 from public.stocktake_lines where stocktake_id = v_id and diff < 0) then
      v_out := public.next_voucher_no('out');
      insert into public.transactions
        (type, voucher_no, txn_date, item_id, item_name, qty, party, project, notes, source,
         created_by, created_by_name)
      select 'out', v_out, p_date, l.item_id, l.item_name, abs(l.diff),
             'تسوية جرد', p_title, 'ناتج عن جرد: ' || p_title, 'stocktake', v_actor, v_actor_name
        from public.stocktake_lines l where l.stocktake_id = v_id and l.diff < 0;
      v_vouchers := v_vouchers || v_out;
    end if;

    update public.stocktakes set posted = true, adjustment_vouchers = v_vouchers where id = v_id;
  end if;

  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (v_actor, v_actor_name, 'post', 'stocktake', v_id::text,
          jsonb_build_object('posted', p_post, 'vouchers', v_vouchers));

  return jsonb_build_object('id', v_id, 'posted', p_post, 'vouchers', v_vouchers);
end $$;

-- ------------------------------------------------------------
-- ملخّص لوحة القيادة في نداء واحد (بدل عدة استعلامات)
-- ------------------------------------------------------------
create or replace function public.dashboard_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'items_count',   (select count(*) from public.items where not is_archived),
    'total_stock',   (select coalesce(sum(balance),0) from public.items where not is_archived),
    'out_of_stock',  (select count(*) from public.items where not is_archived and balance <= 0),
    'low_stock',     (select count(*) from public.items
                       where not is_archived and balance > 0 and balance <= threshold),
    'stock_value',   (select coalesce(sum(balance * unit_price),0) from public.items where not is_archived),
    'txn_today',     (select count(*) from public.transactions where txn_date = current_date),
    'by_category',   (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                        select category,
                               count(*) items,
                               coalesce(sum(balance),0) qty,
                               coalesce(sum(balance*unit_price),0) value
                          from public.items where not is_archived
                         group by category order by 3 desc) x),
    'recent',        (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                        select type, voucher_no, txn_date, item_name, qty, party, project, created_by_name
                          from public.transactions
                         order by created_at desc limit 12) x),
    'top_out',       (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                        select item_id, item_name, sum(qty) qty
                          from public.transactions
                         where type='out' and txn_date >= current_date - 90
                         group by item_id, item_name order by 3 desc limit 5) x)
  );
$$;

-- تقرير حركة صنف خلال فترة
create or replace function public.item_movement(p_item_id text, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'opening', (select i.opening_balance
                  + coalesce((select sum(case when type='in' then qty else -qty end)
                                from public.transactions t
                               where t.item_id = p_item_id and t.txn_date < p_from), 0)
                  from public.items i where i.id = p_item_id),
    'rows',    (select coalesce(jsonb_agg(x order by x->>'txn_date', x->>'created_at'), '[]'::jsonb)
                  from (select to_jsonb(t) x from public.transactions t
                         where t.item_id = p_item_id
                           and t.txn_date between p_from and p_to) s),
    'total_in',  (select coalesce(sum(qty),0) from public.transactions
                   where item_id=p_item_id and type='in'  and txn_date between p_from and p_to),
    'total_out', (select coalesce(sum(qty),0) from public.transactions
                   where item_id=p_item_id and type='out' and txn_date between p_from and p_to)
  );
$$;

-- تقرير مشروع
create or replace function public.project_report(p_project text, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select t.item_id, t.item_name, sum(t.qty) qty,
           coalesce(max(i.unit_price),0) unit_price,
           sum(t.qty) * coalesce(max(i.unit_price),0) value
      from public.transactions t
      left join public.items i on i.id = t.item_id
     where t.type = 'out' and t.project = p_project
       and t.txn_date between p_from and p_to
     group by t.item_id, t.item_name
     order by 3 desc) x;
$$;
