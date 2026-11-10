-- =====================================================================
-- VICE IDLE · NEON EMPIRE — supabase/schema.sql   (v4.5)
-- Idempotente: se puede pegar y ejecutar tantas veces como haga falta.
--
-- Modelo de seguridad:
--   * `players`      NO es legible ni escribible con la anon key.
--   * `player_sync`  / `player_get`  son SECURITY DEFINER y son la única
--                    puerta de entrada desde el juego (clave anon public).
--   * `leaderboard`  / `game_stats`  son vistas de solo lectura.
--   * `player_visits` guarda cada ingreso (register / login).
--
-- Límite aceptado y documentado: es un MARCADOR, no un libro contable.
-- Con la clave pública se puede inflar un balance. El dinero real sigue
-- protegido por el contrato (voucher firmado + topes on-chain).
-- =====================================================================

-- ---------------------------------------------------------------- tablas
create table if not exists public.players (
  player_id     uuid primary key,
  name          text        not null,
  balance       numeric(38,6) not null default 0,
  total_earned  numeric(38,6) not null default 0,
  rank_index    smallint    not null default 0,
  style         integer     not null default 0,
  vip_until     timestamptz,
  device        text        not null default 'web',
  created_at    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  sync_count    bigint      not null default 0,
  constraint players_balance_pos      check (balance >= 0),
  constraint players_total_earned_pos check (total_earned >= 0),
  constraint players_rank_range       check (rank_index between 0 and 7),
  constraint players_name_len         check (char_length(name) between 1 and 40)
);

-- compatibilidad con instalaciones previas (v4.5 añade style)
alter table public.players add column if not exists style integer not null default 0;
alter table public.players add column if not exists device text not null default 'web';
alter table public.players add column if not exists sync_count bigint not null default 0;

create index if not exists players_balance_idx on public.players (balance desc);
create index if not exists players_last_seen_idx on public.players (last_seen desc);
create unique index if not exists players_name_key on public.players (lower(name));

create table if not exists public.player_visits (
  id         bigserial primary key,
  player_id  uuid not null references public.players(player_id) on delete cascade,
  kind       text not null check (kind in ('register','login','sync')),
  at         timestamptz not null default now()
);
create index if not exists player_visits_player_idx on public.player_visits (player_id, at desc);

-- ---------------------------------------------------------------- RLS
alter table public.players       enable row level security;
alter table public.player_visits enable row level security;

-- Sin políticas para anon: la tabla queda cerrada. Solo las funciones
-- SECURITY DEFINER (abajo) pueden leer y escribir.
revoke all on public.players       from anon, authenticated;
revoke all on public.player_visits from anon, authenticated;
revoke all on sequence public.player_visits_id_seq from anon, authenticated;

