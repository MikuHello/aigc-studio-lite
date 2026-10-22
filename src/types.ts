export type ProviderId = 'openai' | 'anthropic' | 'google' | 'xai';

export type ViewId = 'studio' | 'gallery' | 'presets' | 'review' | 'settings';

export type NetworkMode = 'auto' | 'direct' | 'proxy';

export type ModelKind = 'image' | 'text';

export interface AspectOption {
  value: string;
  label: string;
  ratioW: number;
  ratioH: number;
  apiSize?: string;
}

export interface Option {
  value: string;
  label: string;
}

export interface ImageCapabilities {
  aspects?: AspectOption[];
  backgrounds?: Option[];
  qualities?: string[];
  styles?: string[];
  outputFormats?: string[];
  imageSizes?: string[];
  maxCount?: number;
  supportsEdit?: boolean;
}

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  imageGeneration: boolean;
  imageEditing?: boolean;
  image?: ImageCapabilities;
}

export interface ModelDescriptor {
  manual?: boolean;
  key: string;
  providerId: ProviderId;
  modelId: string;
  label: string;
  kind: ModelKind;
  capabilities: ModelCapabilities;
  description?: string;
}

export interface ImageParams {
  aspect: string;
  background?: string;
  quality?: string;
  style?: string;
  outputFormat?: string;
  imageSize?: string;
  count: number;
}

export interface ImageReference {
  mimeType: string;
  dataUrl: string;
  name?: string;
}

export interface GenerateImageInput {
  prompt: string;
  params: ImageParams;
  references: ImageReference[];
  signal?: AbortSignal;
}

export interface GeneratedImage {
  dataUrl: string;
  mimeType: string;
  revisedPrompt?: string;
  width?: number;
  height?: number;
}

export interface ChatImage {
  mimeType: string;
  dataUrl: string;
}

export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentToolResult {
  callId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface AgentToolContinuation {
  assistant: unknown;
  results: AgentToolResult[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRoundInput {
  system: string;
  messages: AgentHistoryMessage[];
  tools: AgentToolDefinition[];
  continuations: AgentToolContinuation[];
  signal?: AbortSignal;
  onText: (chunk: string) => void;
}

export interface ChatRoundResult {
  text: string;
  toolCalls: AgentToolCall[];
  rawAssistant: unknown;
}

export interface ConnectionMeta {
  chatApi?: 'auto' | 'chat-completions' | 'responses';
  baseUrl: string;
  rememberKey: boolean;
}

export interface ProviderConfig extends ConnectionMeta {
  apiKey: string;
}

export type ProviderConfigs = Record<ProviderId, ProviderConfig>;

export type ProviderStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface ProviderRuntime {
  status: ProviderStatus;
  error?: string;
  fetchedAt?: number;
}

export type MessageStatus = 'streaming' | 'done' | 'error';

export interface AgentActivity {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  attachmentIds?: string[];
  imageIds?: string[];
  activities?: AgentActivity[];
  status?: MessageStatus;
  error?: string;
}

export interface Session {
  pinned?: boolean;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface Asset {
  id: string;
  sessionId: string;
  source: 'generated' | 'upload';
  mimeType: string;
  dataUrl: string;
  filename?: string;
  prompt?: string;
  originalPrompt?: string;
  revisedPrompt?: string;
  modelKey?: string;
  modelLabel?: string;
  providerId?: ProviderId;
  params?: ImageParams;
  reviewed?: boolean;
  createdAt: number;
}

export interface SessionDraft {
  studio: string;
  chat: string;
  studioAttachmentIds: string[];
  chatAttachmentIds: string[];
}

export interface PromptPreset {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ReviewSettings {
  rules: string;
  passTargetModel: boolean;
  passAspectRatio: boolean;
  useReferenceImages: boolean;
}

export interface Preferences {
  reviewSettings?: ReviewSettings;
  networkMode: NetworkMode;
  reviewModelKey?: string | null;
  reduceMotion?: boolean;
}

export interface PersistedMeta {
  version: 1 | 2;
  sessions: Session[];
  presets: PromptPreset[];
  models: ModelDescriptor[];
  activeSessionId: string;
  activeView: ViewId;
  activeImageModelKey: string | null;
  activeTextModelKey: string | null;
  imageParams: ImageParams;
  drafts: Record<string, SessionDraft>;
  connections: Record<ProviderId, ConnectionMeta>;
  preferences: Preferences;
}
