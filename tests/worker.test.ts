import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';

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
    expect(init.redirect).toBe('error');
    expect(init.signal).toBe(request.signal);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-only');
    expect(new Headers(init.headers).has('cookie')).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await response.text()).toBe('data: ok\n\n');
  });
});
