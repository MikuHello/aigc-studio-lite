import type { Notice, NoticeInput } from '@/types';

export const NOTICE_HISTORY_LIMIT = 50;
export const NOTICE_VISIBLE_LIMIT = 3;
export const NOTICE_DURATION_MS = 5000;

export function noticeText(value: unknown, secrets: string[] = []): string {
  let text = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[已隐藏]');
  }
  return text
    .replace(
      /(Incorrect API key provided:\s*)(\S+)/gi,
      (_match, prefix: string, token: string) =>
        `${prefix}[已隐藏]${token.endsWith('.') ? '.' : ''}`,
    )
    .replace(/((?:Bearer|Basic)\s+)[^\s"'&,;}]+/gi, '$1[已隐藏]')
    .replace(
      /(authorization["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?[^\s"'&,}]+/gi,
      '$1[已隐藏]',
    )
    .replace(
      /((?:[?&]|["']?)(?:api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi,
      '$1[已隐藏]',
    )
    .trim();
}

export function noticeSummary(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean;
}

export function makeNotice(
  input: NoticeInput,
  id: string,
  now: number,
  secrets: string[] = [],
): Notice {
  const fullTitle = noticeText(input.title, secrets) || '操作失败';
  const title = noticeSummary(fullTitle);
  const detail = noticeText(input.detail, secrets) || (title !== fullTitle ? fullTitle : undefined);
  return {
    id,
    title,
    detail,
    tone: input.tone ?? 'neutral',
    context: noticeText(input.context, secrets) || undefined,
    action: input.action,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
}

export function recordNotice(
  history: Notice[],
  next: Notice,
): { notice: Notice; history: Notice[] } {
  const previous = history.find(
    (item) =>
      item.title === next.title &&
      item.detail === next.detail &&
      item.tone === next.tone &&
      item.context === next.context &&
      item.source === next.source &&
      item.action?.connectionId === next.action?.connectionId,
  );
  const notice = previous
    ? {
        ...next,
        id: previous.id,
        createdAt: previous.createdAt,
      }
    : next;
  return {
    notice,
    history: [notice, ...history.filter((item) => item.id !== notice.id)].slice(
      0,
      NOTICE_HISTORY_LIMIT,
    ),
  };
}

export function failureNotice(
  title: string,
  error: unknown,
  options: Pick<NoticeInput, 'context' | 'action' | 'source'> = {},
): NoticeInput {
  const info =
    error && typeof error === 'object' ? (error as { kind?: string; status?: number }) : {};
  const reason =
    info.kind === 'auth'
      ? info.status === 401
        ? 'API Key 无效'
        : '没有访问权限'
      : info.kind === 'rate-limit'
        ? '请求受限或额度不足'
        : info.kind === 'network'
          ? '连接不可用'
          : info.kind === 'parse'
            ? '响应无效'
            : undefined;
  return {
    title: reason ? `${title}：${reason}` : title,
    tone: 'error',
    detail: error,
    ...options,
  };
}
