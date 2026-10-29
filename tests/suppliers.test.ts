import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  availableModels,
  bindConnectionModel,
  migrateConnections,
  modelConnection,
} from '@/lib/connections';
import { customModel, suggestCustomModel } from '@/lib/customModels';
import { createDefaultMeta } from '@/lib/defaults';
import { readSecrets, writeSecrets } from '@/lib/storage';
import { removeSupplier, saveSupplier, saveSupplierModels } from '@/store/suppliers';
import { snapshotMeta, useAppStore } from '@/store/appStore';
import type { ProviderConfig } from '@/types';
const db = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), getAll: vi.fn() }));
vi.mock('idb', () => ({ openDB: vi.fn(async () => db) }));
const config = (name: string): ProviderConfig => ({
  providerId: 'openai',
  name,
  baseUrl: `https://${name}.example.test/v1`,
  apiKey: `test-${name}`,
  rememberKey: true,
});
const model = customModel({
  provider: 'openai',
  id: 'gpt-image-2.5',
  label: 'Image',
  kind: 'image',
  vision: false,
  tools: false,
  references: false,
});
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  db.put.mockResolvedValue(undefined);
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  useAppStore.setState(useAppStore.getInitialState(), true);
});
afterEach(() => vi.unstubAllGlobals());
describe('supplier identity and persistence', () => {
  it('migrates old model keys and draft references without changing manual capabilities', () => {
    const old = createDefaultMeta();
    old.version = 2;
    old.models = [model];
    old.activeImageModelKey = model.key;
    old.drafts[old.activeSessionId].studio = 'preserved';
    const migrated = migrateConnections(old);
    expect(migrated.version).toBe(3);
    expect(migrated.models[0]).toEqual({ ...model, connectionId: 'openai' });
    expect(migrated.activeImageModelKey).toBe(model.key);
    expect(migrated.drafts).toEqual(old.drafts);
    expect(migrated.sessions).toEqual(old.sessions);
  });
  it('separates identical model IDs and never falls back to another supplier', () => {
    const a = bindConnectionModel(model, 'a');
    const b = bindConnectionModel(model, 'b');
    const configs = { a: config('a'), b: config('b'), openai: config('legacy') };
    expect(a.key).not.toBe(b.key);
    expect(modelConnection(configs, a).apiKey).toBe('test-a');
    expect(modelConnection(configs, b).apiKey).toBe('test-b');
    expect(() => modelConnection(configs, { ...b, connectionId: 'missing' })).toThrow('不存在');
    expect(() => modelConnection(configs, { ...b, providerId: 'google' })).toThrow('不匹配');
    configs.b.disabled = true;
    expect(availableModels([a, b], configs)).toEqual([a]);
    expect(() => modelConnection(configs, b)).toThrow('停用');
    expect(modelConnection(configs, b, true).apiKey).toBe('test-b');
  });
  it('saves without discovery and preserves identity for a rename or key change', async () => {
    const id = await saveSupplier(null, config('a'));
    const renamed = await saveSupplier(id, {
      ...config('a'),
      name: 'Renamed',
      apiKey: 'new-test-key',
    });
    expect(renamed).toBe(id);
    expect(readSecrets().keys[id]).toBe('new-test-key');
    expect(useAppStore.getState().providerRuntime[id].status).toBe('idle');
    expect(JSON.stringify(snapshotMeta(useAppStore.getState()))).not.toContain('new-test-key');
  });
  it('creates a separate supplier on address change and keeps old credentials and models', async () => {
    const a = await saveSupplier(null, config('a'));
    await saveSupplierModels(a, [model]);
    const b = await saveSupplier(a, config('b'));
    expect(b).not.toBe(a);
    expect(readSecrets().keys).toMatchObject({ [a]: 'test-a', [b]: 'test-b' });
    expect(useAppStore.getState().models[0].connectionId).toBe(a);
  });
  it('persists a legacy session key across browser sessions when the supplier is saved', async () => {
    const legacy = { ...config('a'), rememberKey: false };
    useAppStore.setState({ providerConfigs: { legacy } });
    writeSecrets({ legacy }, true);
    await saveSupplier('legacy', legacy);
    expect(sessionStorage.getItem('aigc-studio-lite:session-secrets')).toBeNull();
    vi.stubGlobal('sessionStorage', memoryStorage());
    expect(readSecrets().keys.legacy).toBe('test-a');
    expect(useAppStore.getState().providerConfigs.legacy.rememberKey).toBe(true);
  });
  it('updates only the selected supplier models and preserves the other active model', async () => {
    const a = await saveSupplier(null, config('a'));
    const b = await saveSupplier(null, config('b'));
    await saveSupplierModels(a, [model]);
    await saveSupplierModels(b, [model]);
    const aKey = useAppStore.getState().models[0].key;
    await saveSupplierModels(b, []);
    expect(useAppStore.getState().models.map((m) => m.key)).toEqual([aKey]);
    expect(useAppStore.getState().activeImageModelKey).toBe(aKey);
  });
  it('rolls back credentials and leaves state untouched when metadata cannot be saved', async () => {
    const a = await saveSupplier(null, config('a'));
    const before = useAppStore.getState();
    db.put.mockRejectedValueOnce(new Error('quota'));
    await expect(saveSupplier(a, { ...config('a'), apiKey: 'unsaved-key' })).rejects.toThrow(
      'quota',
    );
    expect(useAppStore.getState()).toBe(before);
    expect(readSecrets().keys[a]).toBe('test-a');
  });
  it('round trips arbitrary supplier IDs in remembered and session storage', () => {
    writeSecrets(
      { 'supplier-one': config('a'), 'supplier-two': { ...config('b'), rememberKey: false } },
      true,
    );
    expect(readSecrets()).toEqual({
      keys: { 'supplier-one': 'test-a', 'supplier-two': 'test-b' },
      remembered: { 'supplier-one': true, 'supplier-two': false },
    });
  });
  it('suggests known image capabilities without assuming unknown models accept references', () => {
    expect(suggestCustomModel('openai', 'gpt-image-2.5')).toMatchObject({
      kind: 'image',
      references: true,
    });
    expect(suggestCustomModel('openai', 'dall-e-3')).toMatchObject({
      kind: 'image',
      references: false,
    });
    expect(suggestCustomModel('openai', 'custom-id')).toMatchObject({
      kind: 'text',
      references: false,
    });
  });
});

