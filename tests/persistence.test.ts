import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { createDefaultMeta, emptyDraft } from '@/lib/defaults';
import { customModel } from '@/lib/customModels';
import { loadAssets, loadMeta, saveAssets } from '@/lib/storage';
import { useAppStore } from '@/store/appStore';
import type { Asset, Session } from '@/types';

const database = vi.hoisted(() => ({
  get: vi.fn(),
  getAll: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('idb', () => ({ openDB: vi.fn(async () => database) }));

const draftKey = (id: string) => `aigc-studio-lite:draft:${id}`;
const session = (id: string): Session => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  messages: [],
});
const asset = (id: string, sessionId = 'one'): Asset => ({
  id,
  sessionId,
  source: 'generated',
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,YQ==',
  createdAt: 1,
});

let local: Map<string, string>;
let storage: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState(useAppStore.getInitialState(), true);
  database.get.mockResolvedValue(null);
  database.getAll.mockResolvedValue([]);
  database.delete.mockResolvedValue(undefined);
  local = new Map();
  storage = {
    getItem: vi.fn((key: string) => local.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => local.set(key, value)),
    removeItem: vi.fn((key: string) => local.delete(key)),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', { getItem: () => null });
});
afterEach(() => vi.unstubAllGlobals());

describe('stored data and session lifecycle', () => {
  it('reopens the database after an initial open failure', async () => {
    vi.resetModules();
    const storageModule = await import('@/lib/storage');
    vi.mocked(openDB).mockRejectedValueOnce(new Error('open denied'));
    await expect(storageModule.loadMeta()).rejects.toThrow('open denied');
    await expect(storageModule.loadMeta()).resolves.toBeNull();
    expect(openDB).toHaveBeenCalledTimes(2);
  });

  it('loads legacy workspaces without dropping sessions, drafts or gallery ownership', async () => {
    const meta = createDefaultMeta();
    const sessions = [
      { ...session('one'), workspaceId: 'a', messages: [{ id: 'message', content: 'hello' }] },
      { ...session('two'), workspaceId: 'b' },
    ];
    database.get.mockResolvedValue({
      ...meta,
      version: 1,
      workspaces: [{ id: 'a' }, { id: 'b' }],
      activeWorkspaceId: 'b',
      activeSessionId: 'two',
      sessions,
      drafts: { one: { ...emptyDraft(), studio: 'draft' } },
    });
    database.getAll.mockResolvedValue([{ ...asset('image', 'two'), workspaceId: 'b' }]);
    const loaded = await loadMeta();
    expect(loaded).not.toHaveProperty('workspaces');
    expect(loaded).not.toHaveProperty('activeWorkspaceId');
    expect(loaded?.sessions.map((item) => item.id)).toEqual(['one', 'two']);
    expect(loaded?.sessions[0]).not.toHaveProperty('workspaceId');
    expect(loaded?.sessions[0].messages).toEqual(sessions[0].messages);
    expect(loaded?.drafts.one.studio).toBe('draft');
    expect(loaded?.activeSessionId).toBe('two');
    expect(await loadAssets()).toEqual([asset('image', 'two')]);
  });

  it.each(['valid', 'malformed', 'blocked'])(
    'restores protocol choice and tolerates %s local draft storage',
    async (mode) => {
      const meta = createDefaultMeta();
      meta.connections.openai.chatApi = 'responses';
      meta.models = [
        {
          key: 'openai::gpt-image-2.5',
          providerId: 'openai',
          modelId: 'gpt-image-2.5',
          label: 'Image',
          kind: 'image',
          capabilities: {
            imageGeneration: true,
            tools: false,
            vision: false,
            imageEditing: false,
            image: { supportsEdit: false },
          },
        },
      ];
      meta.drafts[meta.activeSessionId].studio = 'saved';
      database.get.mockResolvedValue(meta);
      local.set(
        draftKey(meta.activeSessionId),
        mode === 'valid' ? JSON.stringify({ ...emptyDraft(), studio: 'latest' }) : '{broken',
      );
      if (mode === 'blocked')
        storage.getItem.mockImplementation(() => {
          throw new Error('storage denied');
        });
      await useAppStore.getState().hydrate();
      const state = useAppStore.getState();
      expect(state.hydrated).toBe(true);
      expect(state.bootError).toBeNull();
      expect(state.providerConfigs.openai.chatApi).toBe('responses');
      expect(state.models[0].capabilities.imageEditing).toBe(true);
      expect(state.models[0].capabilities.image?.supportsEdit).toBe(true);
      expect(state.drafts[meta.activeSessionId].studio).toBe(mode === 'valid' ? 'latest' : 'saved');
    },
  );

  it.each(['metadata', 'assets'])(
    'blocks hydration after a failed %s read and allows retry',
    async (failedRead) => {
      const meta = createDefaultMeta();
      meta.sessions[0].title = 'Previously saved';
      database.get.mockResolvedValue(meta);
      const failed = failedRead === 'metadata' ? database.get : database.getAll;
      failed.mockRejectedValueOnce(new Error('database temporarily unavailable'));

      await useAppStore.getState().hydrate();
      expect(useAppStore.getState()).toMatchObject({
        hydrated: false,
        hydrating: false,
        bootError: expect.any(String),
      });

      await useAppStore.getState().hydrate();
      expect(useAppStore.getState().hydrated).toBe(true);
      expect(useAppStore.getState().sessions[0].title).toBe('Previously saved');
      expect(useAppStore.getState().bootError).toBeNull();
    },
  );

  it('preserves manually disabled reference images when restoring GPT Image 2.5', async () => {
    const meta = createDefaultMeta();
    const model = customModel({
      provider: 'openai',
      id: 'gpt-image-2.5',
      label: 'Custom image',
      kind: 'image',
      vision: false,
      tools: false,
      references: false,
    });
    meta.models = [model];
    database.get.mockResolvedValue(meta);
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().models[0]).toEqual(model);
    expect(useAppStore.getState().models[0].capabilities.image?.supportsEdit).toBe(false);
    expect(useAppStore.getState().models[0].capabilities.imageEditing).toBe(false);
  });

  it('removes a deleted session draft while preserving its gallery images', () => {
    const image = asset('image');
    local.set(draftKey('one'), JSON.stringify(emptyDraft()));
    useAppStore.setState({
      sessions: [session('one'), session('two')],
      activeSessionId: 'one',
      drafts: { one: emptyDraft(), two: emptyDraft() },
      assets: { image },
    });
    useAppStore.getState().deleteSession('one');
    const state = useAppStore.getState();
    expect(state.sessions.map((item) => item.id)).toEqual(['two']);
    expect(state.activeSessionId).toBe('two');
    expect(state.drafts).not.toHaveProperty('one');
    expect(local.has(draftKey('one'))).toBe(false);
    expect(state.assets.image).toBe(image);
    expect(database.delete).not.toHaveBeenCalled();
  });

  it('removes asset references without rewriting unrelated sessions and local drafts', async () => {
    const unrelated = session('two');
    const untouchedDraft = emptyDraft();
    const attached = { ...emptyDraft(), studioAttachmentIds: ['image', 'keep'] };
    const related = {
      ...session('one'),
      messages: [
        { id: 'm', role: 'user' as const, content: 'hello', createdAt: 1, imageIds: ['image'] },
      ],
    };
    useAppStore.setState({
      sessions: [related, unrelated],
      drafts: { one: attached, two: untouchedDraft },
      assets: { image: asset('image'), keep: asset('keep') },
    });
    await useAppStore.getState().deleteAsset('image');
    const state = useAppStore.getState();
    expect(state.assets).not.toHaveProperty('image');
    expect(state.assets.keep).toBeDefined();
    expect(state.sessions[0].messages[0].imageIds).toEqual([]);
    expect(state.sessions[1]).toBe(unrelated);
    expect(state.drafts.two).toBe(untouchedDraft);
    expect(state.drafts.one.studioAttachmentIds).toEqual(['keep']);
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual([draftKey('one')]);
    expect(database.delete).toHaveBeenCalledWith('assets', 'image');
  });

  it('writes a generated image batch in one transaction and waits for commit', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    let commit!: () => void;
    const done = new Promise<void>((resolve) => {
      commit = resolve;
    });
    database.transaction.mockReturnValue({ store: { put }, done });
    const images = [asset('one'), asset('two')];
    let saved = false;
    const write = saveAssets(images).then(() => {
      saved = true;
    });
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.transaction).toHaveBeenCalledWith('assets', 'readwrite');
    expect(put.mock.calls.map(([image]) => image)).toEqual(images);
    expect(saved).toBe(false);
    commit();
    await write;
    expect(saved).toBe(true);
  });

  it('preserves the image and all references when persistent deletion fails', async () => {
    const assets = { image: asset('image') };
    const sessions = [session('one')];
    const drafts = { one: { ...emptyDraft(), studioAttachmentIds: ['image'] } };
    useAppStore.setState({ assets, sessions, drafts });
    database.delete.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(useAppStore.getState().deleteAsset('image')).rejects.toThrow(
      'database unavailable',
    );
    const state = useAppStore.getState();
    expect(state.assets).toBe(assets);
    expect(state.sessions).toBe(sessions);
    expect(state.drafts).toBe(drafts);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('retains new sessions created while an asset deletion is pending', async () => {
    let deleted!: () => void;
    database.delete.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        deleted = resolve;
      }),
    );
    useAppStore.setState({
      assets: { image: asset('image') },
      sessions: [session('one')],
      activeSessionId: 'one',
      drafts: { one: emptyDraft() },
    });
    const deletion = useAppStore.getState().deleteAsset('image');
    const createdId = useAppStore.getState().createSession('Created while deleting');
    useAppStore.getState().setDraftText(createdId, 'studio', 'keep this draft');
    deleted();
    await deletion;
    const state = useAppStore.getState();
    expect(state.sessions.some((item) => item.id === createdId)).toBe(true);
    expect(state.activeSessionId).toBe(createdId);
    expect(state.drafts[createdId].studio).toBe('keep this draft');
    expect(state.assets).not.toHaveProperty('image');
  });
});
