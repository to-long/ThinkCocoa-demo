-- Rainforest Alliance certificate details on the farmer record.
--
-- The app already carried `certification_status` — a single word, enough to
-- colour a chip and nothing else. A buyer's actual questions are "which
-- certificate?", "audited when?" and "what renews in the next quarter?",
-- and none of those could be answered. These four columns are what an RA
-- certificate carries on its face.
--
-- On the farmer, not the parcel: RA certifies the producer (through the
-- group), and one certificate covers every plot that producer farms.

ALTER TABLE farmer.farmers
  ADD COLUMN IF NOT EXISTS ra_certificate_number text,
  ADD COLUMN IF NOT EXISTS ra_audit_date date,
  ADD COLUMN IF NOT EXISTS ra_expiry_date date,
  ADD COLUMN IF NOT EXISTS ra_certifying_body text;

-- "Expiring soon" and "expired" are the two queries this exists for, and
-- both are a range scan on the expiry date. Partial: a farmer with no
-- certificate is never in the answer.
CREATE INDEX IF NOT EXISTS farmers_ra_expiry_idx
  ON farmer.farmers (ra_expiry_date)
  WHERE ra_expiry_date IS NOT NULL AND deleted_at IS NULL;
