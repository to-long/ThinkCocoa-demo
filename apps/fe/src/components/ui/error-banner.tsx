import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Small inline banner used above forms / dialogs to surface mutation errors.
 * Kept minimal on purpose — no toast library in the app yet.
 */
export function ErrorBanner({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
