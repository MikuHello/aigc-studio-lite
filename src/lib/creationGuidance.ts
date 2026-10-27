import type { ImageCapabilities, VideoCapabilities, VideoMode } from '@/types';

import { MAX_IMAGE_ATTACHMENTS, videoReferenceDurationLimits } from './referencePolicy';
import { MAX_UPLOAD_BYTES } from './image';

export function imageCreationGuidance(caps?: ImageCapabilities) {
  const maxReferences = Math.min(
    MAX_IMAGE_ATTACHMENTS,
    caps?.maxReferences ?? MAX_IMAGE_ATTACHMENTS,
  );
  const supportsReferences = Boolean(caps?.supportsEdit);
  return {
    title: '参考图片说明',
    placeholder: supportsReferences
      ? `添加最多 ${maxReferences} 张参考图，描述想保留的主体、想改变的场景或风格。也可以直接输入画面描述。`
      : '描述主体、场景、风格与构图，生成想要的画面。',
    details: supportsReferences
      ? [
          `当前工作台最多参考 ${maxReferences} 张图片。`,
          `支持拖入、粘贴或从作品库选择；PNG、JPEG、WebP，每张不超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB。`,
          '可用 @ 引用素材，说明想保留或改变的内容。',
        ]
      : ['当前模型不支持参考图生成。', '可切换到支持参考图的模型，已添加的素材会保留。'],
  };
}

export function videoCreationGuidance(caps: VideoCapabilities | undefined, mode: VideoMode) {
  const entries = [
    { count: caps?.maxReferenceImages ?? 0, unit: '张图片', example: '@图片1' },
    { count: caps?.maxReferenceVideos ?? 0, unit: '段视频', example: '@视频1' },
    { count: caps?.maxReferenceAudios ?? 0, unit: '段音频', example: '@音频1' },
  ].filter((entry) => entry.count > 0);
  const capacity = entries.map((entry) => `${entry.count} ${entry.unit}`).join('、');
  const details = [
    capacity ? `当前模型最多支持 ${capacity}，可组合使用。` : '请先选择支持参考素材的视频模型。',
    ...(['video', 'audio'] as const).flatMap((kind) => {
      const count = kind === 'video' ? caps?.maxReferenceVideos : caps?.maxReferenceAudios;
      const { min, max } = videoReferenceDurationLimits(caps, kind);
      const label = kind === 'video' ? '视频' : '音频';
      return count && max
        ? [`单段${label}为 ${min}–${max} 秒；${label}总时长不超过 ${max} 秒。`]
        : [];
    }),
    ...(caps?.maxReferenceAudios
      ? [
          caps.audioOnlyReference
            ? '支持仅用音频作为参考。'
            : '音频参考需搭配至少一张图片或一段视频。',
        ]
      : []),
    ...(entries.length
      ? [`用 ${entries.map((entry) => entry.example).join('、')} 指定素材的用途。`]
      : []),
    ...(caps?.maxReferenceImages ? ['图片可上传、拖入、粘贴或从作品库选择。'] : []),
    ...(caps?.maxReferenceAudios ? ['音频可上传、拖入或粘贴；支持 MP3、WAV。'] : []),
    ...(caps?.maxReferenceVideos ? ['视频通过链接或作品库添加，暂不支持本地视频直传。'] : []),
  ];
  const placeholder =
    mode === 'reference'
      ? `${capacity ? `最多可添加 ${capacity}。` : ''}用 @ 引用素材，描述想要的画面、运镜与声音。`
      : mode === 'first-frame'
        ? '添加一张首帧图，描述画面接下来的动作、镜头与声音。'
        : mode === 'first-last-frame'
          ? '添加首帧与尾帧，描述两个画面之间的动作、过渡和镜头运动。'
          : '描述主体、动作、场景、镜头与声音，生成一段视频。';
  return { title: '全能参考说明', placeholder, details };
}
