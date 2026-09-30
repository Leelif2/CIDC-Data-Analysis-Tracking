-- =====================================================================
-- CIDC Dashboard — shared database schema (Supabase / PostgreSQL)
--
-- How to use: Supabase dashboard > SQL Editor > paste this whole file > Run.
-- Safe to run once on an empty project.
--
-- Layout (카테고리별 구성)
--   0. Access        staff                      누가 로그인해서 볼 수/고칠 수 있는지
--   1. Shared        students, counselors,      모든 시트가 함께 쓰는 기준 데이터
--                    consultation_categories
--   2. Consultation  consultation_sessions      상담 기록 (Consultation Records 페이지)
--   3. Placement     placements                 취업 기록 (Placement 시트)
--   4. OPT           opt_records                OPT 기록 (OPT 시트)
--   5. Events        events                     행사 기록 (Event & Budget 시트)
--   6. Views         *_view                     화면에서 바로 쓰는 읽기용 묶음
--
-- Duplicate protection (중복 방지)
--   * A student exists once: uMail is the primary key (lowercase, u1234567@umail.utah.edu).
--   * Every record points at a student by uMail, so the same name can't split or merge people.
--   * Each table has a UNIQUE rule on what makes a record "the same"
--     (e.g. same student + same date + same category + same topic = one consultation).
--     Uploading the same Excel twice updates rows instead of creating copies.
--
-- Security
--   * Row Level Security is ON for every table. Nothing is readable without logging in.
--   * Only emails listed in `staff` can read; role 'admin' / 'counselor' can write.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. ACCESS
-- ---------------------------------------------------------------------
create table staff (
    email       text primary key check (email = lower(btrim(email)) and email like '%@%'),
    full_name   text not null,
    role        text not null default 'counselor' check (role in ('admin', 'counselor', 'viewer')),
    created_at  timestamptz not null default now()
);
comment on table staff is 'People allowed to use the dashboard. admin/counselor can edit, viewer can only read.';

-- 로그인한 사람의 staff 역할 ('admin' / 'counselor' / 'viewer' / null)
create function current_staff_role() returns text
language sql stable security definer set search_path = public as $$
    select role from staff where email = lower(auth.jwt() ->> 'email')
$$;

create function is_staff() returns boolean
language sql stable as $$ select current_staff_role() is not null $$;

create function can_edit() returns boolean
language sql stable as $$ select current_staff_role() in ('admin', 'counselor') $$;

-- updated_at 자동 갱신
create function touch_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;


