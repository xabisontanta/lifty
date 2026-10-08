-- Exact, fresh quotes for road and explicitly labelled estimated searches.
alter table public.match_quotes add column quote_id uuid not null default gen_random_uuid();
create unique index match_quotes_quote_id_key on public.match_quotes(quote_id);
create table lifty_private.match_search_limits(user_id uuid not null references public.profiles on delete cascade,period timestamptz not null,attempts int not null default 0,primary key(user_id,period));
revoke all on lifty_private.match_search_limits from public,anon,authenticated;
create or replace function public.authorize_match_search(p_commute uuid,p_passenger uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare used int; bucket timestamptz:=date_trunc('hour',now());
begin
 if not exists(select 1 from public.passenger_commutes c join public.profiles p on p.id=c.passenger_id where c.id=p_commute and c.passenger_id=p_passenger and p.suspended_at is null) then raise exception 'Commute not found or account not active';end if;
 insert into lifty_private.match_search_limits(user_id,period,attempts) values(p_passenger,bucket,1)
 on conflict(user_id,period) do update set attempts=lifty_private.match_search_limits.attempts+1 returning attempts into used;
 delete from lifty_private.match_search_limits where period<now()-interval '2 days';
 return used<=30;
end $$;
revoke all on function public.authorize_match_search(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_match_search(uuid,uuid) to service_role;
create or replace function public.persist_match_quotes(p_commute uuid,p_passenger uuid,p_signature text,p_matches jsonb,p_leg_signatures jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.passenger_commutes; l public.driver_legs; m jsonb; result jsonb:='[]'; quote uuid;
begin
 select * into c from public.passenger_commutes where id=p_commute and passenger_id=p_passenger for update;
 if c.id is null or public.commute_signature(c)<>p_signature or not exists(select 1 from public.profiles where id=p_passenger and suspended_at is null) then raise exception 'Search changed; refresh your matches';end if;
 if jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches)>20 then raise exception 'Invalid quote list';end if;
 delete from public.match_quotes where commute_id=p_commute;
 for m in select value from jsonb_array_elements(p_matches) order by value->>'legId' loop
  select * into l from public.driver_legs where id=(m->>'legId')::uuid for share;
  if l.id is null or not l.active or l.seats_open<=0 or not public.driver_approved(l.driver_id) or public.leg_signature(l) is distinct from p_leg_signatures->>l.id::text then raise exception 'An offer changed; refresh your matches';end if;
  quote:=gen_random_uuid();m:=m||jsonb_build_object('quoteId',quote,'commuteId',c.id);
  insert into public.match_quotes(commute_id,leg_id,passenger_id,match,leg_signature,commute_signature,quote_id) values(c.id,l.id,p_passenger,m,public.leg_signature(l),p_signature,quote);
  result:=result||jsonb_build_array(m);
 end loop;
 return result;
end $$;
revoke all on function public.persist_match_quotes(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.persist_match_quotes(uuid,uuid,text,jsonb,jsonb) to service_role;
create or replace function public.get_estimated_match_quotes(p_commute uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.passenger_commutes; m jsonb; result jsonb:='[]'; signatures jsonb:='{}';
begin
 if not public.account_active() then raise exception 'Sign in first';end if;
 select * into c from public.passenger_commutes where id=p_commute and passenger_id=auth.uid() for update;
 if c.id is null then raise exception 'Commute not found';end if;
 for m in select * from public.find_matches(c.id) loop
  m:=m||jsonb_build_object('routing','estimate');
  result:=result||jsonb_build_array(m);
  signatures:=signatures||jsonb_build_object(m->>'legId',public.leg_signature(l)) from public.driver_legs l where l.id=(m->>'legId')::uuid;
 end loop;
 return public.persist_match_quotes(c.id,auth.uid(),public.commute_signature(c),result,signatures);
end $$;
revoke all on function public.get_estimated_match_quotes(uuid) from public,anon;
grant execute on function public.get_estimated_match_quotes(uuid) to authenticated;
create or replace function public.request_to_join_quote(p_commute uuid,p_leg uuid,p_quote uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.passenger_commutes; l public.driver_legs; q public.match_quotes;
begin
 if not public.account_active() then raise exception 'Sign in first';end if;
 select * into c from public.passenger_commutes where id=p_commute and passenger_id=auth.uid() for update;
 select * into l from public.driver_legs where id=p_leg for share;
 select * into q from public.match_quotes where commute_id=p_commute and leg_id=p_leg and passenger_id=auth.uid() and quote_id=p_quote for share;
 if c.id is null or l.id is null or q.quote_id is null or q.created_at<=now()-interval '2 hours' or q.leg_signature<>public.leg_signature(l) or q.commute_signature<>public.commute_signature(c)
 then raise exception 'This offer has changed or expired. Refresh your matches before requesting.';end if;
 return public.request_to_join(c.id,l.id);
end $$;
revoke all on function public.request_to_join_quote(uuid,uuid,uuid) from public,anon;
grant execute on function public.request_to_join_quote(uuid,uuid,uuid) to authenticated;

