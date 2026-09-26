-- 21) مفتاح "لوحة القيادة" لكل مستخدم + إصلاح خصم الرصيد لمن لا يملك صلاحية الأصناف
begin;

alter table public.profiles
  add column if not exists can_view_dashboard boolean not null default true;

-- إصلاح: الخصم/الإضافة التلقائية للرصيد من trigger الحركات كانت تُرفض
-- لمن لا يملك manage_items/edit_price (أمين المخزن)، فيفشل الإذن كله.
create or replace function public.guard_item_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- تحديث تلقائي من trigger الحركات (الرصيد / متوسط التكلفة) — مسموح دائمًا.
  if pg_trigger_depth() > 1 then
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

-- الحارس: مدير النظام فقط يغيّر مفاتيح المستخدم الأربعة
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

  -- (ب2) مفاتيح المستخدم (وارد/صرف/الأسعار/اللوحة): مدير النظام فقط
  --      (auth.uid() يكون null عند التنفيذ من SQL Editor فيُسمح)
  if (new.can_receive    is distinct from old.can_receive
      or new.can_issue      is distinct from old.can_issue
      or new.can_view_price is distinct from old.can_view_price
      or new.can_view_dashboard is distinct from old.can_view_dashboard)
     and auth.uid() is not null
     and coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'تعديل صلاحيات المستخدم متاح لمدير النظام فقط.'
      using errcode = '42501';
  end if;

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

  -- سجل التدقيق
  if new.role is distinct from old.role
     or new.is_active      is distinct from old.is_active
     or new.can_receive    is distinct from old.can_receive
     or new.can_issue      is distinct from old.can_issue
     or new.can_view_price is distinct from old.can_view_price
     or new.can_view_dashboard is distinct from old.can_view_dashboard then
    insert into public.audit_log (actor, actor_name, action, entity, entity_id, details)
    values (auth.uid(), public.my_name(), 'update', 'profile', old.id::text,
            jsonb_build_object(
              'from_role', old.role, 'to_role', new.role,
              'from_active', old.is_active, 'to_active', new.is_active,
              'from_can_receive', old.can_receive, 'to_can_receive', new.can_receive,
              'from_can_issue', old.can_issue, 'to_can_issue', new.can_issue,
              'from_can_view_price', old.can_view_price, 'to_can_view_price', new.can_view_price,
              'from_can_view_dashboard', old.can_view_dashboard, 'to_can_view_dashboard', new.can_view_dashboard));
  end if;

  return new;
end $function$;

commit;
