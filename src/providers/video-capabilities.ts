import type { VideoCapabilities, VideoDraft, VideoParams } from '@/types';

import { configuredVideoModels } from './model-config';
import { VIDEO_DEFAULT_PARAMS } from '@/lib/creation-defaults';
export { VIDEO_DEFAULT_PARAMS } from '@/lib/creation-defaults';

export const SEEDANCE_MODELS = configuredVideoModels('volcengine');

export function emptyVideoDraft(): VideoDraft {
  return { prompt: '', modelKey: null, params: { ...VIDEO_DEFAULT_PARAMS } };
}

export function normalizeVideoParams(
  params: Partial<VideoParams>,
  caps: VideoCapabilities,
): VideoParams {
  const next = { ...VIDEO_DEFAULT_PARAMS, ...params };
  if (!caps.modes.includes(next.mode)) next.mode = caps.modes[0];
  if (!caps.resolutions.includes(next.resolution))
    next.resolution = caps.resolutions.includes('720p') ? '720p' : caps.resolutions[0];
  if (!caps.ratios.includes(next.ratio)) next.ratio = caps.ratios[0];
  if (caps.adaptiveFrameRatio && (next.mode === 'first-frame' || next.mode === 'first-last-frame'))
    next.ratio = 'adaptive';
  if (!(next.duration === -1 && caps.autoDuration)) {
    next.duration = Number.isFinite(next.duration)
      ? Math.min(caps.maxDuration, Math.max(caps.minDuration, Math.round(next.duration)))
      : 5;
  }
  if (!caps.audio) next.generateAudio = false;
  return next;
}
