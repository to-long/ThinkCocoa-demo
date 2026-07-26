/**
 * Tiny status pill used both on the CLMRS list Case column and the
 * Farmer list CLMRS column. Renders nothing for `none` so the farmer
 * row stays visually quiet when there's no observation.
 */

import { useIntl } from 'react-intl';
import { StatusTag } from '@/components/ui/status-tag';
import type { ClmrsFarmerStatus } from '../lib/mock';

interface Props {
  status: ClmrsFarmerStatus;
  /** If true, renders "—" for `none` instead of nothing. Useful in
   *  table cells that always need a visible placeholder. */
  showNone?: boolean;
}

export function ClmrsStatusPill({ status, showNone = false }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  // Tone mapping is deliberately inverted vs. the usual "green = good"
  // convention because CLMRS reads as case severity, not health:
  //   • pending → green  (no case opened yet — nothing to remediate)
  //   • open    → red    (active case demanding attention)
  //   • closed  → amber  (case resolved / archived, no longer urgent
  //                        but distinct from a fresh "no case")
  if (status === 'none') {
    return showNone ? <span className="text-muted-foreground">—</span> : null;
  }
  if (status === 'open') {
    return <StatusTag tone="danger">{t('clmrs.status.open')}</StatusTag>;
  }
  if (status === 'closed') {
    return <StatusTag tone="caution">{t('clmrs.status.closed')}</StatusTag>;
  }
  return <StatusTag tone="success">{t('clmrs.status.pending')}</StatusTag>;
}
