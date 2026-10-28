import { ALLOWED_HOSTS, parseProxyTarget } from '../src/lib/proxy';

export interface Env {
  ASSETS: Fetcher;
}

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
  'anthropic-version',
  'authorization',
  'content-type',
  'openai-organization',
  'openai-project',
  'x-api-key',
  'x-goog-api-client',
  'x-goog-api-key',
]);

const FORWARDED_RESPONSE_HEADERS = [
  'cache-control',
  'content-type',
  'openai-processing-ms',
  'request-id',
  'x-request-id',
  'x-goog-request-id',
];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function handleProxy(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        allow: 'GET, POST, DELETE, OPTIONS',
        'cache-control': 'no-store',
      },
    });
  }
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const target = parseProxyTarget(request.headers.get('x-aigc-proxy-target'));
  if (!target) {
    if (request.method === 'GET' && !request.headers.has('x-aigc-proxy-target')) {
      return jsonResponse({
        ok: true,
        service: 'aigc-studio-lite-proxy',
        allowedHosts: [...ALLOWED_HOSTS],
      });
    }
    return jsonResponse(
      {
        error:
          'Only https requests to OpenAI, Anthropic, Google Generative Language, xAI, or Volcengine Ark hosts are allowed.',
      },
      403,
    );
  }

  if (
    request.method === 'DELETE' &&
    (target.hostname !== 'ark.cn-beijing.volces.com' ||
      !/^\/api\/v3\/contents\/generations\/tasks\/[^/]+$/.test(target.pathname))
  ) {
    return jsonResponse({ error: 'DELETE is only allowed for Ark video tasks.' }, 403);
  }
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set('accept-encoding', 'identity');

  try {
    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : request.body,
      redirect: 'manual',
      signal: request.signal,
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      return jsonResponse({ error: 'Upstream redirects are not allowed.' }, 502);
    }

    const responseHeaders = new Headers();
    for (const header of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }
    responseHeaders.set('x-content-type-options', 'nosniff');
    if (!responseHeaders.has('cache-control')) responseHeaders.set('cache-control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? `Upstream request failed: ${error.message}`
            : 'Upstream request failed.',
      },
      502,
    );
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/proxy') {
      return handleProxy(request);
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
