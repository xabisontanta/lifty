-- Invalidation must happen after the vehicle row is written. Updating documents
-- in the vehicle BEFORE trigger makes their verification trigger update the same
-- vehicle tuple twice and PostgreSQL rejects ordinary vehicle edits (27000).
create or replace function lifty_private.vehicle_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.make,new.model,new.year,new.registration_summary,new.colour,new.seats_total,new.body_type)
 is distinct from row(old.make,old.model,old.year,old.registration_summary,old.colour,old.seats_total,old.body_type) then
  new.status:='pending';
 end if;
 return new;
end $$;

create or replace function lifty_private.invalidate_vehicle_documents()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.make,new.model,new.year,new.registration_summary,new.colour,new.seats_total,new.body_type)
 is distinct from row(old.make,old.model,old.year,old.registration_summary,old.colour,old.seats_total,old.body_type) then
  update public.verification_documents set status='pending',reviewed_by=null,reviewed_at=null,
   review_note='Vehicle details changed; review required'
  where user_id=new.driver_id and kind in('vehicle_registration','insurance');
 end if;
 return new;
end $$;

create trigger vehicle_documents_invalidate after update on public.vehicles
for each row execute function lifty_private.invalidate_vehicle_documents();
revoke all on function lifty_private.vehicle_changed(),lifty_private.invalidate_vehicle_documents() from public,anon,authenticated;
