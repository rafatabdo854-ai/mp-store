-- ============================================================
--  إتمام نقل الصلاحيات — لا اسم دور مكتوب في أي قيد
--  شغّله بعد 10_presence.sql
--
--  بعد أن صارت الأدوار قابلة للإنشاء، أي قيد مكتوب فيه اسم دور
--  يصبح فخًّا: الدور الجديد لا يطابق الاسم، فإمّا يُمنع بلا سبب
--  أو — وهو الأخطر — يمرّ من ثغرة. هذا الملف يغلق ما تبقّى.
-- ============================================================

-- ------------------------------------------------------------
-- 1) صلاحيات جديدة لما كان مربوطًا باسم الدور
-- ------------------------------------------------------------
insert into public.permissions (code, label, category, sort) values
  ('review_voucher',   'مراجعة أذون الشراء ومطابقة الفواتير', 'المحاسبة', 72),
  ('delete_item',      'حذف الأصناف نهائيًا',                  'الأصناف',   35),
  ('delete_stocktake', 'حذف عمليات الجرد',                     'المخزن',    65),
  ('import_data',      'الإدخال المباشر واستيراد البيانات',    'الإدارة',   95),
  ('manage_settings',  'تعديل الإعدادات وعدّادات الأذون',      'الإدارة',   97)
on conflict (code) do update
  set label = excluded.label, category = excluded.category, sort = excluded.sort;

-- تُمنح لمن كان يملكها فعلًا قبل هذا الملف — لا يتغيّر شيء لحظة التشغيل
insert into public.role_permissions (role_code, permission_code) values
  ('admin',      'review_voucher'),
  ('accountant', 'review_voucher'),
  ('admin',      'delete_item'),
  ('admin',      'delete_stocktake'),
  ('admin',      'import_data'),
  ('admin',      'manage_settings')
on conflict do nothing;

-- ------------------------------------------------------------
-- 2) ثغرة في حارس تعديل الأصناف — أهم إصلاح في هذا الملف
--
--  الحارس السابق:
--      can('manage_items') ? اسمح بكل شيء
--      my_role() = 'accountant' ? اقصره على حقول السعر
--      وإلا ? return new        ← اسمح بكل شيء
--
--  آخر سطر كان غير مؤذٍ حين كانت الأدوار خمسة ثابتة. الآن لو أنشأت
--  دورًا ومنحته edit_price وحدها، تمرّره سياسة الكتابة على items ثم
--  يسقط في ذلك السطر — فيعدّل الكود والاسم والرصيد الافتتاحي
--  والأرشفة، لا السعر فقط كما تتوقّع.
--
--  الحارس الجديد يمنع افتراضًا: من لا يملك manage_items يُقصر على
--  حقول السعر مهما كان دوره، ومن لا يملك edit_price يُرفض تمامًا.
-- ------------------------------------------------------------
create or replace function public.guard_item_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- صلاحية إدارة الأصناف: تعديل كامل
  if public.can('manage_items') then
    return new;
  end if;

  -- صلاحية الأسعار وحدها: حقول السعر فقط، ولا شيء غيرها
  if public.can('edit_price') then
    if (new.code, new.category, new.brand, new.name, new.spec, new.unit,
        new.opening_balance, new.threshold, new.is_archived)
       is distinct from
       (old.code, old.category, old.brand, old.name, old.spec, old.unit,
        old.opening_balance, old.threshold, old.is_archived) then
      raise exception 'صلاحيتك على الأصناف تشمل الأسعار والتكاليف فقط'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'ليس لديك صلاحية تعديل الأصناف' using errcode = '42501';
end $$;

-- ------------------------------------------------------------
-- 3) المراجعة المحاسبية
-- ------------------------------------------------------------
create or replace function public.set_voucher_review(
  p_voucher text, p_invoice_no text, p_amount numeric, p_status text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.can('review_voucher') then
    raise exception 'ليس لديك صلاحية المراجعة المحاسبية' using errcode = '42501';
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

drop policy if exists p_review_read on public.voucher_review;
create policy p_review_read on public.voucher_review
  for select to authenticated
  using (public.can('review_voucher') or public.can('accounting'));

-- ------------------------------------------------------------
-- 4) عدّادات الأذون
-- ------------------------------------------------------------
create or replace function public.set_voucher_counter(p_type text, p_value integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.can('manage_settings') then
    raise exception 'ليس لديك صلاحية تعديل عدّادات الأذون' using errcode = '42501';
  end if;
  insert into public.voucher_counters (type, last_no) values (p_type, greatest(p_value, 0))
  on conflict (type) do update
    set last_no = greatest(excluded.last_no, public.voucher_counters.last_no);
  return p_value;
end $$;

-- ------------------------------------------------------------
-- 5) السياسات المتبقّية
-- ------------------------------------------------------------
drop policy if exists p_items_delete on public.items;
create policy p_items_delete on public.items
  for delete to authenticated using (public.can('delete_item'));

drop policy if exists p_txn_import on public.transactions;
create policy p_txn_import on public.transactions
  for insert to authenticated with check (public.can('import_data'));

drop policy if exists p_stk_del on public.stocktakes;
create policy p_stk_del on public.stocktakes
  for delete to authenticated using (public.can('delete_stocktake'));

drop policy if exists p_audit_read on public.audit_log;
create policy p_audit_read on public.audit_log
  for select to authenticated using (public.can('view_audit'));

-- ------------------------------------------------------------
-- 6) تحقّق: لا يجوز أن يبقى اسم دور في أي دالة أو سياسة
--    ما عدا my_role() و can() نفسيهما
-- ------------------------------------------------------------
-- select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prokind = 'f'
--    and pg_get_functiondef(p.oid) ~ 'my_role\(\)\s*(=|<>|not in|in)\s'
--    and p.proname not in ('can', 'my_role');

-- select polname, tablename
--   from pg_policies pol join pg_policy p2 on p2.polname = pol.policyname
--  where schemaname = 'public'
--    and (qual ~ 'my_role' or with_check ~ 'my_role');
