// Generates supabase/seed-demo-lifts.sql — realistic MOCK lift clubs with real road routes (Mapbox Directions).
//   node scripts/build-demo-seed.mjs
// Needs VITE_MAPBOX_TOKEN in .env. The output is committed, so applying the seed needs no network.
//
// Everything is flagged is_demo = true and uses ids d0000000-0000-4000-8000-0000000001NN, so it can be
// removed with supabase/remove-demo-lifts.sql. Drivers are approved the same way real ones are: four
// 'verified' verification_documents rows (no real documents exist).
import { readFileSync, writeFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const TOKEN = env.VITE_MAPBOX_TOKEN
if (!TOKEN) throw new Error('VITE_MAPBOX_TOKEN missing in .env')

/** Area-level places (label, lng, lat). Directions snaps each to the nearest road. */
const P = {
  ballito: ['Ballito', 31.2117, -29.5353],
  saltRock: ['Salt Rock', 31.234, -29.4883],
  sheffield: ['Sheffield Beach', 31.251, -29.4856],
  tongaat: ['Tongaat', 31.12, -29.575],
  verulam: ['Verulam', 31.045, -29.649],
  umhlangaRidge: ['Umhlanga Ridge', 31.0762, -29.7392],
  umhlangaRocks: ['Umhlanga Rocks', 31.087, -29.726],
  laLucia: ['La Lucia', 31.08, -29.748],
  mountEdgecombe: ['Mount Edgecombe', 31.0495, -29.7349],
  durbanNorth: ['Durban North', 31.0206, -29.7937],
  durbanCbd: ['Durban CBD', 31.0218, -29.8587],
  westville: ['Westville', 30.9322, -29.8307],
  sandton: ['Sandton', 28.0567, -26.1076],
  rosebank: ['Rosebank', 28.0436, -26.1458],
  fourways: ['Fourways', 28.0089, -26.0267],
  midrand: ['Midrand', 28.1079, -25.9987],
  centurion: ['Centurion', 28.188, -25.86],
  menlyn: ['Menlyn', 28.2772, -25.7829],
  ctCbd: ['Cape Town CBD', 18.4241, -33.9249],
  durbanville: ['Durbanville', 18.65, -33.833],
  centuryCity: ['Century City', 18.511, -33.893],
  somersetWest: ['Somerset West', 18.843, -34.078],
}

const MF = [0, 1, 2, 3, 4]
/**
 * id = 000000000001..3 are the original demo drivers (Sipho, Thando, Kevin) — they get approvals (and Kevin his
 * missing leg). New drivers start at 101. `legs`: [direction, from, to, departure, days, seatsOpen, maxDeviationMin]
 */
const DRIVERS = [
  // ---- original demo drivers: approvals only (+ Kevin's leg) ----
  { n: 1, existing: true },
  { n: 2, existing: true },
  { n: 3, existing: true, legs: [['to_work', 'sheffield', 'mountEdgecombe', '06:30', MF, 2, 8]] },
  // ---- KwaZulu-Natal: North Coast ↔ Umhlanga / Durban ----
  { n: 101, first: 'Pieter', last: 'V', about: 'Lawyer at an Umhlanga Ridge firm. Quiet, punctual, music off before 7.', rating: 4.9, count: 63, rel: 99, done: 9, car: ['Volkswagen', 'Polo Vivo', 'White', 2020, 'hatchback', 'ND', 3], legs: [['to_work', 'ballito', 'umhlangaRidge', '06:30', MF, 2, 8], ['to_home', 'umhlangaRidge', 'ballito', '17:15', MF, 2, 8]] },
  { n: 102, first: 'Naledi', last: 'D', about: 'Pharmacist, early starter. Happy to share costs and the school-holiday quiet roads.', rating: 4.8, count: 41, rel: 100, done: 6, car: ['Kia', 'Picanto', 'Red', 2021, 'hatchback', 'NU', 3], legs: [['to_work', 'ballito', 'umhlangaRocks', '06:45', MF, 2, 7]] },
  { n: 103, first: 'Lwazi', last: 'S', about: 'Works at the La Lucia offices. Leaves from Salt Rock Main Road.', rating: 4.7, count: 28, rel: 97, done: 5, car: ['Toyota', 'Starlet', 'Grey', 2022, 'hatchback', 'ND', 3], legs: [['to_work', 'saltRock', 'laLucia', '06:20', [0, 1, 2, 3], 2, 8], ['to_home', 'laLucia', 'saltRock', '16:45', [0, 1, 2, 3], 2, 8]] },
  { n: 104, first: 'Michelle', last: 'B', about: 'Accountant, Tongaat to the Ridge every weekday.', rating: 4.6, count: 35, rel: 96, done: 8, car: ['Renault', 'Kwid', 'Orange', 2019, 'hatchback', 'NP', 3], legs: [['to_work', 'tongaat', 'umhlangaRidge', '06:50', MF, 1, 6], ['to_home', 'umhlangaRidge', 'tongaat', '17:05', MF, 1, 6]] },
  { n: 105, first: 'Rajesh', last: 'G', about: 'Engineer commuting from La Lucia to the Durban CBD. Roomy SUV.', rating: 4.9, count: 112, rel: 100, done: 14, car: ['Toyota', 'Corolla Cross', 'Silver', 2023, 'suv', 'ND', 4], legs: [['to_work', 'laLucia', 'durbanCbd', '07:00', MF, 3, 9], ['to_home', 'durbanCbd', 'laLucia', '17:00', MF, 3, 9]] },
  { n: 106, first: 'Zinhle', last: 'M', about: 'Municipal analyst. Durban North to the CBD, never late.', rating: 4.8, count: 57, rel: 98, done: 10, car: ['Suzuki', 'Swift', 'Blue', 2021, 'hatchback', 'ND', 3], legs: [['to_work', 'durbanNorth', 'durbanCbd', '07:10', MF, 2, 7]] },
  { n: 107, first: 'Johan', last: 'K', about: 'Long-haul Ballito to the Durban CBD. Early bird, leaves 05:50 sharp.', rating: 4.7, count: 74, rel: 99, done: 12, car: ['Ford', 'Ranger', 'Black', 2020, 'other', 'ND', 4], legs: [['to_work', 'ballito', 'durbanCbd', '05:50', MF, 3, 10], ['to_home', 'durbanCbd', 'ballito', '16:45', MF, 3, 10]] },
  { n: 108, first: 'Fatima', last: 'K', about: 'Teacher. Verulam to Umhlanga Ridge on Mon, Wed and Fri.', rating: 4.9, count: 38, rel: 100, done: 4, car: ['Hyundai', 'Grand i10', 'White', 2022, 'hatchback', 'NU', 3], legs: [['to_work', 'verulam', 'umhlangaRidge', '07:15', [0, 2, 4], 2, 7]] },
  { n: 109, first: 'Bongani', last: 'Z', about: 'Westville to the CBD. Car is full right now — waiting list opens soon.', rating: 4.5, count: 29, rel: 95, done: 7, car: ['Nissan', 'Almera', 'Silver', 2018, 'sedan', 'ND', 3], legs: [['to_work', 'westville', 'durbanCbd', '06:55', MF, 0, 8]] },
  { n: 110, first: 'Aisha', last: 'P', about: 'Hybrid worker: in the office Tuesdays and Thursdays only.', rating: 4.8, count: 22, rel: 100, done: 3, car: ['Toyota', 'Yaris', 'White', 2021, 'hatchback', 'ND', 3], legs: [['to_work', 'ballito', 'umhlangaRidge', '06:35', [1, 3], 2, 8]] },
  // ---- Gauteng ----
  { n: 111, first: 'Sizwe', last: 'N', about: 'N1 commuter, Centurion to Sandton. Leaves early to beat the traffic.', rating: 4.8, count: 88, rel: 99, done: 13, car: ['Toyota', 'Fortuner', 'Grey', 2021, 'suv', 'GP', 4], legs: [['to_work', 'centurion', 'sandton', '05:50', MF, 3, 10], ['to_home', 'sandton', 'centurion', '16:50', MF, 3, 10]] },
  { n: 112, first: 'Nomsa', last: 'L', about: 'Menlyn to Sandton, N1 south-to-north. Two seats free.', rating: 4.7, count: 46, rel: 97, done: 6, car: ['Volkswagen', 'Golf', 'Black', 2019, 'hatchback', 'GP', 3], legs: [['to_work', 'menlyn', 'sandton', '05:40', MF, 2, 9]] },
  { n: 113, first: 'Ahmed', last: 'S', about: 'Fourways to Rosebank, in the office most days.', rating: 4.9, count: 51, rel: 100, done: 8, car: ['Haval', 'Jolion', 'Blue', 2022, 'suv', 'GP', 4], legs: [['to_work', 'fourways', 'rosebank', '06:50', MF, 3, 8]] },
  { n: 114, first: 'Lindiwe', last: 'M', about: 'Midrand to Sandton. Tidy car, no smoking.', rating: 4.6, count: 33, rel: 96, done: 5, car: ['Suzuki', 'Swift', 'Red', 2020, 'hatchback', 'GP', 3], legs: [['to_work', 'midrand', 'sandton', '06:30', MF, 2, 7]] },
  // ---- Western Cape ----
  { n: 115, first: 'Michael', last: 'A', about: 'Durbanville to the CBD, back by 17:30.', rating: 4.8, count: 67, rel: 99, done: 11, car: ['Toyota', 'Corolla', 'White', 2019, 'sedan', 'CA', 3], legs: [['to_work', 'durbanville', 'ctCbd', '06:40', MF, 2, 8], ['to_home', 'ctCbd', 'durbanville', '17:10', MF, 2, 8]] },
  { n: 116, first: 'Chantelle', last: 'J', about: 'N2 commuter from Somerset West. Early start.', rating: 4.9, count: 44, rel: 100, done: 7, car: ['Volkswagen', 'T-Cross', 'Orange', 2022, 'suv', 'CA', 4], legs: [['to_work', 'somersetWest', 'ctCbd', '06:00', MF, 3, 10]] },
  { n: 117, first: 'Yusuf', last: 'H', about: 'Century City to the CBD, flexible on pickup spots.', rating: 4.7, count: 26, rel: 97, done: 4, car: ['Hyundai', 'i20', 'Grey', 2021, 'hatchback', 'CA', 3], legs: [['to_work', 'centuryCity', 'ctCbd', '07:20', MF, 2, 8]] },
]

const id = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const dist = (a, b) => {
  const R = 6371000, r = (x) => (x * Math.PI) / 180
  const h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const thin = (coords, minM = 15) => {
  const out = [coords[0]]
  for (let i = 1; i < coords.length - 1; i++) if (dist(out[out.length - 1], coords[i]) >= minM) out.push(coords[i])
  out.push(coords[coords.length - 1])
  return out.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)])
}

