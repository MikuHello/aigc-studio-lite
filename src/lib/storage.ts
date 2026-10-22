import { withoutWorkspace } from './migration';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Asset, PersistedMeta, ProviderId, SessionDraft } from '@/types';

interface StudioDatabase extends DBSchema {
  meta: {
    key: string;
    value: PersistedMeta;
  };
  assets: {
    key: string;
    value: Asset;
    indexes: {
      'by-session': string;
    };
  };
}

const DB_NAME = 'aigc-studio-lite';
const META_KEY = 'app';
const LOCAL_DRAFT_PREFIX = 'aigc-studio-lite:draft:';
const LOCAL_SECRETS_KEY = 'aigc-studio-lite:secrets';
const SESSION_SECRETS_KEY = 'aigc-studio-lite:session-secrets';

let databasePromise: Promise<IDBPDatabase<StudioDatabase>> | null = null;

function getDatabase(): Promise<IDBPDatabase<StudioDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<StudioDatabase>(DB_NAME, undefined, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
        if (!db.objectStoreNames.contains('assets')) {
          const store = db.createObjectStore('assets', { keyPath: 'id' });
          store.createIndex('by-session', 'sessionId');
        }
      },
    }).catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export async function loadMeta(): Promise<PersistedMeta | null> {
  const db = await getDatabase();
  const meta = await db.get('meta', META_KEY);
  return meta
    ? { ...withoutWorkspace(meta), version: 2, sessions: meta.sessions.map(withoutWorkspace) }
    : null;
}

export async function saveMeta(meta: PersistedMeta): Promise<void> {
  try {
    const db = await getDatabase();
    await db.put('meta', meta, META_KEY);
  } catch (error) {
    console.warn('IndexedDB metadata could not be written.', error);
  }
}

export async function loadAssets(): Promise<Asset[]> {
  const db = await getDatabase();
  return (await db.getAll('assets')).map(withoutWorkspace);
}

export async function saveAssets(assets: Asset[]): Promise<void> {
  if (assets.length === 0) return;
  try {
    const db = await getDatabase();
    const transaction = db.transaction('assets', 'readwrite');
    await Promise.all([...assets.map((asset) => transaction.store.put(asset)), transaction.done]);
  } catch (error) {
    console.warn('IndexedDB assets could not be written.', error);
  }
}

export async function removeAsset(assetId: string): Promise<void> {
  const db = await getDatabase();
  await db.delete('assets', assetId);
}

export function readLocalDraft(sessionId: string): SessionDraft | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_DRAFT_PREFIX}${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionDraft>;
    return {
      studio: typeof parsed.studio === 'string' ? parsed.studio : '',
      chat: typeof parsed.chat === 'string' ? parsed.chat : '',
      studioAttachmentIds: Array.isArray(parsed.studioAttachmentIds)
        ? parsed.studioAttachmentIds
        : [],
      chatAttachmentIds: Array.isArray(parsed.chatAttachmentIds) ? parsed.chatAttachmentIds : [],
    };
  } catch {
    return null;
  }
}

// @reason Synchronous drafts survive a refresh before the IndexedDB debounce flushes.
export function writeLocalDraft(sessionId: string, draft: SessionDraft): void {
  try {
    localStorage.setItem(`${LOCAL_DRAFT_PREFIX}${sessionId}`, JSON.stringify(draft));
  } catch {}
}

export function removeLocalDraft(sessionId: string): void {
  try {
    localStorage.removeItem(`${LOCAL_DRAFT_PREFIX}${sessionId}`);
  } catch {}
}

export function mergeLocalDrafts(meta: PersistedMeta): PersistedMeta {
  const drafts = { ...meta.drafts };
  for (const session of meta.sessions) {
    const local = readLocalDraft(session.id);
    if (local) drafts[session.id] = local;
  }
  return { ...meta, drafts };
}

interface SecretMap {
  [provider: string]: string;
}

function readSecretMap(key: string, storageName: 'localStorage' | 'sessionStorage'): SecretMap {
  try {
    const storage = storageName === 'localStorage' ? localStorage : sessionStorage;
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as SecretMap) : {};
  } catch {
    return {};
  }
}

export function readSecrets(): {
  keys: Partial<Record<ProviderId, string>>;
  remembered: Partial<Record<ProviderId, boolean>>;
} {
  const local = readSecretMap(LOCAL_SECRETS_KEY, 'localStorage');
  const session = readSecretMap(SESSION_SECRETS_KEY, 'sessionStorage');
  const providers: ProviderId[] = ['openai', 'anthropic', 'google', 'xai'];
  const keys: Partial<Record<ProviderId, string>> = {};
  const remembered: Partial<Record<ProviderId, boolean>> = {};
  for (const provider of providers) {
    if (typeof local[provider] === 'string' && local[provider]) {
      keys[provider] = local[provider];
      remembered[provider] = true;
    } else if (typeof session[provider] === 'string' && session[provider]) {
      keys[provider] = session[provider];
      remembered[provider] = false;
    }
  }
  return { keys, remembered };
}

export function writeSecrets(
  configs: Record<ProviderId, { apiKey: string; rememberKey: boolean }>,
): void {
  const local: SecretMap = {};
  const session: SecretMap = {};
  for (const [provider, config] of Object.entries(configs) as Array<
    [ProviderId, { apiKey: string; rememberKey: boolean }]
  >) {
    if (!config.apiKey) continue;
    if (config.rememberKey) local[provider] = config.apiKey;
    else session[provider] = config.apiKey;
  }
  try {
    if (Object.keys(local).length) localStorage.setItem(LOCAL_SECRETS_KEY, JSON.stringify(local));
    else localStorage.removeItem(LOCAL_SECRETS_KEY);
    if (Object.keys(session).length) {
      sessionStorage.setItem(SESSION_SECRETS_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(SESSION_SECRETS_KEY);
    }
  } catch {}
}
