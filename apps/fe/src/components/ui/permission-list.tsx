import type { LucideIcon } from 'lucide-react';
import { useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { StatusTag } from '@/components/ui/status-tag';
import { cn } from '@/lib/utils';

export interface PermissionGroup {
  key: string;
  label: string;
  /** Optional leading icon for the group header (caller-supplied so
   *  this UI stays feature-agnostic). */
  icon?: LucideIcon;
  items: PermissionItem[];
}

export interface PermissionItem {
  id: string;
  label: string;
  /** Optional leading icon for the item (caller-supplied — usually the
   *  action verb icon, e.g. Eye for read, Plus for create). */
  icon?: LucideIcon;
}

interface PermissionListProps {
  groups: PermissionGroup[];
  value: Set<string>;
  onChange: (selected: Set<string>) => void;
  selectAllLabel?: string;
  deselectAllLabel?: string;
  className?: string;
}

function PermissionList({
  groups,
  value,
  onChange,
  selectAllLabel = 'Select all',
  deselectAllLabel = 'Deselect all',
  className,
}: PermissionListProps) {
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange(next);
    },
    [value, onChange],
  );

  const toggleGroup = useCallback(
    (ids: string[]) => {
      const allSelected = ids.every((id) => value.has(id));
      const next = new Set(value);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      onChange(next);
    },
    [value, onChange],
  );

  return (
    <div className={cn('flex flex-col', className)}>
      {groups.map((group) => {
        const groupIds = group.items.map((item) => item.id);
        if (groupIds.length === 0) return null;

        const allSelected = groupIds.every((id) => value.has(id));

        return (
          <div key={group.key} className="pb-3">
            <div className="sticky -top-px z-[5] flex items-start justify-between gap-3 bg-background px-4 py-3">
              {/* Resource group rendered as a lime status tag (icon +
                  label) so each group header stands out and is easy to
                  scan. `min-w-0` lets it shrink so a long code truncates
                  inside the tag instead of pushing the right-edge
                  Select-all button off the row. */}
              <StatusTag tone="lime" className="min-w-0">
                {group.icon && <group.icon className="size-3 shrink-0" />}
                <span className="truncate">{group.label}</span>
              </StatusTag>
              <button
                type="button"
                className="shrink-0 text-lime-700 text-xs hover:text-lime-900 hover:underline"
                onClick={() => toggleGroup(groupIds)}
              >
                {allSelected ? deselectAllLabel : selectAllLabel}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pb-3">
              {group.items.map((item) => (
                // `min-w-0` lets the label below shrink inside the
                // grid column. `items-start` so the checkbox stays
                // top-aligned when the label wraps to multiple lines.
                <div key={item.id} className="flex min-w-0 items-start gap-2">
                  <Checkbox
                    id={`perm-${item.id}`}
                    checked={value.has(item.id)}
                    onCheckedChange={() => toggle(item.id)}
                    className="mt-0.5 shrink-0"
                  />
                  <Label
                    htmlFor={`perm-${item.id}`}
                    className="min-w-0 break-all font-normal text-sm text-muted-foreground"
                  >
                    {item.icon && <item.icon className="size-3.5 shrink-0 text-muted-foreground" />}
                    {item.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { PermissionList };
