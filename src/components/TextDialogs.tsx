import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
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
