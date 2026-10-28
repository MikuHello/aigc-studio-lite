import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapters } from '@/providers';
import { runAgentTurn } from '@/agent/runAgent';
import { customModel } from '@/lib/customModels';
import type { AgentHistoryMessage } from '@/types';

afterEach(() => vi.unstubAllGlobals());

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

it('keeps text follow-ups working across vision model switches without losing historical images', async () => {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const image = { mimeType: 'image/png', dataUrl: 'data:image/png;base64,YQ==' };
  const history: AgentHistoryMessage[] = [
    { role: 'user', content: 'Describe this image', images: [image] },
    { role: 'assistant', content: 'A reference image' },
  ];
  const savedHistory = structuredClone(history);
  for (const vision of [true, false, true]) {
    const textModel = customModel({
      provider: 'openai',
      id: vision ? 'vision-chat' : 'plain-chat',
      label: '',
      kind: 'text',
      vision,
      tools: false,
      references: false,
    });
    const options = {
      textModel,
      configs: {
        openai: {
          baseUrl: 'https://compatible.example.test/v1',
          apiKey: 'test-only',
          rememberKey: false,
        },
      },
      useProxy: false,
      history,
      userPrompt: 'Continue the discussion',
      userImages: [],
      callbacks: {
        onText: vi.fn(),
        onActivity: vi.fn(),
        onActivityPatch: vi.fn(),
        onGeneratedImages: vi.fn(),
      },
    };
    await expect(runAgentTurn(options)).resolves.toMatchObject({ text: 'ok' });
    const messages = requests.at(-1)!.messages.filter((message) => message.role !== 'system');
    expect(messages).toEqual([
      {
        role: 'user',
        content: vision
          ? [
              { type: 'text', text: 'Describe this image' },
              { type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } },
            ]
          : 'Describe this image',
      },
      { role: 'assistant', content: 'A reference image' },
      { role: 'user', content: 'Continue the discussion' },
    ]);
    if (!vision) {
      const calls = fetchMock.mock.calls.length;
      await expect(runAgentTurn({ ...options, userImages: [image] })).rejects.toThrow(
        '当前模型未启用图片理解能力',
      );
      expect(fetchMock).toHaveBeenCalledTimes(calls);
    }
  }
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(history).toEqual(savedHistory);
});
