-- =====================================================================
-- X-man challenge: database voor Supabase
--
-- Zo gebruik je dit bestand:
--   1. Open je Supabase-project, kies links "SQL Editor" en "New query".
--   2. Plak dit hele bestand en klik op "Run".
--   3. Maak daarna je eigen beheerlink met de regel onderaan dit bestand.
--
-- Beveiliging in het kort:
--   * Alle tabellen staan op slot (Row Level Security zonder regels).
--     De publieke sleutel in de site kan er dus niets rechtstreeks mee.
--   * De site praat alleen met de functies "xm_...". Elke functie
--     controleert eerst de persoonlijke link (token) van de gebruiker.
--   * Er wordt alleen een hash van elke link opgeslagen, nooit de link zelf.
--   * Alleen met een beheerlink kun je deelnemers en doelen beheren.
--   * Niemand, ook de beheerder niet, kan de trainingen of metingen van
--     een ander aanpassen.
-- Je kunt dit bestand veilig opnieuw uitvoeren; bestaande gegevens blijven.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

create table if not exists public.settings (
  id         int primary key default 1 check (id = 1),
  site_name  text not null default 'X-man challenge',
  start_date date not null,
  end_date   date not null,
  tz         text not null default 'Europe/Amsterdam',
  check (end_date >= start_date)
);

insert into public.settings (id, start_date, end_date)
values (1, '2026-10-19', '2027-07-18')
on conflict (id) do nothing;

create table if not exists public.members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  role       text not null default 'member' check (role in ('admin', 'member')),
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

create unique index if not exists members_name_unique
  on public.members (lower(btrim(name)));

-- Doelen: targets = [week 10, week 20, week 30, laatste dag].
-- Tijden worden in seconden opgeslagen, gewicht in kilo, de rest als getal.
create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members (id) on delete cascade,
  position    int not null default 0,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  kind        text not null check (kind in ('tijd', 'gewicht', 'aantal', 'frequentie')),
  better      text not null check (better in ('lager', 'hoger')),
  unit        text not null default '' check (char_length(unit) <= 12),
  start_value double precision not null,
  targets     double precision[] not null check (array_length(targets, 1) = 4)
);

-- Bestaande database bijwerken (veilig om opnieuw uit te voeren)
alter table public.goals add column if not exists unit text not null default '' check (char_length(unit) <= 12);

create index if not exists goals_member_idx on public.goals (member_id);

