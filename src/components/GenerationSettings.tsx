import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Scan, Ratio, X } from 'lucide-react';
import type { ModelDescriptor } from '@/types';
import { popoverPosition } from '@/lib/popoverPosition';
import { normalizeImageParams } from '@/providers';
import { useAppStore } from '@/store/appStore';
import { IconButton } from './ui/IconButton';
import { Switch } from './ui/Switch';
import { Select } from './ui/Select';
import { SegmentedControl } from './ui/SegmentedControl';

const QUALITY_LABELS: Record<string, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  standard: '标准',
  hd: '高清',
};

const STYLE_LABELS: Record<string, string> = {
  vivid: '鲜明',
  natural: '自然',
};

interface GenerationSettingsProps {
  model: ModelDescriptor;
}

export function GenerationSettings({ model }: GenerationSettingsProps) {
  const fieldId = useId();
  const imageParams = useAppStore((state) => state.imageParams);
  const setImageParams = useAppStore((state) => state.setImageParams);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof popoverPosition> | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const caps = model.capabilities.image;
  const normalized = normalizeImageParams(imageParams, caps);
  const aspects = caps?.aspects ?? [];
  const backgrounds = caps?.backgrounds ?? [];
  const qualities = caps?.qualities ?? [];
  const styles = caps?.styles ?? [];
  const formats = caps?.outputFormats ?? [];
  const imageSizes = caps?.imageSizes ?? [];
  const maxCount = caps?.maxCount ?? 1;
  const aspectLabel = normalized.aspect === 'auto' ? '自动' : normalized.aspect;

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(popoverPosition(rect, 360));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if ((event.target as HTMLElement)?.closest('[data-floating-control]')) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('[data-floating-control]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const close = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      if (event.target instanceof HTMLElement && event.target.closest('[data-floating-control]'))
        return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`generation-trigger ${open ? 'is-open' : ''}`}
        onClick={() => (open ? setOpen(false) : show())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`生成设置，${aspectLabel}${
          normalized.background === 'transparent' ? '，透明底' : ''
        }`}
      >
        <Ratio size={16} />
        <span>{aspectLabel}</span>
        {normalized.background === 'transparent' && <em>透明</em>}
        <ChevronDown size={14} className="generation-trigger-chevron" />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            className="generation-popover"
            style={position}
            role="dialog"
            aria-label="生成设置"
          >
            <header className="generation-popover-head">
              <div>
                <strong>生成设置</strong>
              </div>
              <IconButton
                label="关闭生成设置"
                icon={<X size={15} />}
                size="sm"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              />
            </header>

            {aspects.length > 0 && (
              <section className="generation-section" aria-labelledby="generation-aspect-label">
                <h3 id="generation-aspect-label">画幅</h3>
                <div className={`generation-aspects ${aspects.length > 6 ? 'is-dense' : ''}`}>
                  <button
                    type="button"
                    className={`generation-aspect ${normalized.aspect === 'auto' ? 'is-active' : ''}`}
                    aria-pressed={normalized.aspect === 'auto'}
                    onClick={() => setImageParams({ aspect: 'auto' })}
                  >
                    <span className="generation-aspect-shape">
                      <Scan size={23} strokeWidth={1.5} />
                    </span>
                    <span>自动</span>
                  </button>
                  {aspects.map((aspect) => {
                    const active = aspect.value === normalized.aspect;
                    return (
                      <button
                        key={aspect.value}
                        type="button"
                        className={`generation-aspect ${active ? 'is-active' : ''}`}
                        aria-pressed={active}
                        onClick={() => setImageParams({ aspect: aspect.value })}
                      >
                        <span className="generation-aspect-shape">
                          <span
                            style={{
                              width: Math.min(32, (21 * aspect.ratioW) / aspect.ratioH),
                              height: Math.min(21, (32 * aspect.ratioH) / aspect.ratioW),
                            }}
                          />
                        </span>
                        <span>{aspect.value}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="generation-output">
              {formats.length > 0 && (
                <div className="generation-output-field">
                  <span>格式</span>
                  <SegmentedControl
                    value={normalized.outputFormat ?? formats[0]}
                    onChange={(outputFormat) =>
                      setImageParams({
                        outputFormat,
                        ...(outputFormat === 'jpeg' && normalized.background === 'transparent'
                          ? { background: 'opaque' }
                          : {}),
                      })
                    }
                    options={formats.map((format) => ({
                      value: format,
                      label: format.toUpperCase(),
                    }))}
                    ariaLabel="输出格式"
                    fullWidth
                  />
                </div>
              )}
              {formats.length === 0 && (
                <div className="generation-output-field">
                  <span>格式</span>
                  <span className="generation-output-note">由模型返回</span>
                </div>
              )}
              {imageSizes.length > 0 && (
                <div className="generation-output-field">
                  <label htmlFor={`${fieldId}-size`}>分辨率</label>
                  <Select
                    id={`${fieldId}-size`}
                    value={normalized.imageSize ?? imageSizes[0]}
                    onChange={(imageSize) => setImageParams({ imageSize })}
                    options={imageSizes.map((size) => ({ value: size, label: size }))}
                  />
                </div>
              )}
            </section>

            {backgrounds.some((background) => background.value === 'transparent') && (
              <section className="generation-section generation-transparency">
                <Switch
                  label="透明底"
                  checked={normalized.background === 'transparent'}
                  onChange={(checked) =>
                    setImageParams({
                      background: checked ? 'transparent' : 'opaque',
                      ...(checked && normalized.outputFormat !== 'webp'
                        ? { outputFormat: 'png' }
                        : {}),
                    })
                  }
                />
              </section>
            )}

            {maxCount > 1 && (
              <section className="generation-section">
                <h3>数量</h3>
                <SegmentedControl
                  value={String(normalized.count)}
                  options={[1, 2, 3, 4]
                    .filter((count) => count <= maxCount)
                    .map((count) => ({ value: String(count), label: String(count) }))}
                  onChange={(count) => setImageParams({ count: Number(count) })}
                  ariaLabel="生成数量"
                  fullWidth
                />
              </section>
            )}

            {qualities.length > 1 && (
              <section className="generation-section">
                <h3>质量</h3>
                <SegmentedControl
                  value={normalized.quality ?? qualities[0]}
                  options={qualities.map((quality) => ({
                    value: quality,
                    label: QUALITY_LABELS[quality] ?? quality,
                  }))}
                  onChange={(quality) => setImageParams({ quality })}
                  ariaLabel="图像质量"
                  fullWidth
                />
              </section>
            )}

            {styles.length > 0 && (
              <section className="generation-section">
                <h3>风格</h3>
                <SegmentedControl
                  value={normalized.style ?? styles[0]}
                  options={styles.map((style) => ({
                    value: style,
                    label: STYLE_LABELS[style] ?? style,
                  }))}
                  onChange={(style) => setImageParams({ style })}
                  ariaLabel="图像风格"
                  fullWidth
                />
              </section>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
