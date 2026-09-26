-- ============================================================
--  24) سجل الحركات: رؤية الوارد / رؤية الصرف كصلاحيتين منفصلتين
--  شغّله بعد 23_suppliers_projects.sql
--
--  من يسجّل صرف فقط لا يرى حركات الوارد (والعكس). القيد في قاعدة
--  البيانات نفسها (RLS على transactions)، لا في الواجهة فقط.
-- ============================================================
begin;

insert into public.permissions (code, label, category, sort) values
  ('view_log_in',  'سجل الحركات: رؤية حركات الوارد', 'الشاشات', 21),
  ('view_log_out', 'سجل الحركات: رؤية حركات الصرف',  'الشاشات', 22)
on conflict (code) do update
  set label = excluded.label, category = excluded.category, sort = excluded.sort;

-- الأدوار: يرى نوع الحركة من يسجّله، ومن لا يسجّل أيًّا منهما
-- (مُطّلع، محاسب...) يرى الاثنين كما كان.
insert into public.role_permissions (role_code, permission_code)
select r.code, x.code
  from public.roles r
 cross join (values ('view_log_in', 'voucher_in'), ('view_log_out', 'voucher_out')) as x(code, needs)
 where exists (select 1 from public.role_permissions rp
                where rp.role_code = r.code and rp.permission_code = x.needs)
    or not exists (select 1 from public.role_permissions rp
                    where rp.role_code = r.code
                      and rp.permission_code in ('voucher_in', 'voucher_out'))
on conflict do nothing;

-- المستخدمون الممنوعون من نوع إذن بالتخصيص: يُمنعون من رؤيته في السجل
insert into public.user_permissions (user_id, permission_code, granted)
select up.user_id,
       case up.permission_code when 'voucher_in' then 'view_log_in' else 'view_log_out' end,
       false
  from public.user_permissions up
 where up.permission_code in ('voucher_in', 'voucher_out') and up.granted = false
on conflict (user_id, permission_code) do nothing;

-- القيد الفعلي
drop policy if exists p_txn_read on public.transactions;
create policy p_txn_read on public.transactions
  for select to authenticated
  using (
    (type = 'in'  and (select public.can('view_log_in')))
    or (type = 'out' and (select public.can('view_log_out')))
    or type not in ('in', 'out')
  );

commit;
