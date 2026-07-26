import { XIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** Plain string tag (no server id yet) or `{ uuid, value }` from the backend. */
export type TagItem = string | { uuid: string; value: string };

export function tagValue(item: TagItem): string {
  return typeof item === 'string' ? item : item.value;
}

export function tagKey(item: TagItem, index: number): string {
  if (typeof item === 'object') return item.uuid;
  return `i${index}:${item}`;
}

export type TagsInputProps = Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> & {
  value: TagItem[];
  onValueChange: (next: TagItem[]) => void;
  onDraftCommit?: (labels: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  maxTags?: number;
  validateTag?: (tag: string) => boolean;
};

function TagsInput({
  value,
  onValueChange,
  onDraftCommit,
  placeholder,
  disabled,
  readOnly,
  maxTags,
  validateTag,
  className,
  id,
  ...props
}: TagsInputProps) {
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const removeAt = (index: number) => {
    onValueChange(value.filter((_, i) => i !== index));
  };

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (value.some((e) => tagValue(e) === trimmed)) {
      setDraft('');
      return;
    }
    if (validateTag && !validateTag(trimmed)) return;
    if (maxTags && value.length >= maxTags) return;
    if (onDraftCommit) {
      onDraftCommit([trimmed]);
    } else {
      onValueChange([...value, trimmed]);
    }
    setDraft('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      e.preventDefault();
      onValueChange(value.slice(0, -1));
    }
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      data-slot="tags-input"
      id={id}
      role="group"
      className={cn(
        'flex w-full flex-wrap items-center gap-1.5 bg-transparent',
        readOnly
          ? 'px-0 py-0'
          : 'min-h-12 rounded-md border border-input px-2 py-1.5 focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-gray-200',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onPointerDown={(e) => {
        if (disabled || readOnly) return;
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        if (target.closest('input')) return;
        focusInput();
      }}
      {...props}
    >
      {value.map((entry, index) => (
        <span
          key={tagKey(entry, index)}
          data-tag-chip=""
          className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
        >
          <span>{tagValue(entry)}</span>
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove ${tagValue(entry)}`}
              onClick={() => removeAt(index)}
              disabled={disabled}
              className="rounded hover:bg-muted"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          ref={inputRef}
          data-slot="tags-input-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commitDraft}
          placeholder={value.length === 0 ? placeholder : undefined}
          disabled={disabled}
          className="min-w-[6rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground placeholder:opacity-100"
        />
      )}
    </div>
  );
}

export { TagsInput };
