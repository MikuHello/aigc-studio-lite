import { expect, it } from 'vitest';
import { normalizeImageParams, openAIImageCapabilities } from '@/providers/model-capabilities';
import { imageCapabilitiesFor } from '@/providers/model-support';

it('preserves automatic aspect during parameter normalization', () => {
  expect(
    normalizeImageParams({ aspect: 'auto', count: 1 }, openAIImageCapabilities('gpt-image-1'))
      .aspect,
  ).toBe('auto');
});
it.each(['gpt-image-1.5', 'gpt-image-2', 'gpt-image-2.5-sunburst'])(
  'keeps every %s dimension aligned with its aspect ratio and within the image API bounds',
  (id) => {
    for (const aspect of openAIImageCapabilities(id).aspects) {
      const [w, h] = aspect.apiSize!.split('x').map(Number);
      const [ratioW, ratioH] = aspect.value.split(':').map(Number);
      expect(Math.abs(w / h / (ratioW / ratioH) - 1), `${id}: ${aspect.value}`).toBeLessThanOrEqual(
        0.005,
      );
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      expect(w * h).toBeGreaterThanOrEqual(655360);
      expect(w * h).toBeLessThanOrEqual(8294400);
      expect(Math.max(w / h, h / w)).toBeLessThanOrEqual(3);
    }
  },
);
it.each(['doubao-seedream-4-0', 'doubao-seedream-4-5', 'doubao-seedream-5-0'])(
  'keeps every %s 2K dimension aligned with its aspect ratio and within the supported pixel range',
  (id) => {
    for (const aspect of imageCapabilitiesFor('volcengine', id).aspects!) {
      const [w, h] = aspect.apiSize!.split('x').map(Number);
      const [ratioW, ratioH] = aspect.value.split(':').map(Number);
      expect(Math.abs(w / h / (ratioW / ratioH) - 1), `${id}: ${aspect.value}`).toBeLessThanOrEqual(
        0.005,
      );
      expect(w * h).toBeGreaterThanOrEqual(3686400);
      expect(w * h).toBeLessThanOrEqual(4624220);
    }
  },
);
it('keeps legacy GPT Image fixed sizes', () => {
  expect(openAIImageCapabilities('gpt-image-1').aspects.map((item) => item.value)).toEqual([
    '1:1',
    '3:2',
    '2:3',
  ]);
});
