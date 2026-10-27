import { useId } from 'react';
import { Clock3, Image, Images, Type, Ratio, SlidersHorizontal } from 'lucide-react';
import type { VideoCapabilities, VideoParams, VideoStyle } from '@/types';
import { VIDEO_STYLES } from '@/lib/videoStyles';
import { GenerationSettingsPopover } from './GenerationSettingsPopover';
import { AspectRatioPicker } from './AspectRatioPicker';
import { SegmentedControl } from './ui/SegmentedControl';
import { Switch } from './ui/Switch';

const MODES = {
  reference: { label: '全能参考', icon: <Images size={17} /> },
  text: { label: '文生视频', icon: <Type size={17} /> },
  'first-frame': { label: '首帧', icon: <Image size={17} /> },
  'first-last-frame': { label: '首尾帧', icon: <Images size={17} /> },
};

export function VideoGenerationSettings({
  params,
  caps,
  style,
  onChange,
  onStyleChange,
}: {
  params: VideoParams;
  caps: VideoCapabilities;
  style?: VideoStyle;
  onChange: (patch: Partial<VideoParams>) => void;
  onStyleChange: (style: VideoStyle) => void;
}) {
  const id = useId();
  const adaptive =
    caps.adaptiveFrameRatio &&
    (params.mode === 'first-frame' || params.mode === 'first-last-frame');
  return (
    <div className="creation-parameter-controls">
      <GenerationSettingsPopover
        title="视频生成方式"
        icon={MODES[params.mode].icon}
        label={MODES[params.mode].label}
      >
        <section className="generation-section generation-section-single" aria-label="生成方式">
          <div className="generation-aspects video-mode-options">
            {caps.modes.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={params.mode === mode}
                className={`generation-aspect ${params.mode === mode ? 'is-active' : ''}`}
                onClick={() => onChange({ mode })}
              >
                {MODES[mode].icon}
                <span>{MODES[mode].label}</span>
              </button>
            ))}
          </div>
        </section>
      </GenerationSettingsPopover>
      <GenerationSettingsPopover
        title="视频画幅与清晰度"
        icon={<Ratio size={16} />}
        label={`${params.ratio === 'adaptive' ? '自动' : params.ratio} · ${params.resolution}`}
      >
        <section className="generation-section" aria-labelledby={`${id}-ratio`}>
          <h3 id={`${id}-ratio`}>画幅</h3>
          {adaptive ? (
            <p className="generation-output-note video-adaptive-note">自动匹配首帧图片</p>
          ) : (
            <AspectRatioPicker
              value={params.ratio}
              onChange={(ratio) => onChange({ ratio })}
              options={caps.ratios.map((value) => {
                const [ratioW, ratioH] = value.split(':').map(Number);
                return { value, label: value === 'adaptive' ? '自动' : value, ratioW, ratioH };
              })}
            />
          )}
        </section>
        <section className="generation-section">
          <h3>清晰度</h3>
          <SegmentedControl
            value={params.resolution}
            options={caps.resolutions.map((value) => ({ value, label: value }))}
            onChange={(resolution) => onChange({ resolution })}
            ariaLabel="视频清晰度"
            fullWidth
          />
        </section>
      </GenerationSettingsPopover>
      <GenerationSettingsPopover
        title="视频时长"
        icon={<Clock3 size={16} />}
        label={params.duration === -1 ? '自动时长' : `${params.duration}s`}
        width={320}
      >
        <section
          className="generation-section generation-section-single video-duration-section"
          aria-label="视频时长"
        >
          <div className="video-duration-label">
            <output htmlFor={`${id}-duration`}>
              {params.duration === -1 ? '自动' : `${params.duration} 秒`}
            </output>
            {caps.autoDuration && (
              <button
                type="button"
                className={`video-auto-duration ${params.duration === -1 ? 'is-active' : ''}`}
                aria-pressed={params.duration === -1}
                onClick={() =>
                  onChange({
                    duration:
                      params.duration === -1
                        ? Math.min(caps.maxDuration, Math.max(5, caps.minDuration))
                        : -1,
                  })
                }
              >
                自动
              </button>
            )}
          </div>
          <input
            id={`${id}-duration`}
            aria-label="视频时长"
            type="range"
            min={caps.minDuration}
            max={caps.maxDuration}
            step={1}
            value={params.duration === -1 ? caps.minDuration : params.duration}
            disabled={params.duration === -1}
            onChange={(event) => onChange({ duration: Number(event.target.value) })}
          />
          <div className="video-duration-range">
            <span>{caps.minDuration} 秒</span>
            <span>{caps.maxDuration} 秒</span>
          </div>
        </section>
      </GenerationSettingsPopover>
      <GenerationSettingsPopover
        title="更多视频设置"
        icon={<SlidersHorizontal size={16} />}
        label="更多"
        iconOnly
      >
        <section className="generation-section" aria-labelledby={`${id}-style`}>
          <h3 id={`${id}-style`}>画面风格</h3>
          <SegmentedControl
            value={style ?? 'none'}
            options={VIDEO_STYLES}
            onChange={onStyleChange}
            ariaLabel="视频画面风格"
            fullWidth
          />
        </section>
        <section className="generation-section video-output-switches" aria-label="视频输出">
          {caps.audio && (
            <Switch
              label="生成声音"
              checked={params.generateAudio}
              onChange={(generateAudio) => onChange({ generateAudio })}
            />
          )}
          <Switch
            label="添加水印"
            checked={params.watermark}
            onChange={(watermark) => onChange({ watermark })}
          />
        </section>
      </GenerationSettingsPopover>
    </div>
  );
}
