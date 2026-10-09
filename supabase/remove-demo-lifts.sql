-- Removes ALL demo / mock accounts (every profile flagged is_demo): the original demo drivers and passenger plus every mock lift
-- added by seed-demo-lifts.sql, together with their vehicles, documents, routes, and any requests or saved quotes that real
-- passengers made against them. Real accounts are never touched. Run it before real launch (it contains DELETEs on purpose).
delete from auth.users where id in (select id from public.profiles where is_demo);
