import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  showGlyph?: boolean;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  children,
  showGlyph = true,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`ui-empty-state ${className}`.trim()}>
      {showGlyph && (
        <span className="ui-empty-glyph" aria-hidden="true">
          <span />
        </span>
      )}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children && <div className="ui-empty-actions">{children}</div>}
    </div>
  );
}
