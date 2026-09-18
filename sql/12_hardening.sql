-- ============================================================
--  تقوية الحماية وأداء سياسات RLS
--  شغّله بعد 11_permission_cleanup.sql
--
--  ثلاثة محاور:
--   1) تضييق قراءة ملفات المستخدمين — أكبر تسريب معلومات متبقٍّ
--   2) تسريع كل سياسة عبر InitPlan بدل تقييم can() لكل صف
--   3) فهارس للأعمدة التي صارت الشاشات تُرشِّح بها
-- ============================================================

-- ------------------------------------------------------------
-- 1) قراءة ملفات المستخدمين
--
--  السياسة الحالية using (true): أي مستخدم مسجَّل — ولو كان "مُطّلع"
--  بلا أي صلاحية — يقرأ كل صفوف profiles: أسماء الحسابات كلها،
--  أدوارها، عدّاد محاولاتها الفاشلة، ووقت قفلها، وآخر ظهور لها.
--
--  هذه قائمة أهداف جاهزة: من اخترق حسابًا واحدًا ضعيفًا يعرف فورًا
--  أي الحسابات إدارية وأيها غير نشط، فيوجّه محاولاته إليها.
--
--  البديل: كل مستخدم يقرأ صفّه، ومن يملك إدارة المستخدمين أو رؤية
--  الحضور يقرأ الجميع. الشاشات الأخرى لا تتأثر لأن اسم منشئ الإذن
--  مخزَّن في created_by_name داخل الحركة نفسها، لا يُقرأ من هنا.
-- ------------------------------------------------------------
drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.can('manage_users'))
    or (select public.can('view_presence'))
  );

-- ------------------------------------------------------------
-- 2) أداء السياسات — لفّ can() داخل SELECT
--
--  can(...) المكتوبة مباشرة في using تُقيَّم لكل صف: عشرة آلاف حركة
--  تعني عشرة آلاف نداء، وكل نداء يقرأ profiles وrole_permissions.
--
--  لفّها في (select ...) يجعلها InitPlan يُقيَّم مرة واحدة للاستعلام
--  كله. النتيجة منطقيًا واحدة، والفرق في الوقت كبير على الجداول
--  التي تكبر: الحركات وسجل التدقيق.
-- ------------------------------------------------------------

-- الأصناف
drop policy if exists p_items_insert on public.items;
create policy p_items_insert on public.items
  for insert to authenticated
  with check ((select public.can('manage_items')));

drop policy if exists p_items_update on public.items;
create policy p_items_update on public.items
  for update to authenticated
  using ((select public.can('manage_items')) or (select public.can('edit_price')))
  with check ((select public.can('manage_items')) or (select public.can('edit_price')));

drop policy if exists p_items_delete on public.items;
create policy p_items_delete on public.items
  for delete to authenticated using ((select public.can('delete_item')));

-- الحركات
drop policy if exists p_txn_import on public.transactions;
create policy p_txn_import on public.transactions
  for insert to authenticated with check ((select public.can('import_data')));

drop policy if exists p_txn_delete on public.transactions;
create policy p_txn_delete on public.transactions
  for delete to authenticated using ((select public.can('delete_voucher')));

-- القوائم المساعدة
drop policy if exists p_sup_write on public.suppliers;
create policy p_sup_write on public.suppliers for all to authenticated
  using ((select public.can('create_voucher')))
  with check ((select public.can('create_voucher')));

drop policy if exists p_prj_write on public.projects;
create policy p_prj_write on public.projects for all to authenticated
  using ((select public.can('create_voucher')))
  with check ((select public.can('create_voucher')));

drop policy if exists p_cat_write on public.categories;
create policy p_cat_write on public.categories for all to authenticated
  using ((select public.can('manage_items')))
  with check ((select public.can('manage_items')));

-- الجرد
drop policy if exists p_stk_del on public.stocktakes;
create policy p_stk_del on public.stocktakes
  for delete to authenticated using ((select public.can('delete_stocktake')));

-- الإعدادات
drop policy if exists p_set_write on public.settings;
create policy p_set_write on public.settings for all to authenticated
  using ((select public.can('manage_settings')))
  with check ((select public.can('manage_settings')));

