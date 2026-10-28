import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelDescriptor, ProviderConfig } from '@/types';
import {
  googleImageCapabilities,
  normalizeImageParams,
  xaiImageCapabilities,
} from '@/providers/model-capabilities';
import { openaiAdapter } from '@/providers/openai';
import { xaiAdapter } from '@/providers/xai';

const config = (baseUrl = 'https://api.x.ai/v1'): ProviderConfig => ({
  apiKey: 'xai-test-key',
  baseUrl,
  rememberKey: false,
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('xAI Grok image adapter', () => {
  it('discovers Grok image and text models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: 'grok-2-image' },
            { id: 'grok-imagine-image' },
            { id: 'grok-4' },
            { id: 'embedding-v1' },
          ],
        }),
      ),
    );

    const models = await xaiAdapter.listModels(config(), { useProxy: false });
    expect(models.map((model) => [model.modelId, model.kind])).toEqual([
      ['grok-imagine-image', 'image'],
      ['grok-2-image', 'image'],
      ['grok-4', 'text'],
    ]);
    const image = models[0];
    expect(image.providerId).toBe('xai');
    expect(image.capabilities.image?.aspects?.map((aspect) => aspect.value)).toContain('3:2');
    expect(image.capabilities.image?.backgrounds).toBeUndefined();
    expect(image.capabilities.imageEditing).toBe(false);
  });

  it('sends aspect ratio and returns inline images', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: 'aGVsbG8=', revised_prompt: 'revised' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const model: ModelDescriptor = {
      key: 'xai::grok-2-image',
      providerId: 'xai',
      modelId: 'grok-2-image',
      label: 'grok-2-image',
      kind: 'image',
      capabilities: {
        vision: false,
        tools: false,
        imageGeneration: true,
        image: xaiImageCapabilities('grok-2-image'),
      },
    };
    const images = await xaiAdapter.generateImage(
      config(),
      model,
      {
        prompt: 'a black orb over fog',
        params: {
          aspect: '3:2',
          background: 'transparent',
          quality: 'high',
          count: 2,
        },
        references: [],
      },
      { useProxy: false },
    );

    expect(images[0]).toMatchObject({
      dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
      mimeType: 'image/jpeg',
      revisedPrompt: 'revised',
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.x.ai/v1/images/generations');
    expect(body).not.toHaveProperty('aspect_ratio');
    expect(body).toMatchObject({
      model: 'grok-2-image',
      n: 2,
      response_format: 'b64_json',
    });
  });
});

describe('Gemini Banana capabilities', () => {
  it('exposes the full ratio set and never enables transparency', () => {
    const caps = googleImageCapabilities('gemini-2.5-flash-image', 'Nano Banana');
    expect(caps.aspects?.map((aspect) => aspect.value)).toEqual(
      expect.arrayContaining(['1:1', '3:2', '2:3', '16:9', '9:16', '21:9']),
    );
    expect(caps.backgrounds).toBeUndefined();
    expect(caps.imageSizes).toBeUndefined();

    const normalized = normalizeImageParams(
      { aspect: '9:16', background: 'transparent', count: 8 },
      caps,
    );
    expect(normalized.aspect).toBe('9:16');
    expect(normalized.background).toBeUndefined();
    expect(normalized.count).toBe(1);
  });
});

describe('custom API endpoint', () => {
  it.each([false, true])('uses the configured address when proxy=%s', async (useProxy) => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'gpt-4.1' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const models = await openaiAdapter.listModels(
      {
        apiKey: 'test-key',
        baseUrl: 'https://gateway.example/api/v1/',
        rememberKey: false,
      },
      { useProxy },
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('https://gateway.example/api/v1/models');
    expect(headers.has('x-aigc-proxy-target')).toBe(false);
    expect(headers.get('Authorization')).toBe('Bearer test-key');
    expect(models.some((model) => model.modelId === 'gpt-4.1')).toBe(true);
  });
});
