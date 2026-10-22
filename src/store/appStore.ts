import { create } from 'zustand';
import { openAIImageCapabilities } from '@/providers/model-capabilities';
import { normalizeBaseUrl } from '@/providers/shared';
import type {
  AgentActivity,
  Asset,
  ChatMessage,
  ConnectionMeta,
  ImageParams,
  ModelDescriptor,
  NetworkMode,
  PersistedMeta,
  Preferences,
  ReviewSettings,
  PromptPreset,
  ProviderConfig,
  ProviderConfigs,
  ProviderId,
  ProviderRuntime,
  Session,
  SessionDraft,
  ViewId,
} from '@/types';
import { createId } from '@/lib/id';
import { markdownPreview } from '@/lib/text';
import { createDefaultMeta, emptyDraft } from '@/lib/defaults';
import {
  loadAssets,
  loadMeta,
  mergeLocalDrafts,
  removeAsset as removeAssetFromDb,
  removeLocalDraft,
  readSecrets,
  saveAssets,
  writeLocalDraft,
} from '@/lib/storage';
import {
  DEFAULT_IMAGE_PARAMS,
  defaultProviderConfigs,
  getModel,
  normalizeImageParams,
} from '@/providers';

export interface Toast {
  id: string;
  message: string;
  tone: 'neutral' | 'success' | 'error';
}

interface AppState {
  hydrated: boolean;
  hydrating: boolean;
  bootError: string | null;
  sessions: Session[];
  presets: PromptPreset[];
  models: ModelDescriptor[];
  assets: Record<string, Asset>;
  drafts: Record<string, SessionDraft>;
  activeSessionId: string;
  activeView: ViewId;
  activeImageModelKey: string | null;
  activeTextModelKey: string | null;
  imageParams: ImageParams;
  providerConfigs: ProviderConfigs;
  providerRuntime: Record<ProviderId, ProviderRuntime>;
  preferences: Preferences;
  proxyAvailable: boolean | null;
  toasts: Toast[];

  hydrate: () => Promise<void>;
  addToast: (message: string, tone?: Toast['tone']) => string;
  dismissToast: (id: string) => void;
  setActiveView: (view: ViewId) => void;

  activateSession: (sessionId: string) => void;
  createSession: (title?: string) => string;
  toggleSessionPin: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => void;
  ensureSessionTitle: (sessionId: string, prompt: string) => void;

  setDraftText: (sessionId: string, mode: 'studio' | 'chat', text: string) => void;
  setDraftAttachments: (
    sessionId: string,
    mode: 'studio' | 'chat',
    attachmentIds: string[],
  ) => void;
  addDraftAttachment: (sessionId: string, mode: 'studio' | 'chat', attachmentId: string) => void;
  removeDraftAttachment: (sessionId: string, mode: 'studio' | 'chat', attachmentId: string) => void;

  addAssets: (assets: Asset[]) => void;
  deleteAsset: (assetId: string) => Promise<void>;

  addChatMessage: (sessionId: string, message: ChatMessage) => void;
  patchChatMessage: (
    sessionId: string,
    messageId: string,
    patch: Partial<ChatMessage> | ((message: ChatMessage) => Partial<ChatMessage>),
  ) => void;
  appendChatText: (sessionId: string, messageId: string, text: string) => void;
  addChatActivity: (sessionId: string, messageId: string, activity: AgentActivity) => void;
  patchChatActivity: (
    sessionId: string,
    messageId: string,
    activityId: string,
    patch: Partial<AgentActivity>,
  ) => void;

  addPreset: (input: { title: string; content: string; tags: string[] }) => PromptPreset;
  updatePreset: (
    presetId: string,
    patch: Partial<Pick<PromptPreset, 'title' | 'content' | 'tags'>>,
  ) => void;
  deletePreset: (presetId: string) => void;

  setProviderConfig: (provider: ProviderId, patch: Partial<ProviderConfig>) => void;
  beginProviderFetch: (provider: ProviderId) => void;
  setProviderModels: (provider: ProviderId, models: ModelDescriptor[]) => void;
  setProviderError: (provider: ProviderId, error: string) => void;
  resetProviderStatus: (provider: ProviderId) => void;
  disconnectProvider: (provider: ProviderId) => void;
  setActiveImageModel: (key: string | null) => void;
  setActiveTextModel: (key: string | null) => void;
  setImageParams: (patch: Partial<ImageParams>) => void;
  setNetworkMode: (mode: NetworkMode) => void;
  setReviewModel: (key: string | null) => void;
  setReviewSettings: (settings: ReviewSettings) => void;
  setProxyAvailable: (available: boolean | null) => void;
}