create table if not exists public.entries (
  member_id  uuid not null references public.members (id) on delete cascade,
  day        date not null,
  status     text not null check (status in ('done', 'rest')),
  feel       int check (feel between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (member_id, day)
);

create table if not exists public.measurements (
  member_id  uuid not null references public.members (id) on delete cascade,
  goal_id    uuid not null references public.goals (id) on delete cascade,
  day        date not null,
  value      double precision not null check (value >= 0 and value <= 1000000),
  updated_at timestamptz not null default now(),
  primary key (goal_id, day)
);

-- 0 is een geldige meting (bijvoorbeeld 0 pull-ups als startwaarde)
alter table public.measurements drop constraint if exists measurements_value_check;
alter table public.measurements add constraint measurements_value_check check (value >= 0 and value <= 1000000);

create index if not exists measurements_member_idx on public.measurements (member_id, day);

-- Strijdverhalen: een korte tekst bij de check-in van een dag, leesbaar voor iedereen.
create table if not exists public.stories (
  member_id  uuid not null references public.members (id) on delete cascade,
  day        date not null,
  title      text not null check (char_length(btrim(title)) between 1 and 80),
  body       text not null check (char_length(btrim(body)) between 1 and 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, day)
);

create index if not exists stories_created_idx on public.stories (created_at desc);

-- Tabellen op slot: geen enkele regel, dus geen directe toegang.
alter table public.settings     enable row level security;
alter table public.members      enable row level security;
alter table public.goals        enable row level security;
alter table public.entries      enable row level security;
alter table public.measurements enable row level security;
alter table public.stories      enable row level security;

revoke all on public.settings, public.members, public.goals, public.entries, public.measurements, public.stories
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Interne hulpfuncties (niet bereikbaar vanaf de site)
-- ---------------------------------------------------------------------

create or replace function app_private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function app_private.today()
returns date
language sql
stable
set search_path = public, extensions
as $$
  select (now() at time zone (select tz from public.settings where id = 1))::date;
$$;

create or replace function app_private.new_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select encode(extensions.gen_random_bytes(24), 'hex');
$$;

create or replace function app_private.require_member(p_token text)
returns public.members
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m public.members;
begin
  select * into m from public.members where token_hash = app_private.hash_token(p_token);
  if not found then
    raise exception 'Deze link is niet geldig' using errcode = '28000';
  end if;
  return m;
end;
$$;

create or replace function app_private.require_admin(p_token text)
returns public.members
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m public.members;
begin
  m := app_private.require_member(p_token);
  if m.role <> 'admin' then
    raise exception 'Dit mag alleen de beheerder' using errcode = '42501';
  end if;
  return m;
end;
$$;

-- ---------------------------------------------------------------------
-- Functies voor alle deelnemers
-- ---------------------------------------------------------------------

-- Wie ben ik? (voor het inloggen met een link)
create or replace function public.xm_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m public.members;
begin
  m := app_private.require_member(p_token);
  return jsonb_build_object('id', m.id, 'name', m.name, 'role', m.role);
end;
$$;

-- Alle gegevens die de site nodig heeft. Iedereen mag de voortgang van
-- de groep zien, maar alleen met een geldige link.
create or replace function public.xm_snapshot(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m public.members;
  s public.settings;
begin
  m := app_private.require_member(p_token);
  select * into s from public.settings where id = 1;

  return jsonb_build_object(
    'me', jsonb_build_object('id', m.id, 'name', m.name, 'role', m.role),
    'settings', jsonb_build_object(
      'site_name', s.site_name,
      'start_date', s.start_date,
      'end_date', s.end_date
    ),
    'today', app_private.today(),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', x.id, 'name', x.name, 'role', x.role)
        order by x.created_at, x.name)
      from public.members x), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id, 'member_id', g.member_id, 'name', g.name,
          'kind', g.kind, 'better', g.better, 'unit', g.unit,
          'start', g.start_value, 'targets', to_jsonb(g.targets))
        order by g.member_id, g.position, g.id)
      from public.goals g), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'member_id', e.member_id, 'day', e.day, 'status', e.status,
          'feel', e.feel, 'updated_at', e.updated_at))
      from public.entries e), '[]'::jsonb),
    'measurements', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'member_id', k.member_id, 'goal_id', k.goal_id,
          'day', k.day, 'value', k.value))
      from public.measurements k), '[]'::jsonb),
    'stories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'member_id', t.member_id, 'day', t.day, 'title', t.title,
          'body', t.body, 'created_at', t.created_at)
        order by t.created_at desc)
      from (select * from public.stories order by created_at desc limit 60) t), '[]'::jsonb)
  );
end;
$$;

