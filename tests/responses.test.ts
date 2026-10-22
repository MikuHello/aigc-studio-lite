import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRoundInput, ModelDescriptor, ProviderConfig } from '@/types';
import { openaiAdapter } from '@/providers/openai';

const config: ProviderConfig = {
  apiKey: 'test-only',
  baseUrl: 'https://gateway.example/v1',
  rememberKey: false,
  chatApi: 'responses',
};
const model: ModelDescriptor = {
  key: 'openai::custom',
  providerId: 'openai',
  modelId: 'custom',
  label: 'custom',
  kind: 'text',
  capabilities: { tools: true, vision: true, imageGeneration: false },
};
const input = (): ChatRoundInput => ({
  system: 'system',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [],
  continuations: [],
  onText: vi.fn(),
});
const sse = (events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
afterEach(() => vi.unstubAllGlobals());

describe('Responses transport', () => {
  it('streams text and routes to /responses with stateless storage and cancellation', async () => {
    const fetcher = vi.fn(async () =>
      sse([
        { type: 'response.output_text.delta', delta: 'Hello' },
        { type: 'response.output_text.delta', delta: ' world' },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello world' }] }],
          },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetcher);
    const request = input();
    request.signal = new AbortController().signal;
    const result = await openaiAdapter.streamChat(config, model, request, { useProxy: false });
    expect(result.text).toBe('Hello world');
    expect(request.onText).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gateway.example/v1/responses');
    expect(init.signal).toBe(request.signal);
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'custom',
      store: false,
      stream: true,
      instructions: 'system',
    });
  });
  it('keeps reasoning and function call items for the tool continuation and sends image input', async () => {
    const output = [
      { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'encrypted' },
      { type: 'function_call', call_id: 'call_1', name: 'draw', arguments: '{"prompt":"cat"}' },
    ];
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'completed', output }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const request = input();
    request.messages[0].images = [{ mimeType: 'image/png', dataUrl: 'data:image/png;base64,abc' }];
    request.tools = [
      {
        name: 'draw',
        description: 'Draw',
        parameters: { type: 'object', properties: { prompt: { type: 'string' } } },
      },
    ];
    const first = await openaiAdapter.streamChat(config, model, request, { useProxy: false });
    expect(first.toolCalls).toEqual([{ id: 'call_1', name: 'draw', arguments: { prompt: 'cat' } }]);
    request.continuations = [
      {
        assistant: first.rawAssistant,
        results: [{ callId: 'call_1', name: 'draw', content: 'done' }],
      },
    ];
    await openaiAdapter.streamChat(config, model, request, { useProxy: false });
    const [, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.input).toContainEqual(output[0]);
    expect(body.input).toContainEqual(output[1]);
    expect(body.input).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: 'done',
    });
    expect(body.input[0].content[1]).toMatchObject({
      type: 'input_image',
      image_url: 'data:image/png;base64,abc',
    });
    expect(body.tools[0]).toMatchObject({ type: 'function', name: 'draw', strict: false });
  });
  it.each(['response.failed', 'response.incomplete', 'error'])(
    'surfaces %s instead of reporting a successful empty reply',
    async (type) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          sse([
            {
              type,
              message: 'failed',
              response: { status: type.split('.')[1], error: { message: 'failed' } },
            },
          ]),
        ),
      );
      await expect(
        openaiAdapter.streamChat(config, model, input(), { useProxy: false }),
      ).rejects.toThrow();
    },
  );
  it('rejects a stream that ends before response.completed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([{ type: 'response.output_text.delta', delta: 'partial' }])),
    );
    await expect(
      openaiAdapter.streamChat(config, model, input(), { useProxy: false }),
    ).rejects.toThrow('提前结束');
  });
  it('keeps Chat Completions as the default transport', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    await openaiAdapter.streamChat({ ...config, chatApi: undefined }, model, input(), {
      useProxy: false,
    });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://gateway.example/v1/chat/completions',
    );
  });
});

describe('automatic OpenAI protocol selection', () => {
  const automatic = (suffix: string): ProviderConfig => ({
    ...config,
    baseUrl: `https://${suffix}.example/v1`,
    chatApi: 'auto',
  });
  it('falls back on endpoint rejection and remembers the working protocol', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/chat/completions')
        ? new Response(JSON.stringify({ error: { message: 'Endpoint not found' } }), {
            status: 404,
          })
        : new Response(
            JSON.stringify({
              status: 'completed',
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }] }],
            }),
          ),
    );
    vi.stubGlobal('fetch', fetcher);
    const settings = automatic('autodetect');
    expect(
      (await openaiAdapter.streamChat(settings, model, input(), { useProxy: false })).text,
    ).toBe('hello');
    await openaiAdapter.streamChat(settings, model, input(), { useProxy: false });
    expect(fetcher.mock.calls.map(([url]) => url.split('/').pop())).toEqual([
      'completions',
      'responses',
      'responses',
    ]);
  });
  it.each([401, 429, 500])('does not retry HTTP %s', async (status) => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'failure' } }), { status }),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      openaiAdapter.streamChat(automatic(`error-${status}`), model, input(), { useProxy: false }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('pins tool continuation to its original protocol', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 }),
    );
    vi.stubGlobal('fetch', fetcher);
    const request = input();
    request.continuations = [
      {
        assistant: {
          output: [{ type: 'function_call', call_id: 'c', name: 'draw', arguments: '{}' }],
        },
        results: [{ callId: 'c', name: 'draw', content: 'done' }],
      },
    ];
    await expect(
      openaiAdapter.streamChat(automatic('continuation'), model, request, { useProxy: false }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://continuation.example/v1/responses',
    );
  });
});
