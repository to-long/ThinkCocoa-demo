import { ShieldAlert } from 'lucide-react';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import type { ApiCooperative } from '@/shared/api';

interface Props {
  target: ApiCooperative | null;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export function DeleteCooperativeDialog({ target, onCancel, onConfirm }: Props) {
  const intl = useIntl();
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader className="border-b-0">
          <h3 className="font-semibold text-lg">
            {intl.formatMessage({ id: 'cooperatives.deleteDialog.title' })}
          </h3>
          <p className="text-muted-foreground text-sm">
            {target
              ? intl.formatMessage(
                  { id: 'cooperatives.deleteDialog.description' },
                  { name: target.name },
                )
              : ''}
          </p>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {intl.formatMessage({ id: 'cooperatives.deleteDialog.cancel' })}
          </Button>
          <Button variant="destructive" onClick={() => void onConfirm()}>
            <ShieldAlert className="size-4" />
            {intl.formatMessage({ id: 'cooperatives.deleteDialog.confirm' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
