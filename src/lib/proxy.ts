export const ALLOWED_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.x.ai',
  'ark.cn-beijing.volces.com',
]);

export function parseProxyTarget(rawTarget: string | null): URL | null {
  if (!rawTarget) return null;
  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:') return null;
  if (target.username || target.password) return null;
  if (!ALLOWED_HOSTS.has(target.hostname)) return null;
  return target;
}
