import { MAX_AUDIO_UPLOAD_BYTES, videoReferenceDurationLimits } from './referencePolicy';
import type { Asset, GenerateVideoInput, ModelDescriptor, VideoCapabilities } from '@/types';
import { normalizeVideoParams } from '@/providers/video-capabilities';
import { isReferenceUrl, referenceLabels } from './referenceMedia';

export function validateReferenceMedia(
  caps: VideoCapabilities,
  references: GenerateVideoInput['references'],
  complete = true,
): void {
  const groups = {
    image: references.filter((item) => item.role === 'reference_image'),
    video: references.filter((item) => item.role === 'reference_video'),
    audio: references.filter((item) => item.role === 'reference_audio'),
  };
  if (
    references.some(
      (item) => !['reference_image', 'reference_video', 'reference_audio'].includes(item.role),
    )
  )
    throw new Error('全能参考不能混用首帧或尾帧。');
  if (complete && !references.length) throw new Error('请添加至少一个参考素材。');
  if (groups.image.length > (caps.maxReferenceImages ?? 0))
    throw new Error(`当前模型支持 1–${caps.maxReferenceImages ?? 0} 张参考图，请移除多余图片。`);
  for (const kind of ['video', 'audio'] as const) {
    const items = groups[kind];
    const label = kind === 'video' ? '视频' : '音频';
    const limits = videoReferenceDurationLimits(caps, kind);
    const max = (kind === 'video' ? caps.maxReferenceVideos : caps.maxReferenceAudios) ?? 0;
    if (items.length > max) throw new Error(`当前模型最多支持 ${max} 段参考${label}。`);
    let total = 0;
    for (const item of items) {
      const duration = item.durationSeconds;
      if (
        duration === undefined ||
        !Number.isFinite(duration) ||
        duration < limits.min ||
        duration > limits.max
      )
        throw new Error(`参考${label}单段时长需为 ${limits.min}–${limits.max} 秒。`);
      total += duration;
      if (kind === 'video' && item.width !== undefined && item.height !== undefined) {
        const pixels = item.width * item.height;
        if (
          item.width < 300 ||
          item.height < 300 ||
          item.width > 6000 ||
          item.height > 6000 ||
          item.width / item.height < 0.4 ||
          item.width / item.height > 2.5 ||
          pixels < 407696 ||
          pixels > 8295044
        )
          throw new Error(
            '参考视频尺寸不符合模型要求：宽高 300–6000，比例 0.4–2.5，总像素 407696–8295044。',
          );
      }
    }
    if (total > (caps.maxReferenceDurationSeconds ?? 0) + 0.001)
      throw new Error(`参考${label}总时长不能超过 ${caps.maxReferenceDurationSeconds} 秒。`);
  }
  if (
    complete &&
    groups.audio.length &&
    !caps.audioOnlyReference &&
    !groups.image.length &&
    !groups.video.length
  )
    throw new Error('当前模型的音频参考需要至少搭配一张图片或一段视频。');
  for (const item of references) validateReferenceSource(item);
  validateVideoImageBudget(references.map((item) => item.dataUrl));
}

function validateReferenceSource(item: GenerateVideoInput['references'][number]): void {
  if (isReferenceUrl(item.dataUrl)) return;
  const image = item.role !== 'reference_audio' && item.role !== 'reference_video';
  const pattern = image
    ? /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/
    : /^data:audio\/(mpeg|mp3|wav|x-wav);base64,[A-Za-z0-9+/=]+$/;
  if (item.role === 'reference_video' || !pattern.test(item.dataUrl))
    throw new Error(
      item.role === 'reference_video'
        ? '参考视频需要 HTTPS 公网地址或 asset:// 素材 ID。'
        : '参考素材格式无效，请重新添加。',
    );
  if (
    !image &&
    ((item.dataUrl.length - item.dataUrl.indexOf(',') - 1) * 3) / 4 > MAX_AUDIO_UPLOAD_BYTES + 2
  )
    throw new Error(`单段参考音频不能超过 ${MAX_AUDIO_UPLOAD_BYTES / 1024 / 1024} MB。`);
}

