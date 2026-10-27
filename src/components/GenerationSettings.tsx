import { useId } from 'react';
import { Ratio, Layers2, SlidersHorizontal } from 'lucide-react';
import type { ModelDescriptor } from '@/types';
import { normalizeImageParams } from '@/providers';
import { useAppStore } from '@/store/appStore';
import { Switch } from './ui/Switch';
import { SegmentedControl } from './ui/SegmentedControl';
import { GenerationSettingsPopover } from './GenerationSettingsPopover';
import { AspectRatioPicker } from './AspectRatioPicker';

const QUALITY_LABELS: Record<string, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
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

  return (
    <div className="creation-parameter-controls">
      {(aspects.length > 0 || imageSizes.length > 0) && (
        <GenerationSettingsPopover
          title="图片画幅与清晰度"
          label={`${aspectLabel}${imageSizes.length ? ` · ${normalized.imageSize ?? imageSizes[0]}` : ''}`}
          icon={<Ratio size={16} />}
        >
          {aspects.length > 0 && (
            <section className="generation-section" aria-labelledby={`${fieldId}-aspect`}>
              <h3 id={`${fieldId}-aspect`}>画幅</h3>
              <AspectRatioPicker
                value={normalized.aspect}
                onChange={(aspect) => setImageParams({ aspect })}
                options={[
                  { value: 'auto', label: '自动' },
                  ...aspects.map((aspect) => ({ ...aspect, label: aspect.value })),
                ]}
              />
            </section>
          )}

          {imageSizes.length > 0 && (
            <section className="generation-section">
              <h3>分辨率</h3>
              <SegmentedControl
                value={normalized.imageSize ?? imageSizes[0]}
                onChange={(imageSize) => setImageParams({ imageSize })}
                options={imageSizes.map((size) => ({ value: size, label: size }))}
                ariaLabel="图片分辨率"
                fullWidth
              />
            </section>
          )}
        </GenerationSettingsPopover>
      )}
      {maxCount > 1 && (
        <GenerationSettingsPopover
          title="图片数量"
          label={`${normalized.count} 张`}
          icon={<Layers2 size={16} />}
          width={280}
        >
          <section className="generation-section generation-section-single" aria-label="生成数量">
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
        </GenerationSettingsPopover>
      )}

      <GenerationSettingsPopover
        title="更多图片设置"
        icon={<SlidersHorizontal size={16} />}
        label="更多"
        iconOnly
      >
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
        </section>

        {backgrounds.some((background) => background.value === 'transparent') && (
          <section className="generation-section generation-transparency">
            <Switch
              label="透明底"
              checked={normalized.background === 'transparent'}
              onChange={(checked) =>
                setImageParams({
                  background: checked ? 'transparent' : 'opaque',
                  ...(checked && normalized.outputFormat !== 'webp' ? { outputFormat: 'png' } : {}),
                })
              }
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
      </GenerationSettingsPopover>
    </div>
  );
}
