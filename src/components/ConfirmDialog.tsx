import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { failureNotice } from '@/lib/notices';
import { useAppStore } from '@/store/appStore';
import { Button } from './ui/Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '删除',
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const close = () => {
    if (!pending) onClose();
  };

  useEffect(() => {
    if (!open) {
      setPending(false);
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      size="small"
      footer={
        <>
          <Button variant="ghost" data-autofocus disabled={pending} onClick={close}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
                onClose();
              } catch (reason) {
                useAppStore.getState().notify(failureNotice(`${confirmLabel}失败`, reason));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? '处理中' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="ui-confirm-copy">{description}</p>
    </Dialog>
  );
}
