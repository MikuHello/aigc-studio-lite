import { describe, expect, it } from 'vitest';
import { customModel, mergeDiscoveredModels } from '@/lib/customModels';

const input = {
  provider: 'openai' as const,
  id: 'custom-chat',
  label: 'My model',
  kind: 'text' as const,
  vision: true,
  tools: false,
  references: false,
};

describe('manual model configuration', () => {
  it('preserves explicit IDs and capabilities for aliases not recognized by discovery', () => {
    expect(customModel(input)).toMatchObject({
      key: 'openai::custom-chat',
      modelId: 'custom-chat',
      label: 'My model',
      manual: true,
      capabilities: { vision: true, tools: false, imageGeneration: false },
    });
    expect(customModel({ ...input, kind: 'image', references: true })).toMatchObject({
      kind: 'image',
      capabilities: {
        vision: false,
        imageGeneration: true,
        imageEditing: true,
        image: { supportsEdit: true },
      },
    });
  });
  it('rejects empty IDs and unsupported image protocols', () => {
    expect(() => customModel({ ...input, id: ' ' })).toThrow();
    expect(() => customModel({ ...input, provider: 'anthropic', kind: 'image' })).toThrow();
  });
  it('keeps manual overrides and manually added models when refreshing discovery', () => {
    const manual = customModel(input);
    const extra = customModel({ ...input, id: 'private-image', kind: 'image' });
    const discovered = { ...manual, label: 'Discovered name', manual: undefined };
    const stale = { ...discovered, key: 'openai::old' };
    expect(mergeDiscoveredModels([discovered], [manual, extra, stale])).toEqual([manual, extra]);
  });
});
