import type { AdminOrderView } from '@shared/api-types.js';
import { ConfirmDialog } from '../../../components/ConfirmDialog.js';
import { cancelDialogText } from './order-display.js';

export interface CancelOrderDialogProps {
  order: AdminOrderView;
  isToday: boolean;
  open: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CancelOrderDialog({
  order,
  isToday,
  open,
  loading = false,
  onConfirm,
  onCancel,
}: CancelOrderDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title="Cancel order?"
      confirmLabel="Cancel order"
      cancelLabel="Keep order"
      tone="danger"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>{cancelDialogText(order, isToday)}</p>
    </ConfirmDialog>
  );
}
