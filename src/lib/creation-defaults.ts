import type { ImageParams, VideoParams } from '@/types';

export const DEFAULT_IMAGE_PARAMS: ImageParams = {
  aspect: 'auto',
  quality: 'auto',
  background: 'auto',
  outputFormat: 'png',
  count: 1,
};

export const VIDEO_DEFAULT_PARAMS: VideoParams = {
  mode: 'text',
  resolution: '720p',
  ratio: '16:9',
  duration: 5,
  generateAudio: true,
  watermark: false,
};
