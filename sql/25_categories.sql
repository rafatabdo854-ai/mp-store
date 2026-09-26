-- ============================================================
--  25) شاشة الفئات: إضافة، تعديل (يسري على كل الأصناف)، حذف
--  شغّله بعد 24_log_visibility.sql
--
--  - تعديل اسم الفئة يُحدِّث حقل الفئة في كل أصنافها (والمؤرشفة).
--  - تعديل البادئة (مثل ACB) يُحدِّث أكواد أصنافها: ACB-0001 → NEW-0001،
--    ومعها أكواد الأصناف المحفوظة في كشوف الجرد، فلا يبقى كود قديم.
--  - الحذف مسموح فقط لفئة بلا أصناف.
--  - التحديث الجماعي للأصناف يتم من النظام لا من المستخدم، فحارس
--    الأصناف يسمح به حتى لمن لا يملك "تعديل الأصناف".
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1) الصلاحيات
-- ------------------------------------------------------------
insert into public.permissions (code, label, category, sort) values
  ('view_categories',   'فتح شاشة الفئات',                 'الفئات',           329),
  ('add_category',      'إضافة فئة',                       'الفئات',           330),
  ('edit_category',     'تعديل فئة (يسري على أصنافها)',    'الفئات',           331),
  ('delete_category',   'حذف فئة',                         'الفئات',           332),
  ('export_categories', 'تنزيل وطباعة قائمة الفئات',       'التصدير والطباعة', 737)
on conflict (code) do update
  set label = excluded.label, category = excluded.category, sort = excluded.sort;

insert into public.role_permissions (role_code, permission_code)
select r.code, p.code
  from public.roles r
 cross join (values ('view_categories'), ('export_categories')) as p(code)
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code)
select rp.role_code, x.new_code
  from public.role_permissions rp
  join (values ('manage_items', 'edit_category'),
               ('manage_users', 'delete_category')) as x(old_code, new_code)
    on x.old_code = rp.permission_code
on conflict do nothing;

-- ------------------------------------------------------------
-- 2) حارس الأصناف: يسمح بالتحديث الصادر من دوال النظام
--    (mp.system_update تضبطه الدالة داخل المعاملة فقط؛ PostgREST لا
--    يتيح للمستخدم استدعاء set_config)
-- ------------------------------------------------------------
create or replace function public.guard_item_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- تحديث تلقائي من trigger الحركات (الرصيد / متوسط التكلفة)
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- تحديث جماعي من دالة نظام (تعديل فئة)
  if coalesce(current_setting('mp.system_update', true), '') = 'on' then
    return new;
  end if;

  if public.can('manage_items') then
    return new;
  end if;

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
-- 3) الاستخدام: عدد الأصناف وإجمالي الرصيد لكل فئة
-- ------------------------------------------------------------
create or replace function public.category_usage()
returns table (name text, items bigint, active_items bigint, total_balance bigint)
language sql stable security definer set search_path = public as $$
  select category, count(*), count(*) filter (where not is_archived),
         coalesce(sum(balance) filter (where not is_archived), 0)::bigint
    from public.items
   group by category;
$$;
grant execute on function public.category_usage() to authenticated;

