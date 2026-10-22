import { useEffect, useRef, useState, type PointerEvent } from 'react';

function hsv(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const h = !d
    ? 0
    : max === r
      ? ((g - b) / d + 6) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}
function hexFrom(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}
export function AnnotationColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  const [hue, setHue] = useState(hsv(value).h);
  const root = useRef<HTMLDivElement>(null);
  const color = hsv(value);
  useEffect(() => {
    setHex(value);
    if (hsv(value).s > 0.001) setHue(hsv(value).h);
  }, [value]);
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  function pick(event: PointerEvent<HTMLDivElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    onChange(
      hexFrom(
        hue,
        Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
        1 - Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
      ),
    );
  }
  return (
    <div
      className="annotation-color-picker"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          root.current?.querySelector('button')?.focus();
        }
      }}
    >
      <button
        className="annotation-custom-color"
        type="button"
        aria-label="自定义颜色"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="annotation-color-popover" role="group" aria-label="自定义颜色面板">
          <div
            className="annotation-saturation"
            style={{ backgroundColor: `hsl(${hue} 100% 50%)` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pick(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
            }}
          >
            <span
              style={{
                left: `${color.s * 100}%`,
                top: `${(1 - color.v) * 100}%`,
                background: value,
              }}
            />
          </div>
          <input
            className="annotation-hue"
            aria-label="色相"
            type="range"
            min="0"
            max="359"
            value={hue}
            onChange={(event) => {
              const h = Number(event.target.value);
              setHue(h);
              onChange(hexFrom(h, color.s || 1, color.v || 1));
            }}
          />
          <div className="annotation-color-values">
            <span className="annotation-color-preview" style={{ background: value }} />
            <label>
              HEX
              <input
                aria-label="HEX 颜色"
                value={hex}
                maxLength={7}
                spellCheck={false}
                onChange={(event) => {
                  const next = event.target.value;
                  setHex(next);
                  const normalized = next.startsWith('#') ? next : `#${next}`;
                  if (/^#[\da-f]{6}$/i.test(normalized)) onChange(normalized.toLowerCase());
                }}
                onBlur={() => setHex(value)}
              />
            </label>
          </div>
          <div className="annotation-rgb">
            {['R', 'G', 'B'].map((name, i) => (
              <label key={name}>
                {name}
                <input
                  aria-label={`${name} 通道`}
                  type="number"
                  min="0"
                  max="255"
                  value={parseInt(value.slice(1 + i * 2, 3 + i * 2), 16)}
                  onChange={(event) => {
                    const channel = Math.max(0, Math.min(255, Number(event.target.value)))
                      .toString(16)
                      .padStart(2, '0');
                    onChange(value.slice(0, 1 + i * 2) + channel + value.slice(3 + i * 2));
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