-- ---------------------------------------------------------------- escritura
create or replace function public.player_sync(
  p_name         text,
  p_player_id    uuid,
  p_balance      text,
  p_total_earned text,
  p_rank_index   int,
  p_style        int default 0,
  p_vip_until    timestamptz default null,
  p_device       text default 'web'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance      numeric(38,6);
  v_total_earned numeric(38,6);
  v_name         text;
  v_rank         smallint;
  v_style        int;
  v_is_new       boolean := false;
  v_row          public.players;
begin
  -- --- validación de nombre ---
  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  -- --- validación de importes (llegan como texto por los números >= 1e21) ---
  if coalesce(p_balance, '') !~ '^[0-9]{1,32}(\.[0-9]{1,6})?$' then
    raise exception 'invalid_balance' using errcode = '22023';
  end if;
  if coalesce(p_total_earned, '') !~ '^[0-9]{1,32}(\.[0-9]{1,6})?$' then
    raise exception 'invalid_total_earned' using errcode = '22023';
  end if;
  v_balance      := p_balance::numeric;
  v_total_earned := p_total_earned::numeric;

  if v_balance < 0 or v_total_earned < 0 then
    raise exception 'negative_amount' using errcode = '22023';
  end if;

  v_rank  := greatest(0, least(7, coalesce(p_rank_index, 0)));
  v_style := greatest(0, least(1000000, coalesce(p_style, 0)));

  -- --- insert o update ---
  select * into v_row from public.players where player_id = p_player_id;
  if not found then
    -- el nombre no puede estar ocupado por otro player_id
    if exists (select 1 from public.players where lower(name) = lower(v_name)) then
      raise exception 'name_taken' using errcode = '23505';
    end if;
    insert into public.players (player_id, name, balance, total_earned, rank_index, style, vip_until, device, sync_count)
    values (p_player_id, v_name, v_balance, v_total_earned, v_rank, v_style, p_vip_until, coalesce(nullif(p_device,''),'web'), 1)
    returning * into v_row;
    v_is_new := true;
  else
    update public.players set
      name         = v_name,
      balance      = v_balance,
      total_earned = v_total_earned,
      rank_index   = v_rank,
      style        = v_style,
      vip_until    = coalesce(p_vip_until, vip_until),
      device       = coalesce(nullif(p_device,''), device),
      last_seen    = now(),
      sync_count   = sync_count + 1
    where player_id = p_player_id
    returning * into v_row;
  end if;

  insert into public.player_visits (player_id, kind)
  values (p_player_id, case when v_is_new then 'register' else 'sync' end);

  return jsonb_build_object(
    'ok', true,
    'player_id', v_row.player_id,
    'name', v_row.name,
    'balance', v_row.balance,
    'total_earned', v_row.total_earned,
    'rank_index', v_row.rank_index,
    'is_new', v_is_new,
    'sync_count', v_row.sync_count
  );
end;
$$;

-- ---------------------------------------------------------------- lectura
create or replace function public.player_get(p_player_id uuid)
returns table (
  player_id uuid, name text, balance numeric, total_earned numeric,
  rank_index smallint, style integer, vip_until timestamptz,
  last_seen timestamptz, sync_count bigint
)
language sql
security definer
set search_path = public
as $$
  select p.player_id, p.name, p.balance, p.total_earned, p.rank_index,
         p.style, p.vip_until, p.last_seen, p.sync_count
  from public.players p
  where p.player_id = p_player_id;
$$;

-- ---------------------------------------------------------------- vistas
create or replace view public.leaderboard as
  select
    name,
    balance,
    total_earned,
    rank_index,
    vip_until,
    last_seen
  from public.players
  where last_seen > now() - interval '90 days'
  order by balance desc
  limit 500;

create or replace view public.game_stats as
  select
    count(*)                              as players,
    coalesce(sum(balance), 0)             as total_balance,
    coalesce(sum(total_earned), 0)        as total_earned,
    coalesce(max(rank_index), 0)          as top_rank,
    count(*) filter (where vip_until > now()) as vip_players,
    count(*) filter (where last_seen > now() - interval '24 hours') as active_24h
  from public.players;

-- las vistas respetan RLS del dueño (security_invoker = false por defecto en PG15+)
-- se conceden solo a anon y autenticados
grant select on public.leaderboard to anon, authenticated;
grant select on public.game_stats  to anon, authenticated;
grant execute on function public.player_sync(text, uuid, text, text, int, int, timestamptz, text) to anon, authenticated;
grant execute on function public.player_get(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- limpieza
-- Borra visitas de más de 90 días (se puede programar con pg_cron)
create or replace function public.prune_visits() returns bigint
language plpgsql security definer set search_path = public as $$
declare v_count bigint;
begin
  delete from public.player_visits where at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_visits() from anon, authenticated;

-- =====================================================================
-- Fin. Verificación rápida desde el SQL Editor:
--   select public.player_sync('probe', gen_random_uuid(), '1000', '1000', 0, 0, null, 'test');
--   select * from public.leaderboard limit 5;
-- =====================================================================
