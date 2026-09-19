-- ============================================================
--  تنبيه الحذف — رسالة فورية عند مسح أي شيء من النظام
--  شغّله بعد 15_login_alerts.sql
--
--  لماذا الحذف يستحق معاملة خاصة؟
--
--  التعديل يترك ما يُقارَن به: القيمة قبله وبعده. أما الحذف فيمحو
--  الدليل نفسه. وحذف إذن صرف لا يمحو سطرًا فقط — بل يعيد الرصيد كما
--  كان، فتظهر في المخزن كمية لا وجود لها على الرف.
--
--  ولأن الحذف نادر، لا خنق هنا: كل عملية حذف تستحق رسالة.
--
--  وإلى جانب الرسالة يُكتب سطر في سجل التدقيق. الرسالة تُقرأ وتُنسى،
--  والسجل هو ما يُرجَع إليه بعد شهر حين يُسأل: أين ذهب هذا الإذن؟
-- ============================================================

-- ------------------------------------------------------------
-- 1) حذف حركات (إذن كامل أو جزء منه)
--
--  مُشغِّل على مستوى الجملة: delete_voucher() تحذف كل أسطر الإذن في
--  جملة واحدة، فمُشغِّل الصف كان سيرسل رسالة لكل صنف.
-- ------------------------------------------------------------
create or replace function public.notify_txn_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_who text := coalesce(public.my_name(), 'غير معروف');
begin
  for r in
    select o.voucher_no,
           max(o.type)                     as type,
           min(o.txn_date)                 as txn_date,
           max(o.party)                    as party,
           max(o.project)                  as project,
           max(o.created_by_name)          as author,
           count(*)                        as lines,
           sum(o.qty)                      as qty,
           round(sum(o.qty * coalesce(o.unit_cost, 0)), 2) as value
      from old_rows o
     group by o.voucher_no
  loop
    -- السجل أولًا: يبقى حتى لو تعطّل تليجرام
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), v_who, 'delete', 'transactions', r.voucher_no,
            jsonb_build_object('type', r.type, 'lines', r.lines, 'qty', r.qty,
                               'value', r.value, 'party', r.party,
                               'project', r.project, 'original_author', r.author));

    perform public.telegram_send(
      '🗑 <b>حذف إذن</b>' || E'\n' ||
      'رقم: <code>' || r.voucher_no || '</code>' ||
        ' (' || (case when r.type = 'in' then 'وارد' else 'صرف' end) || ')' || E'\n' ||
      'تاريخه: ' || r.txn_date || E'\n' ||
      'الأصناف: ' || r.lines || '   الكميات: ' || r.qty || E'\n' ||
      'القيمة: ' || r.value || ' ج.م' || E'\n' ||
      'الجهة: ' || coalesce(nullif(r.party, ''), '—') || E'\n' ||
      'سجّله: ' || coalesce(r.author, '—') || E'\n' ||
      '<b>حذفه: ' || v_who || '</b>' || E'\n' ||
      'تنبيه: أرصدة هذه الأصناف رجعت كما كانت قبل الإذن.');
  end loop;

  return null;
end $$;

drop trigger if exists trg_notify_txn_delete on public.transactions;
create trigger trg_notify_txn_delete
  after delete on public.transactions
  referencing old table as old_rows
  for each statement execute function public.notify_txn_delete();

-- ------------------------------------------------------------
-- 2) حذف صنف نهائيًا
--
--  الأرشفة تُخفي الصنف وتُبقي تاريخه؛ الحذف يمحوه. لذلك يُذكر في
--  الرسالة رصيده وقت الحذف: صنف بلا رصيد قد يكون تنظيفًا، وصنف
--  برصيد وقيمة هو شيء آخر تمامًا.
-- ------------------------------------------------------------
create or replace function public.notify_item_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_who text := coalesce(public.my_name(), 'غير معروف');
  v_count integer;
begin
  select count(*) into v_count from old_rows;

  -- حذف جماعي: ملخّص واحد بدل عشرات الرسائل
  if v_count > 5 then
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), v_who, 'delete', 'item', 'bulk',
            jsonb_build_object('count', v_count));

    perform public.telegram_send(
      '🗑 <b>حذف جماعي لأصناف</b>' || E'\n' ||
      'العدد: ' || v_count || ' صنف' || E'\n' ||
      '<b>حذفها: ' || v_who || '</b>' || E'\n' ||
      'راجع سجل التدقيق فورًا.');
    return null;
  end if;

  for r in select * from old_rows loop
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), v_who, 'delete', 'item', r.code,
            jsonb_build_object('name', trim(coalesce(r.brand,'') || ' ' || r.name),
                               'category', r.category, 'balance', r.balance,
                               'unit_price', r.unit_price));

    perform public.telegram_send(
      '🗑 <b>حذف صنف نهائيًا</b>' || E'\n' ||
      'الكود: <code>' || r.code || '</code>' || E'\n' ||
      'الصنف: ' || trim(coalesce(r.brand,'') || ' ' || r.name) || E'\n' ||
      'رصيده وقت الحذف: ' || r.balance || ' ' || coalesce(r.unit, '') || E'\n' ||
      'قيمته: ' || round(r.balance * coalesce(r.unit_price, 0), 2) || ' ج.م' || E'\n' ||
      '<b>حذفه: ' || v_who || '</b>');
  end loop;

  return null;
