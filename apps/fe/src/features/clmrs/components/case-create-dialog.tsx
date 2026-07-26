/**
 * Case-creation dialog opened from a pending flag row.
 *
 * The CLMRS code is auto-minted as `CLMRS-YYYY-NNN` (see nextClmrsCode
 * in ../lib/mock). Staff confirm the child + household context, pick a
 * follow-up (recheck) date, and hit submit — no manual code entry.
 *
 * On success: mutates the mock (real API in v2), closes, then
 * navigates to `/clmrs/:childId` so the user immediately sees
 * the case they just created.
 */

import { CalendarClock, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createClmrsCase } from '@/shared/api/clmrs';
import type { ClmrsFlag } from '../lib/mock';
import { CaseFlagSummary } from './case-flag-summary';

interface Props {
  flag: ClmrsFlag | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful creation so callers can revalidate lists. */
  onCreated?: (caseId: string) => void;
}

export function CaseCreateDialog({ flag, open, onOpenChange, onCreated }: Props) {
  const intl = useIntl();
  const navigate = useNavigate();
  const t = (k: string) => intl.formatMessage({ id: k });
  const [followUp, setFollowUp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!flag || submitting) return;
    // Follow-up date is optional — a case can be opened now and its
    // recheck date set later from the case status flow.
    setSubmitting(true);
    setError(null);
    try {
      const newCase = await createClmrsCase(flag.childId, followUp || null);
      // Revalidate every CLMRS record key (list + this detail) so the
      // freshly-opened case shows up without a manual reload.
      await mutate((key) => Array.isArray(key) && key[0] === '/api/clmrs-records');
      onCreated?.(newCase.id);
      onOpenChange(false);
      navigate(`/clmrs/${flag.childId}`);
    } catch {
      setError(t('clmrs.dialog.createError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!flag) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <h2 className="font-semibold text-foreground text-lg">
            {intl.formatMessage(
              { id: 'clmrs.dialog.createTitle' },
              { child: flag.childNameDisplay },
            )}
          </h2>
        </DialogHeader>

        {/* min-h-0 lets the DialogBody actually shrink + scroll inside the
            capped-height dialog; the footer stays reachable. */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="flex flex-col gap-4">
            <CaseFlagSummary flag={flag} />

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="clmrs-create-follow-up"
                className="flex items-center gap-1.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide"
              >
                <CalendarClock className="size-3.5" />
                {t('clmrs.dialog.followUpLabel')}
              </label>
              <Input
                id="clmrs-create-follow-up"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">
                {t('clmrs.dialog.followUpHelp')}
              </span>
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('clmrs.dialog.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t('clmrs.dialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
