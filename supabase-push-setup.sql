-- AA Follow: Web Push real para recordatorios con la app cerrada.
-- 1. Ejecuta todo este archivo una vez en Supabase SQL Editor.
-- 2. Antes de ejecutar, reemplaza APP_URL y CRON_SECRET en las dos llamadas
--    vault.create_secret. CRON_SECRET debe coincidir con la variable de Vercel.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists public.aa_follow_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  timezone text not null default 'UTC',
  user_agent text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aa_follow_push_user_idx
  on public.aa_follow_push_subscriptions (user_id, enabled);

create table if not exists public.aa_follow_push_deliveries (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references public.aa_follow_push_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id text not null,
  occurrence text not null,
  status text not null default 'sending',
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (subscription_id, reminder_id, occurrence)
);

create index if not exists aa_follow_push_delivery_user_idx
  on public.aa_follow_push_deliveries (user_id, created_at desc);

alter table public.aa_follow_push_subscriptions enable row level security;
alter table public.aa_follow_push_deliveries enable row level security;

-- Estas tablas solo se leen y escriben desde las funciones Vercel con service role.
-- No se crean políticas para el cliente público.
revoke all on table public.aa_follow_push_subscriptions from anon, authenticated;
revoke all on table public.aa_follow_push_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.aa_follow_push_subscriptions to service_role;
grant select, insert, update, delete on table public.aa_follow_push_deliveries to service_role;
grant usage, select on sequence public.aa_follow_push_deliveries_id_seq to service_role;

select vault.create_secret('APP_URL', 'aa_follow_app_url');
select vault.create_secret('CRON_SECRET', 'aa_follow_cron_secret');

do $$
declare
  existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'aa-follow-send-reminders'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end $$;

select cron.schedule(
  'aa-follow-send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'aa_follow_app_url' limit 1) || '/api/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'aa_follow_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
