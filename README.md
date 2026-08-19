# IGMCRI Surgery IPD

Supabase-backed inpatient management application for the Department of General Surgery, IGMCRI Puducherry.

## Workflow
Dashboard → New IPD Admission → Patient Chart → Daily Notes → Investigations → Surgery → Discharge

## Backend
Supabase project: `pnncnljakqrqzocahxhs`

The browser uses the Supabase publishable key. Database access must remain protected by Supabase Auth and Row Level Security.

## Deployment
GitHub Pages deployment is configured through `.github/workflows/pages.yml`.

## Important
This application is a clinical software prototype and should be validated, secured, and tested by the institution before use with real patient data.
