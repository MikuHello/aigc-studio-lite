import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapters } from '@/providers';
import { customModel } from '@/lib/customModels';
import { availableModels } from '@/lib/connections';
import {
  imageCapabilitiesFor,
  modelSupportReason,
  refreshModelCapabilities,
} from '@/providers/model-support';
import type { ModelDescriptor, ProviderId } from '@/types';

const config = (baseUrl = 'https://compatible.example.test/v1') => ({
  baseUrl,
  apiKey: 'test-only',
  rememberKey: false,
});
const imageModel = (provider: ProviderId, id: string, imageProfile?: string) =>
  customModel({
    provider,
    id,
    imageProfile,
    label: '',
    kind: 'image',
    vision: false,
    tools: false,
    references: true,
  });
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const reference = { dataUrl: 'data:image/png;base64,YQ==', mimeType: 'image/png' };
const openaiImageResponse = { data: [{ b64_json: 'YQ==' }] };
const arkImageResponse = { data: [{ b64_json: 'Yg==' }] };
const xaiImageResponse = { data: [{ b64_json: 'Yw==' }] };
const geminiImageResponse = {
  candidates: [
    {
      content: {
        parts: [
          { thought: true, inlineData: { data: 'dGhvdWdodA==', mimeType: 'image/png' } },
          { inlineData: { data: 'YQ==', mimeType: 'image/png' } },
        ],
      },
    },
  ],
};
function mockImages(payload: unknown) {
  const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => json(payload));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe('documented image request contracts', () => {
  it.each([
    ['gemini-2.5-flash-image', undefined],
    ['gemini-3.1-flash-lite-image', '1K'],
    ['gemini-3.1-flash-image', '4K'],
    ['gemini-nano-banana-2.1', '4K'],
  ])(
    'uses the supported image size for %s, independent of its display name',
    async (id, imageSize) => {
      const fetch = mockImages(geminiImageResponse);
      const model = { ...imageModel('google', id!), label: 'Nano Banana Pro 4K' };
      const images = await adapters.google.generateImage(
        config(),
        model,
        {
          prompt: 'cat',
          params: { aspect: '16:9', imageSize: '4K', count: 4 },
          references: [reference],
        },
        { useProxy: false },
      );
      const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
      expect(String(fetch.mock.calls[0][0])).toContain(`models/${id}:generateContent`);
      expect(body.generationConfig).toMatchObject({
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9' },
      });
      expect(body.generationConfig.imageConfig.imageSize).toBe(imageSize);
      expect(body.generationConfig).not.toHaveProperty('candidateCount');
      expect(images).toHaveLength(1);
      expect(images[0].dataUrl).toBe('data:image/png;base64,YQ==');
    },
  );

  it.each([
    ['auto', 'auto'],
    ['9:16', '864x1536'],
  ])('sends representative %s GPT Image sizing and output options', async (aspect, size) => {
    const fetch = mockImages(openaiImageResponse);
    await adapters.openai.generateImage(
      config(),
      imageModel('openai', 'gpt-image-2.5-flare-auto'),
      {
        prompt: 'cat',
        params: { aspect, count: 4, background: 'transparent', outputFormat: 'webp' },
        references: [],
      },
      { useProxy: false },
    );
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ size, n: 4, background: 'transparent', output_format: 'webp' });
    expect(body).not.toHaveProperty('response_format');
  });

  it.each([false, true])(
    'keeps transparent output bytes and MIME consistent for edits=%s',
    async (editing) => {
      const fetch = mockImages(openaiImageResponse);
      const images = await adapters.openai.generateImage(
        config(),
        imageModel('openai', 'gpt-image-2.5-flare'),
        {
          prompt: 'cutout',
          params: {
            aspect: 'auto',
            background: 'transparent',
            outputFormat: 'jpeg',
            quality: 'max',
            count: 99,
          },
          references: editing ? [reference] : [],
        },
        { useProxy: false },
      );
      const raw = fetch.mock.calls[0][1]?.body;
      const body =
        raw instanceof FormData ? Object.fromEntries(raw.entries()) : JSON.parse(String(raw));
      expect(body).toMatchObject({
        background: 'transparent',
        output_format: 'png',
        quality: 'max',
      });
      expect(Number(body.n)).toBe(4);
      expect(images[0].mimeType).toBe('image/png');
      expect(String(fetch.mock.calls[0][0])).toContain(
        editing ? '/images/edits' : '/images/generations',
      );
    },
  );

  it('does not display or send fictitious aspect, quality, or editing options for generic compatible images', async () => {
    const fetch = mockImages(openaiImageResponse);
    const model = imageModel('openai', 'flux-private');
    expect(model.capabilities.image).toMatchObject({ aspects: [], supportsEdit: false });
    await adapters.openai.generateImage(
      config(),
      model,
      { prompt: 'cat', params: { aspect: '16:9', quality: 'high', count: 4 }, references: [] },
      { useProxy: false },
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      model: 'flux-private',
      prompt: 'cat',
      n: 1,
    });
  });

  it('sends Seedream JSON references with a representative 2K size', async () => {
    const fetch = mockImages(arkImageResponse);
    const model = imageModel('volcengine', 'ep-private', 'doubao-seedream-5-0');
    const images = await adapters.volcengine.generateImage(
      config(),
      model,
      {
        prompt: 'cat',
        params: { aspect: '1:1', count: 4, outputFormat: 'webp' },
        references: [reference],
      },
      { useProxy: false },
    );
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: 'ep-private',
      image: reference.dataUrl,
      response_format: 'b64_json',
      size: '2048x2048',
    });
    expect(body).not.toHaveProperty('n');
    expect(body).not.toHaveProperty('output_format');
    expect(images[0].dataUrl).toContain('Yg==');
  });

  it('sends xAI ratios only for Imagine and labels the JPEG response correctly', async () => {
    const fetch = mockImages(xaiImageResponse);
    for (const id of ['grok-imagine-image-2.0', 'grok-2-image']) {
      const images = await adapters.xai.generateImage(
        config(),
        imageModel('xai', id),
        { prompt: 'cat', params: { aspect: '16:9', count: 2 }, references: [] },
        { useProxy: false },
      );
      const body = JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body));
      expect(body.aspect_ratio).toBe(id.includes('imagine') ? '16:9' : undefined);
      expect(images[0].mimeType).toBe('image/jpeg');
      expect(images[0].dataUrl).toBe('data:image/jpeg;base64,Yw==');
    }
  });
});

