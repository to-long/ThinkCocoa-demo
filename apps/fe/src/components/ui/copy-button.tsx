/**
 * Inline copy-to-clipboard button.
 *
 * Used wherever a long technical value is displayed and the admin
 * needs the canonical full string (entity ids, session ids, user
 * agents, ...). Click stops propagation so it can sit inside a
 * clickable row without triggering the row's navigate handler.
 *
 * Briefly swaps `Copy` → `Check` (green) on success so the user gets
 * implicit confirmation without a toast — reverts after 1.2s.
 */

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  value: string;
  /** Override the default size-5 / size-3 icon. Used in cells where
   *  the surrounding text is bigger. */
  className?: string;
  /** Aria-label override; defaults to "Copy". */
  label?: string;
}

export function CopyButton({ value, className, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard API can throw inside iframes or insecure
          // contexts. Silent failure keeps row click handlers intact.
        }
      }}
      className={cn(
        'inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer',
        className,
      )}
    >
      {copied ? <Check className="size-3 text-green-600" /> : <Copy className="size-3" />}
    </button>
  );
}
