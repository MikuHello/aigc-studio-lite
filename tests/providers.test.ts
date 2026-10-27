import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@/types';
import { openaiAdapter } from '@/providers/openai';
import { xaiAdapter } from '@/providers/xai';
import { anthropicAdapter } from '@/providers/anthropic';
import { googleAdapter } from '@/providers/google';
import {
  normalizeImageParams,
  openAIImageCapabilities,
  googleImageCapabilities,
} from '@/providers/model-capabilities';

const config = (baseUrl: string): ProviderConfig => ({
  apiKey: 'test-key',
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

describe('OpenAI model discovery', () => {
  it('separates image generators, multimodal text models and unsupported endpoints', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'gpt-image-1' },
          { id: 'gpt-image-1-mini' },
          { id: 'dall-e-3' },
          { id: 'gpt-4o' },
          { id: 'gpt-3.5-turbo' },
          { id: 'text-embedding-3-large' },
          { id: 'whisper-1' },
          { id: 'dall-e-2' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await openaiAdapter.listModels(config('https://api.openai.com/v1'), {
      useProxy: false,
    });
    const images = models.filter((model) => model.kind === 'image').map((model) => model.modelId);
    const texts = models.filter((model) => model.kind === 'text').map((model) => model.modelId);

    expect(images).toEqual(['gpt-image-1-mini']);
    expect(texts).toContain('gpt-4o');
    expect(texts).not.toContain('gpt-3.5-turbo');
    expect(texts).not.toContain('whisper-1');
    expect(texts).not.toContain('text-embedding-3-large');

    const visionModel = models.find((model) => model.modelId === 'gpt-4o');
    expect(visionModel?.capabilities.vision).toBe(true);
    expect(visionModel?.capabilities.tools).toBe(true);

    const imageModel = models.find((model) => model.modelId === 'gpt-image-1-mini');
    expect(imageModel?.capabilities.vision).toBe(false);
    expect(imageModel?.capabilities.imageGeneration).toBe(true);
    expect(imageModel?.capabilities.imageEditing).toBe(true);
    expect(imageModel?.capabilities.image?.backgrounds?.map((item) => item.value)).toContain(
      'transparent',
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/models');
  });

  it('classifies authentication failures with their HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { message: 'Incorrect API key provided: sk-secret' } }, 401),
      ),
    );
    await expect(
      openaiAdapter.listModels(config('https://api.openai.com/v1'), { useProxy: false }),
    ).rejects.toMatchObject({ kind: 'auth', status: 401 });
  });
});

describe('Anthropic and Google model discovery', () => {
  it('marks Anthropic models as multimodal tool users', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'claude-sonnet-4-5-20250929',
              display_name: 'Claude Sonnet 4.5',
            },
          ],
          has_more: false,
        }),
      ),
    );
    const models = await anthropicAdapter.listModels(config('https://api.anthropic.com/v1'), {
      useProxy: false,
    });
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      kind: 'text',
      label: 'Claude Sonnet 4.5',
      capabilities: { vision: true, tools: true, imageGeneration: false },
    });
  });

  it('distinguishes Gemini image models from text and filters embeddings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          models: [
            {
              name: 'models/gemini-3-pro-image-preview',
              displayName: 'Gemini 3 Pro Image',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/imagen-4.0-generate-001',
              displayName: 'Imagen 4',
              supportedGenerationMethods: ['predict'],
            },
            {
              name: 'models/gemini-2.5-pro',
              displayName: 'Gemini 2.5 Pro',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/text-embedding-004',
              displayName: 'Embedding 004',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }),
      ),
    );
    const models = await googleAdapter.listModels(
      config('https://generativelanguage.googleapis.com/v1beta'),
      { useProxy: false },
    );
    expect(models.map((model) => [model.modelId, model.kind])).toEqual([
      ['gemini-3-pro-image-preview', 'image'],
      ['gemini-2.5-pro', 'text'],
    ]);
    expect(models[1].capabilities.vision).toBe(true);
    expect(models[1].capabilities.tools).toBe(true);
  });
});

describe('image parameter adaptation', () => {
  it('keeps transparent background only for GPT Image models', () => {
    const gpt = openAIImageCapabilities('gpt-image-1');
    expect(
      normalizeImageParams(
        {
          aspect: '2:3',
          background: 'transparent',
          quality: 'high',
          outputFormat: 'webp',
          count: 3,
        },
        gpt,
      ),
    ).toMatchObject({
      aspect: '2:3',
      background: 'transparent',
      quality: 'high',
      outputFormat: 'webp',
      count: 3,
    });

    const dalle = openAIImageCapabilities('dall-e-3');
    const normalized = normalizeImageParams(
      {
        aspect: '1:1',
        background: 'transparent',
        count: 5,
      },
      dalle,
    );
    expect(normalized.background).toBeUndefined();
    expect(normalized.count).toBe(1);
  });

  it('supports Gemini 3 image sizes and aspect ratios', () => {
    const caps = googleImageCapabilities('gemini-3-pro-image-preview');
    expect(caps.imageSizes).toEqual(['1K', '2K', '4K']);
    expect(caps.aspects?.map((aspect) => aspect.value)).toContain('21:9');
    expect(caps.supportsEdit).toBe(true);
  });
});

describe('generated image download cancellation', () => {
  it.each([
    ['openai', openaiAdapter],
    ['xai', xaiAdapter],
  ] as const)('passes cancellation through the %s result download', async (providerId, adapter) => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return jsonResponse({ data: [{ url: 'https://images.example.test/result.png' }] });
      }
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      throw controller.signal.reason;
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      adapter.generateImage(
        config('https://api.example.test/v1'),
        {
          key: `${providerId}::image`,
          providerId,
          modelId: 'image',
          label: 'Image',
          kind: 'image',
          capabilities: { vision: false, tools: false, imageGeneration: true, image: {} },
        },
        {
          prompt: 'cat',
          params: { aspect: '1:1', count: 1 },
          references: [],
          signal: controller.signal,
        },
        { useProxy: false },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
