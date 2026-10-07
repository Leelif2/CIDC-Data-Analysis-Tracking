-- =====================================================================
-- CIDC Dashboard — shared auto-save storage (used by /api/state)
--
-- How to use: Supabase dashboard > SQL Editor > paste this file > Run. Safe to run more than once.
--
-- One row per data section (consultationData, placementData, optData, eventData, consultationSource).
-- Only the server (Vercel function with the service-role key) reads/writes this table:
-- Row Level Security is ON with no policies, so the public anon key can't see anything.
-- =====================================================================

create table if not exists app_state (
    key         text primary key,
    data        jsonb,
    updated_at  timestamptz not null default now(),
    updated_by  text
);

alter table app_state enable row level security;

comment on table app_state is 'Dashboard data shared by all staff; written by /api/state (auto-save).';
