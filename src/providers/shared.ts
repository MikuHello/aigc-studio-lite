import { noticeText } from '@/lib/notices';
import type { ProviderId } from '@/types';
import { ProviderError } from './types';

export interface RequestOptions {
  useProxy: boolean;
  signal?: AbortSignal;
  provider: ProviderId;
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function normalizeBaseUrl(baseUrl: string, provider: ProviderId = 'openai'): string {
  const url = new URL(baseUrl.trim());
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(
    /\/(?:contents\/generations\/tasks|chat\/completions|images\/(?:generations|edits)|responses|models|messages)$/,
    '',
  );
  path = path.replace(/(\/v\d+(?:beta\d*|alpha\d*)?)(?:\1)+(?=\/|$)/g, '$1');
  if (!/\/v\d+(?:beta\d*|alpha\d*)?(?:\/|$)/.test(path)) {
    path +=
      provider === 'google'
        ? '/v1beta'
        : provider === 'volcengine'
          ? path.endsWith('/api')
            ? '/v3'
            : '/api/v3'
          : '/v1';
  }
  url.pathname = path;
  return url.toString().replace(/\/$/, '');
}

export function errorKindForStatus(status: number): ProviderError['kind'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status >= 400 && status < 500) return 'request';
  return 'unknown';
}

export function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    for (const key of ['message', 'detail']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return fallback;
}

async function readErrorResponse(response: Response): Promise<{ message: string; raw: string }> {
  const raw = await response.text().catch(() => '');
  if (!raw) return { message: response.statusText || `HTTP ${response.status}`, raw };
  try {
    const payload = JSON.parse(raw) as unknown;
    return {
      message: errorMessageFromPayload(payload, response.statusText || `HTTP ${response.status}`),
      raw,
    };
  } catch {
    return { message: raw, raw };
  }
}

export async function providerFetch(
  url: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<Response> {
  const headers = new Headers(init.headers);
  // @reason 上游异常可能回显本次请求的 Key，必须在创建异常前脱敏；平台默认请求事件脱敏不处理错误正文。
  const requestSecrets = [
    headers.get('authorization')?.replace(/^(?:Bearer|Basic)\s+/i, ''),
    headers.get('x-api-key'),
    headers.get('x-goog-api-key'),
  ].filter((value): value is string => Boolean(value));
  const useProxy = options.useProxy;
  let target = url;
  if (useProxy) {
    headers.set('x-aigc-proxy-target', url);
    target = '/api/proxy';
  }

  let response: Response;
  try {
    response = await fetch(target, { ...init, headers, signal: options.signal ?? init.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ProviderError(
      useProxy
        ? '无法连接本站 Worker 代理。请确认部署包含 /api/proxy，或在此供应商的「编辑连接」中关闭「Worker 代理」。'
        : '浏览器直连失败，可能是网络或跨域（CORS）限制。可在此供应商的「编辑连接」中开启「Worker 代理」；自定义网关需先由部署者放行目标地址。',
      { provider: options.provider, kind: 'network', cause: error },
    );
  }

  if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    throw new ProviderError(
      useProxy
        ? response.headers.has('x-aigc-proxy-upstream')
          ? '上游服务经 Worker 代理返回了 HTML 网页，请检查 API 地址或网关拦截策略。'
          : '代理接口返回了网页，未连接到 API 服务。本地 Vite 不提供 /api/proxy；请在此供应商的「编辑连接」中关闭「Worker 代理」，或使用 npm run dev:worker。'
        : 'API 地址返回了 HTML 网页，而不是模型数据。请检查是否填写了网站首页、是否缺少 /v1 等接口路径，或网关是否拦截了请求。',
      { provider: options.provider, kind: 'parse' },
    );
  }

  if (!response.ok) {
    const payload = await readErrorResponse(response);
    const message = noticeText(payload.message, requestSecrets);
    if (useProxy && response.headers.has('x-aigc-proxy-error')) {
      throw new ProviderError(`Worker 代理错误：${message}`, {
        status: response.status,
        provider: options.provider,
        kind: 'network',
      });
    }
    if (useProxy && !response.headers.has('x-aigc-proxy-upstream')) {
      throw new ProviderError(
        `Worker 代理接口不可用（HTTP ${response.status}）。请确认部署包含 /api/proxy，或在此供应商的「编辑连接」中关闭「Worker 代理」。`,
        {
          status: response.status,
          provider: options.provider,
          kind: 'network',
        },
      );
    }
    const kind = errorKindForStatus(response.status);
    const translated =
      response.status === 401
        ? `API Key 验证失败：${message}`
        : response.status === 429
          ? `请求过于频繁或额度不足：${message}`
          : response.status === 403
            ? `没有访问权限：${message}`
            : message;
    throw new ProviderError(
      `上游服务${useProxy ? '（经 Worker 代理）' : '（浏览器直连）'}：${translated}`,
      {
        status: response.status,
        provider: options.provider,
        kind,
      },
    );
  }

  return response;
}

export async function providerJson<T>(
  url: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<T> {
  const response = await providerFetch(url, init, options);
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ProviderError('服务端返回了无法解析的数据。', {
      provider: options.provider,
      kind: 'parse',
      cause: error,
    });
  }
}

export function isEventStream(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ?? false;
}

export async function readEventStream(
  response: Response,
  onData: (data: string) => void,
): Promise<boolean> {
  if (!response.body) {
    throw new ProviderError('服务端没有返回响应流。', { kind: 'parse' });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let isFinished = false;
  let isClosed = false;

  const dispatch = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data === '[DONE]') {
      isFinished = true;
      return;
    }
    if (!data) return;
    onData(data);
  };

  try {
    while (!isFinished) {
      const chunk = await reader.read();
      if (chunk.done) {
        isClosed = true;
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replaceAll('\r\n', '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1 && !isFinished) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (!isFinished && buffer.trim()) dispatch(buffer);
  } finally {
    if (!isClosed) {
      try {
        await reader.cancel();
      } catch {}
    }
    reader.releaseLock();
  }
  return isFinished;
}

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function stripImageFences(text: string): string {
  let clean = text.trim();
  const fenced = /^```(?:\w+)?\s*\n([\s\S]*?)\n```$/.exec(clean);
  if (fenced) clean = fenced[1].trim();
  clean = clean.replace(/^(["“])([\s\S]*)(["”])$/, '$2').trim();
  return clean;
}

export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}
