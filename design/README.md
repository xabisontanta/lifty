# Lifty design source of truth

| File | What it is |
|---|---|
| `01-lifty-design-system.png` | Brand principles, palette, type, icons, imagery, map style, components, spacing/radius, states, experience categories |
| `02-lifty-screen-flows.png` | 20 mobile screens: onboarding → matching → lift club → payments → ratings |
| `03-reference-rideway.jpg` | Visual reference only. Its e-hailing concepts (ride types, fares, "Choose Ride", nearest driver) are **not** used. |

Lifty is a **recurring commuter lift club**, not e-hailing. When a design detail uses taxi language ("Bookings", "Find More Drivers"), we use lift-club language instead.

## Tokens (implemented in `src/styles/tokens.css`)
| Token | Design | Value |
|---|---|---|
| Primary teal | Brand, CTA, active | `#00B386` |
| Dark navy | Headings, navigation | `#0F2D4A` |
| Off white / Light mint / Light gray | Page bg / cards, highlights / borders | `#F8FAFC` / `#E8F7F1` / `#E5E7EB` |
| Success / Warning / Error | States | `#22C55E` / `#F59E0B` / `#EF4444` |
| Map blue / Soft blue | Route line, tracking / map elements | `#3B82F6` / `#DBEAFE` |
| Text / secondary | | `#0F172A` / `#64748B` |
| Type | Inter. H1 32/40 bold · H2 24/32 · H3 18/28 · Body 16/24 · Button 16 semibold · Caption 14/20 | `--fs-*`, `--lh-*` |
| Spacing | 8pt grid: 4 8 12 16 24 32 48 | `--s-1…7` |
| Radius | 4 small · 8 input · 16 button · 24 card · 32 large | `--r-xs/sm/input/btn/card/panel` |

## Map style (design/01 §06)
Green pin = pickup point · red pin = destination · navy car = driver location · blue dot = passenger · dotted line = walking path · blue line = planned route · amber = pickup deviation (our addition, so the detour is visible). Floating chips: "8 min · Driver away", "5 min · Walk to pickup".

## Bottom navigation
Passenger: **Home · My Commute · Find Lifts · Messages · Profile**. Driver: **Home · My Route · Requests · Messages · Profile**.
(The design system shows "Clubs/Commute/Messages"; the flow sheet shows "Search/Bookings". We merged them and avoided taxi wording.)

## Screen-by-screen (design/02)
| # | Screen | Purpose | Route | Status |
|---|---|---|---|---|
| 01 | Welcome | Value proposition, Get Started | `/welcome` | Done — AI photo carousel (3 slides, swipe) |
| 02 | Choose Role | Passenger or Driver (never "both") | `/role` | Done — photo role cards |
| 03 | Sign Up | Name, mobile, password, terms | `/signup` | Done |
| 04 | OTP | Verify WhatsApp number, resend timer | `/otp` | Done |
| 05 | Passenger Onboarding 1/3 | Home, work, preferred pickup, walk toggle + metres slider | `/onboarding/passenger/1` | Done — walk toggle + metres slider, Mapbox address search |
| 06 | Passenger Onboarding 2/3 | Days, arrival time, return time | `/onboarding/passenger/2` | Done |
| — | Passenger Onboarding 3/3 | Not in design: privacy + location consent | `/onboarding/passenger/3` | Ours |
| 07 | Driver Onboarding 1/4 | Vehicle: registration, make, model, year, colour, seats | `/onboarding/driver/1` | Done — vehicle first, body type, seats |
| 08 | Driver Onboarding 2/4 | Regular commute: home, work, depart, return, days | `/onboarding/driver/2` | Done — address search, days, optional trip home |
| 09 | Driver Onboarding 3/4 | Verification docs: ID, licence, registration, insurance | `/onboarding/driver/3` | Done — real uploads to private storage |
| — | Driver Onboarding 4/4 | Not in design: profile photo, **car photo**, max detour, contribution | `/onboarding/driver/4` | Ours — real photo uploads, cost-sharing cap |
| 10 | Passenger Home | Greeting, Plan Your Commute card, large map | `/p/home` | Done — 320px live map with community pickup points |
| 11 | Plan Your Commute | From/To, days, arrival time, pickup preference, Find Lift Clubs | `/p/find` | Done |
| 12 | Finding Drivers | Dark radar loading with step checklist | `/p/finding` | Done |
| 13 | Available Lift Clubs | Compact rows: avatar, rating, car, seats, deviation + match chips | `/p/matches` | Done — design-system match card with avatar stack |
| 14 | Driver Route Details | Route map, legend, est. deviation and pickup time, Request to Join | `/p/match/:id` | Done — legend list, car photo card, real route geometry (live) |
| 15 | Request Sent | Confetti check, View Details, find more | `/p/sent` | Done — confetti, declined state |
| 16 | Match Accepted | "You're In!", start date, days, pickup point and time | `/p/accepted` | Done |
| 17 | My Lift Club | Driver with call/message, pickup → drop-off timeline, dates, contribution | `/p/commute` | Done — call/message, pickup→drop-off timeline, morning/evening legs |
| 18 | Payment Method | Card, EFT, mobile money, add new | `/p/payments` | Done (v1 tracks contributions only) |
| 19 | Driver Profile | Verified chips, **vehicle photo card**, about, reviews | `/p/driver/:id` | Done — vehicle photo, About, reliability |
| 20 | Rate Driver | Stars, category chips, comment | `/p/rate` | Done |
| 20b | Profile / Settings | Account rows | `/p/profile` | Done |

Not shown in the design but required by the product brief, styled with the same tokens: live tracking (`/p/track`, `/d/today`), commute complete, no-match, schedule exceptions, Safety Centre, chat, and all driver-side screens after onboarding.

## Imagery
AI-generated set in `public/images/`, consistent daylight look with a soft teal grade, ordinary South African commuters, mid-range cars (no taxis or luxury). The driver's **real car photo** (uploaded at onboarding) replaces the fallback wherever a passenger needs to recognise the car.
