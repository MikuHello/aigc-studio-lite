import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { providerFetch } from '@/providers/shared';
import { resolveUseProxy } from '@/store/appStore';

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

it.each(['auto', 'proxy', 'direct'] as const)(
  'routes a custom gateway directly in %s mode while keeping official proxy routing',
  async (mode) => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/proxy') {
        return worker.fetch(
          new Request('https://studio.example/api/proxy', init),
          {} as Parameters<typeof worker.fetch>[1],
        );
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const options = { useProxy: resolveUseProxy(mode, true), provider: 'openai' as const };
    const gateway = 'https://gateway.example/v1/models';
    await expect(providerFetch(gateway, {}, options)).resolves.toHaveProperty('status', 200);
    expect(fetchMock.mock.calls[0][0]).toBe(gateway);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('x-aigc-proxy-target')).toBe(false);
    fetchMock.mockClear();
    await expect(
      providerFetch('https://api.openai.com/v1/models', {}, options),
    ).resolves.toHaveProperty('status', 200);
    expect(fetchMock.mock.calls[0][0]).toBe(
      mode === 'direct' ? 'https://api.openai.com/v1/models' : '/api/proxy',
    );
  },
);
