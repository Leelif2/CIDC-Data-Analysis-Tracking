-- =====================================================================
-- CIDC Dashboard — shared auto-save storage (used by /api/state)
--
-- How to use: Supabase dashboard > SQL Editor > paste this file > Run. Safe to run more than once.
--
-- One row per data section (consultationData, placementData, optData, eventData, consultationSource).
-- version goes up by 1 on every save. A save from a screen that still shows an older version is
-- rejected, so a tab left open for hours can't overwrite a newer upload by someone else.
-- Only the server (Vercel function with the service-role key) reads/writes this table:
-- Row Level Security is ON with no policies, so the public anon key can't see anything.
-- =====================================================================

create table if not exists app_state (
    key         text primary key,
    data        jsonb,
    version     bigint not null default 1,
    updated_at  timestamptz not null default now(),
    updated_by  text
);

-- 이전 버전의 테이블(version 열 없음)을 이미 만든 경우
alter table app_state add column if not exists version bigint not null default 1;

alter table app_state enable row level security;

-- 새 프로젝트에서 테이블 권한이 자동으로 주어지지 않는 경우 대비 (이미 있으면 그대로)
grant select, insert, update, delete on table app_state to service_role;

comment on table app_state is 'Dashboard data shared by all staff; written by /api/state (auto-save).';
