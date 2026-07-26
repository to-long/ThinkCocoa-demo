-- Server-side read cursor for the notification bell.
--
-- One row per user holding the highest audit_logs.id they've seen. Was
-- localStorage (`notif:lastSeenAuditId`), which meant the badge came back
-- on every new browser/device. The bell now POSTs its cursor here and the
-- unread count reads it, so "seen" follows the account.

CREATE TABLE IF NOT EXISTS iam.user_notification_reads (
  user_id uuid PRIMARY KEY REFERENCES iam.users (id) ON DELETE CASCADE,
  last_read_audit_id bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
