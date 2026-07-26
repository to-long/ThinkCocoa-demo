import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';

interface DeleteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
  onConfirm: () => Promise<void>;
}

export function DeleteUserDialog({
  open,
  onOpenChange,
  userEmail,
  onConfirm,
}: DeleteUserDialogProps) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // error already shown as toast; keep dialog open so user can retry or cancel
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
            {intl.formatMessage({ id: 'users.deleteDialog.title' })}
          </h3>
          <p className="text-muted-foreground text-sm">
            {intl.formatMessage({ id: 'users.deleteDialog.description' }, { email: userEmail })}
          </p>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {intl.formatMessage({ id: 'users.deleteDialog.cancel' })}
          </Button>
          <Button
            className="border border-destructive bg-destructive text-white hover:bg-destructive/90"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {intl.formatMessage({ id: 'users.deleteDialog.confirm' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
