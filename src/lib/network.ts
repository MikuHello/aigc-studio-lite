export async function detectWorkerProxy(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch('/api/proxy', {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { ok?: boolean; service?: string };
    return payload.ok === true && payload.service === 'aigc-studio-lite-proxy';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
