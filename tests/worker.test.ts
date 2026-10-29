import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { providerFetch } from '@/providers/shared';

afterEach(() => vi.unstubAllGlobals());

describe('Worker proxy boundary', () => {
  it.each([
    'http://api.openai.com/v1/models',
    'https://private.example/v1/models',
    'https://api.openai.com.evil.example/v1/models',
    'https://user:secret@api.openai.com/v1/models',
  ])('rejects an untrusted target %s before making a request', async (target) => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const response = await worker.fetch(
      new Request('https://studio.example/api/proxy', {
        headers: { 'x-aigc-proxy-target': target },
      }),
      {} as Parameters<typeof worker.fetch>[1],
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('forwards credentials and cancellation only to the allowed target without following redirects', async () => {
    const upstream = vi.fn(
      async () =>
        new Response('data: ok\n\n', {
          headers: { 'content-type': 'text/event-stream', 'set-cookie': 'do-not-forward=1' },
        }),
    );
    vi.stubGlobal('fetch', upstream);
    const request = new Request('https://studio.example/api/proxy', {
      headers: {
        'x-aigc-proxy-target': 'https://api.openai.com/v1/models',
        authorization: 'Bearer test-only',
        cookie: 'private=1',
      },
    });
    const response = await worker.fetch(request, {} as Parameters<typeof worker.fetch>[1]);
    const [target, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe('https://api.openai.com/v1/models');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBe(request.signal);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-only');
    expect(new Headers(init.headers).has('cookie')).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await response.text()).toBe('data: ok\n\n');
  });
});

describe('Ark proxy methods', () => {
  it('forwards task cancellation but rejects DELETE outside the video task path', async () => {
    const upstream = vi.fn(
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', upstream);
    for (const target of [
      'https://api.openai.com/v1/models/example',
      'https://ark.cn-beijing.volces.com/api/v3/models/example',
    ]) {
      const response = await worker.fetch(
        new Request('https://studio.example/api/proxy', {
          method: 'DELETE',
          headers: { 'x-aigc-proxy-target': target },
        }),
        {} as Parameters<typeof worker.fetch>[1],
      );
      expect(response.status).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
    const response = await worker.fetch(
      new Request('https://studio.example/api/proxy', {
        method: 'DELETE',
        headers: {
          'x-aigc-proxy-target':
            'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-example',
          authorization: 'Bearer test-only',
        },
      }),
      {} as Parameters<typeof worker.fetch>[1],
    );
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

it('rejects an upstream redirect without following it or exposing the destination', async () => {
  const upstream = vi.fn(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://untrusted.example/collect' },
      }),
  );
  vi.stubGlobal('fetch', upstream);
  const response = await worker.fetch(
    new Request('https://studio.example/api/proxy', {
      headers: {
        'x-aigc-proxy-target': 'https://ark.cn-beijing.volces.com/api/v3/models',
        authorization: 'Bearer test-only',
      },
    }),
    {} as Parameters<typeof worker.fetch>[1],
  );
  expect(response.status).toBe(502);
  expect(response.headers.has('location')).toBe(false);
  expect(upstream).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'routes official and custom API targets solely by the connection choice %s',
  async (useProxy) => {
    const fetchMock = vi.fn(
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    for (const target of [
      'https://gateway.example/v1/models',
      'https://api.openai.com/v1/models',
    ]) {
      await providerFetch(
        target,
        { headers: { authorization: 'Bearer test-only' } },
        { useProxy, provider: 'openai' },
      );
      const [url, init] = fetchMock.mock.calls.at(-1)! as unknown as [string, RequestInit];
      expect(url).toBe(useProxy ? '/api/proxy' : target);
      expect(new Headers(init.headers).get('x-aigc-proxy-target')).toBe(useProxy ? target : null);
    }
  },
);

const env = { PROXY_ALLOWED_BASE_URLS: ['https://gateway.example/api/v3'] } as Parameters<
  typeof worker.fetch
>[1];
function proxyRequest(target: string, method = 'GET', extra: Record<string, string> = {}) {
  return new Request('https://studio.example/api/proxy', {
    method,
    headers: { 'x-aigc-proxy-target': target, authorization: 'Bearer test-only', ...extra },
    ...(method === 'POST' ? { body: JSON.stringify({ prompt: 'test' }) } : {}),
  });
}

it.each(['GET', 'POST', 'DELETE'])(
  'forwards configured gateway task requests with %s',
  async (method) => {
    const upstream = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', upstream);
    const target = 'https://gateway.example/api/v3/contents/generations/tasks/example';
    const request = proxyRequest(target, method, { origin: 'https://studio.example' });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-aigc-proxy-upstream')).toBe('1');
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(target);
    expect(init.method).toBe(method);
    expect(init.signal).toBe(request.signal);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-only');
    if (method === 'POST') expect(await new Response(init.body).text()).toBe('{"prompt":"test"}');
  },
);

it.each([
  'https://gateway.example/api/v30/models',
  'https://gateway.example/models',
  'https://gateway.example/api/v3/../models',
  'https://gateway.example/api/v3/%2e%2e/models',
  'https://gateway.example/api/v3/%252e%252e/models',
  'https://gateway.example/api/v3/tasks%2fother',
  'https://gateway.example.evil.example/api/v3/models',
  'https://child.gateway.example/api/v3/models',
  'https://gateway.example:8443/api/v3/models',
  'https://user:password@gateway.example/api/v3/models',
  'https://gateway.example/api/v3/models#fragment',
])('does not let configured gateway targets escape their origin or path: %s', async (target) => {
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  const response = await worker.fetch(proxyRequest(target), env);
  expect(response.status).toBe(403);
  expect(response.headers.get('x-aigc-proxy-error')).toBe('1');
  expect(upstream).not.toHaveBeenCalled();
});

it.each([
  'http://gateway.example',
  'https://127.0.0.1',
  'https://2130706433',
  'https://[::1]',
  'https://169.254.169.254',
  'https://10.0.0.1',
  'https://localhost',
  'https://service.local',
  'https://service.internal',
  'https://gateway.example.',
  'https://gateway.example:8443',
])('rejects unsafe targets even when explicitly configured: %s', async (baseUrl) => {
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  const response = await worker.fetch(proxyRequest(`${baseUrl}/models`), {
    PROXY_ALLOWED_BASE_URLS: [baseUrl],
  } as Parameters<typeof worker.fetch>[1]);
  expect(response.status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});

it('ignores malformed target configuration without opening the proxy', async () => {
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  for (const configured of ['*', ['*', null, {}, 'https://gateway.example/v1?key=test']]) {
    const response = await worker.fetch(proxyRequest('https://gateway.example/v1/models'), {
      PROXY_ALLOWED_BASE_URLS: configured,
    } as Parameters<typeof worker.fetch>[1]);
    expect(response.status).toBe(403);
  }
  expect(upstream).not.toHaveBeenCalled();
});

it('rejects browser requests from other sites and unsupported methods before forwarding', async () => {
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  for (const [method, headers, status] of [
    ['POST', { origin: 'https://other.example' }, 403],
    ['OPTIONS', { origin: 'https://other.example' }, 403],
    ['GET', { 'sec-fetch-site': 'cross-site' }, 403],
    ['PUT', {}, 405],
  ] as const) {
    const response = await worker.fetch(
      proxyRequest('https://api.openai.com/v1/models', method, headers),
      env,
    );
    expect(response.status).toBe(status);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  }
  expect(upstream).not.toHaveBeenCalled();
});

it('rejects configured gateway DELETE outside the task cancellation path', async () => {
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  const response = await worker.fetch(
    proxyRequest('https://gateway.example/api/v3/models/example', 'DELETE'),
    env,
  );
  expect(response.status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});

it('keeps gateway query parameters and upstream failures distinguishable from Worker errors', async () => {
  const upstream = vi.fn(
    async () =>
      new Response('{"error":{"message":"invalid key"}}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', upstream);
  const response = await worker.fetch(
    proxyRequest('https://gateway.example/api/v3/models?page=2'),
    env,
  );
  expect(upstream.mock.calls[0][0]).toBe('https://gateway.example/api/v3/models?page=2');
  expect(response.status).toBe(401);
  expect(response.headers.has('x-aigc-proxy-error')).toBe(false);
  expect(response.headers.get('x-aigc-proxy-upstream')).toBe('1');
});

it('does not expose exception details or credentials when upstream fetch fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-key-in-fetch-details')));
  const response = await worker.fetch(proxyRequest('https://api.openai.com/v1/models'), env);
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('secret-key');
});

it('never retries a rejected proxy target directly', async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
    worker.fetch(new Request('https://studio.example/api/proxy', init), env),
  );
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    providerFetch(
      'https://unconfigured.example/v1/models',
      {},
      { useProxy: true, provider: 'openai' },
    ),
  ).rejects.toThrow('Worker 代理错误');
  expect(fetchMock).toHaveBeenCalledOnce();
});
