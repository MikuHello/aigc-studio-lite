import { afterEach, expect, it, vi } from 'vitest';
import { providerFetch } from '@/providers/shared';
import { normalizeImageParams, openAIImageCapabilities } from '@/providers/model-capabilities';
import { openaiAdapter } from '@/providers/openai';
import type { ModelDescriptor } from '@/types';
afterEach(() => vi.unstubAllGlobals());
it('preserves automatic aspect and sends auto sizing to GPT Image', async () => {
  const caps = openAIImageCapabilities('gpt-image-1');
  const params = normalizeImageParams({ aspect: 'auto', count: 1 }, caps);
  expect(params.aspect).toBe('auto');
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const model: ModelDescriptor = {
    key: 'openai::gpt-image-1',
    providerId: 'openai',
    modelId: 'gpt-image-1',
    label: 'GPT',
    kind: 'image',
    capabilities: { vision: false, tools: false, imageGeneration: true, image: caps },
  };
  await openaiAdapter.generateImage(
    { apiKey: 'test-only', baseUrl: 'https://example.test/v1', rememberKey: false },
    model,
    { prompt: 'cat', params, references: [] },
    { useProxy: false },
  );
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body)).size).toBe('auto');
});
it.each([false, true])('explains HTML responses with proxy=%s', async (useProxy) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }),
    ),
  );
  await expect(
    providerFetch('https://example.test/v1', {}, { useProxy, provider: 'openai' }),
  ).rejects.toThrow(useProxy ? '代理接口返回了网页' : 'API 地址返回了 HTML');
});
it.each([
  ['9:16', '864x1536'],
  ['16:9', '1536x864'],
  ['4:3', '1536x1152'],
  ['3:4', '1152x1536'],
  ['21:9', '1792x768'],
])('sends custom %s dimensions for GPT Image 2.5', async (aspect, size) => {
  const caps = openAIImageCapabilities('gpt-image-2.5-flare-auto');
  const params = normalizeImageParams(
    { aspect, count: 4, background: 'transparent', outputFormat: 'webp' },
    caps,
  );
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const model: ModelDescriptor = {
    key: 'openai::gpt-image-2.5-flare-auto',
    providerId: 'openai',
    modelId: 'gpt-image-2.5-flare-auto',
    label: 'GPT',
    kind: 'image',
    capabilities: { vision: false, tools: false, imageGeneration: true, image: caps },
  };
  await openaiAdapter.generateImage(
    { apiKey: 'test-only', baseUrl: 'https://example.test/v1', rememberKey: false },
    model,
    { prompt: 'cat', params, references: [] },
    { useProxy: false },
  );
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toMatchObject({
    size,
    n: 4,
    background: 'transparent',
    output_format: 'webp',
  });
});
it('keeps legacy GPT Image fixed sizes', () => {
  expect(openAIImageCapabilities('gpt-image-1').aspects.map((item) => item.value)).toEqual([
    '1:1',
    '3:2',
    '2:3',
  ]);
});