function ensureDraft(state: Pick<AppState, 'drafts'>, sessionId: string): SessionDraft {
  return state.drafts[sessionId] ?? emptyDraft();
}

function withSession(
  sessions: Session[],
  sessionId: string,
  updater: (session: Session) => Session,
): Session[] {
  return sessions.map((session) => (session.id === sessionId ? updater(session) : session));
}

function imageModelRank(model: ModelDescriptor): number {
  const id = model.modelId.toLowerCase();
  if (/gpt-image-1(?!-mini)/.test(id)) return 100;
  if (/gpt-image/.test(id)) return 90;
  if (/chatgpt-image/.test(id)) return 85;
  if (/grok.*image|grok.*imagine/.test(id)) return 84;
  if (/gemini-3.*image/.test(id)) return 82;
  if (/gemini.*image|banana/.test(id)) return 80;
  if (/imagen/.test(id)) return 72;
  if (/dall-e-3/.test(id)) return 60;
  if (/dall-e/.test(id)) return 40;
  return 50;
}

function textModelRank(model: ModelDescriptor): number {
  const { tools, vision } = model.capabilities;
  const id = model.modelId.toLowerCase();
  let score = (tools ? 20 : 0) + (vision ? 10 : 0);
  if (/gpt-4\.?1|gpt-4o|claude.*sonnet|gemini.*pro/.test(id)) score += 5;
  if (/mini|flash|haiku/.test(id)) score -= 1;
  return score;
}

function chooseModels(
  models: ModelDescriptor[],
  currentImage: string | null,
  currentText: string | null,
): { image: string | null; text: string | null } {
  const imageModels = [...models.filter((model) => model.kind === 'image')].sort(
    (a, b) => imageModelRank(b) - imageModelRank(a),
  );
  const textModels = [...models.filter((model) => model.kind === 'text')].sort(
    (a, b) => textModelRank(b) - textModelRank(a),
  );
  const imageExists = imageModels.some((model) => model.key === currentImage);
  const textExists = textModels.some((model) => model.key === currentText);
  return {
    image: imageExists ? currentImage : (imageModels[0]?.key ?? null),
    text: textExists ? currentText : (textModels[0]?.key ?? null),
  };
}

function hydrateInvariants(meta: PersistedMeta): PersistedMeta {
  const sessions = meta.sessions.length ? meta.sessions : createDefaultMeta().sessions;
  const safeSessions = sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.status === 'streaming'
        ? {
            ...message,
            status: 'error' as const,
            error: message.error || '页面刷新，本次生成已中断。',
          }
        : message,
    ),
  }));

  const activeSessionId = safeSessions.some((session) => session.id === meta.activeSessionId)
    ? meta.activeSessionId
    : safeSessions[0].id;

  const drafts = Object.fromEntries(
    safeSessions.map((session) => [session.id, meta.drafts[session.id] ?? emptyDraft()]),
  );

  meta.models = meta.models.map((model) => {
    if (
      model.manual ||
      model.providerId !== 'openai' ||
      model.kind !== 'image' ||
      !/(?:gpt|chatgpt)-image-2\.5/i.test(model.modelId)
    )
      return model;
    const image = openAIImageCapabilities(model.modelId);
    return {
      ...model,
      capabilities: { ...model.capabilities, image, imageEditing: Boolean(image.supportsEdit) },
    };
  });
  const presets = meta.presets.filter((preset) => !preset.id.startsWith('preset_seed_'));
  const selected = chooseModels(meta.models, meta.activeImageModelKey, meta.activeTextModelKey);
  const imageModel = meta.models.find((model) => model.key === selected.image);

  return {
    ...meta,
    sessions: safeSessions,
    presets,
    activeSessionId,
    drafts,
    activeImageModelKey: selected.image,
    activeTextModelKey: selected.text,
    imageParams: normalizeImageParams(
      meta.imageParams ?? DEFAULT_IMAGE_PARAMS,
      imageModel?.capabilities.image,
    ),
    version: 2,
  };
}

