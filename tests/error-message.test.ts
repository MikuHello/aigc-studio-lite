import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerFetch } from '@/providers/shared';
afterEach(() => vi.unstubAllGlobals());
describe('complete error messages', () => {
  it('retains the end of a long plain-text upstream error', async () => {
    const message = '服务错误：' + 'detail '.repeat(400) + 'request_id=tail-marker';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(message, { status: 402 })));
    await expect(
      providerFetch('https://example.test/v1/images', {}, { provider: 'openai', useProxy: false }),
    ).rejects.toThrow(message);
  });
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
    providerFetch('https://api.openai.com/v1', {}, { useProxy, provider: 'openai' }),
  ).rejects.toThrow(useProxy ? '代理接口返回了网页' : 'API 地址返回了 HTML');
});
