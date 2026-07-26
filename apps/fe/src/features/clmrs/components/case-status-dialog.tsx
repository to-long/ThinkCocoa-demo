/**
 * Confirm dialog for the case status toggle on the CLMRS record detail.
 *
 * Two modes:
 *   • reopen — case is being (re)opened. Staff must pick a follow-up
 *     date so the case surfaces for a recheck later; the confirm button
 *     stays disabled until a date is chosen.
 *   • close  — case is being resolved. Plain confirmation, no date.
 *
 * Mock-only feature (no server contract yet), so form state is local
 * `useState` rather than react-hook-form — mirrors CaseCreateDialog.
 */

import { CalendarClock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ClmrsFlag } from '../lib/mock';
import { CaseFlagSummary } from './case-flag-summary';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'reopen' | 'close';
  /** Flag the case belongs to — rendered as read-only context. */
  flag: ClmrsFlag;
  /** Called with the chosen follow-up date (ISO yyyy-mm-dd) on reopen,
   *  or null on close. */
  onConfirm: (followUpDate: string | null) => void;
}

/** Today as yyyy-mm-dd — used as the `min` so rechecks can't be scheduled
 *  in the past. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CaseStatusDialog({ open, onOpenChange, mode, flag, onConfirm }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const [followUp, setFollowUp] = useState('');

  // Reset the picked date every time the dialog (re)opens so a stale
  // value from a previous toggle never leaks in.
  useEffect(() => {
    if (open) setFollowUp('');
  }, [open]);

  const isReopen = mode === 'reopen';
  const canConfirm = !isReopen || followUp !== '';

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canConfirm) return;
    onConfirm(isReopen ? followUp : null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <h2 className="font-semibold text-foreground text-lg">
            {intl.formatMessage(
              { id: isReopen ? 'clmrs.dialog.reopenTitle' : 'clmrs.dialog.closeTitle' },
              { child: flag.childNameDisplay },
            )}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t(isReopen ? 'clmrs.dialog.reopenBody' : 'clmrs.dialog.closeBody')}
          </p>
        </DialogHeader>

        {/* min-h-0 lets the DialogBody shrink + scroll inside the capped
            dialog height so the footer buttons stay reachable. */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="flex flex-col gap-4">
            <CaseFlagSummary flag={flag} />

            {isReopen && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="clmrs-follow-up"
                  className="flex items-center gap-1.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide"
                >
                  <CalendarClock className="size-3.5" />
                  {t('clmrs.dialog.followUpLabel')}
                </label>
                <Input
                  id="clmrs-follow-up"
                  type="date"
                  min={todayIso()}
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  required
                />
                <span className="text-[11px] text-muted-foreground">
                  {t('clmrs.dialog.followUpHelp')}
                </span>
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('clmrs.dialog.cancel')}
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              {t(isReopen ? 'clmrs.action.reopenCase' : 'clmrs.action.closeCase')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
