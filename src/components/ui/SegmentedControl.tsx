import type { ReactNode } from 'react';

interface SegmentedControlProps<T extends string> {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  fullWidth?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  fullWidth = false,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`ui-segmented ${fullWidth ? 'is-full' : ''} ${className}`.trim()}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) ||
          !options.length
        )
          return;
        event.preventDefault();
        const current = Math.max(
          0,
          options.findIndex((option) => option.value === value),
        );
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : (current +
                  (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) +
                  options.length) %
                options.length;
        onChange(options[next].value);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
      }}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={
            value === option.value || (!options.some((item) => item.value === value) && index === 0)
              ? 0
              : -1
          }
          className={`ui-segment ${value === option.value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
