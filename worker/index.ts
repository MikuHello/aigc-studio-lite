import { parseProxyTarget } from '../src/lib/proxy';

export interface Env {
  ASSETS: Fetcher;
  PROXY_ALLOWED_BASE_URLS?: string[];
}

// @reason 认证头必须原样交给上游鉴权；Cloudflare 默认请求事件脱敏只影响事件数据，不会隐藏 Worker 运行时的 Key。
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
      'x-aigc-proxy-error': '1',
    },
  });
}

async function handleProxy(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return jsonResponse({ error: 'Worker 代理仅接受本站请求。' }, 403);
  }
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
    return jsonResponse({ error: 'Worker 代理不支持此请求方法。' }, 405);
  }

  const target = parseProxyTarget(
    request.headers.get('x-aigc-proxy-target'),
    env.PROXY_ALLOWED_BASE_URLS,
  );
  if (!target) {
    return jsonResponse(
      {
        error:
          '目标地址未获 Worker 允许。仅支持公共域名的标准 HTTPS 地址；自定义网关需由部署者配置 PROXY_ALLOWED_BASE_URLS。',
      },
      403,
    );
  }
  if (
    request.method === 'DELETE' &&
    !/\/contents\/generations\/tasks\/[^/]+$/.test(target.pathname)
  ) {
    return jsonResponse({ error: 'DELETE 仅允许视频任务取消路径。' }, 403);
  }
  // @reason 平台默认认证头脱敏不保护主动日志，原始请求头、请求体、响应体及 Key 不得写入日志或存储。
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
      return jsonResponse({ error: 'Worker 代理拒绝上游重定向，请配置最终 API 地址。' }, 502);
    }

    const responseHeaders = new Headers();
    for (const header of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }
    responseHeaders.set('x-content-type-options', 'nosniff');
    responseHeaders.set('x-aigc-proxy-upstream', '1');
    if (!responseHeaders.has('cache-control')) responseHeaders.set('cache-control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return jsonResponse(
      { error: 'Worker 无法连接上游服务，请检查目标地址、上游网络或稍后重试。' },
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
      return handleProxy(request, env);
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
