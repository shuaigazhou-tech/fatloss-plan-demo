-- 刚刚好 v2：登录同步、常用餐食、AI 配额与监控
-- 在 Supabase Dashboard > SQL Editor 中完整执行一次。

create extension if not exists pgcrypto;

create table if not exists public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_ref text not null,
  eaten_on date not null,
  name text not null check (char_length(name) between 1 and 80),
  meal_type text not null default '午餐',
  calories numeric(8,1) not null default 0 check (calories between 0 and 5000),
  protein numeric(8,1) not null default 0 check (protein between 0 and 500),
  carbs numeric(8,1) not null default 0 check (carbs between 0 and 1000),
  fat numeric(8,1) not null default 0 check (fat between 0 and 500),
  note text not null default '',
  source text not null default 'manual',
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_ref)
);

create index if not exists meal_logs_user_date_idx
  on public.meal_logs (user_id, eaten_on desc);

create table if not exists public.weight_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  weighed_on date not null,
  weight numeric(5,2) not null check (weight between 30 and 250),
  updated_at timestamptz not null default now(),
  primary key (user_id, weighed_on)
);

create table if not exists public.daily_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  checklist integer[] not null default '{}',
  workout_done boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

create table if not exists public.favorite_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_ref text not null,
  name text not null check (char_length(name) between 1 and 80),
  meal_type text not null default '午餐',
  calories numeric(8,1) not null default 0,
  protein numeric(8,1) not null default 0,
  carbs numeric(8,1) not null default 0,
  fat numeric(8,1) not null default 0,
  note text not null default '',
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_ref)
);

create index if not exists favorite_meals_user_idx
  on public.favorite_meals (user_id, updated_at desc);

-- AI 限额只允许 Edge Function 的服务端密钥访问。
create table if not exists public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

create table if not exists public.ai_request_logs (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null check (status in ('success', 'rejected', 'failed')),
  error_code text,
  provider_status integer,
  latency_ms integer not null default 0,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists ai_request_logs_created_idx
  on public.ai_request_logs (created_at desc);
create index if not exists ai_request_logs_user_idx
  on public.ai_request_logs (user_id, created_at desc);

alter table public.meal_logs enable row level security;
alter table public.weight_logs enable row level security;
alter table public.daily_logs enable row level security;
alter table public.favorite_meals enable row level security;
alter table public.ai_usage_daily enable row level security;
alter table public.ai_request_logs enable row level security;

drop policy if exists "meal logs are private" on public.meal_logs;
create policy "meal logs are private" on public.meal_logs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "weight logs are private" on public.weight_logs;
create policy "weight logs are private" on public.weight_logs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "daily logs are private" on public.daily_logs;
create policy "daily logs are private" on public.daily_logs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "favorite meals are private" on public.favorite_meals;
create policy "favorite meals are private" on public.favorite_meals
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.meal_logs to authenticated;
grant select, insert, update, delete on public.weight_logs to authenticated;
grant select, insert, update, delete on public.daily_logs to authenticated;
grant select, insert, update, delete on public.favorite_meals to authenticated;

-- 原子计数：并发请求不会绕过每日上限。
create or replace function public.consume_ai_quota(
  p_user_id uuid,
  p_limit integer default 20
)
returns table (allowed boolean, used integer, quota integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'invalid quota';
  end if;

  insert into public.ai_usage_daily (user_id, usage_date, request_count)
  values (p_user_id, current_date, 0)
  on conflict (user_id, usage_date) do nothing;

  update public.ai_usage_daily
     set request_count = request_count + 1,
         updated_at = now()
   where user_id = p_user_id
     and usage_date = current_date
     and request_count < p_limit
  returning request_count into current_count;

  if found then
    return query select true, current_count, p_limit;
    return;
  end if;

  select request_count into current_count
    from public.ai_usage_daily
   where user_id = p_user_id and usage_date = current_date;

  return query select false, coalesce(current_count, p_limit), p_limit;
end;
$$;

revoke all on function public.consume_ai_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, integer) to service_role;

-- 监控表不开放给网页端；只有服务端密钥可写入和查询。
revoke all on public.ai_usage_daily from anon, authenticated;
revoke all on public.ai_request_logs from anon, authenticated;

