export function popoverPosition(
  rect: DOMRect,
  preferredWidth = 340,
  align: 'start' | 'end' = 'end',
) {
  const margin = 12;
  const gap = 8;
  const width = Math.min(preferredWidth, window.innerWidth - margin * 2);
  const below = window.innerHeight - rect.bottom - gap - margin;
  const above = rect.top - gap - margin;
  const opensAbove = below < 320 && above > below;
  return {
    left: Math.max(
      margin,
      Math.min(
        align === 'start' ? rect.left : rect.right - width,
        window.innerWidth - width - margin,
      ),
    ),
    width,
    top: opensAbove ? undefined : rect.bottom + gap,
    bottom: opensAbove ? window.innerHeight - rect.top + gap : undefined,
    maxHeight: Math.max(0, Math.min(460, opensAbove ? above : below)),
  };
}
