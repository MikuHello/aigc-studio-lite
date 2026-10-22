import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface RowMenuProps {
  actions: RowMenuItem[];
  label?: string;
}

export function RowMenu({ actions, label = '更多操作' }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionsList = useMemo(() => actions.filter(Boolean), [actions]);

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 168;
    const estimatedHeight = actionsList.length * 34 + 10;
    const left = Math.min(Math.max(10, rect.right - width), window.innerWidth - width - 10);
    const top =
      rect.bottom + estimatedHeight + 8 > window.innerHeight
        ? Math.max(10, rect.top - estimatedHeight - 4)
        : rect.bottom + 4;
    setPosition({ top, left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const timer = window.setTimeout(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
        ?.focus();
    }, 20);
    document.addEventListener('pointerdown', handlePointer);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointer);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`row-menu-trigger ui-icon-button ui-icon-button-plain ui-icon-button-sm ${open ? 'is-active' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <MoreHorizontal size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="row-menu-popover"
            style={position}
            role="menu"
            data-floating-control
            aria-label={label}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus();
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]:not([disabled])',
                ),
              );
              if (!items.length) return;
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }}
          >
            {actionsList.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={`row-menu-item ${action.danger ? 'is-danger' : ''}`}
                  disabled={action.disabled}
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                    action.onSelect();
                  }}
                >
                  {Icon && <Icon size={14} />}
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
