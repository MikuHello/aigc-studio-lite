interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 28, className = '' }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path d="M9 9h14v14H9z" stroke="var(--brand-negative, #fff)" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="4.2" fill="var(--brand-negative, #fff)" />
      <path
        d="M16 4.8v3.1M16 24.1v3.1M4.8 16h3.1M24.1 16h3.1"
        stroke="var(--brand-negative, #fff)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AgentAvatar({ size = 26 }: { size?: number }) {
  return (
    <span className="agent-avatar" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" width={size * 0.58} height={size * 0.58}>
        <path
          d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      </svg>
    </span>
  );
}
