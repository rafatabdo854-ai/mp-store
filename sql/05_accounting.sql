-- ============================================================
--  الطبقة المحاسبية — التكلفة المتوسطة، تقييم المخزون، مراجعة الفواتير
--  شغّله بعد 04_seed.sql
--
--  كل شيء هنا idempotent: تشغيله على قاعدة بيانات تحتوي هذه الكائنات
--  بالفعل لا يغيّر بياناتها ولا يمسح شيئًا.
-- ============================================================

-- ------------------------------------------------------------
-- 1) أعمدة التكلفة
--    avg_cost  : المتوسط المرجّح لتكلفة الصنف، يُحدَّث مع كل وارد
--    unit_cost : تكلفة السطر وقت الحركة — تُجمَّد فلا يغيّرها تغيّر السعر لاحقًا
-- ------------------------------------------------------------
alter table public.items
  add column if not exists avg_cost numeric(14,4) not null default 0;

alter table public.transactions
  add column if not exists unit_cost numeric(14,4) not null default 0;

create index if not exists idx_txn_cost on public.transactions (type, txn_date)
  where unit_cost > 0;

-- ------------------------------------------------------------
-- 2) مراجعة أذون الشراء أمام فواتير الموردين
-- ------------------------------------------------------------
create table if not exists public.voucher_review (
  voucher_no       text primary key,
  invoice_no       text not null default '',
  invoice_amount   numeric(14,2),
  status           text not null default 'pending'
                   check (status in ('pending','matched','disputed')),
  notes            text not null default '',
  reviewed_by      uuid references public.profiles(id),
  reviewed_by_name text not null default '',
  reviewed_at      timestamptz not null default now()
);
comment on table public.voucher_review is 'مطابقة قيمة إذن الوارد مع فاتورة المورد';

-- ------------------------------------------------------------
-- 3) حساب التكلفة المتوسطة المرجّحة عند كل حركة
--    before insert: يقرأ الرصيد قبل أن يعدّله trg_txn_balance (وهو after)
-- ------------------------------------------------------------
create or replace function public.apply_cost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_bal integer; v_avg numeric; v_price numeric; v_base integer;
begin
  select balance, avg_cost into v_bal, v_avg from public.items where id = new.item_id;
  if not found then return new; end if;

  if new.type = 'in' then
    -- وارد بسعر: يدخل في المتوسط. وارد بلا سعر: يأخذ المتوسط الحالي
    v_price := case when coalesce(new.unit_price, 0) > 0 then new.unit_price
                    else coalesce(v_avg, 0) end;
    new.unit_cost := v_price;

    v_base := greatest(coalesce(v_bal, 0), 0);
    if (v_base + new.qty) > 0 then
      v_avg := ((v_base * coalesce(v_avg, 0)) + (new.qty * v_price)) / (v_base + new.qty);
    else
      v_avg := v_price;
    end if;

    update public.items set avg_cost = round(v_avg, 4) where id = new.item_id;
  else
    -- الصرف يُقيَّم بمتوسط التكلفة وقت الصرف
    new.unit_cost := coalesce(v_avg, 0);
  end if;

  return new;
end $$;

drop trigger if exists trg_txn_cost on public.transactions;
create trigger trg_txn_cost
  before insert on public.transactions
  for each row execute function public.apply_cost();