-- ------------------------------------------------------------
-- 4) إضافة / تعديل
-- ------------------------------------------------------------
create or replace function public.save_category(
  p_old_name text, p_name text, p_prefix text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_prefix  text := upper(btrim(coalesce(p_prefix, '')));
  v_old     public.categories%rowtype;
  v_items   integer := 0;
  v_codes   integer := 0;
  v_clash   text;
begin
  if v_name = '' then
    raise exception 'أدخل اسم الفئة' using errcode = '22023';
  end if;
  if v_prefix !~ '^[A-Z0-9]{2,6}$' then
    raise exception 'البادئة من 2 إلى 6 حروف إنجليزية أو أرقام (مثل ACB)' using errcode = '22023';
  end if;

  if p_old_name is null then
    if not public.can('add_category') then
      raise exception 'ليس لديك صلاحية إضافة فئة' using errcode = '42501';
    end if;
    if exists (select 1 from public.categories where name = v_name) then
      raise exception 'الفئة "%" موجودة بالفعل', v_name using errcode = '23505';
    end if;
    if exists (select 1 from public.categories where prefix = v_prefix) then
      raise exception 'البادئة % مستخدمة لفئة أخرى', v_prefix using errcode = '23505';
    end if;
    insert into public.categories (name, prefix) values (v_name, v_prefix);

  else
    if not public.can('edit_category') then
      raise exception 'ليس لديك صلاحية تعديل الفئات' using errcode = '42501';
    end if;
    select * into v_old from public.categories where name = p_old_name for update;
    if not found then
      raise exception 'الفئة غير موجودة' using errcode = 'P0002';
    end if;
    if v_name <> p_old_name and exists (select 1 from public.categories where name = v_name) then
      raise exception 'توجد فئة أخرى بالاسم "%"', v_name using errcode = '23505';
    end if;

    -- البادئة لا تتكرّر بين فئتين، وإلا اختلط ترقيم أكوادهما
    if v_prefix <> v_old.prefix
       and exists (select 1 from public.categories
                    where prefix = v_prefix and name <> p_old_name) then
      raise exception 'البادئة % مستخدمة لفئة أخرى', v_prefix using errcode = '23505';
    end if;

    -- الأكواد الجديدة لا تصطدم بأكواد أصناف موجودة
    if v_prefix <> v_old.prefix then
      select i2.code into v_clash
        from public.items i
        join public.items i2
          on i2.code = v_prefix || substr(i.code, length(v_old.prefix) + 1)
       where i.category = p_old_name and i.code like v_old.prefix || '-%'
         and i2.id <> i.id
       limit 1;
      if v_clash is not null then
        raise exception 'لا يمكن تغيير البادئة: الكود % مستخدم لصنف آخر', v_clash
          using errcode = '23505';
      end if;
    end if;

    perform set_config('mp.system_update', 'on', true);

    update public.categories set name = v_name, prefix = v_prefix where name = p_old_name;

    -- الأكواد أولًا (بالاسم القديم للفئة)، ثم اسم الفئة
    if v_prefix <> v_old.prefix then
      update public.stocktake_lines l
         set item_code = v_prefix || substr(l.item_code, length(v_old.prefix) + 1)
        from public.items i
       where l.item_id = i.id and i.category = p_old_name
         and l.item_code like v_old.prefix || '-%';

      update public.items
         set code = v_prefix || substr(code, length(v_old.prefix) + 1),
             updated_at = now()
       where category = p_old_name and code like v_old.prefix || '-%';
      get diagnostics v_codes = row_count;
    end if;

    if v_name <> p_old_name then
      update public.items set category = v_name, updated_at = now()
       where category = p_old_name;
      get diagnostics v_items = row_count;
    end if;

    perform set_config('mp.system_update', 'off', true);
  end if;

  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(),
          case when p_old_name is null then 'create' else 'update' end,
          'category', v_name,
          jsonb_build_object('old_name', p_old_name, 'old_prefix', v_old.prefix,
                             'prefix', v_prefix, 'items_renamed', v_items,
                             'codes_changed', v_codes));

  return jsonb_build_object('name', v_name, 'prefix', v_prefix,
                            'items_renamed', v_items, 'codes_changed', v_codes);
end $$;

-- ------------------------------------------------------------
-- 5) حذف
-- ------------------------------------------------------------
create or replace function public.delete_category(p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.can('delete_category') then
    raise exception 'ليس لديك صلاحية حذف الفئات' using errcode = '42501';
  end if;
  select count(*) into v_n from public.items where category = p_name;
  if v_n > 0 then
    raise exception 'لا يمكن حذف الفئة: بها % صنف (منها المؤرشف). انقل أصنافها لفئة أخرى أو غيّر اسمها بدل الحذف.', v_n
      using errcode = '23503';
  end if;
  delete from public.categories where name = p_name;
  if not found then
    raise exception 'الفئة غير موجودة' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), public.my_name(), 'delete', 'category', p_name, '{}'::jsonb);
end $$;

grant execute on function public.save_category(text, text, text),
                          public.delete_category(text)
  to authenticated;

-- الكتابة المباشرة: الإضافة فقط (التعديل والحذف عبر الدوال)
drop policy if exists p_cat_write on public.categories;
create policy p_cat_write on public.categories for insert to authenticated
  with check ((select public.can('add_category')));

commit;
