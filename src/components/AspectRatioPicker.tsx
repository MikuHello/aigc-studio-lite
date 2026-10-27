import { Scan } from 'lucide-react';

export function AspectRatioPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; ratioW?: number; ratioH?: number }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`generation-aspects ${options.length > 6 ? 'is-dense' : ''}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`generation-aspect ${value === option.value ? 'is-active' : ''}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          <span className="generation-aspect-shape">
            {option.ratioW && option.ratioH ? (
              <span
                style={{
                  width: Math.min(32, (21 * option.ratioW) / option.ratioH),
                  height: Math.min(21, (32 * option.ratioH) / option.ratioW),
                }}
              />
            ) : (
              <Scan size={23} strokeWidth={1.5} />
            )}
          </span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
