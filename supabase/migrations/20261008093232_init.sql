create extension if not exists postgis with schema extensions;
create extension if not exists pg_cron;

create type public.user_role as enum ('passenger', 'driver');
create type public.verification_status as enum ('pending', 'verified', 'rejected');
create type public.doc_kind as enum ('id', 'licence', 'vehicle_registration', 'insurance', 'profile_photo', 'vehicle_photo');
create type public.leg_direction as enum ('to_work', 'to_home');
create type public.request_status as enum ('pending', 'accepted', 'declined', 'cancelled');
create type public.instance_status as enum ('scheduled', 'sharing', 'underway', 'completed', 'cancelled');
create type public.rider_status as enum ('expected', 'absent', 'at_pickup', 'collected', 'no_show', 'dropped_off');
create type public.contribution_status as enum ('upcoming', 'due', 'paid', 'overdue');
create type public.report_status as enum ('open', 'reviewing', 'closed');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_initial text not null default '' check (char_length(last_initial) <= 1),
  avatar_path text,
  about text check (char_length(about) <= 400),
  rating numeric(2, 1) not null default 0,
  rating_count int not null default 0,
  reliability int not null default 100,
  completed_arrangements int not null default 0,
  identity_status public.verification_status,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.profile_private (
  id uuid primary key references public.profiles (id) on delete cascade,
  last_name text,
  phone text,
  emergency_contact text,
  terms_accepted_at timestamptz,
  location_consent_at timestamptz,
  low_data_mode boolean not null default false
);

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null unique references public.profiles (id) on delete cascade,
  make text not null,
  model text not null,
  colour text not null,
  year int check (year between 1980 and 2100),
  body_type text not null default 'sedan' check (body_type in ('sedan', 'hatchback', 'suv', 'other')),
  registration_summary text not null,
  seats_total int not null check (seats_total between 1 and 7),
  photo_path text,
  status public.verification_status not null default 'pending'
);

create table public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.doc_kind not null,
  storage_path text not null,
  detail text,
  status public.verification_status not null default 'pending',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index on public.verification_documents (user_id);
create index on public.verification_documents (status);

create table public.pickup_points (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text not null,
  location extensions.geography (point, 4326) not null,
  kind text not null default 'community'
);
create index on public.pickup_points using gist (location);

create table public.driver_legs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles (id) on delete cascade,
  direction public.leg_direction not null,
  origin_label text not null,
  origin extensions.geography (point, 4326) not null,
  destination_label text not null,
  destination extensions.geography (point, 4326) not null,
  route extensions.geography (linestring, 4326) not null,
  route_distance_m int not null,
  route_duration_s int not null,
  departure_time time not null,
  days smallint[] not null check (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  seats_open int not null default 0 check (seats_open >= 0),
  max_deviation_min int not null default 8 check (max_deviation_min between 0 and 30),
  monthly_contribution int not null check (monthly_contribution >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (driver_id, direction)
);
create index on public.driver_legs using gist (route);
create index on public.driver_legs (driver_id);

create table public.passenger_commutes (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles (id) on delete cascade,
  direction public.leg_direction not null default 'to_work',
  origin_label text not null,
  origin extensions.geography (point, 4326) not null,
  destination_label text not null,
  destination extensions.geography (point, 4326) not null,
  days smallint[] not null check (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  arrive_by time not null,
  window_min int not null default 15,
  max_walk_m int not null default 750 check (max_walk_m between 0 and 1500),
  preferred_pickup_id uuid references public.pickup_points (id) on delete set null,
  notify_on_match boolean not null default false,
  created_at timestamptz not null default now(),
  unique (passenger_id, direction)
);

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles (id) on delete cascade,
  leg_id uuid not null references public.driver_legs (id) on delete cascade,
  commute_id uuid not null references public.passenger_commutes (id) on delete cascade,
  pickup_label text not null,
  pickup extensions.geography (point, 4326) not null,
  walking_m int not null,
  walking_min int not null,
  deviation_min int not null,
  route_overlap int not null,
  pickup_time time not null,
  monthly_contribution int not null,
  status public.request_status not null default 'pending',
  start_date date not null default (current_date + 7),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index join_requests_one_open on public.join_requests (passenger_id, leg_id) where status = 'pending';
create index on public.join_requests (leg_id);

create table public.club_members (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.driver_legs (id) on delete cascade,
  passenger_id uuid not null references public.profiles (id) on delete cascade,
  request_id uuid references public.join_requests (id) on delete set null,
  pickup_label text not null,
  pickup extensions.geography (point, 4326) not null,
  pickup_time time not null,
  monthly_contribution int not null,
  start_date date not null,
  paused boolean not null default false,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  unique (leg_id, passenger_id)
);
create index on public.club_members (passenger_id);

create table public.commute_instances (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.driver_legs (id) on delete cascade,
  service_date date not null,
  departs_at timestamptz not null,
  sharing_starts_at timestamptz not null,
  sharing_ends_at timestamptz not null,
  status public.instance_status not null default 'scheduled',
  driver_arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  unique (leg_id, service_date)
);

create table public.instance_riders (
  instance_id uuid not null references public.commute_instances (id) on delete cascade,
  passenger_id uuid not null references public.profiles (id) on delete cascade,
  status public.rider_status not null default 'expected',
  at_pickup_at timestamptz,
  collected_at timestamptz,
  primary key (instance_id, passenger_id)
);
create index on public.instance_riders (passenger_id);

create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  leg_id uuid references public.driver_legs (id) on delete cascade,
  kind text not null check (kind in ('wfh', 'leave', 'holiday', 'absent', 'unavailable', 'pause', 'pickup-change')),
  date date,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index on public.schedule_exceptions (user_id);
create index on public.schedule_exceptions (leg_id, date);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.driver_legs (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index on public.messages (leg_id, created_at);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  rater_id uuid not null references public.profiles (id) on delete cascade,
  ratee_id uuid not null references public.profiles (id) on delete cascade,
  leg_id uuid not null references public.driver_legs (id) on delete cascade,
  instance_id uuid references public.commute_instances (id) on delete set null,
  stars int not null check (stars between 1 and 5),
  tags text[] not null default '{}',
  comment text check (char_length(comment) <= 400),
  created_at timestamptz not null default now(),
  unique (rater_id, ratee_id, instance_id)
);
create index on public.ratings (ratee_id);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.driver_legs (id) on delete cascade,
  passenger_id uuid not null references public.profiles (id) on delete cascade,
  period date not null,
  amount int not null,
  status public.contribution_status not null default 'upcoming',
  paid_at timestamptz,
  unique (leg_id, passenger_id, period)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.profiles (id) on delete set null,
  instance_id uuid references public.commute_instances (id) on delete set null,
  kind text not null check (kind in ('driver', 'passenger', 'incident', 'safety')),
  body text not null check (char_length(body) between 5 and 2000),
  status public.report_status not null default 'open',
  handled_by uuid references auth.users (id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.location_pings (
  id bigint generated always as identity primary key,
  instance_id uuid not null references public.commute_instances (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  location extensions.geography (point, 4326) not null,
  heading real,
  speed real,
  recorded_at timestamptz not null default now()
);
create index on public.location_pings (instance_id, recorded_at);
create index on public.location_pings (recorded_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('android', 'ios', 'web')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
