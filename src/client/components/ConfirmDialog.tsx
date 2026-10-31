import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto max-w-sm rounded-card border border-neutral-200 bg-white p-6 shadow-xl backdrop:bg-black/40 open:flex open:flex-col open:gap-4"
    >
      <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
      {children && <div className="text-sm text-neutral-600">{children}</div>}
      <div className="mt-2 flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