-- السجلات
drop policy if exists p_audit_read on public.audit_log;
create policy p_audit_read on public.audit_log
  for select to authenticated using ((select public.can('view_audit')));

drop policy if exists p_auth_events_read on public.auth_events;
create policy p_auth_events_read on public.auth_events
  for select to authenticated using ((select public.can('view_auth_log')));

drop policy if exists p_review_read on public.voucher_review;
create policy p_review_read on public.voucher_review
  for select to authenticated
  using ((select public.can('review_voucher')) or (select public.can('accounting')));

-- الأدوار
drop policy if exists p_roles_write on public.roles;
create policy p_roles_write on public.roles for all to authenticated
  using ((select public.can('manage_users')))
  with check ((select public.can('manage_users')));

drop policy if exists p_rp_write on public.role_permissions;
create policy p_rp_write on public.role_permissions for all to authenticated
  using ((select public.can('manage_users')))
  with check ((select public.can('manage_users')));

drop policy if exists p_profiles_write on public.profiles;
create policy p_profiles_write on public.profiles
  for all to authenticated
  using ((select public.can('manage_users')))
  with check ((select public.can('manage_users')));

-- ------------------------------------------------------------
-- 3) فهارس لما صارت الشاشات تُرشِّح به
--
--  شاشة سجل التدقيق تُرشِّح بالإجراء والنوع والفاعل والتاريخ، وسجل
--  audit_log ليس عليه سوى فهرس على at. مع نموّه تصير كل صفحة مسحًا
--  كاملًا للجدول.
-- ------------------------------------------------------------
create index if not exists idx_audit_entity on public.audit_log (entity, at desc);
create index if not exists idx_audit_actor  on public.audit_log (actor, at desc);
create index if not exists idx_audit_action on public.audit_log (action, at desc);

--  البحث في السجل بـ ilike '%نص%' لا يستفيد من أي فهرس عادي، لأن
--  البادئة مجهولة. trigram يحلّها، والامتداد مفعَّل أصلًا للأصناف.
create index if not exists idx_audit_entity_id
  on public.audit_log using gin (entity_id gin_trgm_ops);

--  ترتيب الحركات داخل الإذن الواحد عند الطباعة
create index if not exists idx_txn_voucher_line
  on public.transactions (voucher_no, id);

-- ------------------------------------------------------------
-- 4) تنظيف السجلات — نموّ بلا حدّ يبطّئ كل شيء تدريجيًا
--
--  auth_events يكبر بسرعة: كل دخول وكل محاولة فاشلة سطر. احتفظ
--  بتسعين يومًا؛ ما قبلها لا يُراجَع عمليًا.
--  شغّلها يدويًا كل بضعة أشهر، أو من مهمة النسخ الاحتياطي.
-- ------------------------------------------------------------
create or replace function public.prune_logs(p_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_auth integer; v_audit integer;
begin
  if not public.can('manage_settings') then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  delete from public.auth_events
   where created_at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics v_auth = row_count;

  -- سجل التدقيق يُحتفظ به ضعف المدة: هو المرجع عند الخلاف على حركة
  delete from public.audit_log
   where at < now() - make_interval(days => greatest(p_days, 30) * 2);
  get diagnostics v_audit = row_count;

  return jsonb_build_object('auth_events', v_auth, 'audit_log', v_audit);
end $$;

grant execute on function public.prune_logs(integer) to authenticated;

-- ------------------------------------------------------------
-- 5) تحقّق بعد التشغيل
-- ------------------------------------------------------------
--  أي جدول عام بلا RLS؟ يجب ألّا يعود أي صف.
-- select tablename from pg_tables t
--  where schemaname = 'public'
--    and not exists (select 1 from pg_class c
--                     where c.relname = t.tablename and c.relrowsecurity);

--  أي سياسة ما زالت تستدعي can() خارج select؟
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and (qual like '%can(%' or with_check like '%can(%')
--    and qual not like '%( SELECT%' and coalesce(with_check,'') not like '%( SELECT%';
