import { afterEach, expect, it, vi } from 'vitest';
import { reviewPrompt } from '@/agent/review';
import { openaiAdapter } from '@/providers/openai';
import { DEFAULT_REVIEW_SETTINGS } from '@/lib/reviewSettings';
import type { ModelDescriptor } from '@/types';
const model: ModelDescriptor = {
  key: 'text',
  providerId: 'openai',
  modelId: 'text',
  label: 'Text',
  kind: 'text',
  capabilities: { vision: true, tools: false, imageGeneration: false },
};
const input = {
  prompt: 'cat',
  textModel: model,
  imageModel: { ...model, label: 'Target image' },
  config: { apiKey: 'test', baseUrl: 'https://example.test/v1', rememberKey: false },
  useProxy: false,
  aspectRatio: '3:2',
  references: [{ dataUrl: 'data:image/png;base64,abc', mimeType: 'image/png' }],
};
afterEach(() => vi.restoreAllMocks());
function mock() {
  return vi
    .spyOn(openaiAdapter, 'streamChat')
    .mockResolvedValue({ text: 'cat rewritten', toolCalls: [], rawAssistant: {} });
}
it('uses default rules, sends target and ratio, and withholds reference images by default', async () => {
  const spy = mock();
  await reviewPrompt(input);
  const message = spy.mock.calls[0][2].messages[0];
  expect(message.content).toContain(DEFAULT_REVIEW_SETTINGS.rules);
  expect(message.content).toContain('目标模型：Target image');
  expect(message.content).toContain('画幅：3:2');
  expect(message.images).toBeUndefined();
  expect(message.content).not.toContain('已附上');
});
it('uses custom rules literally and omits disabled context', async () => {
  const spy = mock();
  await reviewPrompt({
    ...input,
    settings: {
      ...DEFAULT_REVIEW_SETTINGS,
      rules: '保留 {{ prompt }} 字样',
      passTargetModel: false,
      passAspectRatio: false,
    },
  });
  const message = spy.mock.calls[0][2].messages[0];
  expect(message.content).toContain('保留 {{ prompt }} 字样');
  expect(message.content).not.toContain('目标模型：');
  expect(message.content).not.toContain('画幅：');
});
it('passes actual references only when enabled and refuses unsupported vision', async () => {
  const spy = mock();
  const settings = { ...DEFAULT_REVIEW_SETTINGS, useReferenceImages: true };
  await reviewPrompt({ ...input, settings });
  expect(spy.mock.calls[0][2].messages[0].images).toEqual(input.references);
  await expect(
    reviewPrompt({
      ...input,
      settings,
      textModel: { ...model, capabilities: { ...model.capabilities, vision: false } },
    }),
  ).rejects.toThrow('不支持识图');
  expect(spy).toHaveBeenCalledTimes(1);
});
