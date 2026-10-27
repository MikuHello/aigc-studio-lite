import { expect, it } from 'vitest';
import { imageCreationGuidance, videoCreationGuidance } from '@/lib/creationGuidance';
import type { VideoCapabilities } from '@/types';

const caps: VideoCapabilities = {
  modes: ['text', 'reference'],
  resolutions: ['720p'],
  ratios: ['adaptive'],
  minDuration: 4,
  maxDuration: 30,
  autoDuration: true,
  audio: true,
  adaptiveFrameRatio: false,
  maxReferenceImages: 7,
  maxReferenceVideos: 2,
  maxReferenceAudios: 3,
  maxReferenceDurationSeconds: 20,
};

it('updates capacities and omits unsupported media from reference guidance', () => {
  const first = videoCreationGuidance(caps, 'reference');
  expect(first.placeholder).toMatch(/7.*2.*3/);
  const limited = videoCreationGuidance(
    { ...caps, maxReferenceImages: 5, maxReferenceVideos: 0, maxReferenceAudios: 0 },
    'reference',
  );
  expect(limited.placeholder).toContain('5');
  expect(limited.details.join('')).not.toMatch(/@视频|@音频|单段视频|单段音频/);
});
it.each([false, true])(
  'distinguishes effective video and audio durations with automatic tasks=%s',
  (autoVideoReferenceParams) => {
    const details = videoCreationGuidance(
      { ...caps, autoVideoReferenceParams },
      'reference',
    ).details;
    expect(details.find((line) => line.startsWith('单段视频'))).toContain(
      `${autoVideoReferenceParams ? 4 : 2}–20`,
    );
    expect(details.find((line) => line.startsWith('单段音频'))).toContain('2–20');
  },
);
it('explains whether audio needs accompanying visual input', () => {
  expect(
    videoCreationGuidance({ ...caps, audioOnlyReference: true }, 'reference').details.join(''),
  ).toContain('仅用音频');
  expect(
    videoCreationGuidance({ ...caps, audioOnlyReference: false }, 'reference').details.join(''),
  ).toContain('需搭配');
});
it('does not invite unsupported references and derives image capacity from capabilities', () => {
  expect(videoCreationGuidance(caps, 'text').placeholder).not.toContain('@');
  const disabled = imageCreationGuidance({ supportsEdit: false });
  expect(disabled.placeholder).not.toContain('参考图');
  expect(disabled.details.join('')).toContain('不支持');
  expect(imageCreationGuidance({ supportsEdit: true, maxReferences: 2 }).placeholder).toContain(
    '2',
  );
});
