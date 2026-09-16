-- ============================================================
--  الحماية على مستوى الصف (Row Level Security) — شغّله بعد 02_functions.sql
--  القاعدة: أي قارئ لازم يكون مسجّل دخول. الكتابة حسب الدور.
-- ============================================================

alter table public.profiles        enable row level security;
alter table public.items           enable row level security;
alter table public.transactions    enable row level security;
alter table public.suppliers       enable row level security;
alter table public.projects        enable row level security;
alter table public.categories      enable row level security;
alter table public.stocktakes      enable row level security;
alter table public.stocktake_lines enable row level security;
alter table public.settings        enable row level security;
alter table public.audit_log       enable row level security;
-- جدول العدّادات: مغلق تمامًا أمام العميل، ولا يُلمس إلا من داخل الدوال
alter table public.voucher_counters enable row level security;

-- ---------- profiles ----------
drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists p_profiles_write on public.profiles;
create policy p_profiles_write on public.profiles
  for all to authenticated
  using (public.can('manage_users')) with check (public.can('manage_users'));

-- ---------- items ----------
drop policy if exists p_items_read on public.items;
create policy p_items_read on public.items
  for select to authenticated using (true);

drop policy if exists p_items_insert on public.items;
create policy p_items_insert on public.items
  for insert to authenticated with check (public.can('manage_items'));

drop policy if exists p_items_update on public.items;
create policy p_items_update on public.items
  for update to authenticated
  using (public.can('manage_items') or public.can('edit_price'))
  with check (public.can('manage_items') or public.can('edit_price'));

drop policy if exists p_items_delete on public.items;
create policy p_items_delete on public.items
  for delete to authenticated using (public.my_role() = 'admin');

-- المحاسب يعدّل الأسعار فقط — يُمنع من تغيير أي حقل آخر
create or replace function public.guard_item_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.can('manage_items') then return new; end if;
  if public.my_role() = 'accountant' then
    if (new.code, new.category, new.brand, new.name, new.spec, new.unit,
        new.opening_balance, new.threshold, new.is_archived)
       is distinct from
       (old.code, old.category, old.brand, old.name, old.spec, old.unit,
        old.opening_balance, old.threshold, old.is_archived) then
      raise exception 'المحاسب مصرّح له بتعديل الأسعار فقط' using errcode = '42501';
    end if;
    return new;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_item_update on public.items;
create trigger trg_guard_item_update
  before update on public.items
  for each row execute function public.guard_item_update();

-- ---------- transactions ----------
-- الإدخال يتم حصريًا عبر create_voucher()/post_stocktake() لضمان الترقيم والذرّية
drop policy if exists p_txn_read on public.transactions;
create policy p_txn_read on public.transactions
  for select to authenticated using (true);

-- استثناء واحد: المدير يستطيع الإدخال المباشر أثناء استيراد البيانات القديمة
drop policy if exists p_txn_import on public.transactions;
create policy p_txn_import on public.transactions
  for insert to authenticated with check (public.my_role() = 'admin');

drop policy if exists p_txn_delete on public.transactions;
create policy p_txn_delete on public.transactions
  for delete to authenticated using (public.can('delete_voucher'));

-- ---------- القوائم المساعدة ----------
drop policy if exists p_sup_read on public.suppliers;
create policy p_sup_read on public.suppliers for select to authenticated using (true);
drop policy if exists p_sup_write on public.suppliers;
create policy p_sup_write on public.suppliers for all to authenticated
  using (public.can('create_voucher')) with check (public.can('create_voucher'));

drop policy if exists p_prj_read on public.projects;
create policy p_prj_read on public.projects for select to authenticated using (true);
drop policy if exists p_prj_write on public.projects;
create policy p_prj_write on public.projects for all to authenticated
  using (public.can('create_voucher')) with check (public.can('create_voucher'));

drop policy if exists p_cat_read on public.categories;
create policy p_cat_read on public.categories for select to authenticated using (true);
drop policy if exists p_cat_write on public.categories;
create policy p_cat_write on public.categories for all to authenticated
  using (public.can('manage_items')) with check (public.can('manage_items'));

-- ---------- الجرد ----------
drop policy if exists p_stk_read on public.stocktakes;
create policy p_stk_read on public.stocktakes for select to authenticated using (true);
drop policy if exists p_stk_del on public.stocktakes;
create policy p_stk_del on public.stocktakes for delete to authenticated
  using (public.my_role() = 'admin');

drop policy if exists p_stkl_read on public.stocktake_lines;
create policy p_stkl_read on public.stocktake_lines for select to authenticated using (true);

-- ---------- الإعدادات ----------
drop policy if exists p_set_read on public.settings;
create policy p_set_read on public.settings for select to authenticated using (true);
drop policy if exists p_set_write on public.settings;
create policy p_set_write on public.settings for all to authenticated
  using (public.can('manage_users')) with check (public.can('manage_users'));

-- ---------- سجل التدقيق (قراءة للمدير فقط، والكتابة عبر الدوال) ----------
drop policy if exists p_audit_read on public.audit_log;
create policy p_audit_read on public.audit_log for select to authenticated
  using (public.my_role() in ('admin','accountant'));

-- ---------- Realtime ----------
-- إضافة الجدولين للنشر اللحظي (يتجاهل الخطأ لو كانا مضافين بالفعل)
do $$
begin
  begin alter publication supabase_realtime add table public.items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.transactions; exception when duplicate_object then null; end;
end $$;