-- ------------------------------------------------------------
-- 4) تقرير تقييم المخزون: رصيد أول المدة، الوارد، المنصرف، رصيد آخر المدة
--    الرصيد الافتتاحي يُحسب رجوعًا من الرصيد الحالي بطرح حركات ما بعد p_to
-- ------------------------------------------------------------
create or replace function public.valuation_report(p_from date, p_to date)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  with mv as (
    select item_id,
           coalesce(sum(case when txn_date > p_to
                             then (case when type='in' then qty else -qty end) end), 0) as post_net,
           coalesce(sum(qty)             filter (where type='in'  and txn_date between p_from and p_to), 0) as in_qty,
           coalesce(sum(qty * unit_cost) filter (where type='in'  and txn_date between p_from and p_to), 0) as in_val,
           coalesce(sum(qty)             filter (where type='out' and txn_date between p_from and p_to), 0) as out_qty,
           coalesce(sum(qty * unit_cost) filter (where type='out' and txn_date between p_from and p_to), 0) as out_val
      from public.transactions group by item_id
  ),
  base_rows as (
    select i.id, i.code, trim(i.brand || ' ' || i.name) as label, i.category, i.unit,
           round(i.avg_cost, 2) as avg_cost,
           (i.balance - coalesce(m.post_net, 0)) as closing_qty,
           (i.balance - coalesce(m.post_net, 0)) - coalesce(m.in_qty, 0) + coalesce(m.out_qty, 0) as opening_qty,
           coalesce(m.in_qty, 0)  as in_qty,  round(coalesce(m.in_val, 0), 2)  as in_val,
           coalesce(m.out_qty, 0) as out_qty, round(coalesce(m.out_val, 0), 2) as out_val,
           round((i.balance - coalesce(m.post_net, 0)) * i.avg_cost, 2) as closing_val
      from public.items i
      left join mv m on m.item_id = i.id
     where not i.is_archived
  ),
  calc as (
    select *, round(closing_val - in_val + out_val, 2) as opening_val from base_rows
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (select jsonb_build_object(
                 'opening_val', round(coalesce(sum(opening_val),0), 2),
                 'in_val',      round(coalesce(sum(in_val),0), 2),
                 'out_val',     round(coalesce(sum(out_val),0), 2),
                 'closing_val', round(coalesce(sum(closing_val),0), 2),
                 'items',       count(*) filter (where closing_qty <> 0 or in_qty <> 0 or out_qty <> 0)
               ) from calc),
    'rows', (select coalesce(jsonb_agg(x order by (x->>'closing_val')::numeric desc), '[]'::jsonb)
               from (select to_jsonb(f) x from calc f
                      where f.closing_qty <> 0 or f.in_qty <> 0 or f.out_qty <> 0) s)
  );
$$;

-- ------------------------------------------------------------
-- 5) تكلفة المشاريع
-- ------------------------------------------------------------
create or replace function public.project_cost(p_from date, p_to date)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x.cost desc), '[]'::jsonb) from (
    select coalesce(nullif(project, ''), 'بدون مشروع') as project,
           count(distinct voucher_no) as vouchers,
           count(distinct item_id)    as items,
           sum(qty)                   as qty,
           round(sum(qty * unit_cost), 2) as cost
      from public.transactions
     where type = 'out' and txn_date between p_from and p_to
     group by 1) x;
$$;

create or replace function public.project_cost_detail(p_project text, p_from date, p_to date)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x.cost desc), '[]'::jsonb) from (
    select t.item_id, t.item_name, sum(t.qty) as qty,
           round(avg(t.unit_cost), 2) as avg_cost,
           round(sum(t.qty * t.unit_cost), 2) as cost
      from public.transactions t
     where t.type = 'out' and t.txn_date between p_from and p_to
       and coalesce(nullif(t.project, ''), 'بدون مشروع') = p_project
     group by t.item_id, t.item_name) x;
$$;

-- ------------------------------------------------------------
-- 6) أذون الشراء مع حالة مراجعتها المحاسبية
-- ------------------------------------------------------------
create or replace function public.purchase_vouchers(p_from date, p_to date)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x.txn_date desc), '[]'::jsonb) from (
    select t.voucher_no,
           min(t.txn_date)::text              as txn_date,
           max(t.party)                       as party,
           count(*)                           as lines,
           sum(t.qty)                         as qty,
           round(sum(t.qty * t.unit_cost), 2) as voucher_value,
           max(t.created_by_name)             as created_by_name,
           coalesce(max(v.status), 'pending') as status,
           max(v.invoice_no)                  as invoice_no,
           max(v.invoice_amount)              as invoice_amount,
           round(coalesce(max(v.invoice_amount), 0) - sum(t.qty * t.unit_cost), 2) as diff,
           max(v.reviewed_by_name)            as reviewed_by_name
      from public.transactions t
      left join public.voucher_review v on v.voucher_no = t.voucher_no
     where t.type = 'in' and t.txn_date between p_from and p_to
     group by t.voucher_no) x;
$$;