export function snapshotMeta(state: AppState): PersistedMeta {
  const connections = Object.fromEntries(
    (Object.keys(state.providerConfigs) as ProviderId[]).map((provider) => {
      const config = state.providerConfigs[provider];
      const value: ConnectionMeta = {
        baseUrl: config.baseUrl,
        chatApi: config.chatApi,
        rememberKey: config.rememberKey,
      };
      return [provider, value];
    }),
  ) as Record<ProviderId, ConnectionMeta>;

  return {
    version: 2,
    sessions: state.sessions,
    presets: state.presets,
    models: state.models,
    activeSessionId: state.activeSessionId,
    activeView: state.activeView,
    activeImageModelKey: state.activeImageModelKey,
    activeTextModelKey: state.activeTextModelKey,
    imageParams: state.imageParams,
    drafts: state.drafts,
    connections,
    preferences: state.preferences,
  };
}

const initialMeta = createDefaultMeta();
const initialConfigs = defaultProviderConfigs();

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,
  hydrating: false,
  bootError: null,
  sessions: [],
  presets: [],
  models: [],
  assets: {},
  drafts: {},
  activeSessionId: '',
  activeView: 'studio',
  activeImageModelKey: null,
  activeTextModelKey: null,
  imageParams: DEFAULT_IMAGE_PARAMS,
  providerConfigs: initialConfigs,
  providerRuntime: {
    openai: { status: 'idle' },
    anthropic: { status: 'idle' },
    google: { status: 'idle' },
    xai: { status: 'idle' },
  },
  preferences: {
    networkMode: 'auto',
    reviewModelKey: null,
  },
  proxyAvailable: null,
  toasts: [],

  hydrate: async () => {
    if (get().hydrated || get().hydrating) return;
    set({ hydrating: true, bootError: null });
    try {
      const [storedMeta, assets] = await Promise.all([loadMeta(), loadAssets()]);
      const meta = mergeLocalDrafts(hydrateInvariants(storedMeta ?? initialMeta));

      const secrets = readSecrets();
      const configs = defaultProviderConfigs();
      for (const provider of Object.keys(configs) as ProviderId[]) {
        configs[provider] = {
          apiKey: secrets.keys[provider] ?? '',
          chatApi: meta.connections[provider]?.chatApi ?? 'auto',
          baseUrl: normalizeBaseUrl(
            meta.connections[provider]?.baseUrl || configs[provider].baseUrl,
            provider,
          ),
          rememberKey:
            secrets.remembered[provider] ?? meta.connections[provider]?.rememberKey ?? true,
        };
      }

      const assetRecord = Object.fromEntries(assets.map((asset) => [asset.id, asset]));
      const selected = chooseModels(meta.models, meta.activeImageModelKey, meta.activeTextModelKey);
      const selectedImage = meta.models.find((model) => model.key === selected.image);
      const runtime: Record<ProviderId, ProviderRuntime> = {
        openai: { status: 'idle' },
        anthropic: { status: 'idle' },
        google: { status: 'idle' },
        xai: { status: 'idle' },
      };
      for (const provider of Object.keys(runtime) as ProviderId[]) {
        const hasKey = Boolean(configs[provider].apiKey);
        const hasModels = meta.models.some((model) => model.providerId === provider);
        runtime[provider] = {
          status: hasKey && hasModels ? 'connected' : 'idle',
        };
      }

      set({
        hydrated: true,
        sessions: meta.sessions,
        presets: meta.presets,
        models: meta.models,
        assets: assetRecord,
        drafts: meta.drafts,
        activeSessionId: meta.activeSessionId,
        activeView: (['studio', 'gallery', 'presets', 'review', 'settings'] as const).includes(
          meta.activeView,
        )
          ? meta.activeView
          : 'studio',
        activeImageModelKey: selected.image,
        activeTextModelKey: selected.text,
        imageParams: normalizeImageParams(meta.imageParams, selectedImage?.capabilities.image),
        providerConfigs: configs,
        providerRuntime: runtime,
        preferences: {
          networkMode: meta.preferences?.networkMode ?? 'auto',
          reviewModelKey: meta.preferences?.reviewModelKey ?? null,
          reviewSettings: meta.preferences?.reviewSettings,
          reduceMotion: meta.preferences?.reduceMotion,
        },
        hydrating: false,
        bootError: null,
      });
    } catch (error) {
      console.error('AIGC Studio failed to hydrate local state.', error);
      set({
        hydrating: false,
        bootError: error instanceof Error ? error.message : '本地数据读取失败，请刷新页面后重试。',
      });
    }
  },

  addToast: (message, tone = 'neutral') => {
    const id = createId('toast');
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    return id;
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  setActiveView: (activeView) => set({ activeView }),

  activateSession: (sessionId) => {
    const session = get().sessions.find((item) => item.id === sessionId);
    if (!session) return;
    set((state) => ({
      activeSessionId: sessionId,
      activeView: 'studio',
      drafts: state.drafts[sessionId]
        ? state.drafts
        : { ...state.drafts, [sessionId]: emptyDraft() },
    }));
  },

  createSession: (title = '新会话') => {
    const state = get();
    const now = Date.now();
    const session: Session = {
      id: createId('session'),
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    const draft = emptyDraft();
    writeLocalDraft(session.id, draft);
    set({
      sessions: [session, ...state.sessions],
      activeSessionId: session.id,
      activeView: 'studio',
      drafts: { ...state.drafts, [session.id]: draft },
    });
    return session.id;
  },

  toggleSessionPin: (sessionId) =>
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (session) => ({
        ...session,
        pinned: !session.pinned,
      })),
    })),

  renameSession: (sessionId, title) => {
    const clean = title.trim();
    if (!clean) return;
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (session) => ({
        ...session,
        title: clean,
        updatedAt: Date.now(),
      })),
    }));
  },

  deleteSession: (sessionId) => {
    const state = get();
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const nextSessions = state.sessions.filter((item) => item.id !== sessionId);
    const drafts = { ...state.drafts };
    delete drafts[sessionId];
    if (nextSessions.length === 0) {
      const now = Date.now();
      const newSession: Session = {
        id: createId('session'),
        title: '新会话',
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      const draft = emptyDraft();
      writeLocalDraft(newSession.id, draft);
      nextSessions.unshift(newSession);
      set({
        sessions: nextSessions,
        drafts: { ...drafts, [newSession.id]: draft },
        activeSessionId:
          state.activeSessionId === sessionId ? newSession.id : state.activeSessionId,
      });
    } else {
      const nextActive =
        state.activeSessionId === sessionId
          ? nextSessions.reduce((latest, item) =>
              item.updatedAt > latest.updatedAt ? item : latest,
            ).id
          : state.activeSessionId;
      set({ sessions: nextSessions, drafts, activeSessionId: nextActive });
    }
    removeLocalDraft(sessionId);
  },

  ensureSessionTitle: (sessionId, prompt) => {
    const session = get().sessions.find((item) => item.id === sessionId);
    if (!session || (session.title !== '新会话' && session.title !== '第一张画')) return;
    const title = markdownPreview(prompt, 24);
    if (!title) return;
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (item) => ({ ...item, title })),
    }));
  },

  setDraftText: (sessionId, mode, text) => {
    const state = get();
    const current = ensureDraft(state, sessionId);
    if (current[mode] === text) return;
    const draft = { ...current, [mode]: text };
    writeLocalDraft(sessionId, draft);
    set({ drafts: { ...state.drafts, [sessionId]: draft } });
  },

  setDraftAttachments: (sessionId, mode, attachmentIds) => {
    const state = get();
    const current = ensureDraft(state, sessionId);
    const key = mode === 'studio' ? 'studioAttachmentIds' : 'chatAttachmentIds';
    if (
      current[key].length === attachmentIds.length &&
      current[key].every((id, index) => id === attachmentIds[index])
    )
      return;
    const draft = { ...current, [key]: attachmentIds };
    writeLocalDraft(sessionId, draft);
    set({ drafts: { ...state.drafts, [sessionId]: draft } });
  },

  addDraftAttachment: (sessionId, mode, attachmentId) => {
    const state = get();
    const current = ensureDraft(state, sessionId);
    const key = mode === 'studio' ? 'studioAttachmentIds' : 'chatAttachmentIds';
    if (current[key].includes(attachmentId)) return;
    const draft = { ...current, [key]: [...current[key], attachmentId].slice(0, 6) };
    writeLocalDraft(sessionId, draft);
    set({ drafts: { ...state.drafts, [sessionId]: draft } });
  },

  removeDraftAttachment: (sessionId, mode, attachmentId) => {
    const state = get();
    const current = ensureDraft(state, sessionId);
    const key = mode === 'studio' ? 'studioAttachmentIds' : 'chatAttachmentIds';
    if (!current[key].includes(attachmentId)) return;
    const draft = { ...current, [key]: current[key].filter((id) => id !== attachmentId) };
    writeLocalDraft(sessionId, draft);
    set({ drafts: { ...state.drafts, [sessionId]: draft } });
  },

  addAssets: (assets) => {
    if (assets.length === 0) return;
    set((state) => ({
      assets: {
        ...state.assets,
        ...Object.fromEntries(assets.map((asset) => [asset.id, asset])),
      },
    }));
    void saveAssets(assets);
  },

  deleteAsset: async (assetId) => {
    if (!get().assets[assetId]) return;
    await removeAssetFromDb(assetId);
    const state = get();
    if (!state.assets[assetId]) return;
    const remaining = { ...state.assets };
    delete remaining[assetId];
    let drafts = state.drafts;
    for (const [sessionId, draft] of Object.entries(state.drafts)) {
      if (
        draft.studioAttachmentIds.includes(assetId) ||
        draft.chatAttachmentIds.includes(assetId)
      ) {
        if (drafts === state.drafts) drafts = { ...drafts };
        drafts[sessionId] = {
          ...draft,
          studioAttachmentIds: draft.studioAttachmentIds.filter((item) => item !== assetId),
          chatAttachmentIds: draft.chatAttachmentIds.filter((item) => item !== assetId),
        };
        writeLocalDraft(sessionId, drafts[sessionId]);
      }
    }
    const sessions = state.sessions.map((session) => {
      let changed = false;
      const messages = session.messages.map((message) => {
        if (!message.attachmentIds?.includes(assetId) && !message.imageIds?.includes(assetId))
          return message;
        changed = true;
        return {
          ...message,
          attachmentIds: message.attachmentIds?.filter((id) => id !== assetId),
          imageIds: message.imageIds?.filter((id) => id !== assetId),
        };
      });
      return changed ? { ...session, messages } : session;
    });
    set({
      assets: remaining,
      drafts,
      sessions: sessions.some((session, index) => session !== state.sessions[index])
        ? sessions
        : state.sessions,
    });
  },

  addChatMessage: (sessionId, message) => {
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (session) => ({
        ...session,
        updatedAt: Date.now(),
        messages: [...session.messages, message],
      })),
    }));
  },

  patchChatMessage: (sessionId, messageId, patch) => {
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (session) => ({
        ...session,
        updatedAt: Date.now(),
        messages: session.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                ...(typeof patch === 'function' ? patch(message) : patch),
              }
            : message,
        ),
      })),
    }));
  },

  appendChatText: (sessionId, messageId, text) => {
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === messageId ? { ...message, content: message.content + text } : message,
        ),
      })),
    }));
  },

  addChatActivity: (sessionId, messageId, activity) => {
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === messageId
            ? { ...message, activities: [...(message.activities ?? []), activity] }
            : message,
        ),
      })),
    }));
  },

  patchChatActivity: (sessionId, messageId, activityId, patch) => {
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                activities: message.activities?.map((activity) =>
                  activity.id === activityId ? { ...activity, ...patch } : activity,
                ),
              }
            : message,
        ),
      })),
    }));
  },

  addPreset: (input) => {
    const now = Date.now();
    const preset: PromptPreset = {
      id: createId('preset'),
      title: input.title.trim() || '未命名预设',
      content: input.content,
      tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ presets: [preset, ...state.presets] }));
    return preset;
  },

  updatePreset: (presetId, patch) => {
    set((state) => ({
      presets: state.presets.map((preset) =>
        preset.id === presetId
          ? {
              ...preset,
              ...patch,
              title: patch.title !== undefined ? patch.title.trim() || preset.title : preset.title,
              tags: patch.tags?.map((tag) => tag.trim()).filter(Boolean) ?? preset.tags,
              updatedAt: Date.now(),
            }
          : preset,
      ),
    }));
  },

  deletePreset: (presetId) => {
    set((state) => ({ presets: state.presets.filter((preset) => preset.id !== presetId) }));
  },

  setProviderConfig: (provider, patch) => {
    set((state) => ({
      providerConfigs: {
        ...state.providerConfigs,
        [provider]: {
          ...state.providerConfigs[provider],
          ...patch,
          ...(patch.baseUrl ? { baseUrl: normalizeBaseUrl(patch.baseUrl, provider) } : {}),
        },
      },
    }));
  },

  beginProviderFetch: (provider) => {
    set((state) => ({
      providerRuntime: {
        ...state.providerRuntime,
        [provider]: { ...state.providerRuntime[provider], status: 'connecting', error: undefined },
      },
    }));
  },

  setProviderModels: (provider, newModels) => {
    const state = get();
    const models = [...state.models.filter((model) => model.providerId !== provider), ...newModels];
    const selected = chooseModels(models, state.activeImageModelKey, state.activeTextModelKey);
    const imageModel = getModel(models, selected.image);
    set({
      models,
      activeImageModelKey: selected.image,
      activeTextModelKey: selected.text,
      imageParams: normalizeImageParams(state.imageParams, imageModel?.capabilities.image),
      providerRuntime: {
        ...state.providerRuntime,
        [provider]: { status: 'connected', fetchedAt: Date.now() },
      },
    });
  },

  setProviderError: (provider, error) => {
    set((state) => ({
      providerRuntime: {
        ...state.providerRuntime,
        [provider]: {
          ...state.providerRuntime[provider],
          status: 'error',
          error,
        },
      },
    }));
  },

  resetProviderStatus: (provider) => {
    set((state) => {
      const hasKey = Boolean(state.providerConfigs[provider].apiKey);
      const hasModels = state.models.some((model) => model.providerId === provider);
      return {
        providerRuntime: {
          ...state.providerRuntime,
          [provider]: {
            status: hasKey && hasModels ? 'connected' : 'idle',
          },
        },
      };
    });
  },

  disconnectProvider: (provider) => {
    const state = get();
    const models = state.models.filter((model) => model.providerId !== provider);
    const selected = chooseModels(models, state.activeImageModelKey, state.activeTextModelKey);
    const imageModel = getModel(models, selected.image);
    set({
      models,
      activeImageModelKey: selected.image,
      activeTextModelKey: selected.text,
      imageParams: normalizeImageParams(state.imageParams, imageModel?.capabilities.image),
      providerConfigs: {
        ...state.providerConfigs,
        [provider]: {
          ...state.providerConfigs[provider],
          apiKey: '',
        },
      },
      providerRuntime: {
        ...state.providerRuntime,
        [provider]: { status: 'idle' },
      },
    });
  },

  setActiveImageModel: (key) => {
    const state = get();
    const imageModel = getModel(state.models, key);
    set({
      activeImageModelKey: imageModel?.kind === 'image' ? key : null,
      imageParams: normalizeImageParams(state.imageParams, imageModel?.capabilities.image),
    });
  },

  setActiveTextModel: (key) => {
    const state = get();
    const model = getModel(state.models, key);
    set({ activeTextModelKey: model?.kind === 'text' ? key : null });
  },

  setImageParams: (patch) => {
    set((state) => ({ imageParams: { ...state.imageParams, ...patch } }));
  },

  setNetworkMode: (networkMode) => {
    set((state) => ({ preferences: { ...state.preferences, networkMode } }));
  },

  setReviewSettings: (reviewSettings) =>
    set((state) => ({ preferences: { ...state.preferences, reviewSettings } })),

  setReviewModel: (reviewModelKey) => {
    set((state) => ({ preferences: { ...state.preferences, reviewModelKey } }));
  },

  setProxyAvailable: (proxyAvailable) => set({ proxyAvailable }),
}));

export function useActiveSession(): Session | undefined {
  return useAppStore((state) =>
    state.sessions.find((session) => session.id === state.activeSessionId),
  );
}

export function resolveUseProxy(mode: NetworkMode, proxyAvailable: boolean | null): boolean {
  if (mode === 'proxy') return true;
  if (mode === 'direct') return false;
  return proxyAvailable === true;
}
