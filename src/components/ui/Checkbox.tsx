import { Check } from 'lucide-react';

export function Checkbox({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label className="ui-checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-checkbox-mark" aria-hidden="true">
        <Check size={12} strokeWidth={2.5} />
      </span>
      <span>{label}</span>
    </label>
  );
}
