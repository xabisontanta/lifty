-- Server-side, road-routed matching.
-- The find-matches Edge Function reads candidates through match_candidates (service role only: it exposes
-- the driver's full private route and home/work points), measures them with Mapbox Directions, scores them
-- with the shared engine and stores what the passenger saw in match_quotes. get_match — and therefore
-- request_to_join — prefers a still-valid quote, so a request records the road-routed figures.
-- find_matches stays as the labelled fallback when road routing is unavailable.

create table if not exists public.match_quotes (
  commute_id uuid not null references public.passenger_commutes(id) on delete cascade,
  leg_id uuid not null references public.driver_legs(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  match jsonb not null,
  leg_signature text not null,
  commute_signature text not null,
  created_at timestamptz not null default now(),
  primary key (commute_id, leg_id)
);
create index if not exists match_quotes_passenger_idx on public.match_quotes(passenger_id);
create index if not exists match_quotes_leg_idx on public.match_quotes(leg_id);
alter table public.match_quotes enable row level security;
-- no policies: only the Edge Function (service role) and security-definer functions touch quotes
revoke all on public.match_quotes from anon, authenticated;
comment on table public.match_quotes is 'Road-routed match figures shown to a passenger; valid 2 h and only while the leg and commute are unchanged.';

-- A quote is void as soon as the driver's route/schedule/terms or the passenger's commute change.
create or replace function public.leg_signature(l public.driver_legs) returns text
language sql stable set search_path = '' as $$
  select md5(concat_ws('|', l.route::text, l.origin::text, l.destination::text, l.departure_time::text, l.days::text,
                       l.direction::text, l.max_deviation_min::text, l.monthly_contribution::text));
$$;
create or replace function public.commute_signature(c public.passenger_commutes) returns text
language sql stable set search_path = '' as $$
  select md5(concat_ws('|', c.direction::text, c.origin::text, c.destination::text, c.days::text, c.arrive_by::text,
                       c.window_min::text, c.max_walk_m::text, c.specific_dates::text, c.start_date::text,
                       c.end_date::text, c.skip_holidays::text));
$$;
revoke all on function public.leg_signature(public.driver_legs) from public, anon, authenticated;
revoke all on function public.commute_signature(public.passenger_commutes) from public, anon, authenticated;

-- Hard filters + best pickup per leg. Timing and deviation are NOT filtered here: they are measured on
-- the road network by the Edge Function. Spatial pre-filters only bound the Mapbox calls.
create or replace function public.match_candidates(p_commute uuid, p_passenger uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  c passenger_commutes;
  v_dated boolean;
  today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_from date;
  v_to date;
  v_dates text[];
  v_candidates jsonb;
begin
  select * into c from passenger_commutes where id = p_commute and passenger_id = p_passenger;
  if not found then raise exception 'Commute not found'; end if;
  if not exists (select 1 from profiles where id = p_passenger and suspended_at is null) then
    raise exception 'Account is not active';
  end if;
  v_dated := c.specific_dates is not null and cardinality(c.specific_dates) > 0;
  -- same 84-day horizon as the app's schedule resolver
  v_from := greatest(today + 1, c.start_date);
  v_to := least(coalesce(c.end_date, v_from + 83), v_from + 83);
  select coalesce(array_agg(to_char(d::date, 'YYYY-MM-DD') order by d), '{}') into v_dates
    from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d
   where public.commute_booked_on(c, d::date);

  with legs as (
    select l.*, l.route::geometry as g, public.leg_signature(l) as sig
    from driver_legs l
    where public.driver_approved(l.driver_id) and l.active and l.direction = c.direction and l.seats_open > 0
      and l.driver_id <> c.passenger_id
      and st_dwithin(l.route, c.destination, 1500)
      and st_dwithin(l.route, c.origin, c.max_walk_m + 1200)
      and not exists (select 1 from club_members m where m.leg_id = l.id and m.passenger_id = c.passenger_id and m.active)
      and exists (select 1 from unnest(v_dates) d where (extract(isodow from d::date)::int - 1) = any (l.days))
  ),
  pickups as (
    select l.id as leg_id, pp.name as label, pp.location as pt
    from legs l
    join pickup_points pp on st_dwithin(pp.location, c.origin, c.max_walk_m) and st_dwithin(pp.location, l.route, 800)
    union all
    select l.id, 'On ' || split_part(l.destination_label, ',', 1) || ' route', st_closestpoint(l.g, c.origin::geometry)::geography
    from legs l where c.max_walk_m > 0 and st_dwithin(l.route, c.origin, c.max_walk_m)
    union all
    select l.id, 'Your street', c.origin from legs l where c.max_walk_m = 0
  ),
  scored as (
    select k.leg_id, k.label, k.pt,
           st_distance(k.pt, c.origin) * 1.25 as walk_m,
           st_distance(k.pt, l.route) as off_m,
           st_linelocatepoint(l.g, k.pt::geometry) as fa,
           st_linelocatepoint(l.g, st_closestpoint(l.g, c.destination::geometry)) as fb
    from pickups k join legs l on l.id = k.leg_id
  ),
  best as (
    select distinct on (s.leg_id) s.* from scored s
    where s.fb > s.fa -- the pickup comes before the drop-off along the driver's route
    order by s.leg_id, s.walk_m + 3 * s.off_m
  ),
  measured_rows as (
    select b.*, l.g, l.sig, l.driver_id, l.origin as leg_origin, l.destination as leg_destination, l.departure_time,
           l.route_distance_m, l.days as leg_days, l.seats_open, l.max_deviation_min, l.monthly_contribution,
           cardinality(array(select unnest(l.days) intersect select unnest(c.days))) as shared_days,
           (select count(*) from unnest(coalesce(c.specific_dates, '{}'::date[])) d
             where d > today and public.commute_booked_on(c, d) and (extract(isodow from d)::int - 1) = any (l.days)
               and date_trunc('month', d) = date_trunc('month', (select min(x) from unnest(c.specific_dates) x where x > today and public.commute_booked_on(c, x))))::int as booked_days,
           per_day_contribution(l.monthly_contribution, cardinality(l.days)) as per_day
    from best b join legs l on l.id = b.leg_id
  )
  select coalesce(jsonb_agg(x.j order by x.rank_key), '[]') into v_candidates
  from (
    select r.off_m + r.walk_m as rank_key, jsonb_build_object(
      'public', jsonb_build_object(
        'id', r.leg_id, 'legId', r.leg_id, 'commuteId', c.id, 'direction', c.direction,
        'driver', jsonb_build_object(
          'id', p.id, 'firstName', p.first_name, 'lastInitial', p.last_initial, 'avatarPath', p.avatar_path,
          'rating', p.rating, 'ratingCount', p.rating_count, 'reliability', p.reliability,
          'completedArrangements', p.completed_arrangements, 'memberSince', p.created_at::date, 'about', p.about,
          'identityStatus', coalesce(p.identity_status::text, 'pending'), 'verification', public.driver_verification(p.id)),
        'vehicle', jsonb_build_object(
          'make', v.make, 'model', v.model, 'colour', v.colour, 'year', v.year, 'bodyType', v.body_type,
          'registrationSummary', v.registration_summary, 'seatsTotal', v.seats_total, 'photoPath', v.photo_path, 'status', v.status),
        'origin', jsonb_build_object('label', c.origin_label, 'lng', st_x(c.origin::geometry), 'lat', st_y(c.origin::geometry)),
        'pickup', jsonb_build_object('label', r.label, 'lng', st_x(r.pt::geometry), 'lat', st_y(r.pt::geometry)),
        'destination', jsonb_build_object('label', c.destination_label, 'lng', st_x(c.destination::geometry), 'lat', st_y(c.destination::geometry)),
        -- the passenger only ever sees the route from shortly before their pickup to their drop-off
        'geometry', jsonb_build_object('path', st_asgeojson(st_linesubstring(r.g, greatest(0, r.fa - 2500.0 / r.route_distance_m), r.fb), 6)::jsonb),
        'departureTime', to_char(r.departure_time, 'HH24:MI'),
        'days', to_jsonb(array(select unnest(r.leg_days) intersect select unnest(c.days))),
        'coveredDays', to_jsonb(array(select unnest(r.leg_days) intersect select unnest(c.days))),
        'uncoveredDays', to_jsonb(array(select unnest(c.days) except select unnest(r.leg_days))),
        'coveredDates', to_jsonb(array(select d from unnest(coalesce(c.specific_dates, '{}'::date[])) d where d > today and (extract(isodow from d)::int - 1) = any (r.leg_days) and public.commute_booked_on(c, d))),
        'uncoveredDates', to_jsonb(array(select d from unnest(coalesce(c.specific_dates, '{}'::date[])) d where d > today and not (extract(isodow from d)::int - 1) = any (r.leg_days) and public.commute_booked_on(c, d))),
        'availableSeats', r.seats_open,
        'pricing', case when v_dated then 'per_day' else 'monthly' end,
        'perDayContribution', r.per_day,
        'bookedDays', r.booked_days,
        'monthlyContribution', case when v_dated then r.per_day * r.booked_days else round(r.monthly_contribution * r.shared_days::numeric / greatest(cardinality(r.leg_days), 1))::int end,
        'members', coalesce((select jsonb_agg(jsonb_build_object('firstName', mp.first_name, 'avatarPath', mp.avatar_path))
                             from club_members cm join profiles mp on mp.id = cm.passenger_id
                             where cm.leg_id = r.leg_id and cm.active), '[]'::jsonb)),
      'private', jsonb_build_object(
        'route', st_asgeojson(r.g, 6)::jsonb,
        'legOrigin', jsonb_build_object('lng', st_x(r.leg_origin::geometry), 'lat', st_y(r.leg_origin::geometry)),
        'legDestination', jsonb_build_object('lng', st_x(r.leg_destination::geometry), 'lat', st_y(r.leg_destination::geometry)),
        'departureTime', to_char(r.departure_time, 'HH24:MI'),
        'maxDeviationMin', r.max_deviation_min,
        'legDays', to_jsonb(r.leg_days),
        'seatsOpen', r.seats_open,
        -- driver_approved() above already requires verified identity, documents and vehicle
        'identityVerified', true,
        'vehicleVerified', true,
        'rating', p.rating,
        'reliability', p.reliability,
        'legSignature', r.sig)) as j
    from measured_rows r
    join profiles p on p.id = r.driver_id
    join vehicles v on v.driver_id = r.driver_id
  ) x;

  return jsonb_build_object(
    'commute', jsonb_build_object(
      'direction', c.direction,
      'arriveBy', to_char(c.arrive_by, 'HH24:MI'),
      'flexMinutes', c.window_min,
      'maxWalkMeters', c.max_walk_m,
      'dates', to_jsonb(v_dates),
      'origin', jsonb_build_object('lng', st_x(c.origin::geometry), 'lat', st_y(c.origin::geometry)),
      'destination', jsonb_build_object('lng', st_x(c.destination::geometry), 'lat', st_y(c.destination::geometry)),
      'signature', public.commute_signature(c)),
    'candidates', v_candidates);
end $$;
revoke all on function public.match_candidates(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_candidates(uuid, uuid) to service_role;

-- Prefer the road-routed quote the passenger was shown; fall back to the database estimate.
create or replace function public.get_match(p_commute uuid, p_leg uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select q.match
       from public.match_quotes q
       join public.passenger_commutes c on c.id = q.commute_id and c.passenger_id = (select auth.uid())
       join public.driver_legs l on l.id = q.leg_id
      where q.commute_id = p_commute and q.leg_id = p_leg and q.passenger_id = (select auth.uid())
        and q.created_at > now() - interval '2 hours'
        and q.leg_signature = public.leg_signature(l)
        and q.commute_signature = public.commute_signature(c)
        and l.active and l.seats_open > 0
        and public.account_active() and public.driver_approved(l.driver_id)
        and not exists (select 1 from public.club_members m where m.leg_id = l.id and m.passenger_id = (select auth.uid()) and m.active)),
    (select m from public.find_matches(p_commute) m where m ->> 'legId' = p_leg::text limit 1));
$$;
