import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRoundInput, ProviderConfig } from '@/types';
import { openaiAdapter } from '@/providers/openai';
import { anthropicAdapter } from '@/providers/anthropic';
import { googleAdapter } from '@/providers/google';
import { googleImageCapabilities } from '@/providers/model-capabilities';
import { readEventStream } from '@/providers/shared';

const config: ProviderConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://api.example.test',
  rememberKey: false,
};

function sseResponse(chunks: unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        const data = typeof chunk === 'string' ? chunk : JSON.stringify(chunk);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function baseInput(overrides: Partial<ChatRoundInput> = {}): ChatRoundInput {
  return {
    system: 'You are an agent.',
    messages: [{ role: 'user', content: 'Make a poster.' }],
    tools: [
      {
        name: 'generate_image',
        description: 'Generate an image',
        parameters: {
          type: 'object',
          properties: { prompt: { type: 'string' } },
          required: ['prompt'],
        },
      },
    ],
    continuations: [],
    onText: () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI streaming tool calls', () => {
  it.each(['length', 'content_filter'])(
    'rejects %s termination even when tool arguments are valid JSON',
    async (finishReason) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          sseResponse([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        function: { name: 'generate_image', arguments: '{"prompt":"cat"}' },
                      },
                    ],
                  },
                },
              ],
            },
            { choices: [{ delta: {}, finish_reason: finishReason }] },
            '[DONE]',
          ]),
        ),
      );
      await expect(
        openaiAdapter.streamChat(
          config,
          {
            key: 'openai::gpt-4o',
            providerId: 'openai',
            modelId: 'gpt-4o',
            label: 'gpt-4o',
            kind: 'text',
            capabilities: { vision: true, tools: true, imageGeneration: false },
          },
          baseInput(),
          { useProxy: false },
        ),
      ).rejects.toThrow();
    },
  );

  it.each([false, true])(
    'requires a completed tool stream while accepting DONE-only gateways: %s',
    async (done) => {
      const chunk = {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'generate_image', arguments: '{"prompt":"cat"}' },
                },
              ],
            },
          },
        ],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => sseResponse(done ? [chunk, '[DONE]'] : [chunk])),
      );
      const request = openaiAdapter.streamChat(
        config,
        {
          key: 'openai::gpt-4o',
          providerId: 'openai',
          modelId: 'gpt-4o',
          label: 'gpt-4o',
          kind: 'text',
          capabilities: { vision: true, tools: true, imageGeneration: false },
        },
        baseInput(),
        { useProxy: false },
      );
      if (done)
        await expect(request).resolves.toMatchObject({
          toolCalls: [{ name: 'generate_image', arguments: { prompt: 'cat' } }],
        });
      else await expect(request).rejects.toThrow('提前结束');
    },
  );

  it('assembles text deltas and fragmented tool arguments', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { choices: [{ delta: { content: 'I will ' } }] },
        { choices: [{ delta: { content: 'generate it.' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: { name: 'generate_image', arguments: '{"prompt":"a ' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'quiet sea"}' } }],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const text: string[] = [];
    const result = await openaiAdapter.streamChat(
      config,
      {
        key: 'openai::gpt-4o',
        providerId: 'openai',
        modelId: 'gpt-4o',
        label: 'gpt-4o',
        kind: 'text',
        capabilities: { vision: true, tools: true, imageGeneration: false },
      },
      baseInput({ onText: (chunk) => text.push(chunk) }),
      { useProxy: false },
    );
    expect(text.join('')).toBe('I will generate it.');
    expect(result.text).toBe('I will generate it.');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'generate_image', arguments: { prompt: 'a quiet sea' } },
    ]);
    expect(result.rawAssistant).toMatchObject({
      tool_calls: [{ id: 'call_1', function: { name: 'generate_image' } }],
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.tools[0].function.name).toBe('generate_image');
    expect(body.stream).toBe(true);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-key');
  });
});

describe('Anthropic streaming content blocks', () => {
  it('parses text and tool use events and sends browser access headers', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking.' } },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'generate_image', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"prompt":"night city"}' },
        },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_stop' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await anthropicAdapter.streamChat(
      config,
      {
        key: 'anthropic::claude',
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        label: 'Claude',
        kind: 'text',
        capabilities: { vision: true, tools: true, imageGeneration: false },
      },
      baseInput(),
      { useProxy: false },
    );
    expect(result.text).toBe('Checking.');
    expect(result.toolCalls).toEqual([
      { id: 'toolu_1', name: 'generate_image', arguments: { prompt: 'night city' } },
    ]);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.tools[0]).toMatchObject({ name: 'generate_image' });
  });
});

describe('Google Gemini streaming and image generation', () => {
  it('streams text chunks and preserves function calls', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { candidates: [{ content: { parts: [{ text: 'A ' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'poster.' }] } }] },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'generate_image',
                      args: { prompt: 'winter sea' },
                    },
                    thoughtSignature: 'sig',
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await googleAdapter.streamChat(
      config,
      {
        key: 'google::gemini-2.5-pro',
        providerId: 'google',
        modelId: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        kind: 'text',
        capabilities: { vision: true, tools: true, imageGeneration: false },
      },
      baseInput(),
      { useProxy: false },
    );
    expect(result.text).toBe('A poster.');
    expect(result.toolCalls[0]).toMatchObject({
      name: 'generate_image',
      arguments: { prompt: 'winter sea' },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.tools[0].functionDeclarations[0].parameters.type).toBe('OBJECT');
    expect(body.tools[0].functionDeclarations[0].parameters.properties.prompt.type).toBe('STRING');
  });

  it('parses inline image output from generateContent', async () => {
    const imagePayload = 'aGVsbG8=';
    const fetchMock = vi.fn(async () =>
      jsonResponseForTest({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: imagePayload } }],
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const model = {
      key: 'google::gemini-3-pro-image-preview',
      providerId: 'google' as const,
      modelId: 'gemini-3-pro-image-preview',
      label: 'Gemini 3 Pro Image',
      kind: 'image' as const,
      capabilities: {
        vision: false,
        tools: false,
        imageGeneration: true,
        imageEditing: true,
        image: googleImageCapabilities('gemini-3-pro-image-preview'),
      },
    };
    const images = await googleAdapter.generateImage(
      config,
      model,
      {
        prompt: 'A blue form',
        params: {
          aspect: '21:9',
          count: 1,
          imageSize: '4K',
        },
        references: [],
      },
      { useProxy: false },
    );
    expect(images[0]).toEqual({
      dataUrl: `data:image/png;base64,${imagePayload}`,
      mimeType: 'image/png',
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '21:9', imageSize: '4K' });
  });
});

function jsonResponseForTest(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SSE stream boundaries', () => {
  it('handles split UTF-8 and CRLF, then cancels an open stream at DONE', async () => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode(
      'data: 喵\r\ndata: second\r\n\r\ndata: [DONE]\r\n\r\ndata: ignored\r\n\r\n',
    );
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        },
        cancel,
      }),
    );
    const data: string[] = [];
    await readEventStream(response, (value) => data.push(value));
    expect(data).toEqual(['喵\nsecond']);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  }, 1000);

  it('cancels the stream when a consumer rejects a malformed event', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: broken\n\n'));
        },
        cancel,
      }),
    );
    await expect(
      readEventStream(response, () => {
        throw new Error('invalid event');
      }),
    ).rejects.toThrow('invalid event');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });
});
