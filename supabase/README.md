# Shared database (Supabase)

`schema.sql` creates the shared database the dashboard will read and write, so every
counselor sees the same records.

| Area | Tables | Duplicate rule |
|---|---|---|
| Access | `staff` | one row per email |
| Shared | `students`, `counselors`, `consultation_categories` | student = uMail (primary key); counselor name unique |
| Consultation | `consultation_sessions` | same student + date + category + topic |
| Placement | `placements` | same student + company + role + type |
| OPT | `opt_records` | same student + OPT type + start date |
| Events | `events` | same title + date |

Only people listed in `staff` can see anything (Row Level Security).
`admin` and `counselor` can edit; `viewer` can only read.

## Setup
1. Create a Supabase project (or add Supabase from the Vercel Marketplace on the
   `cidc-data-analysis-tracking` project).
2. Supabase → SQL Editor → paste `schema.sql` → Run.
3. Run the last line of `schema.sql` with your own email to make yourself `admin`.
4. Supabase → Authentication → enable Email sign-in.
5. Share the Project URL and the `anon` public key so the site can be connected.
   Never share the `service_role` key.

This folder is excluded from the deployed site by `.vercelignore`.
