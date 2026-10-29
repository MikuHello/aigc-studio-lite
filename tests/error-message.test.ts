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

it.each([false, true])(
  'explains network failure without retrying when proxy=%s',
  async (useProxy) => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      providerFetch('https://gateway.example/v1/models', {}, { useProxy, provider: 'openai' }),
    ).rejects.toThrow(useProxy ? '无法连接本站 Worker 代理' : '浏览器直连失败');
    expect(fetchMock).toHaveBeenCalledOnce();
  },
);

it.each([false, true])(
  'keeps upstream authentication errors separate with proxy=%s',
  async (useProxy) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"error":"invalid key"}', {
            status: 401,
            headers: useProxy ? { 'x-aigc-proxy-upstream': '1' } : {},
          }),
      ),
    );
    await expect(
      providerFetch('https://gateway.example/v1/models', {}, { useProxy, provider: 'openai' }),
    ).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
      message: expect.stringContaining(
        useProxy ? '上游服务（经 Worker 代理）' : '上游服务（浏览器直连）',
      ),
    });
  },
);

it('reports a proxy target rejection as a Worker error rather than a bad API key', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('{"error":"目标未获允许"}', {
          status: 403,
          headers: { 'x-aigc-proxy-error': '1' },
        }),
    ),
  );
  await expect(
    providerFetch('https://gateway.example/v1/models', {}, { useProxy: true, provider: 'openai' }),
  ).rejects.toMatchObject({ kind: 'network', message: 'Worker 代理错误：目标未获允许' });
});

it('identifies a missing proxy endpoint and HTML returned by an actual upstream', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
    .mockResolvedValueOnce(
      new Response('<html/>', {
        headers: { 'content-type': 'text/html', 'x-aigc-proxy-upstream': '1' },
      }),
    );
  vi.stubGlobal('fetch', fetchMock);
  const request = () =>
    providerFetch('https://gateway.example/v1/models', {}, { useProxy: true, provider: 'openai' });
  await expect(request()).rejects.toThrow('Worker 代理接口不可用');
  await expect(request()).rejects.toThrow('上游服务经 Worker 代理返回了 HTML');
});

it('preserves cancellation in either route', async () => {
  const abort = new DOMException('Cancelled', 'AbortError');
  const fetchMock = vi.fn().mockRejectedValue(abort);
  vi.stubGlobal('fetch', fetchMock);
  for (const useProxy of [false, true]) {
    const controller = new AbortController();
    controller.abort();
    await expect(
      providerFetch(
        'https://gateway.example/v1/models',
        {},
        { useProxy, signal: controller.signal, provider: 'openai' },
      ),
    ).rejects.toBe(abort);
    expect(fetchMock.mock.calls.at(-1)![1].signal).toBe(controller.signal);
  }
});
