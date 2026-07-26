/**
 * Inspection validators — corrective-action workflow.
 *
 * A corrective action's `status` moves open → processing → done, with a
 * reopen path (done → reopen → processing). The PATCH body lets staff
 * change the status and/or reschedule the deadline (`actionDate`).
 */

import { z } from 'zod';
import { boundedDate } from './common';

export const CORRECTIVE_ACTION_STATUSES = ['open', 'reopen', 'processing', 'done'] as const;

export const correctiveActionStatusSchema = z.enum(CORRECTIVE_ACTION_STATUSES);
export type CorrectiveActionStatus = z.infer<typeof correctiveActionStatusSchema>;

/** PATCH body — at least one of `status` / `actionDate` must be present.
 *  `actionDate` is a deadline so future dates are allowed. */
export const updateCorrectiveActionSchema = z
  .object({
    status: correctiveActionStatusSchema.optional(),
    actionDate: boundedDate({ max: '2100-12-31' }).nullable().optional(),
    // Closing note recorded when marking an action done.
    lastComment: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.actionDate !== undefined || v.lastComment !== undefined,
    { message: 'At least one of status, actionDate or lastComment is required' },
  );
export type UpdateCorrectiveActionInput = z.infer<typeof updateCorrectiveActionSchema>;
