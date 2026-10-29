const OFFICIAL_BASE_URLS = [
  'https://api.openai.com',
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com',
  'https://api.x.ai',
  'https://ark.cn-beijing.volces.com',
];

function publicHttpsUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    host.endsWith('.') ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    /(?:^|\.)(?:localhost|local|internal|home|arpa)$/.test(host) ||
    /%2e|%2f|%5c|%25/i.test(url.pathname) ||
    raw.includes('\\')
  )
    return null;
  return url;
}

export function parseProxyTarget(
  rawTarget: string | null,
  additionalBaseUrls: unknown = [],
): URL | null {
  if (!rawTarget) return null;
  const target = publicHttpsUrl(rawTarget);
  if (!target) return null;
  const configured = Array.isArray(additionalBaseUrls) ? additionalBaseUrls : [];
  for (const rawBase of [...OFFICIAL_BASE_URLS, ...configured]) {
    if (typeof rawBase !== 'string') continue;
    const base = publicHttpsUrl(rawBase);
    if (!base || base.search) continue;
    const path = base.pathname.replace(/\/+$/, '');
    if (
      target.origin === base.origin &&
      (target.pathname === path || target.pathname.startsWith(`${path}/`))
    )
      return target;
  }
  return null;
}