async function route(a, b) {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${a[1]},${a[2]};${b[1]},${b[2]}?geometries=geojson&overview=full&access_token=${TOKEN}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Directions ${res.status} for ${a[0]} → ${b[0]}`)
  const r = (await res.json()).routes?.[0]
  if (!r) throw new Error(`No route ${a[0]} → ${b[0]}`)
  return { coords: thin(r.geometry.coordinates), dist: Math.round(r.distance), dur: Math.round(r.duration) }
}

const sql = []
const out = (s) => sql.push(s)
out(`-- GENERATED by scripts/build-demo-seed.mjs — do not edit by hand.
-- Realistic MOCK lift clubs (is_demo = true) with real road routes, so searches return results while testing.
-- Idempotent: safe to run more than once. Remove with supabase/remove-demo-lifts.sql before real launch.
-- Drivers are approved exactly like real ones (four verified verification_documents) — the documents are fake.
`)

let legCount = 0
for (const d of DRIVERS) {
  const uid = id(d.n)
  if (!d.existing) {
    const [make, model, colour, year, body, plate, seats] = d.car
    const email = `demo.${d.first.toLowerCase()}@lifty.test`
    out(`-- ${d.first} ${d.last}.`)
    out(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user)
values ('00000000-0000-0000-0000-000000000000', ${q(uid)}, 'authenticated', 'authenticated', ${q(email)}, '', now(), now() - interval '120 days', now(), '{"provider":"email","providers":["email"]}', ${q(JSON.stringify({ full_name: `${d.first} ${d.last}.`, demo: true }))}, false)
on conflict (id) do nothing;`)
    out(`insert into public.profiles (id, role, first_name, last_initial, about, rating, rating_count, reliability, completed_arrangements, is_demo, created_at)
values (${q(uid)}, 'driver', ${q(d.first)}, ${q(d.last)}, ${q(d.about)}, ${d.rating}, ${d.count}, ${d.rel}, ${d.done}, true, now() - interval '120 days')
on conflict (id) do update set about = excluded.about, rating = excluded.rating, rating_count = excluded.rating_count, reliability = excluded.reliability, completed_arrangements = excluded.completed_arrangements, is_demo = true;`)
    const reg = `${plate} ••• ${String(100 + ((d.n * 37) % 900)).padStart(3, '0')}`
    out(`insert into public.vehicles (driver_id, make, model, colour, year, body_type, registration_summary, seats_total, status)
values (${q(uid)}, ${q(make)}, ${q(model)}, ${q(colour)}, ${year}, ${q(body)}, ${q(reg)}, ${seats}, 'pending')
on conflict (driver_id) do nothing;`)
  } else {
    out(`-- original demo driver ${uid.slice(-2)}`)
  }
  // approvals — the same four documents a real driver submits, marked verified
  out(`insert into public.verification_documents (user_id, kind, storage_path, detail, status, reviewed_at)
select ${q(uid)}, k, 'demo/' || ${q(uid)} || '/' || k || '.pdf', 'Demo account — no real document', 'verified', now()
from unnest(array['id','licence','vehicle_registration','insurance']::public.doc_kind[]) k
where exists (select 1 from public.profiles where id = ${q(uid)})
  and not exists (select 1 from public.verification_documents x where x.user_id = ${q(uid)} and x.kind = k);`)

  for (const [direction, from, to, dep, days, seatsOpen, maxDev] of d.legs ?? []) {
    const r = await route(P[from], P[to])
    legCount++
    console.log(`${d.first ?? 'orig'} ${direction}: ${P[from][0]} → ${P[to][0]}  ${(r.dist / 1000).toFixed(1)} km  ${Math.round(r.dur / 60)} min  ${r.coords.length} pts`)
    const line = JSON.stringify({ type: 'LineString', coordinates: r.coords })
    // the leg starts and ends where the road does (the place coordinates above are only approximate area centres)
    const startPt = [P[from][0], ...r.coords[0]]
    const endPt = [P[to][0], ...r.coords[r.coords.length - 1]]
    const pg = (p) => `extensions.st_setsrid(extensions.st_makepoint(${p[1]}, ${p[2]}), 4326)::extensions.geography`
    out(`insert into public.driver_legs (driver_id, direction, origin_label, origin, destination_label, destination, route, route_distance_m, route_duration_s, departure_time, days, seats_open, max_deviation_min, monthly_contribution, active)
select ${q(uid)}, ${q(direction)}, ${q(P[from][0])}, ${pg(startPt)}, ${q(P[to][0])}, ${pg(endPt)},
  extensions.st_setsrid(extensions.st_geomfromgeojson(${q(line)}), 4326)::extensions.geography, ${r.dist}, ${r.dur}, ${q(dep)}, '{${days.join(',')}}'::smallint[], ${seatsOpen}, ${maxDev},
  (round(public.suggested_contribution(${r.dist}, ${days.length}, v.seats_total) * 0.9 / 10) * 10)::int, true
from public.vehicles v where v.driver_id = ${q(uid)}
on conflict (driver_id, direction) do update set origin = excluded.origin, destination = excluded.destination, route = excluded.route, route_duration_s = excluded.route_duration_s, departure_time = excluded.departure_time,
  days = excluded.days, seats_open = excluded.seats_open, max_deviation_min = excluded.max_deviation_min, monthly_contribution = excluded.monthly_contribution, active = true;`)
  }
}

writeFileSync('supabase/seed-demo-lifts.sql', sql.join('\n') + '\n')
console.log(`\nwrote supabase/seed-demo-lifts.sql — ${DRIVERS.length} drivers, ${legCount} routes`)
