-- ============================================================================
-- Straffligan på fotbollskarta.se — tabeller, säkerhet och funktion
-- ============================================================================
-- Körs en gång i Supabase SQL Editor, i samma projekt som VM Tips.
-- Skapar bara nya objekt med prefixet straffligan_ och rör ingenting befintligt.
--
-- Säkerhetsmodellen: publishable-nyckeln ligger synlig i frontend-koden, så den
-- får inte kunna ändra poäng. Läsning är öppen, skrivning går bara via
-- funktionen straffligan_registrera(), som alltid bokför exakt en vinst och en
-- förlust — den kan inte sätta ett godtyckligt värde.
--
-- Poäng: vinst +2, förlust -1, men aldrig under 0.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Poängtabellen (en rad per förening)
-- ---------------------------------------------------------------------------
create table if not exists public.straffligan_poang (
  club_id    text primary key,
  points     integer     not null default 0,
  wins       integer     not null default 0,
  losses     integer     not null default 0,
  played     integer     not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.straffligan_poang is
  'Straffligan på fotbollskarta.se: en rad per förening. club_id är samma id som i sajtens data.json.';

create index if not exists straffligan_poang_points_idx
  on public.straffligan_poang (points desc, wins desc);


-- ---------------------------------------------------------------------------
-- 1b. Månadstabellen — samma siffror men en rad per förening och månad, så att
--     topplistan kan börja om den 1:a varje månad. manad är alltid den första
--     dagen i månaden (2026-09-01 = september 2026).
-- ---------------------------------------------------------------------------
create table if not exists public.straffligan_poang_manad (
  club_id    text        not null,
  manad      date        not null,
  points     integer     not null default 0,
  wins       integer     not null default 0,
  losses     integer     not null default 0,
  played     integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (club_id, manad)
);

comment on table public.straffligan_poang_manad is
  'Straffligan: poäng per förening och månad. Används för topplistan "denna månad".';

create index if not exists straffligan_poang_manad_idx
  on public.straffligan_poang_manad (manad, points desc, wins desc);


-- ---------------------------------------------------------------------------
-- 2. Matchlogg — gör det möjligt att upptäcka fusk och visa senaste matcherna
-- ---------------------------------------------------------------------------
create table if not exists public.straffligan_matcher (
  id         bigserial   primary key,
  vinnare    text        not null,
  forlorare  text        not null,
  skapad     timestamptz not null default now()
);

create index if not exists straffligan_matcher_skapad_idx
  on public.straffligan_matcher (skapad desc);

create index if not exists straffligan_matcher_vinnare_idx
  on public.straffligan_matcher (vinnare, skapad desc);


-- ---------------------------------------------------------------------------
-- 3. Row Level Security: alla får läsa, ingen får skriva direkt
-- ---------------------------------------------------------------------------
alter table public.straffligan_poang       enable row level security;
alter table public.straffligan_poang_manad enable row level security;
alter table public.straffligan_matcher     enable row level security;

drop policy if exists "straffligan_poang_las"       on public.straffligan_poang;
drop policy if exists "straffligan_poang_manad_las" on public.straffligan_poang_manad;
drop policy if exists "straffligan_matcher_las"     on public.straffligan_matcher;

create policy "straffligan_poang_las"
  on public.straffligan_poang
  for select
  to anon, authenticated
  using (true);

create policy "straffligan_poang_manad_las"
  on public.straffligan_poang_manad
  for select
  to anon, authenticated
  using (true);

create policy "straffligan_matcher_las"
  on public.straffligan_matcher
  for select
  to anon, authenticated
  using (true);

-- Inga insert-, update- eller delete-policyer: ingen kan skriva med
-- publishable-nyckeln, bara funktionen nedan (som kör som ägare).


-- ---------------------------------------------------------------------------
-- 4. Funktionen som registrerar ett avgjort straffavgörande
-- ---------------------------------------------------------------------------
create or replace function public.straffligan_registrera(
  p_vinnare   text,
  p_forlorare text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_senaste integer;
  v_manad   date := date_trunc('month', (now() at time zone 'Europe/Stockholm'))::date;
begin
  -- Grundkontroller
  if p_vinnare is null or p_forlorare is null then
    raise exception 'klubb-id saknas';
  end if;
  if p_vinnare = p_forlorare then
    raise exception 'en klubb kan inte möta sig själv';
  end if;
  if length(p_vinnare) > 64 or length(p_forlorare) > 64 then
    raise exception 'ogiltigt klubb-id';
  end if;

  -- Mjuk broms mot spam: en förening kan inte samla mer än 100 vinster i
  -- timmen. Långt över vad någon spelar på riktigt, men stoppar ett skript.
  select count(*) into v_senaste
  from public.straffligan_matcher
  where vinnare = p_vinnare
    and skapad > now() - interval '1 hour';

  if v_senaste >= 100 then
    raise exception 'för många matcher för den föreningen den senaste timmen';
  end if;

  -- Vinnaren: +2 poäng
  insert into public.straffligan_poang as p (club_id, points, wins, played)
  values (p_vinnare, 2, 1, 1)
  on conflict (club_id) do update
    set points     = p.points + 2,
        wins       = p.wins + 1,
        played     = p.played + 1,
        updated_at = now();

  -- Förloraren: -1 poäng, men aldrig under 0
  insert into public.straffligan_poang as p (club_id, points, losses, played)
  values (p_forlorare, 0, 1, 1)
  on conflict (club_id) do update
    set points     = greatest(p.points - 1, 0),
        losses     = p.losses + 1,
        played     = p.played + 1,
        updated_at = now();

  -- Samma sak i månadstabellen
  insert into public.straffligan_poang_manad as m (club_id, manad, points, wins, played)
  values (p_vinnare, v_manad, 2, 1, 1)
  on conflict (club_id, manad) do update
    set points     = m.points + 2,
        wins       = m.wins + 1,
        played     = m.played + 1,
        updated_at = now();

  insert into public.straffligan_poang_manad as m (club_id, manad, points, losses, played)
  values (p_forlorare, v_manad, 0, 1, 1)
  on conflict (club_id, manad) do update
    set points     = greatest(m.points - 1, 0),
        losses     = m.losses + 1,
        played     = m.played + 1,
        updated_at = now();

  insert into public.straffligan_matcher (vinnare, forlorare)
  values (p_vinnare, p_forlorare);
end;
$$;

comment on function public.straffligan_registrera(text, text) is
  'Registrerar ett avgjort straffavgörande i Straffligan: +1 poäng och vinst till vinnaren, +1 förlust till förloraren. Enda vägen att skriva poäng.';

revoke all on function public.straffligan_registrera(text, text) from public;
grant execute on function public.straffligan_registrera(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Klart. Kontrollera med:
--   select public.straffligan_registrera('testklubb-a', 'testklubb-b');
--   select * from public.straffligan_poang;
--   select * from public.straffligan_poang_manad;
--   delete from public.straffligan_poang       where club_id like 'testklubb-%';
--   delete from public.straffligan_poang_manad where club_id like 'testklubb-%';
--   delete from public.straffligan_matcher     where vinnare like 'testklubb-%'
--                                                 or forlorare like 'testklubb-%';
-- ---------------------------------------------------------------------------
