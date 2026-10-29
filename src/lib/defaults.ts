import type { PersistedMeta, SessionDraft } from '@/types';
import { createId } from './id';

const EMPTY_DRAFT: SessionDraft = {
  studio: '',
  chat: '',
  studioAttachmentIds: [],
  chatAttachmentIds: [],
};

export function emptyDraft(): SessionDraft {
  return {
    ...EMPTY_DRAFT,
    studioAttachmentIds: [],
    chatAttachmentIds: [],
  };
}

export function createDefaultMeta(): PersistedMeta {
  const now = Date.now();
  const sessionId = createId('session');
  return {
    version: 3,
    sessions: [
      {
        id: sessionId,
        title: '新会话',
        createdAt: now,
        updatedAt: now,
        messages: [],
      },
    ],
    presets: [],
    models: [],
    activeSessionId: sessionId,
    activeView: 'studio',
    activeImageModelKey: null,
    activeTextModelKey: null,
    imageParams: {
      aspect: '1:1',
      quality: 'auto',
      background: 'auto',
      outputFormat: 'png',
      count: 1,
    },
    drafts: {
      [sessionId]: emptyDraft(),
    },
    connections: {
      volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', rememberKey: true },
      openai: { baseUrl: 'https://api.openai.com/v1', rememberKey: true },
      anthropic: { baseUrl: 'https://api.anthropic.com/v1', rememberKey: true },
      google: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        rememberKey: true,
      },
      xai: {
        baseUrl: 'https://api.x.ai/v1',
        rememberKey: true,
      },
    },
    preferences: {
      reviewModelKey: null,
    },
  };
}