export function validateVideoInput(model: ModelDescriptor, input: GenerateVideoInput): void {
  const caps = model.capabilities.video;
  if (!caps) throw new Error('该模型尚未配置视频能力。');
  const p = input.params;
  const normalized = normalizeVideoParams(p, caps);
  if (
    ['mode', 'resolution', 'ratio', 'duration', 'generateAudio'].some(
      (key) => p[key as keyof typeof p] !== normalized[key as keyof typeof p],
    )
  )
    throw new Error('生成参数不适用于当前模型，请重新选择。');
  if (p.mode === 'reference') {
    validateReferenceMedia(caps, input.references);
    const videos = input.references.filter((item) => item.role === 'reference_video');
    if (caps.autoVideoReferenceParams && videos.length) {
      if (p.ratio !== 'adaptive' || p.duration !== -1)
        throw new Error('当前模型会自动识别视频参考任务，请将画幅设为自动、时长设为自动后再生成。');
    }
    if (/\[已移除:(?:图片|图像|视频|音频)\d+\]/.test(input.prompt))
      throw new Error('提示词引用了已移除的素材，请修改后再生成。');
    for (const match of input.prompt.matchAll(/@(图片|图像|视频|音频)(\d+)(?!\d)/g)) {
      const role =
        match[1] === '视频'
          ? 'reference_video'
          : match[1] === '音频'
            ? 'reference_audio'
            : 'reference_image';
      if (
        Number(match[2]) < 1 ||
        Number(match[2]) > input.references.filter((item) => item.role === role).length
      )
        throw new Error(`提示词中的 ${match[0]} 不存在，请检查素材编号。`);
    }
  } else {
    const roles = input.references.map((item) => item.role);
    const expected =
      p.mode === 'text'
        ? []
        : p.mode === 'first-frame'
          ? ['first_frame']
          : ['first_frame', 'last_frame'];
    if (roles.length !== expected.length || roles.some((role, index) => role !== expected[index]))
      throw new Error('请补齐当前模式所需的首帧和尾帧。');
    input.references.forEach(validateReferenceSource);
  }
  validateVideoImageBudget(
    input.references.map((item) => item.dataUrl),
    input.prompt,
  );
  if (!input.prompt.trim() && p.mode === 'text') throw new Error('请输入视频描述。');
}

export function validateVideoImageBudget(dataUrls: string[], prompt = ''): void {
  const bytes = dataUrls.reduce(
    (total, url) => total + url.length,
    new TextEncoder().encode(prompt).byteLength,
  );
  if (bytes > 64 * 1024 * 1024 - 4096)
    throw new Error('参考素材总量超过请求上限（64 MB，含编码），请减少或压缩素材。');
}

export function remapVideoReferences(
  prompt: string,
  previousIds: string[],
  nextIds: string[],
  assets: Record<string, Asset> = {},
): string {
  const describe = (ids: string[]) =>
    referenceLabels(ids.map((id) => ({ id, mimeType: assets[id]?.mimeType ?? 'image/png' })));
  const previous = describe(previousIds);
  const next = describe(nextIds);
  const byLabel = new Map([...previous].map(([id, label]) => [label, id]));
  return prompt.replace(
    /\[已移除:(?:图片|图像|视频|音频)\d+\]|(@?)((?:图片|图像|视频|音频)\d+)(?!\d)/g,
    (text, prefix: string | undefined, label: string | undefined) => {
      if (label === undefined) return text;
      const id = byLabel.get(label.replace('图像', '图片'));
      if (!id) return text;
      const replacement = next.get(id);
      return replacement
        ? `${prefix}${label.startsWith('图像') ? replacement.replace('图片', '图像') : replacement}`
        : `[已移除:${label}]`;
    },
  );
}
