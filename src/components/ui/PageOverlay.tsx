import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

interface PageOverlayProps {
  inline?: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PageOverlay({
  inline = false,
  title,
  description,
  onClose,
  actions,
  children,
  className = '',
}: PageOverlayProps) {
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestClose = () => {
    if (closeTimer.current) return;
    setClosing(true);
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
    closeTimer.current = setTimeout(() => closeCallback.current(), delay);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;

  useEffect(() => {
    if (inline) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 30);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('.dialog-backdrop')) return;
      if ((event.target as HTMLElement)?.closest('[data-floating-control]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const elements = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (elements.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const focused = document.activeElement;
      if (!panel.contains(focused) || focused === panel) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && focused === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [inline]);

  if (inline)
    return (
      <section className={`workspace-page ${className}`} aria-labelledby={titleId}>
        <header className="page-overlay-head">
          <div className="page-overlay-heading">
            <h1 id={titleId}>{title}</h1>
            {description && <p>{description}</p>}
          </div>
          <div className="page-overlay-actions">
            {actions}
            <IconButton label="返回工作台" icon={<X size={18} />} onClick={onClose} />
          </div>
        </header>
        <div className="page-overlay-body">{children}</div>
      </section>
    );

  return createPortal(
    <div
      className={`page-overlay ${closing ? 'is-closing' : ''}`}
      inert={closing}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        className={`page-overlay-panel ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="page-overlay-head">
          <div className="page-overlay-heading">
            <h1 id={titleId}>{title}</h1>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <div className="page-overlay-actions">
            {actions}
            <IconButton label="关闭" icon={<X size={18} />} onClick={requestClose} />
          </div>
        </header>
        <div className="page-overlay-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
