import { MAX_AUDIO_UPLOAD_BYTES } from './referencePolicy';
import type { Asset, GenerateVideoInput, MediaMetadata, ReferenceKind } from '@/types';
import { fileToDataUrl, MAX_UPLOAD_BYTES } from './image';
import { createId } from './id';

export const REFERENCE_FILE_ACCEPT =
  'image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,.mp3,.wav';
export const ASSET_DRAG_TYPE = 'application/x-aigc-asset-id';
const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

export function referenceKind(asset: Pick<Asset, 'mimeType'>): ReferenceKind {
  return asset.mimeType.startsWith('audio/')
    ? 'audio'
    : asset.mimeType.startsWith('video/')
      ? 'video'
      : 'image';
}
export function referenceSource(asset: Asset): string {
  return asset.video?.url ?? asset.dataUrl;
}
export function referenceLabels(
  assets: Array<Pick<Asset, 'id' | 'mimeType'>>,
): Map<string, string> {
  const counts = { image: 0, video: 0, audio: 0 };
  const names = { image: '图片', video: '视频', audio: '音频' };
  return new Map(
    assets.map((asset) => {
      const kind = referenceKind(asset);
      return [asset.id, `${names[kind]}${++counts[kind]}`];
    }),
  );
}
export function isReferenceUrl(value: string): boolean {
  if (/^asset:\/\/[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
export function assertImageDimensions({ width = 0, height = 0 }: MediaMetadata): void {
  if (
    width < 300 ||
    height < 300 ||
    width > 6000 ||
    height > 6000 ||
    width / height < 0.4 ||
    width / height > 2.5
  )
    throw new Error('参考图片宽高需为 300–6000 像素，宽高比需为 0.4–2.5。');
}
export function readMediaMetadata(source: string, kind: ReferenceKind): Promise<MediaMetadata> {
  return new Promise((resolve, reject) => {
    const element = kind === 'image' ? new Image() : document.createElement(kind);
    const clear = () => {
      clearTimeout(timer);
      element.onload = null;
      element.onerror = null;
      if (element instanceof HTMLMediaElement) {
        element.onloadedmetadata = null;
        element.removeAttribute('src');
        element.load();
      }
    };
    const fail = () => {
      clear();
      reject(new Error('无法读取素材，请检查格式、链接有效期及浏览器是否支持该编码。'));
    };
    const timer = setTimeout(fail, 15000);
    const ready = () => {
      const metadata =
        element instanceof HTMLImageElement
          ? { width: element.naturalWidth, height: element.naturalHeight }
          : {
              durationSeconds: element.duration,
              ...(element instanceof HTMLVideoElement
                ? { width: element.videoWidth, height: element.videoHeight }
                : {}),
            };
      clear();
      resolve(metadata);
    };
    element.onerror = fail;
    if (element instanceof HTMLMediaElement) {
      element.preload = 'metadata';
      element.onloadedmetadata = ready;
    } else element.onload = ready;
    element.src = source;
  });
}
export async function referenceFileAsset(
  file: File,
  sessionId: string,
  allowAudio: boolean,
  videoImageConstraints = true,
): Promise<Asset> {
  const mimeType = MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? file.type;
  if (mimeType.startsWith('video/'))
    throw new Error(
      '本地视频暂不直传。请在「添加参考素材 → 链接」填入视频公网地址，或从作品库选择视频。',
    );
  if (
    ![
      'image/png',
      'image/jpeg',
      'image/webp',
      ...(allowAudio ? ['audio/mpeg', 'audio/wav'] : []),
    ].includes(mimeType)
  )
    throw new Error(
      allowAudio
        ? '支持 PNG、JPEG、WebP 图片和 MP3、WAV 音频。'
        : '请选择 PNG、JPEG 或 WebP 图片。',
    );
  const kind = referenceKind({ mimeType });
  const limit = kind === 'audio' ? MAX_AUDIO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (file.size > limit)
    throw new Error(`${file.name} 超过 ${limit / 1024 / 1024} MB，请压缩后重试。`);
  const dataUrl = await fileToDataUrl(new File([file], file.name, { type: mimeType }));
  const media = await readMediaMetadata(dataUrl, kind);
  if (kind === 'image' && videoImageConstraints) assertImageDimensions(media);
  return {
    id: createId('asset'),
    sessionId,
    source: 'upload',
    dataUrl,
    mimeType,
    filename: file.name,
    media,
    createdAt: Date.now(),
  };
}

export function assetVideoReference(asset: Asset): GenerateVideoInput['references'][number] {
  const kind = referenceKind(asset);
  return {
    dataUrl: referenceSource(asset),
    mimeType: asset.mimeType,
    ...asset.media,
    durationSeconds: asset.media?.durationSeconds ?? asset.video?.duration,
    role:
      kind === 'video'
        ? 'reference_video'
        : kind === 'audio'
          ? 'reference_audio'
          : 'reference_image',
  };
}
