# Surgery Unit OS

Integrated unit management system for the Department of General Surgery, Unit VI,
Indira Gandhi Medical College & Research Institute (IGMCRI), Puducherry.

Architecture and plan: see the *Surgery Unit OS: Phase 1 audit and architecture* document.

## What is built (Phases 2–3)

| Area | Status |
|---|---|
| Database: units, roles, permissions, audit log, row-level security | Done |
| Patient registry: register, search, duplicate warnings, edit, history | Done |
| IPD: admit, bed allocation, transfer, discharge, diagnoses, investigations, medications | Done |
| Today's inpatient census (all 11 measures, live, printable A4) | Done |
| Ward board (bed grid, round status, POD, critical flags) | Done |
| Ward-round **database** (append-only entries, amendments, verification, carry-forward tasks, POD) | Done, tested |
| Ward-round entry **screens** and daily reports | Phase 4 |
| Preoperative, Major/Minor OT, Endoscopy, OPD, analytics, MCP | Phases 5–9 |

## Layout

```
apps/web/              Next.js web app (static export, works on phone and desktop)
supabase/migrations/   Database schema — every change is a numbered SQL file
supabase/tests/        Behaviour tests: permissions, append-only rounds, beds, census
.github/workflows/     CI (tests + build on every pull request), deploy to GitHub Pages
```

## Rules the database enforces (not just the screens)

- Nothing is readable without signing in **and** holding a role in the unit.
- UHID is unique per institution; an IP number belongs to one admission; one active admission per patient.
- A bed can hold only one patient; beds must belong to the admitting unit.
- Ward-round entries cannot be edited or deleted. Corrections are amendments with a reason.
- Only faculty (`round.verify`) can verify rounds or surgery dates; POD counts only from verified dates.
- A final discharge summary is locked.
- Every insert, update and delete is written to `audit_logs` with the user and channel.
- A unit always keeps at least one administrator.

## Running the tests

```bash
# needs a local PostgreSQL 16 on port 54329 (or set PGHOST / PGPORT)
./supabase/tests/run-local.sh
```

## Working on the web app

```bash
cd apps/web
npm ci
npm run dev        # http://localhost:3000
npm run build      # static site in apps/web/out
```

Only the publishable Supabase key is used in the browser. Never add a service-role key to this repository.

## Releasing

1. Change code on a branch and open a pull request. CI must pass.
2. Database changes: add a new file in `supabase/migrations/`, apply it to Supabase after review.
3. Merge to `main`. The web app redeploys to GitHub Pages automatically.

Development and testing use synthetic patients only, until the institution authorises real data.
