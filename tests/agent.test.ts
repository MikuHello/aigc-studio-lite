import { describe, expect, it, vi } from 'vitest';
import { adapters } from '@/providers';
import { runAgentTurn } from '@/agent/runAgent';
import { customModel } from '@/lib/customModels';

describe('agent capability boundaries', () => {
  it('keeps plain chat working when an image model is selected but tools are disabled', async () => {
    const stream = vi.spyOn(adapters.openai, 'streamChat').mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      rawAssistant: {},
    });
    try {
      const textModel = customModel({
        provider: 'openai',
        id: 'plain-chat',
        label: '',
        kind: 'text',
        vision: false,
        tools: false,
        references: false,
      });
      await runAgentTurn({
        textModel,
        imageModel: customModel({
          provider: 'openai',
          id: 'gpt-image-2.5',
          label: '',
          kind: 'image',
          vision: false,
          tools: false,
          references: false,
        }),
        configs: {
          openai: {
            baseUrl: 'https://compatible.example.test/v1',
            apiKey: 'test-only',
            rememberKey: false,
          },
        },
        useProxy: false,
        history: [],
        userPrompt: 'hello',
        userImages: [],
        callbacks: {
          onText: () => {},
          onActivity: () => {},
          onActivityPatch: () => {},
          onGeneratedImages: () => {},
        },
      });
      expect(stream).toHaveBeenCalledOnce();
      expect(stream.mock.calls[0][2].tools).toEqual([]);
      expect(stream.mock.calls[0][2].system).toContain('未接入');
    } finally {
      stream.mockRestore();
    }
  });
});