-- ---------------------------------------------------------------------
-- 1. SHARED — students, counselors, consultation categories
-- ---------------------------------------------------------------------
create table students (
    umail       text primary key
                check (umail = lower(btrim(umail)) and umail ~ '^u[0-9]{7}@umail\.utah\.edu$'),
    full_name   text not null check (btrim(full_name) <> ''),
    major       text,
    cohort      text,                                  -- e.g. 'Spring 2026'
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
comment on table students is 'One row per student. uMail is the ID, so two students with the same name stay separate.';

create table counselors (
    id          bigint generated always as identity primary key,
    full_name   text not null check (btrim(full_name) <> ''),
    email       text unique check (email is null or email = lower(btrim(email))),
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);
-- 같은 상담사를 'Jane Park' / 'jane park ' 처럼 두 번 만들지 않도록
create unique index counselors_name_unique on counselors (lower(btrim(full_name)));

create table consultation_categories (
    id          text primary key,
    label       text not null unique,
    sort_order  int  not null
);
insert into consultation_categories (id, label, sort_order) values
    ('visa',      'OPT / Visa',              1),
    ('interview', 'Interview Prep',          2),
    ('resume',    'Resume & Cover Letter',   3),
    ('job',       'Job Search & Networking', 4),
    ('career',    'Career Planning',         5),
    ('other',     'Other',                   6);


-- ---------------------------------------------------------------------
-- 2. CONSULTATION — one row per counseling session
-- ---------------------------------------------------------------------
create table consultation_sessions (
    id              uuid primary key default gen_random_uuid(),
    student_umail   text not null references students (umail) on update cascade on delete restrict,
    counselor_id    bigint references counselors (id) on delete set null,
    category_id     text not null default 'other' references consultation_categories (id),
    session_date    date not null,
    topic           text not null default '',
    rating          smallint check (rating between 1 and 5),
    notes           text,
    extra           jsonb not null default '{}'::jsonb,   -- extra Excel columns (e.g. "Next Step")
    topic_key       text generated always as (lower(btrim(topic))) stored,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    created_by      text default lower(auth.jwt() ->> 'email'),
    updated_by      text default lower(auth.jwt() ->> 'email'),
    -- 같은 학생 · 같은 날 · 같은 카테고리 · 같은 주제 = 같은 상담 (대소문자/앞뒤 공백 무시)
    constraint consultation_sessions_no_duplicates unique (student_umail, session_date, category_id, topic_key)
);
create index consultation_sessions_student_idx on consultation_sessions (student_umail, session_date desc);
create index consultation_sessions_category_idx on consultation_sessions (category_id, session_date desc);


-- ---------------------------------------------------------------------
-- 3. PLACEMENT — employment / internship outcomes
-- ---------------------------------------------------------------------
create table placements (
    id              uuid primary key default gen_random_uuid(),
    student_umail   text not null references students (umail) on update cascade on delete restrict,
    company         text not null check (btrim(company) <> ''),
    role            text not null default '',
    placement_type  text not null default 'Full-time' check (placement_type in ('Full-time', 'Internship', 'Part-time', 'Other')),
    status          text not null default 'Employed',
    start_date      date,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- 같은 학생 · 같은 회사 · 같은 직무 · 같은 유형 = 같은 취업 기록
    constraint placements_no_duplicates unique (student_umail, company, role, placement_type)
);


-- ---------------------------------------------------------------------
-- 4. OPT — work authorization records
-- ---------------------------------------------------------------------
create table opt_records (
    id              uuid primary key default gen_random_uuid(),
    student_umail   text not null references students (umail) on update cascade on delete restrict,
    opt_type        text not null check (opt_type in ('Pre-completion OPT', 'Post-completion OPT', 'STEM OPT Extension', 'CPT')),
    status          text not null default 'Pending' check (status in ('Pending', 'Approved', 'Denied', 'Expired')),
    start_date      date,
    end_date        date check (end_date is null or start_date is null or end_date >= start_date),
    employer        text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- 같은 학생의 같은 종류 OPT는 시작일마다 하나
    constraint opt_records_no_duplicates unique nulls not distinct (student_umail, opt_type, start_date)
);


-- ---------------------------------------------------------------------
-- 5. EVENTS — career events & budget
-- ---------------------------------------------------------------------
create table events (
    id              uuid primary key default gen_random_uuid(),
    title           text not null check (btrim(title) <> ''),
    event_type      text not null default 'Other'
                    check (event_type in ('Boot Camp', 'Career Talk', 'Info Session', 'Volunteer', 'Workshop', 'Career Fair', 'Other')),
    event_date      date not null,
    attendance      int check (attendance >= 0),
    budget_usd      numeric(12, 2) check (budget_usd >= 0),
    photo_url       text,
    description     text,
    title_key       text generated always as (lower(btrim(title))) stored,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- 같은 날 같은 이름의 행사는 하나
    constraint events_no_duplicates unique (title_key, event_date)
);


-- updated_at 트리거
create trigger students_touch              before update on students              for each row execute function touch_updated_at();
create trigger consultation_sessions_touch before update on consultation_sessions for each row execute function touch_updated_at();
create trigger placements_touch            before update on placements            for each row execute function touch_updated_at();
create trigger opt_records_touch           before update on opt_records           for each row execute function touch_updated_at();
create trigger events_touch                before update on events                for each row execute function touch_updated_at();

-- 상담을 수정한 사람 기록
create function stamp_consultation_editor() returns trigger
language plpgsql as $$
begin
    new.updated_by := coalesce(lower(auth.jwt() ->> 'email'), new.updated_by);
    return new;
end $$;
create trigger consultation_sessions_editor before update on consultation_sessions for each row execute function stamp_consultation_editor();


-- ---------------------------------------------------------------------
-- 6. VIEWS — what the Consultation Records page reads
-- ---------------------------------------------------------------------
create view consultation_sessions_view with (security_invoker = true) as
select  s.id,
        s.session_date,
        st.umail            as student_umail,
        st.full_name        as student_name,
        c.full_name         as counselor_name,
        cat.id              as category_id,
        cat.label           as category_label,
        s.topic,
        s.rating,
        s.notes,
        s.extra,
        s.updated_at,
        s.updated_by
from        consultation_sessions   s
join        students                st  on st.umail = s.student_umail
left join   counselors              c   on c.id = s.counselor_id
join        consultation_categories cat on cat.id = s.category_id;

create view student_consultation_summary with (security_invoker = true) as
select  st.umail,
        st.full_name,
        count(s.id)                         as session_count,
        min(s.session_date)                 as first_session,
        max(s.session_date)                 as latest_session,
        round(avg(s.rating)::numeric, 1)    as avg_rating
from        students st
join        consultation_sessions s on s.student_umail = st.umail
group by    st.umail, st.full_name;


-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY — staff only
-- ---------------------------------------------------------------------
alter table staff                   enable row level security;
alter table students                enable row level security;
alter table counselors              enable row level security;
alter table consultation_categories enable row level security;
alter table consultation_sessions   enable row level security;
alter table placements              enable row level security;
alter table opt_records             enable row level security;
alter table events                  enable row level security;

-- staff: 본인 행은 볼 수 있고, 관리(추가/삭제)는 admin만
create policy staff_read   on staff for select to authenticated using (email = lower(auth.jwt() ->> 'email') or current_staff_role() = 'admin');
create policy staff_manage on staff for all    to authenticated using (current_staff_role() = 'admin') with check (current_staff_role() = 'admin');

-- 카테고리는 staff 누구나 읽기, admin만 수정
create policy categories_read   on consultation_categories for select to authenticated using (is_staff());
create policy categories_manage on consultation_categories for all    to authenticated using (current_staff_role() = 'admin') with check (current_staff_role() = 'admin');

-- 나머지 데이터 테이블: staff 읽기, admin/counselor 쓰기
do $$
declare t text;
begin
    foreach t in array array['students', 'counselors', 'consultation_sessions', 'placements', 'opt_records', 'events'] loop
        execute format('create policy %I on %I for select to authenticated using (is_staff())', t || '_read', t);
        execute format('create policy %I on %I for insert to authenticated with check (can_edit())', t || '_insert', t);
        execute format('create policy %I on %I for update to authenticated using (can_edit()) with check (can_edit())', t || '_update', t);
        execute format('create policy %I on %I for delete to authenticated using (can_edit())', t || '_delete', t);
    end loop;
end $$;


-- ---------------------------------------------------------------------
-- FIRST ADMIN — replace with your own email, then run this line
-- ---------------------------------------------------------------------
-- insert into staff (email, full_name, role) values ('your.name@utah.edu', 'Your Name', 'admin');