end $$;

drop trigger if exists trg_notify_item_delete on public.items;
create trigger trg_notify_item_delete
  after delete on public.items
  referencing old table as old_rows
  for each statement execute function public.notify_item_delete();

-- ------------------------------------------------------------
-- 3) أرشفة صنف
--
--  ليست حذفًا، لكنها تُخرج الصنف من كل الشاشات والتقارير — ومن
--  يبحث عنه بعدها لا يجده ويظن أنه حُذف. صنف برصيد يُؤرشف يعني
--  أن رصيده اختفى من قيمة المخزون.
-- ------------------------------------------------------------
create or replace function public.notify_item_archive()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_who text := coalesce(public.my_name(), 'غير معروف');
begin
  insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
  values (auth.uid(), v_who, 'update', 'item', new.code,
          jsonb_build_object('field', 'is_archived', 'to', true,
                             'balance', new.balance));

  -- الأرشفة بلا رصيد تنظيف روتيني؛ مع رصيد هي إخفاء قيمة
  if new.balance <> 0 then
    perform public.telegram_send(
      '📦 <b>أُرشف صنف له رصيد</b>' || E'\n' ||
      'الكود: <code>' || new.code || '</code>' || E'\n' ||
      'الصنف: ' || trim(coalesce(new.brand,'') || ' ' || new.name) || E'\n' ||
      'رصيده: ' || new.balance || ' ' || coalesce(new.unit, '') || E'\n' ||
      'قيمته: ' || round(new.balance * coalesce(new.unit_price, 0), 2) || ' ج.م' || E'\n' ||
      '<b>أرشفه: ' || v_who || '</b>' || E'\n' ||
      'لن يظهر في الشاشات ولا في قيمة المخزون.');
  end if;

  return null;
end $$;

drop trigger if exists trg_notify_item_archive on public.items;
create trigger trg_notify_item_archive
  after update of is_archived on public.items
  for each row
  when (new.is_archived and not old.is_archived)
  execute function public.notify_item_archive();

-- ------------------------------------------------------------
-- 4) حذف جرد
-- ------------------------------------------------------------
create or replace function public.notify_stocktake_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_who text := coalesce(public.my_name(), 'غير معروف');
begin
  for r in select * from old_rows loop
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), v_who, 'delete', 'stocktake', r.id::text,
            jsonb_build_object('title', r.title, 'date', r.stk_date,
                               'posted', r.posted));

    perform public.telegram_send(
      '🗑 <b>حذف جرد</b>' || E'\n' ||
      'العنوان: ' || coalesce(r.title, '—') || E'\n' ||
      'تاريخه: ' || r.stk_date || E'\n' ||
      (case when r.posted
            then 'كان مُرحَّلًا — أذون التسوية الناتجة عنه لم تُحذف.'
            else 'لم يكن مُرحَّلًا.' end) || E'\n' ||
      '<b>حذفه: ' || v_who || '</b>');
  end loop;

  return null;
end $$;

drop trigger if exists trg_notify_stocktake_delete on public.stocktakes;
create trigger trg_notify_stocktake_delete
  after delete on public.stocktakes
  referencing old table as old_rows
  for each statement execute function public.notify_stocktake_delete();

-- ------------------------------------------------------------
-- 5) حذف مستخدم
-- ------------------------------------------------------------
create or replace function public.notify_profile_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_who text := coalesce(public.my_name(), 'غير معروف');
begin
  for r in select * from old_rows loop
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), v_who, 'delete', 'profile', r.username,
            jsonb_build_object('full_name', r.full_name, 'role', r.role));

    perform public.telegram_send(
      '🗑 <b>حذف مستخدم</b>' || E'\n' ||
      'المستخدم: ' || coalesce(r.full_name, r.username) ||
        ' (<code>' || r.username || '</code>)' || E'\n' ||
      'دوره: ' || r.role || E'\n' ||
      '<b>حذفه: ' || v_who || '</b>' || E'\n' ||
      'الأذون التي سجّلها تبقى باسمه في السجل.');
  end loop;

  return null;
end $$;

drop trigger if exists trg_notify_profile_delete on public.profiles;
create trigger trg_notify_profile_delete
  after delete on public.profiles
  referencing old table as old_rows
  for each statement execute function public.notify_profile_delete();

-- ------------------------------------------------------------
-- 6) تجربة — احذف إذنًا تجريبيًا وراقب المجموعة
-- ------------------------------------------------------------
-- select public.delete_voucher('OUT-00001');

-- لمراجعة ما سُجِّل:
-- select at, actor_name, action, entity, entity_id, details
--   from public.audit_log where action = 'delete'
--  order by at desc limit 20;
