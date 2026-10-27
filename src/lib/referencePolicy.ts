import type { VideoCapabilities } from '@/types';

export const MAX_IMAGE_ATTACHMENTS = 6;
export const MAX_AUDIO_UPLOAD_BYTES = 15 * 1024 * 1024;

export function videoReferenceDurationLimits(
  caps: VideoCapabilities | undefined,
  kind: 'video' | 'audio',
) {
  return {
    min: kind === 'video' && caps?.autoVideoReferenceParams ? 4 : 2,
    max: caps?.maxReferenceDurationSeconds ?? 0,
  };
}
