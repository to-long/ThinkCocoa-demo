import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';

interface DeleteRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleName: string;
  onConfirm: () => void;
}

export function DeleteRoleDialog({
  open,
  onOpenChange,
  roleName,
  onConfirm,
}: DeleteRoleDialogProps) {
  const intl = useIntl();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="border-b-0">
          <h3 className="font-semibold text-lg">
            {intl.formatMessage({ id: 'roles.deleteDialog.title' })}
          </h3>
          <p className="text-muted-foreground text-sm">
            {intl.formatMessage({ id: 'roles.deleteDialog.description' }, { name: roleName })}
          </p>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {intl.formatMessage({ id: 'roles.deleteDialog.cancel' })}
          </Button>
          <Button
            className="border border-destructive bg-destructive text-white hover:bg-destructive/90"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {intl.formatMessage({ id: 'roles.deleteDialog.confirm' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