create or replace function public.set_voucher_review(
  p_voucher text, p_invoice_no text, p_amount numeric, p_status text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.my_role() not in ('admin','accountant') then
    raise exception 'المراجعة المحاسبية متاحة للمحاسب ومدير النظام فقط' using errcode = '42501';
  end if;
  if not exists (select 1 from public.transactions where voucher_no = p_voucher) then
    raise exception 'الإذن % غير موجود', p_voucher using errcode = 'P0002';
  end if;

  insert into public.voucher_review
    (voucher_no, invoice_no, invoice_amount, status, notes,
     reviewed_by, reviewed_by_name, reviewed_at)
  values (p_voucher, coalesce(p_invoice_no,''), p_amount, coalesce(p_status,'pending'),
          coalesce(p_notes,''), auth.uid(), public.my_name(), now())
  on conflict (voucher_no) do update set
    invoice_no       = excluded.invoice_no,
    invoice_amount   = excluded.invoice_amount,
    status           = excluded.status,
    notes            = excluded.notes,
    reviewed_by      = excluded.reviewed_by,
    reviewed_by_name = excluded.reviewed_by_name,
    reviewed_at      = now();

  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(), 'update', 'voucher_review', p_voucher,
          jsonb_build_object('status', p_status, 'invoice_no', p_invoice_no, 'amount', p_amount));

  return jsonb_build_object('voucher_no', p_voucher, 'status', p_status);
end $$;

-- ------------------------------------------------------------
-- 7) مراجعة الأسعار: أصناف بلا سعر، وارد بتكلفة صفر، وفجوة السعر عن التكلفة
-- ------------------------------------------------------------
create or replace function public.price_review(p_gap numeric default 25)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'missing', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select id, code, trim(brand || ' ' || name) as label, category, balance, unit
                    from public.items
                   where not is_archived and unit_price = 0 and balance > 0
                   order by balance desc limit 200) x),

    'zero_cost_in', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select t.voucher_no, t.txn_date::text as txn_date,
                         t.item_id, t.item_name, t.qty, t.party
                    from public.transactions t
                   where t.type = 'in' and coalesce(t.unit_cost, 0) = 0
                   order by t.txn_date desc limit 100) x),

    'gap', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select id, code, trim(brand || ' ' || name) as label,
                         round(unit_price, 2) as unit_price, round(avg_cost, 2) as avg_cost,
                         round(((unit_price - avg_cost) / nullif(avg_cost, 0)) * 100) as gap_pct,
                         balance
                    from public.items
                   where not is_archived and avg_cost > 0 and unit_price > 0
                     and abs((unit_price - avg_cost) / avg_cost) * 100 >= p_gap
                   order by abs((unit_price - avg_cost) / avg_cost) desc limit 100) x),

    'summary', (select jsonb_build_object(
                  'missing_count', count(*) filter (where unit_price = 0 and balance > 0),
                  'priced_count',  count(*) filter (where unit_price > 0),
                  'items',         count(*),
                  'value_at_cost', round(coalesce(sum(balance * avg_cost), 0), 2),
                  'value_at_last', round(coalesce(sum(balance * unit_price), 0), 2)
                ) from public.items where not is_archived)
  );
$$;

-- ------------------------------------------------------------
-- 8) إعادة بناء التكاليف من أول الحركات (صيانة — بعد استيراد أو تصحيح)
--    تمشي على الحركات بالترتيب الزمني وتعيد بناء المتوسط خطوة بخطوة
-- ------------------------------------------------------------
create or replace function public.recalc_avg_cost()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record; t record;
  v_bal numeric; v_avg numeric; v_price numeric; v_n integer := 0;
begin
  if not public.can('edit_price') then
    raise exception 'غير مصرح لك بإعادة حساب التكاليف' using errcode = '42501';
  end if;

  for r in select id, opening_balance, unit_price from public.items loop
    v_bal := coalesce(r.opening_balance, 0);
    v_avg := coalesce(r.unit_price, 0);

    for t in select id, type, qty, unit_price from public.transactions
              where item_id = r.id order by txn_date, created_at loop
      if t.type = 'in' then
        v_price := case when coalesce(t.unit_price, 0) > 0 then t.unit_price else v_avg end;
        if (greatest(v_bal, 0) + t.qty) > 0 then
          v_avg := ((greatest(v_bal, 0) * v_avg) + (t.qty * v_price)) / (greatest(v_bal, 0) + t.qty);
        else
          v_avg := v_price;
        end if;
        v_bal := v_bal + t.qty;
        update public.transactions set unit_cost = round(v_price, 4) where id = t.id;
      else
        v_bal := v_bal - t.qty;
        update public.transactions set unit_cost = round(v_avg, 4) where id = t.id;
      end if;
    end loop;

    update public.items set avg_cost = round(v_avg, 4) where id = r.id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- ------------------------------------------------------------
