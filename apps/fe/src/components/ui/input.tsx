import { X } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

interface InputProps extends React.ComponentProps<'input'> {
  /**
   * When provided, an inline X button is rendered on the right edge while
   * the input has a value. Clicking it invokes onClear (and the caller is
   * responsible for resetting `value`). Designed for filter/search inputs.
   */
  onClear?: () => void;
}

function Input({ className, type, onClear, value, ...props }: InputProps) {
  const input = (
    <input
      type={type}
      data-slot="input"
      value={value}
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground placeholder:opacity-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        onClear && 'pr-9',
        className,
      )}
      {...props}
    />
  );
  if (!onClear) return input;
  const hasValue = value != null && value !== '';
  return (
    <div className="relative w-full">
      {input}
      {hasValue && (
        <button
          type="button"
          aria-label="Clear"
          onClick={onClear}
          className="-translate-y-1/2 absolute top-1/2 right-2 inline-flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export { Input };
