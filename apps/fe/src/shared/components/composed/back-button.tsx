/**
 * Tiny back-arrow button used on detail pages.
 *
 * Default behaviour: navigate to `fallbackTo` (the feature's list
 * page). Detail pages ALWAYS go to their own list rather than popping
 * history — this prevents ping-pong loops when the user jumps between
 * a detail page and the History (audit) view: history-back would land
 * on the previous audit list, back again on the detail, etc.
 *
 * Notification / audit detail is the one exception: it opts into
 * true history-back via `alwaysHistory`, because that page is only
 * reachable in-app (from the audit list or an entity's History
 * button) and users expect to return to whichever surface they came
 * from.
 *
 * `preferHistory` is the middle ground: pop real history when there IS
 * a prior in-app entry (so farmer-detail → parcel-detail → Back lands
 * back on the farmer), but jump to `fallbackTo` on a cold/direct load
 * where there's nothing to pop. `navigate(-1)` only ever shrinks the
 * stack, so it can't create the detail↔History ping-pong that plain
 * `fallbackTo` pages avoid — that's why the farmer/audit surfaces which
 * cross-link keep their static `fallbackTo`, and only leaf pages like
 * the parcel detail opt into `preferHistory`.
 *
 * If neither prop is provided we fall back to `navigate(-1)` (legacy
 * behaviour for surfaces that predate the fallbackTo prop).
 *
 * Sized to sit inline next to an `h1` page title.
 */

import { ArrowLeft } from 'lucide-react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';

interface Props {
  /** Where the button lands. Default detail-page behaviour ignores
   *  browser history and jumps straight to this path. */
  fallbackTo?: string;
  /** Force `navigate(-1)` (history pop) instead of `fallbackTo`. Set
   *  on pages that are only reachable in-app AND want the user to
   *  return to whichever surface they came from. */
  alwaysHistory?: boolean;
  /** Pop real history when there IS a prior in-app entry to pop,
   *  otherwise jump to `fallbackTo`. Use on leaf detail pages that
   *  should return to whatever pushed them (e.g. parcel → farmer),
   *  without the ping-pong risk of a static cross-`fallbackTo`. */
  preferHistory?: boolean;
  className?: string;
}

export function BackButton({ fallbackTo, alwaysHistory, preferHistory, className }: Props) {
  const intl = useIntl();
  const navigate = useNavigate();

  const onClick = () => {
    if (alwaysHistory) {
      navigate(-1);
      return;
    }
    if (preferHistory) {
      // React Router stamps an incrementing `idx` on history.state.
      // idx > 0 ⇒ there's an in-app entry behind us that a pop returns
      // to (the farmer we came from). idx 0 / undefined ⇒ cold load or
      // external referrer → jump to the list instead of leaving the app.
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) {
        navigate(-1);
        return;
      }
      if (fallbackTo) {
        navigate(fallbackTo);
        return;
      }
      navigate(-1);
      return;
    }
    if (fallbackTo) {
      navigate(fallbackTo);
      return;
    }
    navigate(-1);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={intl.formatMessage({ id: 'common.back', defaultMessage: 'Back' })}
      className={`-ml-1 flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${className ?? ''}`}
    >
      <ArrowLeft className="size-4" />
    </button>
  );
}