-- Een dag invullen of aanpassen. Dit werkt ALTIJD alleen voor de eigenaar
-- van de link, nooit voor iemand anders.
--   p_status: 'done' (getraind), 'rest' (rustdag) of null (dag leegmaken)
--   p_values: {"<doel-id>": getal of null, ...} met metingen van die dag
create or replace function public.xm_save_day(
  p_token  text,
  p_day    date,
  p_status text,
  p_feel   int default null,
  p_values jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m      public.members;
  s      public.settings;
  kv     record;
  v_goal public.goals;
  v_val  double precision;
begin
  m := app_private.require_member(p_token);
  select * into s from public.settings where id = 1;

  if p_day is null
     or p_day < s.start_date
     or p_day > least(s.end_date, app_private.today()) then
    raise exception 'Deze dag kan niet worden ingevuld' using errcode = '22023';
  end if;

  if p_status is null then
    delete from public.entries where member_id = m.id and day = p_day;
  elsif p_status in ('done', 'rest') then
    insert into public.entries (member_id, day, status, feel, updated_at)
    values (m.id, p_day, p_status, p_feel, now())
    on conflict (member_id, day) do update
      set status = excluded.status, feel = excluded.feel, updated_at = now();
  else
    raise exception 'Onbekende status' using errcode = '22023';
  end if;

  if p_values is not null and jsonb_typeof(p_values) = 'object' then
    for kv in select key, value from jsonb_each(p_values) loop
      select * into v_goal from public.goals
        where id = kv.key::uuid and member_id = m.id;
      if not found then
        raise exception 'Onbekend doel' using errcode = '22023';
      end if;

      if jsonb_typeof(kv.value) = 'null' then
        delete from public.measurements where goal_id = v_goal.id and day = p_day;
      else
        v_val := (kv.value #>> '{}')::double precision;
        if v_val is null or v_val < 0 or v_val > 1000000 then
          raise exception 'Ongeldige meting' using errcode = '22023';
        end if;
        insert into public.measurements (member_id, goal_id, day, value, updated_at)
        values (m.id, v_goal.id, p_day, v_val, now())
        on conflict (goal_id, day) do update
          set value = excluded.value, updated_at = now();
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Een strijdverhaal bij een dag opslaan of aanpassen (alleen je eigen).
-- Titel en tekst allebei leeg = het verhaal van die dag verwijderen.
create or replace function public.xm_save_story(
  p_token text,
  p_day   date,
  p_title text,
  p_body  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m       public.members;
  s       public.settings;
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
begin
  m := app_private.require_member(p_token);
  select * into s from public.settings where id = 1;

  if p_day is null
     or p_day < s.start_date
     or p_day > least(s.end_date, app_private.today()) then
    raise exception 'Deze dag kan niet worden ingevuld' using errcode = '22023';
  end if;

  if v_title = '' and v_body = '' then
    delete from public.stories where member_id = m.id and day = p_day;
    return jsonb_build_object('ok', true, 'deleted', true);
  end if;

  if v_title = '' then
    raise exception 'Geef je strijdverhaal een titel' using errcode = '22023';
  end if;
  if v_body = '' then
    raise exception 'Schrijf ook een tekst bij je titel' using errcode = '22023';
  end if;
  if char_length(v_title) > 80 or char_length(v_body) > 1500 then
    raise exception 'Je strijdverhaal is te lang' using errcode = '22023';
  end if;

  insert into public.stories (member_id, day, title, body)
  values (m.id, p_day, v_title, v_body)
  on conflict (member_id, day) do update
    set title = excluded.title, body = excluded.body, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Functies voor de beheerder
-- ---------------------------------------------------------------------

create or replace function public.xm_admin_add_member(p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a       public.members;
  v_token text;
  v_id    uuid;
  v_name  text := btrim(coalesce(p_name, ''));
begin
  a := app_private.require_admin(p_token);
  if v_name = '' then
    raise exception 'Vul een naam in' using errcode = '22023';
  end if;
  v_token := app_private.new_token();
  insert into public.members (name, role, token_hash)
  values (v_name, 'member', app_private.hash_token(v_token))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'token', v_token);
end;
$$;

-- Nieuwe persoonlijke link maken (de oude werkt daarna niet meer).
create or replace function public.xm_admin_reset_token(p_token text, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a       public.members;
  v_token text;
begin
  a := app_private.require_admin(p_token);
  v_token := app_private.new_token();
  update public.members
     set token_hash = app_private.hash_token(v_token)
   where id = p_member_id;
  if not found then
    raise exception 'Deelnemer niet gevonden' using errcode = '22023';
  end if;
  return jsonb_build_object('id', p_member_id, 'token', v_token);
end;
$$;

create or replace function public.xm_admin_rename_member(p_token text, p_member_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a      public.members;
  v_name text := btrim(coalesce(p_name, ''));
begin
  a := app_private.require_admin(p_token);
  if v_name = '' then
    raise exception 'Vul een naam in' using errcode = '22023';
  end if;
  update public.members set name = v_name where id = p_member_id;
  if not found then
    raise exception 'Deelnemer niet gevonden' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.xm_admin_delete_member(p_token text, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a public.members;
begin
  a := app_private.require_admin(p_token);
  if p_member_id = a.id then
    raise exception 'Je kunt jezelf niet verwijderen' using errcode = '22023';
  end if;
  delete from public.members where id = p_member_id;
  if not found then
    raise exception 'Deelnemer niet gevonden' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.xm_admin_set_role(p_token text, p_member_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a public.members;
  t public.members;
begin
  a := app_private.require_admin(p_token);
  if p_role not in ('admin', 'member') then
    raise exception 'Onbekende rol' using errcode = '22023';
  end if;
  select * into t from public.members where id = p_member_id;
  if not found then
    raise exception 'Deelnemer niet gevonden' using errcode = '22023';
  end if;
  if t.role = 'admin' and p_role = 'member'
     and (select count(*) from public.members where role = 'admin') <= 1 then
    raise exception 'Er moet minstens één beheerder blijven' using errcode = '22023';
  end if;
  update public.members set role = p_role where id = p_member_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Doelen van een deelnemer opslaan. p_goals is een lijst met objecten:
--   {"id": "<bestaand doel-id of weglaten>", "name": "5 km hardlopen",
--    "kind": "tijd|gewicht|aantal|frequentie", "better": "lager|hoger", "unit": "kg",
--    "start": 1800, "targets": [1560, 1530, 1515, 1499]}
-- Doelen die niet meer in de lijst staan, worden verwijderd (inclusief de
-- bijbehorende metingen).
create or replace function public.xm_admin_save_goals(p_token text, p_member_id uuid, p_goals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a    public.members;
  g    jsonb;
  pos  int := 0;
  keep uuid[] := '{}';
  gid  uuid;
  t    double precision[];
begin
  a := app_private.require_admin(p_token);
  if not exists (select 1 from public.members where id = p_member_id) then
    raise exception 'Deelnemer niet gevonden' using errcode = '22023';
  end if;
  if p_goals is null or jsonb_typeof(p_goals) <> 'array' then
    raise exception 'Ongeldige doelen' using errcode = '22023';
  end if;

  for g in select value from jsonb_array_elements(p_goals) loop
    pos := pos + 1;

    t := array(
      select (x.v)::double precision
        from jsonb_array_elements_text(g -> 'targets') with ordinality as x(v, i)
       order by x.i);
    if array_length(t, 1) is distinct from 4 then
      raise exception 'Elk doel heeft vier tussenstappen nodig' using errcode = '22023';
    end if;

    gid := nullif(g ->> 'id', '')::uuid;
    if gid is not null
       and exists (select 1 from public.goals where id = gid and member_id = p_member_id) then
      update public.goals
         set name = btrim(g ->> 'name'),
             kind = g ->> 'kind',
             better = g ->> 'better',
             unit = coalesce(btrim(g ->> 'unit'), ''),
             start_value = (g ->> 'start')::double precision,
             targets = t,
             position = pos
       where id = gid;
    else
      insert into public.goals (member_id, position, name, kind, better, unit, start_value, targets)
      values (p_member_id, pos, btrim(g ->> 'name'), g ->> 'kind', g ->> 'better',
              coalesce(btrim(g ->> 'unit'), ''), (g ->> 'start')::double precision, t)
      returning id into gid;
    end if;
    keep := keep || gid;
  end loop;

  delete from public.goals
   where member_id = p_member_id and not (id = any (keep));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.xm_admin_set_settings(
  p_token text, p_start date, p_end date, p_site_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a public.members;
begin
  a := app_private.require_admin(p_token);
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'De laatste dag ligt voor de eerste dag' using errcode = '22023';
  end if;
  update public.settings
     set start_date = p_start,
         end_date = p_end,
         site_name = coalesce(nullif(btrim(p_site_name), ''), site_name)
   where id = 1;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Rechten: de site (anon) mag alleen de xm_-functies aanroepen
-- ---------------------------------------------------------------------

revoke all on function public.xm_me(text)                                   from public;
revoke all on function public.xm_snapshot(text)                             from public;
revoke all on function public.xm_save_day(text, date, text, int, jsonb)     from public;
revoke all on function public.xm_save_story(text, date, text, text)         from public;
revoke all on function public.xm_admin_add_member(text, text)               from public;
revoke all on function public.xm_admin_reset_token(text, uuid)              from public;
revoke all on function public.xm_admin_rename_member(text, uuid, text)      from public;
revoke all on function public.xm_admin_delete_member(text, uuid)            from public;
revoke all on function public.xm_admin_set_role(text, uuid, text)           from public;
revoke all on function public.xm_admin_save_goals(text, uuid, jsonb)        from public;
revoke all on function public.xm_admin_set_settings(text, date, date, text) from public;

grant execute on function public.xm_me(text)                                   to anon, authenticated;
grant execute on function public.xm_snapshot(text)                             to anon, authenticated;
grant execute on function public.xm_save_day(text, date, text, int, jsonb)     to anon, authenticated;
grant execute on function public.xm_save_story(text, date, text, text)         to anon, authenticated;
grant execute on function public.xm_admin_add_member(text, text)               to anon, authenticated;
grant execute on function public.xm_admin_reset_token(text, uuid)              to anon, authenticated;
grant execute on function public.xm_admin_rename_member(text, uuid, text)      to anon, authenticated;
grant execute on function public.xm_admin_delete_member(text, uuid)            to anon, authenticated;
grant execute on function public.xm_admin_set_role(text, uuid, text)           to anon, authenticated;
grant execute on function public.xm_admin_save_goals(text, uuid, jsonb)        to anon, authenticated;
grant execute on function public.xm_admin_set_settings(text, date, date, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Eerste beheerder en herstel (alleen bruikbaar in de SQL Editor)
-- ---------------------------------------------------------------------

-- Maakt de allereerste beheerder en geeft zijn geheime code terug.
-- Werkt maar één keer: zodra er een beheerder is, geeft dit een foutmelding.
create or replace function app_private.create_first_admin(p_name text)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if exists (select 1 from public.members where role = 'admin') then
    raise exception 'Er is al een beheerder. Gebruik app_private.reset_member_token(''naam'') voor een nieuwe link.';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Vul een naam in';
  end if;
  v_token := app_private.new_token();
  insert into public.members (name, role, token_hash)
  values (btrim(p_name), 'admin', app_private.hash_token(v_token));
  return v_token;
end;
$$;

-- Herstel: nieuwe link voor een bestaande deelnemer of beheerder
-- (bijvoorbeeld als de beheerder zijn link kwijt is).
create or replace function app_private.reset_member_token(p_name text)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  v_token := app_private.new_token();
  update public.members
     set token_hash = app_private.hash_token(v_token)
   where lower(btrim(name)) = lower(btrim(p_name));
  if not found then
    raise exception 'Geen deelnemer met die naam';
  end if;
  return v_token;
end;
$$;

revoke all on function app_private.create_first_admin(text) from public, anon, authenticated;
revoke all on function app_private.reset_member_token(text) from public, anon, authenticated;

-- =====================================================================
-- STAP 3: maak je eigen beheerlink.
--
-- Haal de twee streepjes aan het begin van de regel hieronder weg, zet je
-- eigen voornaam tussen de aanhalingstekens en voer ALLEEN die regel uit
-- (selecteer hem en klik op Run). Het resultaat is je geheime code.
-- Je beheerlink wordt dan:   https://JOUW-SITE/#t=DEZE_CODE
-- Bewaar die code goed en deel hem met niemand.
--
--   select app_private.create_first_admin('Jorrit');
--
-- Link kwijt? Maak een nieuwe met:
--   select app_private.reset_member_token('Jorrit');
-- =====================================================================
