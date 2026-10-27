import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { popoverPosition } from '@/lib/popoverPosition';
import { IconButton } from './ui/IconButton';

export function GenerationSettingsPopover({
  title,
  label,
  icon,
  children,
  compact = true,
  iconOnly = false,
  width = 360,
}: {
  title: string;
  label: ReactNode;
  icon: ReactNode;
  children: ReactNode;
  compact?: boolean;
  iconOnly?: boolean;
  width?: number;
}) {
  const id = useId();
  const [position, setPosition] = useState<ReturnType<typeof popoverPosition> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => {
    setPosition(null);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!position) return;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('[data-floating-control]')) return;
      if (
        target instanceof Node &&
        (trigger.current?.contains(target) || panel.current?.contains(target))
      )
        return;
      setPosition(null);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('[data-floating-control]'))
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setPosition(null);
        trigger.current?.focus();
      }
    };
    const resize = () => setPosition(null);
    const otherPopover = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setPosition(null);
    };
    document.addEventListener('creation-popover-open', otherPopover);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', outside, true);
    document.addEventListener('keydown', keydown);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', outside, true);
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', resize);
      document.removeEventListener('creation-popover-open', otherPopover);
    };
  }, [position, id]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`generation-trigger ${compact ? 'is-parameter' : ''} ${iconOnly ? 'is-icon-only' : ''} ${position ? 'is-open' : ''}`}
        aria-label={title}
        title={title}
        aria-controls={position ? id : undefined}
        aria-haspopup="dialog"
        aria-expanded={Boolean(position)}
        onClick={() => {
          if (position) close();
          else if (trigger.current) {
            document.dispatchEvent(new CustomEvent('creation-popover-open', { detail: id }));
            setPosition(popoverPosition(trigger.current.getBoundingClientRect(), width));
          }
        }}
      >
        {icon}
        {!iconOnly && <span>{label}</span>}
        {!iconOnly && <ChevronDown size={12} className="generation-trigger-chevron" />}
      </button>
      {position &&
        createPortal(
          <div
            ref={panel}
            id={id}
            className="generation-popover"
            style={position}
            role="dialog"
            aria-label={title}
          >
            <header className="generation-popover-head">
              <strong>{title}</strong>
              <IconButton label={`关闭${title}`} icon={<X size={15} />} size="sm" onClick={close} />
            </header>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
