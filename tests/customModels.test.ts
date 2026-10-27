import { describe, expect, it } from 'vitest';
import { customModel, suggestCustomModel } from '@/lib/customModels';

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
    expect(
      customModel({ ...input, kind: 'image', references: true, imageProfile: 'gpt-image-1.5' }),
    ).toMatchObject({
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
  it.each([
    ['google', 'gemini-2.5-flash'],
    ['xai', 'grok-4'],
    ['volcengine', 'doubao-seed-1-6'],
    ['anthropic', 'claude-sonnet'],
  ] as const)(
    'uses %s text capabilities for manual suggestions without overriding explicit opt-outs',
    (provider, id) => {
      expect(suggestCustomModel(provider, id)).toMatchObject({
        kind: 'text',
        vision: true,
        tools: true,
      });
      expect(
        customModel({ ...input, provider, id, vision: false, tools: false }).capabilities,
      ).toMatchObject({ vision: false, tools: false });
    },
  );
});
