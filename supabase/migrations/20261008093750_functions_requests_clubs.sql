create or replace function public.request_to_join(p_commute uuid, p_leg uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  m jsonb;
  v_id uuid;
  v_driver uuid;
begin
  m := get_match(p_commute, p_leg);
  if m is null then
    raise exception 'This lift club is no longer a match for your commute';
  end if;
  insert into join_requests (passenger_id, leg_id, commute_id, pickup_label, pickup, walking_m, walking_min,
                             deviation_min, route_overlap, pickup_time, monthly_contribution)
  values (auth.uid(), p_leg, p_commute, m -> 'pickup' ->> 'label',
          st_setsrid(st_makepoint((m -> 'pickup' ->> 'lng')::float8, (m -> 'pickup' ->> 'lat')::float8), 4326)::geography,
          (m ->> 'walkingDistanceM')::int, (m ->> 'walkingMinutes')::int, (m ->> 'driverDeviationMinutes')::int,
          (m ->> 'routeOverlap')::int, (m ->> 'pickupEta')::time, (m ->> 'monthlyContribution')::int)
  returning id into v_id;
  select driver_id into v_driver from driver_legs where id = p_leg;
  perform notify(v_driver, 'request', 'New lift club request',
                 (select first_name from profiles where id = auth.uid()) || ' would like to join your commute.', '/d/request/' || v_id);
  return v_id;
end $$;

create or replace function public.cancel_join_request(p_request uuid)
returns void language sql security definer set search_path = public as $$
  update join_requests set status = 'cancelled', responded_at = now()
  where id = p_request and passenger_id = auth.uid() and status = 'pending';
$$;

create or replace function public.respond_to_request(p_request uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r join_requests;
  l driver_legs;
begin
  select * into r from join_requests where id = p_request for update;
  if not found or r.status <> 'pending' then
    raise exception 'This request is no longer open';
  end if;
  select * into l from driver_legs where id = r.leg_id for update;
  if l.driver_id <> auth.uid() then
    raise exception 'Not your lift club';
  end if;

  if p_accept then
    if l.seats_open <= 0 then
      raise exception 'You have no open seats';
    end if;
    insert into club_members (leg_id, passenger_id, request_id, pickup_label, pickup, pickup_time, monthly_contribution, start_date)
    values (r.leg_id, r.passenger_id, r.id, r.pickup_label, r.pickup, r.pickup_time, r.monthly_contribution, r.start_date)
    on conflict (leg_id, passenger_id) do update set active = true, paused = false, pickup_label = excluded.pickup_label,
      pickup = excluded.pickup, pickup_time = excluded.pickup_time, monthly_contribution = excluded.monthly_contribution;
    update driver_legs set seats_open = seats_open - 1 where id = l.id;
    insert into contributions (leg_id, passenger_id, period, amount, status)
    values (l.id, r.passenger_id, date_trunc('month', r.start_date)::date, r.monthly_contribution, 'upcoming')
    on conflict do nothing;
    update join_requests set status = 'accepted', responded_at = now() where id = r.id;
    perform notify(r.passenger_id, 'accepted', 'You’re in!',
                   (select first_name from profiles where id = l.driver_id) || ' accepted your request to join the lift club.', '/p/accepted');
  else
    update join_requests set status = 'declined', responded_at = now() where id = r.id;
    perform notify(r.passenger_id, 'declined', 'Not a fit this time',
                   'That lift club can’t take you right now. We’ll keep looking for other matches.', '/p/find');
  end if;
end $$;

create or replace function public.remove_member(p_leg uuid, p_passenger uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_leg_driver(p_leg) then
    raise exception 'Not your lift club';
  end if;
  update club_members set active = false where leg_id = p_leg and passenger_id = p_passenger and active;
  if found then
    update driver_legs set seats_open = seats_open + 1 where id = p_leg;
    perform notify(p_passenger, 'removed', 'Lift club update', 'Your driver has ended this arrangement.', '/p/find');
  end if;
end $$;

create or replace function public.list_incoming_requests()
returns setof jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', r.id,
    'status', case r.status when 'accepted' then 'accepted' when 'pending' then 'pending' else 'declined' end,
    'passenger', jsonb_build_object('id', p.id, 'firstName', p.first_name, 'lastInitial', p.last_initial,
                                    'avatarPath', p.avatar_path, 'rating', p.rating, 'ratingCount', p.rating_count,
                                    'reliability', p.reliability, 'verified', coalesce(p.identity_status = 'verified', false)),
    'pickup', jsonb_build_object('label', r.pickup_label, 'lng', st_x(r.pickup::geometry), 'lat', st_y(r.pickup::geometry)),
    'destination', jsonb_build_object('label', c.destination_label, 'lng', st_x(c.destination::geometry), 'lat', st_y(c.destination::geometry)),
    'walkingFlexibilityM', c.max_walk_m,
    'days', to_jsonb(c.days),
    'arriveBy', to_char(c.arrive_by, 'HH24:MI'),
    'routeOverlap', r.route_overlap,
    'currentCommuteMinutes', round(l.route_duration_s / 60.0),
    'deviationMinutes', r.deviation_min,
    'additionalDistanceKm', round((r.deviation_min * 0.5)::numeric, 1),
    'monthlyContribution', r.monthly_contribution,
    'geometry', jsonb_build_object(
      'path', st_asgeojson(l.route::geometry, 6)::jsonb,
      'deviation', st_asgeojson(st_makeline(array[
          st_lineinterpolatepoint(l.route::geometry, greatest(0, st_linelocatepoint(l.route::geometry, r.pickup::geometry) - 300.0 / l.route_distance_m)),
          r.pickup::geometry,
          st_lineinterpolatepoint(l.route::geometry, least(1, st_linelocatepoint(l.route::geometry, r.pickup::geometry) + 300.0 / l.route_distance_m))]), 6)::jsonb,
      'walking', '{"type":"LineString","coordinates":[]}'::jsonb)
  )
  from join_requests r
  join driver_legs l on l.id = r.leg_id and l.driver_id = auth.uid()
  join profiles p on p.id = r.passenger_id
  join passenger_commutes c on c.id = r.commute_id
  where r.status <> 'cancelled'
  order by r.created_at desc;
$$;

create or replace function public.get_my_clubs()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'asPassenger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'legId', l.id, 'direction', l.direction, 'paused', m.paused, 'startDate', m.start_date,
        'pickup', jsonb_build_object('label', m.pickup_label, 'lng', st_x(m.pickup::geometry), 'lat', st_y(m.pickup::geometry)),
        'pickupTime', to_char(m.pickup_time, 'HH24:MI'),
        'destination', jsonb_build_object('label', l.destination_label, 'lng', st_x(l.destination::geometry), 'lat', st_y(l.destination::geometry)),
        'days', to_jsonb(l.days), 'monthlyContribution', m.monthly_contribution,
        'paymentStatus', coalesce((select ct.status from contributions ct where ct.leg_id = l.id and ct.passenger_id = m.passenger_id order by ct.period desc limit 1), 'upcoming'),
        'driver', jsonb_build_object('id', dp.id, 'firstName', dp.first_name, 'lastInitial', dp.last_initial, 'avatarPath', dp.avatar_path,
                                     'rating', dp.rating, 'ratingCount', dp.rating_count, 'identityStatus', coalesce(dp.identity_status::text, 'pending')),
        'vehicle', jsonb_build_object('make', v.make, 'model', v.model, 'colour', v.colour, 'year', v.year, 'bodyType', v.body_type,
                                      'registrationSummary', v.registration_summary, 'seatsTotal', v.seats_total, 'photoPath', v.photo_path),
        'seatsTaken', (select count(*) from club_members x where x.leg_id = l.id and x.active),
        'members', (select jsonb_agg(jsonb_build_object('id', xp.id, 'firstName', xp.first_name, 'lastInitial', xp.last_initial, 'avatarPath', xp.avatar_path))
                    from club_members x join profiles xp on xp.id = x.passenger_id where x.leg_id = l.id and x.active)))
      from club_members m
      join driver_legs l on l.id = m.leg_id
      join profiles dp on dp.id = l.driver_id
      join vehicles v on v.driver_id = l.driver_id
      where m.passenger_id = auth.uid() and m.active), '[]'::jsonb),
    'asDriver', coalesce((
      select jsonb_agg(jsonb_build_object(
        'legId', l.id, 'direction', l.direction, 'originLabel', l.origin_label, 'destinationLabel', l.destination_label,
        'departureTime', to_char(l.departure_time, 'HH24:MI'), 'days', to_jsonb(l.days), 'seatsOpen', l.seats_open,
        'maxDeviationMin', l.max_deviation_min, 'monthlyContribution', l.monthly_contribution,
        'routeDistanceM', l.route_distance_m, 'routeDurationS', l.route_duration_s,
        'route', st_asgeojson(l.route::geometry, 6)::jsonb,
        'members', (select jsonb_agg(jsonb_build_object('id', xp.id, 'firstName', xp.first_name, 'lastInitial', xp.last_initial,
                                                        'avatarPath', xp.avatar_path, 'pickupLabel', x.pickup_label,
                                                        'pickupTime', to_char(x.pickup_time, 'HH24:MI'),
                                                        'paymentStatus', (select ct.status from contributions ct where ct.leg_id = l.id and ct.passenger_id = x.passenger_id order by ct.period desc limit 1)))
                    from club_members x join profiles xp on xp.id = x.passenger_id where x.leg_id = l.id and x.active)))
      from driver_legs l where l.driver_id = auth.uid()), '[]'::jsonb)
  );
$$;

create or replace function public.mark_contribution_paid(p_leg uuid, p_passenger uuid, p_period date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_leg_driver(p_leg) or p_passenger = auth.uid()) then raise exception 'Not allowed'; end if;
  update contributions set status = 'paid', paid_at = now()
  where leg_id = p_leg and passenger_id = p_passenger and period = date_trunc('month', p_period)::date;
end $$;
