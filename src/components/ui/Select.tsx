import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { usePresence } from '@/hooks/usePresence';
import { popoverPosition } from '@/lib/popoverPosition';

interface SelectProps<T extends string> {
  id: string;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  options: { value: T; label: string; disabled?: boolean }[];
}

export function Select<T extends string>({
  id,
  value,
  onChange,
  disabled,
  options,
}: SelectProps<T>) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof popoverPosition> | null>(null);
  const lastPosition = useRef<ReturnType<typeof popoverPosition> | null>(null);
  const present = usePresence(Boolean(position), 120);
  const [active, setActive] = useState(0);
  const selected = options.find((option) => option.value === value);
  const close = () => {
    setPosition(null);
    trigger.current?.focus();
  };
  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (disabled || !rect || !options.some((option) => !option.disabled)) return;
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
    lastPosition.current = popoverPosition(rect, rect.width, 'start');
    setPosition(lastPosition.current);
  };
  useEffect(() => {
    if (!position) return;
    list.current?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !list.current?.contains(event.target as Node)
      )
        setPosition(null);
    };
    const scroll = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) setPosition(null);
    };
    const hide = () => setPosition(null);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', hide);
    };
  }, [position]);
  const move = (delta: number) => {
    for (let step = 1; step <= options.length; step++) {
      const index = (active + delta * step + options.length * step) % options.length;
      if (!options[index].disabled) {
        setActive(index);
        break;
      }
    }
  };
  return (
    <>
      <button
        type="button"
        id={id}
        ref={trigger}
        className="ui-input ui-select-trigger"
        role="combobox"
        aria-expanded={Boolean(position)}
        aria-haspopup="listbox"
        aria-controls={position ? listId : undefined}
        disabled={disabled || !options.some((option) => !option.disabled)}
        onClick={() => (position ? close() : show())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {present &&
        createPortal(
          <div
            ref={list}
            id={listId}
            className={`ui-select-popover ${position ? '' : 'is-closing'}`}
            inert={!position}
            style={position ?? lastPosition.current ?? undefined}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={id}
            aria-activedescendant={`${listId}-${active}`}
            data-floating-control
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
              } else if (event.key === 'Tab') {
                close();
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(event.key === 'ArrowDown' ? 1 : -1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                setActive(options.findIndex((option) => !option.disabled));
              } else if (event.key === 'End') {
                event.preventDefault();
                setActive(
                  options.length -
                    1 -
                    [...options].reverse().findIndex((option) => !option.disabled),
                );
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (options[active] && !options[active].disabled) {
                  onChange(options[active].value);
                  close();
                }
              } else if (event.key.length === 1) {
                const index = options.findIndex(
                  (option) =>
                    !option.disabled &&
                    option.label.toLowerCase().startsWith(event.key.toLowerCase()),
                );
                if (index >= 0) setActive(index);
              }
            }}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={value === option.value}
                aria-disabled={option.disabled || undefined}
                className={`ui-select-option ${active === index ? 'is-active' : ''}`}
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!option.disabled) {
                    onChange(option.value);
                    close();
                  }
                }}
              >
                <span>{option.label}</span>
                {value === option.value && <Check size={15} />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
