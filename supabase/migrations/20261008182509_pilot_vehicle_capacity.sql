-- A replacement vehicle cannot leave accepted passengers without seats. Changing
-- the offered capacity also revalidates published prices without editing agreed prices.
create or replace function lifty_private.vehicle_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.make,new.model,new.year,new.registration_summary,new.colour,new.seats_total,new.body_type)
 is distinct from row(old.make,old.model,old.year,old.registration_summary,old.colour,old.seats_total,old.body_type) then
  if exists(select 1 from public.driver_legs l where l.driver_id=new.driver_id
   and (select count(*) from public.club_members m where m.leg_id=l.id and m.active)>new.seats_total) then
   raise exception 'Vehicle capacity cannot be less than existing members';
  end if;
  if exists(select 1 from public.driver_legs l where l.driver_id=new.driver_id
   and l.monthly_contribution>public.contribution_cap(l.route_distance_m,cardinality(l.days),new.seats_total)) then
   raise exception 'Update your published contribution to the new vehicle cost-sharing limit first';
  end if;
  new.status:='pending';
 end if;
 return new;
end $$;

create or replace function lifty_private.reconcile_vehicle_capacity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.seats_total<>old.seats_total then
  update public.driver_legs l set seats_open=greatest(0,new.seats_total-(select count(*) from public.club_members m where m.leg_id=l.id and m.active))
  where l.driver_id=new.driver_id and l.seats_open+(select count(*) from public.club_members m where m.leg_id=l.id and m.active)>new.seats_total;
 end if;
 return new;
end $$;
create trigger vehicle_capacity_reconcile after update of seats_total on public.vehicles
for each row execute function lifty_private.reconcile_vehicle_capacity();
revoke all on function lifty_private.vehicle_changed(),lifty_private.reconcile_vehicle_capacity() from public,anon,authenticated;
