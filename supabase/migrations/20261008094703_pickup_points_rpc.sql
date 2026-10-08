create or replace function public.list_pickup_points(p_lng float8 default null, p_lat float8 default null, p_radius_m int default 5000)
returns setof jsonb language sql stable security invoker set search_path = public, extensions as $$
  select jsonb_build_object('id', id, 'label', name, 'area', area, 'kind', kind,
                            'lng', st_x(location::geometry), 'lat', st_y(location::geometry))
  from pickup_points
  where p_lng is null or st_dwithin(location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_m)
  order by case when p_lng is null then 0 else st_distance(location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) end
  limit 30;
$$;
revoke execute on function public.list_pickup_points(float8, float8, int) from public, anon;
grant execute on function public.list_pickup_points(float8, float8, int) to authenticated;
