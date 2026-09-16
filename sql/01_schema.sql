-- ============================================================
--  نظام إدارة مخزن مستلزمات الكهرباء — مخطط قاعدة البيانات
--  Supabase / PostgreSQL 15+
--  شغّل هذا الملف أولًا في: Supabase Dashboard > SQL Editor
-- ============================================================

create extension if not exists pg_trgm;

-- ------------------------------------------------------------
-- 1) المستخدمون (مرتبطة بـ auth.users الخاص بـ Supabase)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  full_name   text not null,
  role        text not null default 'viewer'
              check (role in ('admin','deputy_manager','accountant','staff','viewer')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.profiles is 'بيانات المستخدم والدور الوظيفي';

-- ------------------------------------------------------------
-- 2) القوائم المساعدة
-- ------------------------------------------------------------
create table if not exists public.suppliers (
  name       text primary key,
  phone      text default '',
  notes      text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  name       text primary key,
  status     text not null default 'active' check (status in ('active','closed')),
  notes      text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  name       text primary key,
  prefix     text not null default 'GEN',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3) الأصناف
-- ------------------------------------------------------------
create table if not exists public.items (
  id              text primary key,
  code            text not null unique,
  category        text not null,
  brand           text not null default '',
  name            text not null,
  spec            text not null default '',
  unit            text not null default 'قطعة',
  opening_balance integer not null default 0,
  balance         integer not null default 0,
  threshold       integer not null default 5 check (threshold >= 0),
  base_price      numeric(14,2) not null default 0 check (base_price >= 0),
  extra_costs     numeric(14,2) not null default 0 check (extra_costs >= 0),
  unit_price      numeric(14,2) generated always as (base_price + extra_costs) stored,
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  search_blob     text generated always as
                  (coalesce(code,'')||' '||coalesce(brand,'')||' '||coalesce(name,'')||' '||
                   coalesce(spec,'')||' '||coalesce(category,'')) stored
);

create index if not exists idx_items_category on public.items (category);
create index if not exists idx_items_archived on public.items (is_archived);
create index if not exists idx_items_search   on public.items using gin (search_blob gin_trgm_ops);
create index if not exists idx_items_low      on public.items (balance) where is_archived = false;

-- ------------------------------------------------------------
-- 4) الحركات (أذون الوارد والصرف)
-- ------------------------------------------------------------
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (type in ('in','out')),
  voucher_no      text not null,
  txn_date        date not null,
  item_id         text not null references public.items(id) on delete restrict,
  item_name       text not null default '',
  qty             integer not null check (qty > 0),
  unit_price      numeric(14,2) not null default 0,
  party           text not null default '',
  project         text not null default '',
  notes           text not null default '',
  source          text not null default 'voucher' check (source in ('voucher','stocktake','opening','import')),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  created_by_name text not null default ''
);

create index if not exists idx_txn_item    on public.transactions (item_id, txn_date desc);
create index if not exists idx_txn_date    on public.transactions (txn_date desc, created_at desc);
create index if not exists idx_txn_voucher on public.transactions (voucher_no);
create index if not exists idx_txn_type    on public.transactions (type, txn_date desc);
create index if not exists idx_txn_project on public.transactions (project) where project <> '';

-- ------------------------------------------------------------
-- 5) الجرد
-- ------------------------------------------------------------
create table if not exists public.stocktakes (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  stk_date            date not null,
  notes               text not null default '',
  posted              boolean not null default false,
  adjustment_vouchers text[] not null default '{}',
  created_by          uuid references public.profiles(id),
  created_by_name     text not null default '',
  created_at          timestamptz not null default now()
);

create table if not exists public.stocktake_lines (
  id           bigserial primary key,
  stocktake_id uuid not null references public.stocktakes(id) on delete cascade,
  item_id      text not null,
  item_code    text not null default '',
  item_name    text not null default '',
  system_qty   integer not null default 0,
  counted_qty  integer not null default 0,
  diff         integer not null default 0
);
create index if not exists idx_stk_lines on public.stocktake_lines (stocktake_id);

-- ------------------------------------------------------------
-- 6) الإعدادات + سجل التدقيق
-- ------------------------------------------------------------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid references public.profiles(id),
  actor_name  text not null default '',
  action      text not null,
  entity      text not null,
  entity_id   text not null default '',
  details     jsonb not null default '{}'::jsonb
);
create index if not exists idx_audit_at on public.audit_log (at desc);

-- ------------------------------------------------------------
-- 7) عدّاد أرقام الأذون (آمن مع المستخدمين المتزامنين)
-- ------------------------------------------------------------
create table if not exists public.voucher_counters (
  type    text primary key check (type in ('in','out')),
  last_no integer not null default 0
);
insert into public.voucher_counters (type, last_no) values ('in', 0), ('out', 0)
on conflict (type) do nothing;
