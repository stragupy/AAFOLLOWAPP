-- Conexiones FatSecret por usuario. Ejecutar una vez en Supabase SQL Editor.
-- Los tokens OAuth se cifran antes de guardarse; solo las funciones Vercel usan service_role.

create table if not exists public.aa_follow_fatsecret_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text,
  access_secret text,
  request_token text,
  request_secret text,
  request_expires_at timestamptz,
  connected_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists aa_follow_fatsecret_request_token_idx
  on public.aa_follow_fatsecret_connections (request_token)
  where request_token is not null;

alter table public.aa_follow_fatsecret_connections enable row level security;
revoke all on table public.aa_follow_fatsecret_connections from anon, authenticated;
grant select, insert, update, delete on table public.aa_follow_fatsecret_connections to service_role;
