import { InlineNotice } from './Feedback';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, className = '', children }: FieldProps) {
  return (
    <div className={`ui-field ${className}`.trim()}>
      <label className="ui-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="ui-field-hint">{hint}</p>}
      <InlineNotice field message={error} />
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className = '', invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`ui-input ${invalid ? 'is-invalid' : ''} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});
