import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { FloatingNotice } from './Toasts';
import { Button } from './ui/Button';
import { Field, TextInput } from './ui/Field';

interface NameDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

export function NameDialog({
  open,
  title,
  description,
  label,
  initialValue = '',
  placeholder,
  submitLabel = '保存',
  onClose,
  onSubmit,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const submit = () => {
    const clean = value.trim();
    if (!clean) return;
    onSubmit(clean);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="small"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <Field label={label} htmlFor="name-dialog-field">
        <TextInput
          id="name-dialog-field"
          ref={inputRef}
          data-autofocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </Field>
    </Dialog>
  );
}

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
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (!pending) onClose();
  };

  useEffect(() => {
    if (!open) {
      setPending(false);
      setError(null);
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
          <Button variant="ghost" disabled={pending} onClick={close}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : '操作失败，请重试');
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
      <FloatingNotice message={open ? error : null} />
      <p className="ui-confirm-copy">{description}</p>
    </Dialog>
  );
}
