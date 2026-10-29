export type ProviderId = 'openai' | 'anthropic' | 'google' | 'xai' | 'volcengine';

export type ViewId = 'studio' | 'gallery' | 'presets' | 'review' | 'settings';

export type ModelKind = 'image' | 'text' | 'video';

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
  maxReferences?: number;
}

export interface ImageModelConfig {
  configId: string;
  displayName: string;
  aspectRatios: string[];
  aspectRatioLabels?: Record<string, string>;
  imageDimensions?: Record<string, { width: number; height: number }>;
  backgrounds?: string[];
  qualities?: string[];
  styles?: string[];
  outputFormats?: string[];
  resolutions?: string[];
  maxImagesPerRequest: number;
  supportsReferenceImages?: boolean;
  maxReferenceImages?: number;
}

export interface VideoModelConfig {
  configId: string;
  displayName: string;
  modes: VideoMode[];
  resolutions: string[];
  aspectRatios: string[];
  minDurationSeconds: number;
  maxDurationSeconds: number;
  supportsAutoDuration: boolean;
  supportsAudio: boolean;
  requiresAdaptiveFrameRatio: boolean;
  requiresAutoVideoReferenceParams?: boolean;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  maxReferenceDurationSeconds?: number;
  supportsAudioOnlyReference?: boolean;
}

export interface ModelConfigMapping {
  modelId: string;
  configId: string;
  selectable?: boolean;
}

export interface ProviderModelMappings {
  providerId: ProviderId;
  imageModels: ModelConfigMapping[];
  videoModels: ModelConfigMapping[];
}

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  imageGeneration: boolean;
  imageEditing?: boolean;
  image?: ImageCapabilities;
  video?: VideoCapabilities;
}

export interface ModelDescriptor {
  connectionId?: string;
  capabilityProfileId?: string;
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
  providerId?: ProviderId;
  name?: string;
  configured?: boolean;
  disabled?: boolean;
  chatApi?: 'auto' | 'chat-completions' | 'responses';
  useWorkerProxy?: boolean;
  baseUrl: string;
  rememberKey: boolean;
}

export interface ProviderConfig extends ConnectionMeta {
  apiKey: string;
}

export type ProviderConfigs = Record<string, ProviderConfig>;

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

export type ReferenceKind = 'image' | 'video' | 'audio';

export interface MediaMetadata {
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export interface Asset {
  media?: MediaMetadata;
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
  video?: VideoResult;
  videoParams?: VideoParams;
  generationElapsedMs?: number;
  reviewed?: boolean;
  createdAt: number;
}

export interface SessionDraft {
  video?: VideoDraft;
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
  reviewModelKey?: string | null;
  reduceMotion?: boolean;
  studioMode?: 'image' | 'video';
}

export interface PersistedMeta {
  version: 1 | 2 | 3;
  sessions: Session[];
  presets: PromptPreset[];
  models: ModelDescriptor[];
  activeSessionId: string;
  activeView: ViewId;
  activeImageModelKey: string | null;
  activeTextModelKey: string | null;
  imageParams: ImageParams;
  drafts: Record<string, SessionDraft>;
  connections: Record<string, ConnectionMeta>;
  preferences: Preferences;
}

export type VideoMode = 'text' | 'first-frame' | 'first-last-frame' | 'reference';

export interface VideoCapabilities {
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  maxReferenceDurationSeconds?: number;
  audioOnlyReference?: boolean;
  modes: VideoMode[];
  resolutions: string[];
  ratios: string[];
  minDuration: number;
  maxDuration: number;
  autoDuration: boolean;
  audio: boolean;
  adaptiveFrameRatio: boolean;
  autoVideoReferenceParams?: boolean;
}

export interface VideoParams {
  mode: VideoMode;
  resolution: string;
  ratio: string;
  duration: number;
  generateAudio: boolean;
  watermark: boolean;
}

export type VideoStyle = 'none' | 'cinematic' | 'documentary' | 'animation';

export interface VideoDraft {
  referenceIds?: string[];
  style?: VideoStyle;
  prompt: string;
  modelKey: string | null;
  params: VideoParams;
  firstFrameId?: string;
  lastFrameId?: string;
}

export interface GenerateVideoInput {
  prompt: string;
  params: VideoParams;
  references: Array<
    ImageReference &
      MediaMetadata & {
        role:
          'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio';
      }
  >;
}

export interface VideoResult {
  url: string;
  lastFrameUrl?: string;
  duration?: number;
}

export type VideoTaskStatus =
  | 'submitting'
  | 'unknown'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface VideoTaskUpdate {
  elapsedMs?: number;
  status: Exclude<VideoTaskStatus, 'submitting' | 'unknown'>;
  result?: VideoResult;
  error?: string;
}

export interface VideoTask {
  connectionId?: string;
  completedAt?: number;
  elapsedMs?: number;
  submittedPrompt?: string;
  id: string;
  remoteId?: string;
  sessionId: string;
  providerId: ProviderId;
  baseUrl: string;
  model: ModelDescriptor;
  draft: VideoDraft;
  status: VideoTaskStatus;
  result?: VideoResult;
  error?: string;
  queryError?: string;
  paused: boolean;
  assetSaved?: boolean;
  createdAt: number;
  updatedAt: number;
}