-- 9) تحليلات لوحة القيادة: معدل الاستهلاك، أيام التغطية، اقتراح الشراء
-- ------------------------------------------------------------
create or replace function public.dashboard_insights(p_days integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_days      integer := greatest(coalesce(p_days, 30), 1);
  v_from      date := current_date - v_days;
  v_prev_from date := current_date - (v_days * 2);
  v_result    jsonb;
begin
  with
  -- معدل الاستهلاك اليومي لكل صنف من واقع آخر ٩٠ يومًا
  rate as (
    select t.item_id, sum(t.qty)::numeric / 90.0 as per_day
      from public.transactions t
     where t.type = 'out' and t.txn_date >= current_date - 90
     group by t.item_id
  ),
  last_move as (
    select item_id, max(txn_date) as last_out
      from public.transactions where type = 'out' group by item_id
  ),
  -- كل صنف ومعه معدل استهلاكه وكم يومًا يكفيه رصيده الحالي
  enriched as (
    select i.id, i.code, i.category, i.brand, i.name, i.unit,
           i.balance, i.threshold, i.unit_price,
           coalesce(r.per_day, 0) as per_day,
           case when coalesce(r.per_day, 0) > 0
                then floor(i.balance / r.per_day)::integer end as days_cover,
           lm.last_out
      from public.items i
      left join rate r       on r.item_id = i.id
      left join last_move lm on lm.item_id = i.id
     where not i.is_archived
  ),
  -- حركة الفترة الحالية مقارنة بالفترة السابقة لها
  mv as (
    select
      coalesce(sum(qty) filter (where type = 'in'  and txn_date >= v_from), 0) as in_now,
      coalesce(sum(qty) filter (where type = 'out' and txn_date >= v_from), 0) as out_now,
      coalesce(sum(qty) filter (where type = 'in'  and txn_date >= v_prev_from and txn_date < v_from), 0) as in_prev,
      coalesce(sum(qty) filter (where type = 'out' and txn_date >= v_prev_from and txn_date < v_from), 0) as out_prev,
      count(distinct voucher_no) filter (where txn_date >= v_from) as vouchers_now,
      count(distinct voucher_no) filter (where txn_date >= v_prev_from and txn_date < v_from) as vouchers_prev
      from public.transactions where txn_date >= v_prev_from
  ),
  -- منحنى الوارد والصرف يومًا بيوم
  series as (
    select d::date as day,
           coalesce(sum(t.qty) filter (where t.type = 'in'),  0) as in_qty,
           coalesce(sum(t.qty) filter (where t.type = 'out'), 0) as out_qty
      from generate_series(v_from, current_date, interval '1 day') d
      left join public.transactions t on t.txn_date = d::date
     group by d order by d
  ),
  -- آخر إذن صرف طلب كل صنف رصيده سالب حاليًا — لمعرفة من يُعمل له
  -- أمر شراء، ولمن يُوجَّه السؤال عن سبب الصرف فوق الرصيد
  last_voucher as (
    select distinct on (t.item_id)
           t.item_id, t.voucher_no, t.txn_date, t.qty,
           t.party, t.project, t.created_by_name, t.created_at
      from public.transactions t
      join public.items i on i.id = t.item_id
     where t.type = 'out' and i.balance < 0
     order by t.item_id, t.created_at desc
  )
  select jsonb_build_object(
    'days', v_days,

    'kpi', (select jsonb_build_object(
              'items_count',  count(*),
              'total_stock',  coalesce(sum(balance), 0),
              'out_of_stock', count(*) filter (where balance <= 0),
              'low_stock',    count(*) filter (where balance > 0 and balance <= threshold),
              'unpriced',     count(*) filter (where unit_price = 0 and balance > 0),
              'stock_value',  coalesce(sum(balance * unit_price), 0),
              'urgent',       count(*) filter (where days_cover is not null and days_cover <= 14 and balance > 0),
              'stagnant',     count(*) filter (where balance > 0 and (last_out is null or last_out < current_date - 180)),
              'stagnant_value', coalesce(sum(balance * unit_price)
                                  filter (where balance > 0 and (last_out is null or last_out < current_date - 180)), 0),
              -- الأصناف التي رصيدها سالب فعليًا، لا الصفر فقط:
              -- الصفر نفاد، والسالب خطأ في التسجيل أو صرف بلا توريد
              'negative_count', count(*) filter (where balance < 0)
            ) from enriched),

    'movement', (select jsonb_build_object(
              'in_now', in_now, 'out_now', out_now,
              'in_prev', in_prev, 'out_prev', out_prev,
              'vouchers_now', vouchers_now, 'vouchers_prev', vouchers_prev,
              'out_change', case when out_prev > 0
                                 then round(((out_now - out_prev)::numeric / out_prev) * 100) end,
              'in_change',  case when in_prev > 0
                                 then round(((in_now - in_prev)::numeric / in_prev) * 100) end
            ) from mv),

    'series', (select coalesce(jsonb_agg(jsonb_build_object(
                'day', day, 'in_qty', in_qty, 'out_qty', out_qty) order by day), '[]'::jsonb) from series),

    -- أصناف على وشك النفاد، مرتبة بالأكثر إلحاحًا
    'risk', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                select id, code, trim(brand || ' ' || name) as label, unit,
                       balance, threshold, days_cover, round(per_day, 2) as per_day
                  from enriched
                 where balance > 0 and days_cover is not null and days_cover <= 45
                 order by days_cover, balance limit 10) x),

    -- اقتراح طلب شراء: يغطي ٤٥ يومًا للأصناف المهدَّدة أو التي تحت الحد
    'reorder', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                select id, code, trim(brand || ' ' || name) as label, unit, balance, threshold,
                       days_cover, unit_price,
                       greatest(ceil(per_day * 45)::integer - balance, threshold - balance, 1) as suggest_qty,
                       greatest(ceil(per_day * 45)::integer - balance, threshold - balance, 1) * unit_price as suggest_value
                  from enriched
                 where balance <= threshold
                    or (days_cover is not null and days_cover <= 30)
                 order by coalesce(days_cover, 0), balance limit 25) x),

    -- رأس مال راكد: رصيد بلا صرف منذ ١٨٠ يومًا
    'stagnant', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                select id, code, trim(brand || ' ' || name) as label, balance, unit_price,
                       balance * unit_price as value, last_out
                  from enriched
                 where balance > 0 and (last_out is null or last_out < current_date - 180)
                 order by balance * unit_price desc limit 10) x),

    'by_category', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                select category, count(*) as items, coalesce(sum(balance), 0) as qty,
                       coalesce(sum(balance * unit_price), 0) as value,
                       count(*) filter (where balance <= threshold) as at_risk
                  from enriched group by category order by 4 desc) x),

    'top_out', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                select t.item_id, t.item_name, sum(t.qty) as qty
                  from public.transactions t
                 where t.type = 'out' and t.txn_date >= v_from
                 group by t.item_id, t.item_name order by 3 desc limit 6) x),

    'busiest_projects', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                select project, sum(qty) as qty, count(distinct voucher_no) as vouchers
                  from public.transactions
                 where type = 'out' and project <> '' and txn_date >= v_from
                 group by project order by 2 desc limit 5) x),

    'recent', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                select type, voucher_no, txn_date, item_name, qty, party, project,
                       created_by_name, created_at
                  from public.transactions order by created_at desc limit 10) x),

    -- الأصناف ذات الرصيد السالب الآن، ومعها آخر إذن طلبها: من يحتاج
    -- أمر شراء، وبأي كمية ناقصة، وبطلب من مَن
    'negative_stock', (select coalesce(jsonb_agg(x order by x.balance), '[]'::jsonb) from (
                select e.id, e.code, e.category, trim(e.brand || ' ' || e.name) as label, e.unit,
                       e.balance, e.threshold, e.unit_price,
                       abs(e.balance) * e.unit_price as shortfall_value,
                       lv.voucher_no, lv.txn_date as last_voucher_date, lv.qty as last_voucher_qty,
                       lv.party, lv.project, lv.created_by_name as requested_by,
                       lv.created_at as requested_at
                  from enriched e
                  left join last_voucher lv on lv.item_id = e.id
                 where e.balance < 0) x)

  ) into v_result;

  return v_result;
end $$;

-- ------------------------------------------------------------
-- 10) الحماية على جدول المراجعة
--     الكتابة تتم حصريًا عبر set_voucher_review()، والقراءة للمحاسب والمدير
-- ------------------------------------------------------------
alter table public.voucher_review enable row level security;

drop policy if exists p_review_read on public.voucher_review;
create policy p_review_read on public.voucher_review
  for select to authenticated
  using (public.my_role() in ('admin','accountant','deputy_manager'));
