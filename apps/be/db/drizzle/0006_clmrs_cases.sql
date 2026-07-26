-- CLMRS case register. A "flag" (at-risk / case observation) lives on a
-- coaching visit; when staff open a remediation case, a row is written
-- here keyed by child_id (= originating coaching visit id). Status is
-- mutable and survives coaching re-syncs.

CREATE SCHEMA IF NOT EXISTS clmrs;

CREATE TABLE IF NOT EXISTS clmrs.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id text NOT NULL UNIQUE,
  clmrs_code text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  last_visit_date date,
  follow_up_date date,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clmrs_cases_status_check CHECK (status IN ('open', 'processing', 'closed'))
);