describe('unsupported choices and stale configurations', () => {
  it.each([
    ['openai', 'dall-e-3', 'https://api.openai.com/v1'],
    ['openai', 'gpt-image-1', 'https://api.openai.com/v1'],
    ['google', 'imagen-4.0-generate-001', 'https://generativelanguage.googleapis.com/v1beta'],
  ] as const)(
    'blocks retired %s/%s only on the official service before making requests',
    async (provider, id, baseUrl) => {
      const fetch = mockImages(openaiImageResponse);
      const model = imageModel(provider, id);
      expect(modelSupportReason(model, config())).toBeUndefined();
      expect(availableModels([model], { [provider]: config(baseUrl) })).toEqual([]);
      await expect(
        adapters[provider].generateImage(
          config(baseUrl),
          model,
          { prompt: 'cat', params: { aspect: 'auto', count: 1 }, references: [] },
          { useProxy: false },
        ),
      ).rejects.toThrow('下线');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('requires an explicit Seedream specification for an opaque endpoint instead of guessing', async () => {
    const fetch = mockImages(openaiImageResponse);
    await expect(
      adapters.volcengine.generateImage(
        config(),
        imageModel('volcengine', 'ep-unknown'),
        { prompt: 'cat', params: { aspect: 'auto', count: 1 }, references: [] },
        { useProxy: false },
      ),
    ).rejects.toThrow('规格');
    expect(fetch).not.toHaveBeenCalled();
    expect(
      modelSupportReason(imageModel('volcengine', 'ep-unknown', 'doubao-seedream-4-0')),
    ).toBeUndefined();
  });

  it('ignores forged capability flags and prevents references on Imagen or xAI', async () => {
    const fetch = mockImages(openaiImageResponse);
    for (const [provider, id] of [
      ['google', 'imagen-4.0-generate-001'],
      ['xai', 'grok-imagine-image'],
    ] as const) {
      const model = imageModel(provider, id);
      model.capabilities.image!.supportsEdit = true;
      await expect(
        adapters[provider].generateImage(
          config(),
          model,
          { prompt: 'cat', params: { aspect: 'auto', count: 1 }, references: [reference] },
          { useProxy: false },
        ),
      ).rejects.toThrow('不支持参考图');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('updates stored Lite capabilities and cannot use a Pro profile to bypass the model limits', () => {
    const model = imageModel('google', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image');
    model.capabilities.image!.imageSizes = ['1K', '2K', '4K'];
    expect(refreshModelCapabilities(model).capabilities.image!.imageSizes).toEqual(['1K']);
    expect(imageCapabilitiesFor('google', 'gemini-2.5-flash-image')).not.toHaveProperty(
      'backgrounds',
    );
  });

  it('rejects excess Gemini 2.5 references before issuing a request', async () => {
    const fetch = mockImages(openaiImageResponse);
    await expect(
      adapters.google.generateImage(
        config(),
        imageModel('google', 'gemini-2.5-flash-image'),
        {
          prompt: 'cat',
          params: { aspect: 'auto', count: 1 },
          references: Array(4).fill(reference),
        },
        { useProxy: false },
      ),
    ).rejects.toThrow('3 张');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not classify xAI video models as images or Google speech models as chat', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ data: [{ id: 'grok-imagine-video' }, { id: 'grok-imagine-image-2.0' }] }),
        )
        .mockResolvedValueOnce(
          json({
            models: [
              {
                name: 'models/gemini-2.5-flash-preview-tts',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          }),
        ),
    );
    expect(
      (await adapters.xai.listModels(config(), { useProxy: false })).map((m) => m.modelId),
    ).toEqual(['grok-imagine-image-2.0']);
    expect(await adapters.google.listModels(config(), { useProxy: false })).toEqual([]);
  });

  it('keeps image and tool inputs out of a plain text-only chat request', async () => {
    const fetch = mockImages(openaiImageResponse);
    const model: ModelDescriptor = {
      key: 'xai::text',
      providerId: 'xai',
      modelId: 'private-chat',
      label: 'Text',
      kind: 'text',
      capabilities: { vision: false, tools: false, imageGeneration: false },
    };
    await expect(
      adapters.xai.streamChat(
        config(),
        model,
        {
          system: '',
          messages: [{ role: 'user', content: 'cat', images: [reference] }],
          tools: [],
          continuations: [],
          onText: () => {},
        },
        { useProxy: false },
      ),
    ).rejects.toThrow('图片理解');
    expect(fetch).not.toHaveBeenCalled();
  });
});