it.each(['auto', 'proxy', 'direct'])(
  'hydrates legacy %s data as direct connections without losing local data',
  async (networkMode) => {
    const old = createDefaultMeta();
    old.connections = {
      legacy: { ...config('legacy'), useWorkerProxy: undefined },
      proxied: { ...config('proxied'), useWorkerProxy: true },
      malformed: { ...config('malformed'), useWorkerProxy: 'true' as unknown as boolean },
    };
    old.preferences = { ...old.preferences, ...{ networkMode } };
    old.models = [bindConnectionModel(model, 'legacy')];
    old.drafts[old.activeSessionId].studio = 'preserved draft';
    old.presets = [
      {
        id: 'custom-preset',
        title: 'saved',
        content: 'preserved',
        tags: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const asset = {
      id: 'saved-art',
      dataUrl: 'data:image/png;base64,YQ==',
      sessionId: old.activeSessionId,
    };
    db.get.mockResolvedValue(old);
    db.getAll.mockResolvedValue([asset]);
    writeSecrets({
      legacy: config('legacy'),
      proxied: { ...config('proxied'), rememberKey: false },
    });
    await useAppStore.getState().hydrate();
    const state = useAppStore.getState();
    expect(state.bootError).toBeNull();
    expect(state.providerConfigs.legacy).toMatchObject({
      apiKey: 'test-legacy',
      useWorkerProxy: false,
    });
    expect(state.providerConfigs.proxied).toMatchObject({
      apiKey: 'test-proxied',
      rememberKey: false,
      useWorkerProxy: true,
    });
    expect(state.providerConfigs.malformed.useWorkerProxy).toBe(false);
    expect(state.models[0].connectionId).toBe('legacy');
    expect(state.sessions).toEqual(old.sessions);
    expect(state.drafts).toEqual(old.drafts);
    expect(state.presets).toEqual(old.presets);
    expect(state.assets['saved-art']).toEqual(asset);
    expect(state.preferences).not.toHaveProperty('networkMode');
    const saved = snapshotMeta(state);
    expect(saved.connections.proxied.useWorkerProxy).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('test-proxied');
  },
);

it('saves proxy changes on only the chosen connection while preserving credentials, identity and models', async () => {
  const a = await saveSupplier(null, config('a'));
  const b = await saveSupplier(null, config('b'));
  await saveSupplierModels(a, [model]);
  const savedModels = useAppStore.getState().models;
  const beforeB = useAppStore.getState().providerConfigs[b];
  for (const useWorkerProxy of [true, false]) {
    expect(
      await saveSupplier(a, { ...useAppStore.getState().providerConfigs[a], useWorkerProxy }),
    ).toBe(a);
    const state = useAppStore.getState();
    expect(state.providerConfigs[a].useWorkerProxy).toBe(useWorkerProxy);
    expect(state.providerConfigs[b]).toBe(beforeB);
    expect(state.models).toEqual(savedModels);
    expect(readSecrets().keys).toMatchObject({ [a]: 'test-a', [b]: 'test-b' });
    expect(db.put.mock.calls.at(-1)![1].connections[a].useWorkerProxy).toBe(useWorkerProxy);
  }
});

it('restores valid session failure records and discards malformed local failure data', async () => {
  const meta = createDefaultMeta();
  meta.sessions[0].imageFailure = {
    message: 'safe failure',
    prompt: 'original prompt',
    modelLabel: 'Image',
    createdAt: 100,
  };
  meta.sessions.push({
    ...meta.sessions[0],
    id: 'malformed-session',
    imageFailure: { message: 42 } as never,
  });
  db.get.mockResolvedValue(meta);
  db.getAll.mockResolvedValue([]);
  await useAppStore.getState().hydrate();
  expect(useAppStore.getState().sessions[0].imageFailure).toEqual(meta.sessions[0].imageFailure);
  expect(useAppStore.getState().sessions[1].imageFailure).toBeUndefined();
});

it('deletes one supplier and its keys and models while preserving history and other connections', async () => {
  const a = await saveSupplier(null, config('a'));
  const b = await saveSupplier(null, config('b'));
  const textModel = customModel({
    provider: 'openai',
    id: 'gpt-4.1',
    kind: 'text',
    label: 'Text',
    vision: false,
    tools: false,
    references: false,
  });
  await saveSupplierModels(a, [model, textModel]);
  await saveSupplierModels(b, [model, textModel]);
  const before = useAppStore.getState();
  const aModels = before.models.filter((item) => item.connectionId === a);
  const aImage = aModels.find((item) => item.kind === 'image')!;
  const aText = aModels.find((item) => item.kind === 'text')!;
  before.setActiveImageModel(aImage.key);
  before.setActiveTextModel(aText.key);
  before.setReviewModel(aText.key);
  const sessionId = before.createSession('keep history');
  before.setDraftText(sessionId, 'studio', 'keep draft');
  before.addChatMessage(sessionId, {
    id: 'old-chat',
    role: 'user',
    content: 'keep message',
    createdAt: 1,
    status: 'done',
  });
  useAppStore.setState({
    providerConfigs: {
      ...useAppStore.getState().providerConfigs,
      [a]: { ...config('a'), rememberKey: false },
    },
    assets: {
      saved: {
        id: 'saved',
        sessionId,
        source: 'generated',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,YQ==',
        modelKey: aImage.key,
        createdAt: 1,
      },
    },
    connectionToEdit: a,
  });
  writeSecrets(useAppStore.getState().providerConfigs, true);
  const retained = useAppStore.getState();
  await removeSupplier(a);
  const state = useAppStore.getState();
  expect(state.providerConfigs).not.toHaveProperty(a);
  expect(state.providerRuntime).not.toHaveProperty(a);
  expect(state.models.every((item) => item.connectionId === b)).toBe(true);
  expect(state.models.find((item) => item.key === state.activeImageModelKey)?.connectionId).toBe(b);
  expect(state.models.find((item) => item.key === state.activeTextModelKey)?.connectionId).toBe(b);
  expect(state.preferences.reviewModelKey).toBeNull();
  expect(state.connectionToEdit).toBeNull();
  expect(state.providerConfigs[b]).toBe(retained.providerConfigs[b]);
  expect(state.sessions).toBe(retained.sessions);
  expect(state.drafts).toBe(retained.drafts);
  expect(state.assets).toBe(retained.assets);
  expect(readSecrets().keys).toEqual({ [b]: 'test-b' });
  const persisted = db.put.mock.calls.at(-1)![1];
  expect(persisted.connections).not.toHaveProperty(a);
  expect(persisted.activeImageModelKey).toBe(state.activeImageModelKey);
  db.get.mockResolvedValue(persisted);
  db.getAll.mockResolvedValue(Object.values(state.assets));
  useAppStore.setState(useAppStore.getInitialState(), true);
  await useAppStore.getState().hydrate();
  expect(useAppStore.getState().providerConfigs).not.toHaveProperty(a);
  expect(useAppStore.getState().sessions).toEqual(state.sessions);
  expect(readSecrets().keys).not.toHaveProperty(a);
});

it('leaves the supplier, selection and both key stores unchanged when deletion cannot persist', async () => {
  const a = await saveSupplier(null, config('a'));
  await saveSupplierModels(a, [model]);
  const before = useAppStore.getState();
  const secrets = readSecrets();
  db.put.mockRejectedValueOnce(new Error('quota'));
  await expect(removeSupplier(a)).rejects.toThrow('quota');
  expect(useAppStore.getState()).toBe(before);
  expect(readSecrets()).toEqual(secrets);
});

it('deletes a legacy supplier without restoring its keys or enabled models on reload', async () => {
  useAppStore.setState({ providerConfigs: { openai: { ...config('a'), configured: true } } });
  await saveSupplierModels('openai', [model]);
  await removeSupplier('openai');
  expect(useAppStore.getState().activeImageModelKey).toBeNull();
  expect(useAppStore.getState().activeTextModelKey).toBeNull();
  const saved = db.put.mock.calls.at(-1)![1];
  db.get.mockResolvedValue(saved);
  db.getAll.mockResolvedValue([]);
  useAppStore.setState(useAppStore.getInitialState(), true);
  await useAppStore.getState().hydrate();
  const state = useAppStore.getState();
  expect(state.providerConfigs.openai.apiKey).toBe('');
  expect(state.providerConfigs.openai.configured).toBeFalsy();
  expect(state.models).toEqual([]);
  expect(readSecrets().keys).toEqual({});
});
