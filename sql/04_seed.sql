-- ============================================================
--  بيانات البداية — شغّله بعد 03_security.sql
-- ============================================================

insert into public.settings (key, value) values
  ('stock',   '{"allow_negative_stock": false, "default_threshold": 5}'::jsonb),
  ('company', '{"name":"إدارة مخزن مستلزمات الكهرباء","currency":"ج.م"}'::jsonb)
on conflict (key) do nothing;

insert into public.categories (name, prefix) values
  ('القواطع الهوائية (ACB)', 'ACB'),
  ('القواطع المصبوبة (MCCB)', 'MCB'),
  ('الكابلات', 'CBL'),
  ('الكونتاكتورات', 'CNT'),
  ('أجهزة القياس', 'MTR'),
  ('مستلزمات عامة', 'GEN')
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- بعد إنشاء أول مستخدم من صفحة Supabase > Authentication > Users
-- شغّل السطر ده مرة واحدة لترقيته لمدير النظام:
-- ------------------------------------------------------------
-- update public.profiles set role = 'admin' where username = 'admin';
