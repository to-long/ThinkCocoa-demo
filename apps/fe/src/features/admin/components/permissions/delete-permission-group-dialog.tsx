import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';

/**
 * Confirmation dialog for deleting an entire permission group.
 *
 * A "group delete" fans out to N individual permission deletes under the
 * hood (the BE exposes no bulk delete today), so the confirmation mentions
 * the resource name AND the action count to prevent surprise.
 */
interface DeletePermissionGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: string;
  actionCount: number;
  onConfirm: () => Promise<void>;
}

export function DeletePermissionGroupDialog({
  open,
  onOpenChange,
  resource,
  actionCount,
  onConfirm,
}: DeletePermissionGroupDialogProps) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // error already surfaced by parent; keep dialog open for retry
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!loading) onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader className="border-b-0">
          <h3 className="font-semibold text-lg">
            {intl.formatMessage({ id: 'permissions.deleteGroupDialog.title' })}
          </h3>
          <p className="text-muted-foreground text-sm">
            {intl.formatMessage(
              { id: 'permissions.deleteGroupDialog.description' },
              { resource, count: actionCount },
            )}
          </p>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {intl.formatMessage({ id: 'permissions.deleteGroupDialog.cancel' })}
          </Button>
          <Button
            className="border border-destructive bg-destructive text-white hover:bg-destructive/90"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {intl.formatMessage({ id: 'permissions.deleteGroupDialog.confirm' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
