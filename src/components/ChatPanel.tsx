import { useAvailableModels } from '@/store/appStore';
import { NoticeDetails } from './Toasts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Paperclip,
  LoaderCircle,
  Square,
  X,
} from 'lucide-react';
import type { AgentHistoryMessage, Asset, ChatMessage } from '@/types';
import { runAgentTurn } from '@/agent/runAgent';
import { createId } from '@/lib/id';
import { formatDateTime, copyText } from '@/lib/text';
import { resolveUseProxy, useAppStore } from '@/store/appStore';
import { useImageAttachments } from '@/hooks/useImageAttachments';
import { AgentAvatar } from '@/components/BrandMark';
import { Markdown } from '@/components/Markdown';
import {
  ExpandablePromptEditor as PromptEditor,
  type PromptEditorHandle,
} from '@/components/ExpandablePromptEditor';
import { PresetPicker } from '@/components/PresetPicker';
import { ImageLightbox } from '@/components/ImageLightbox';
import { ModelPicker } from '@/components/ModelPicker';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';

interface ChatPanelProps {
  open: boolean;
  width: number;
  onClose: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void;
  onResizeBy: (delta: number) => void;
  onOpenSettings: () => void;
  onOpenPresets: () => void;
}

const EMPTY_DRAFT = {
  studio: '',
  chat: '',
  studioAttachmentIds: [] as string[],
  chatAttachmentIds: [] as string[],
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '任务执行失败';
}

export function ChatPanel({
  open,
  width,
  onClose,
  onResizeStart,
  onResizeBy,
  onOpenSettings,
  onOpenPresets,
}: ChatPanelProps) {
  const sessionId = useAppStore((state) => state.activeSessionId);
  const session = useAppStore((state) =>
    state.sessions.find((item) => item.id === state.activeSessionId),
  );
  const draft = useAppStore((state) => state.drafts[state.activeSessionId]) ?? EMPTY_DRAFT;
  const assets = useAppStore((state) => state.assets);
  const models = useAvailableModels();
  const activeTextModelKey = useAppStore((state) => state.activeTextModelKey);
  const activeImageModelKey = useAppStore((state) => state.activeImageModelKey);
  const preferences = useAppStore((state) => state.preferences);
  const providerConfigs = useAppStore((state) => state.providerConfigs);
  const proxyAvailable = useAppStore((state) => state.proxyAvailable);
  const setDraftText = useAppStore((state) => state.setDraftText);
  const setDraftAttachments = useAppStore((state) => state.setDraftAttachments);
  const addAssets = useAppStore((state) => state.addAssets);
  const deleteAsset = useAppStore((state) => state.deleteAsset);
  const addChatMessage = useAppStore((state) => state.addChatMessage);
  const patchChatMessage = useAppStore((state) => state.patchChatMessage);
  const appendChatText = useAppStore((state) => state.appendChatText);
  const addChatActivity = useAppStore((state) => state.addChatActivity);
  const patchChatActivity = useAppStore((state) => state.patchChatActivity);
  const ensureSessionTitle = useAppStore((state) => state.ensureSessionTitle);
  const setActiveTextModel = useAppStore((state) => state.setActiveTextModel);

  const editorRef = useRef<PromptEditorHandle>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const runsRef = useRef<Map<string, AbortController>>(new Map());
  const copyTimerRef = useRef<number | null>(null);

  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const textModels = useMemo(() => models.filter((model) => model.kind === 'text'), [models]);
  const imageModels = useMemo(() => models.filter((model) => model.kind === 'image'), [models]);
  const textModel = textModels.find((model) => model.key === activeTextModelKey);
  const imageModel = imageModels.find((model) => model.key === activeImageModelKey);
  const runningCurrent = runningSessionIds.has(sessionId);

  const {
    attachments,
    dragActive,
    dropHandlers,
    reading: readingAttachments,
    maxAttachments,
    fileInputRef,
    pickFiles,
    onFilesSelected,
    removeAttachment,
  } = useImageAttachments(sessionId, 'chat', textModel?.capabilities.vision ? 6 : 0);

  const promptAttachments = useMemo(
    () =>
      attachments.map((asset, index) => ({
        id: asset.id,
        label: asset.filename || `参考图-${index + 1}.png`,
        dataUrl: asset.dataUrl,
      })),
    [attachments],
  );

  const messages = session?.messages ?? [];
  const lightboxAsset = lightboxAssetId ? assets[lightboxAssetId] : null;

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  };

  useEffect(() => {
    nearBottomRef.current = true;
    const frame = requestAnimationFrame(() => scrollToBottom('auto'));
    return () => cancelAnimationFrame(frame);
  }, [sessionId, open]);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToBottom('auto'));
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => {
    return () => {
      for (const controller of runsRef.current.values()) controller.abort();
      runsRef.current.clear();
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const setSessionRunning = (targetSessionId: string, running: boolean) => {
    setRunningSessionIds((current) => {
      const next = new Set(current);
      if (running) next.add(targetSessionId);
      else next.delete(targetSessionId);
      return next;
    });
  };

  const stopRun = (targetSessionId: string) => {
    const controller = runsRef.current.get(targetSessionId);
    if (!controller) return;
    controller.abort();
  };

  const send = () => {
    if (!session || !sessionId) return;
    if (runningCurrent || readingAttachments) return;
    if (!textModel) {
      onOpenSettings();
      return;
    }
    if (attachments.length && !textModel.capabilities.vision) {
      useAppStore
        .getState()
        .addToast('当前文字模型不支持图片理解，请移除参考图或切换模型。', 'error');
      return;
    }
    const prompt = (editorRef.current?.getMarkdown() ?? draft.chat).trim();
    if (!prompt) {
      editorRef.current?.focus();
      return;
    }

    const controller = new AbortController();
    runsRef.current.set(sessionId, controller);
    setSessionRunning(sessionId, true);
    nearBottomRef.current = true;
    ensureSessionTitle(sessionId, prompt);

    const attachmentAssets = attachments.slice();
    const imageReferences = attachmentAssets.map((asset) => ({
      mimeType: asset.mimeType,
      dataUrl: asset.dataUrl,
      name: asset.filename,
    }));
    const history: AgentHistoryMessage[] = messages
      .filter((message) => Boolean(message.content.trim()) && message.status !== 'streaming')
      .slice(-20)
      .map((message) => ({ role: message.role, content: message.content }));

    const userMessage: ChatMessage = {
      id: createId('msg'),
      role: 'user',
      content: prompt,
      createdAt: Date.now(),
      attachmentIds: attachmentAssets.map((asset) => asset.id),
    };
    const assistantId = createId('msg');
    addChatMessage(sessionId, userMessage);
    addChatMessage(sessionId, {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      imageIds: [],
      activities: [],
      status: 'streaming',
    });

    editorRef.current?.setMarkdown('');
    setDraftText(sessionId, 'chat', '');
    setDraftAttachments(sessionId, 'chat', []);

    const capturedSessionId = sessionId;
    const capturedAssistantId = assistantId;
    const capturedImageModel = imageModel;
    let buffer = '';
    let flushTimer: number | null = null;

    const flush = () => {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!buffer) return;
      const chunk = buffer;
      buffer = '';
      appendChatText(capturedSessionId, capturedAssistantId, chunk);
    };

    const scheduleFlush = () => {
      if (flushTimer !== null) return;
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        flush();
      }, 45);
    };

    const finishActivities = (status: 'done' | 'error', detail: string) => {
      patchChatMessage(capturedSessionId, capturedAssistantId, (message) => ({
        activities: message.activities?.map((activity) =>
          activity.status === 'running'
            ? { ...activity, status, detail: activity.detail ?? detail }
            : activity,
        ),
      }));
    };

    void (async () => {
      try {
        await runAgentTurn({
          textModel,
          imageModel: capturedImageModel,
          configs: providerConfigs,
          useProxy: resolveUseProxy(preferences.networkMode, proxyAvailable),
          history,
          userPrompt: prompt,
          userImages: imageReferences,
          signal: controller.signal,
          callbacks: {
            onText: (chunk) => {
              buffer += chunk;
              scheduleFlush();
            },
            onActivity: (activity) => {
              addChatActivity(capturedSessionId, capturedAssistantId, activity);
            },
            onActivityPatch: (activityId, patch) => {
              patchChatActivity(capturedSessionId, capturedAssistantId, activityId, patch);
            },
            onGeneratedImages: async (images, meta) => {
              const now = Date.now();
              const generated: Asset[] = images.map((image, index) => ({
                id: createId('asset'),
                sessionId: capturedSessionId,
                source: 'generated',
                mimeType: image.mimeType,
                dataUrl: image.dataUrl,
                prompt: meta.prompt,
                originalPrompt:
                  meta.originalPrompt !== meta.prompt ? meta.originalPrompt : undefined,
                revisedPrompt: image.revisedPrompt,
                modelKey: meta.model.key,
                modelLabel: meta.model.label,
                providerId: meta.model.providerId,
                params: meta.params,
                reviewed: meta.reviewed,
                createdAt: now + index,
              }));
              addAssets(generated);
              patchChatMessage(capturedSessionId, capturedAssistantId, (message) => ({
                imageIds: [...(message.imageIds ?? []), ...generated.map((asset) => asset.id)],
              }));
            },
          },
        });
        flush();
        finishActivities('done', '完成');
        patchChatMessage(capturedSessionId, capturedAssistantId, (message) => ({
          content:
            message.content.trim() ||
            (message.imageIds?.length ? '图像已生成。' : '没有产生新的内容。'),
          status: 'done',
        }));
      } catch (error) {
        flush();
        if (isAbortError(error)) {
          finishActivities('error', '已停止');
          patchChatMessage(capturedSessionId, capturedAssistantId, (message) => ({
            content: message.content.trim() || '已停止。',
            status: 'done',
            error: undefined,
          }));
        } else {
          if (!openRef.current || useAppStore.getState().activeSessionId !== capturedSessionId) {
            useAppStore.getState().addToast(errorText(error), 'error');
          }
          finishActivities('error', '中断');
          patchChatMessage(capturedSessionId, capturedAssistantId, {
            status: 'error',
            error: errorText(error),
          });
        }
      } finally {
        flush();
        if (flushTimer !== null) window.clearTimeout(flushTimer);
        runsRef.current.delete(capturedSessionId);
        setSessionRunning(capturedSessionId, false);
      }
    })();
  };

  const insertStarter = (text: string) => {
    editorRef.current?.insertMarkdown(text);
    editorRef.current?.focus();
  };

  const copyAssistant = async (message: ChatMessage) => {
    setCopiedMessageId(null);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    try {
      await copyText(message.content);
      setCopiedMessageId(message.id);
      copyTimerRef.current = window.setTimeout(() => setCopiedMessageId(null), 1500);
    } catch {
      useAppStore.getState().addToast('复制失败，请重试或选中文字手动复制。', 'error');
    }
  };

  const messageImages = (message: ChatMessage): Asset[] =>
    (message.imageIds ?? [])
      .map((id) => assets[id])
      .filter((asset): asset is Asset => Boolean(asset));

  return (
    <aside
      className={`chat-panel ${open ? 'is-open' : 'is-closed'}`}
      style={{ '--chat-width': `${width}px` } as React.CSSProperties}
      aria-label="Chat"
      aria-hidden={!open}
      inert={!open}
    >
      <div
        className="chat-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整 Chat 宽度"
        aria-valuenow={Math.round(width)}
        aria-valuemin={340}
        aria-valuemax={620}
        tabIndex={open ? 0 : -1}
        onPointerDown={onResizeStart}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            onResizeBy(24);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            onResizeBy(-24);
          }
        }}
      />

      <div className="chat-panel-inner">
        <header className="chat-panel-head">
          <div className="chat-panel-title">
            <h1>Chat</h1>
          </div>
          <div className="chat-panel-actions">
            <IconButton label="收起 Chat" icon={<X size={17} />} onClick={onClose} />
          </div>
        </header>

        <div
          className="chat-scroll"
          ref={scrollRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            nearBottomRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 140;
          }}
        >
          {messages.length === 0 ? (
            <div className="chat-panel-empty">
              <AgentAvatar size={30} />
              <h2>交给 Agent。</h2>
            </div>
          ) : (
            <div className="chat-log" role="log" aria-label="对话记录">
              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <article className="chat-turn is-user" key={message.id}>
                    <div className="chat-user-bubble">
                      <Markdown content={message.content} />
                      {(message.attachmentIds?.length ?? 0) > 0 && (
                        <div className="chat-user-attachments">
                          {message.attachmentIds?.map((id) => {
                            const asset = assets[id];
                            if (!asset) return null;
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setLightboxAssetId(asset.id)}
                                title={asset.filename ?? '参考图'}
                              >
                                <img src={asset.dataUrl} alt={asset.filename ?? '参考图'} />
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <time dateTime={new Date(message.createdAt).toISOString()}>
                        {formatDateTime(message.createdAt)}
                      </time>
                    </div>
                  </article>
                ) : (
                  <AgentMessage
                    key={message.id}
                    message={message}
                    images={messageImages(message)}
                    copied={copiedMessageId === message.id}
                    onCopy={() => void copyAssistant(message)}
                    onOpenImage={setLightboxAssetId}
                    onRestore={() => {
                      const previousUser = [...messages]
                        .slice(0, index)
                        .reverse()
                        .find((item) => item.role === 'user');
                      if (previousUser) insertStarter(previousUser.content);
                    }}
                  />
                ),
              )}
            </div>
          )}
        </div>

        <div className="chat-dock">
          {(attachments.length > 0 || readingAttachments) && (
            <div className="attachment-strip">
              {attachments.map((asset, index) => (
                <div className="attachment-card" key={asset.id}>
                  <img src={asset.dataUrl} alt={asset.filename ?? '参考图'} />
                  <span>{asset.filename || `参考图 ${index + 1}`}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(asset.id)}
                    aria-label={`移除 ${asset.filename ?? '参考图'}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {readingAttachments && (
                <div className="attachment-card is-loading">
                  <LoaderCircle size={16} className="spin" />
                  <span>读取中</span>
                </div>
              )}
            </div>
          )}

          <div
            className={`composer chat-composer ${dragActive ? 'is-dragging' : ''}`}
            {...dropHandlers}
          >
            {dragActive && <div className="composer-drop-hint">松开以添加参考图</div>}
            <PromptEditor
              key={`${sessionId}:chat`}
              ref={editorRef}
              initialValue={draft.chat}
              placeholder="给 Agent 一个任务"
              attachments={promptAttachments}
              compact
              onChange={(value) => setDraftText(sessionId, 'chat', value)}
              onSubmit={send}
              onAttachFiles={(files) => void onFilesSelected(files)}
              onRequestUpload={pickFiles}
            />
            <footer className="chat-composer-footer">
              <div className="composer-tools">
                <PresetPicker
                  compact
                  onSelect={(preset) => editorRef.current?.insertMarkdown(preset.content)}
                  onManage={onOpenPresets}
                />
              </div>
              <div className="composer-actions">
                <IconButton
                  label={textModel?.capabilities.vision ? '添加参考图' : '当前模型不支持图片理解'}
                  icon={<Paperclip size={18} />}
                  className="composer-plus"
                  disabled={readingAttachments || attachments.length >= maxAttachments}
                  onClick={pickFiles}
                />
                <ModelPicker
                  models={textModels}
                  value={activeTextModelKey}
                  onChange={setActiveTextModel}
                  onManage={onOpenSettings}
                  kind="text"
                  label="文本模型"
                  compact
                />
                {!textModel ? (
                  <Button variant="primary" size="sm" onClick={onOpenSettings}>
                    发送
                  </Button>
                ) : runningCurrent ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Square size={11} fill="currentColor" />}
                    onClick={() => stopRun(sessionId)}
                  >
                    停止
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    className="chat-send"
                    disabled={!draft.chat.trim() || readingAttachments}
                    icon={<ArrowUp size={17} />}
                    onClick={send}
                    aria-label="发送"
                    title="发送"
                  />
                )}
              </div>
            </footer>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.currentTarget.value = '';
            if (files.length > 0) void onFilesSelected(files);
          }}
        />
      </div>

      <ImageLightbox
        asset={lightboxAsset ?? null}
        onClose={() => setLightboxAssetId(null)}
        onDelete={(assetId) => {
          return deleteAsset(assetId);
        }}
      />
    </aside>
  );
}

function AgentMessage({
  message,
  images,
  copied,
  onCopy,
  onOpenImage,
  onRestore,
}: {
  message: ChatMessage;
  images: Asset[];
  copied: boolean;
  onCopy: () => void;
  onOpenImage: (assetId: string) => void;
  onRestore: () => void;
}) {
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const activities = message.activities ?? [];
  const activeActivity = [...activities]
    .reverse()
    .find((activity) => activity.status === 'running');
  const finishedActivities =
    message.status === 'streaming'
      ? activities.filter((activity) => activity.status !== 'running')
      : activities;
  const streaming = message.status === 'streaming';

  return (
    <article
      className={`chat-turn is-agent ${streaming ? 'is-streaming' : ''}`}
      aria-label="Agent 回复"
    >
      <div className="chat-agent-mark">
        <AgentAvatar size={26} />
      </div>
      <div className="chat-agent-body">
        <time className="message-time" dateTime={new Date(message.createdAt).toISOString()}>
          {formatDateTime(message.createdAt)}
        </time>

        {streaming && activeActivity && (
          <div className="chat-active-step" aria-live="polite">
            <LoaderCircle size={12} className="spin" />
            <span>{activeActivity.label}</span>
          </div>
        )}

        {message.content ? (
          streaming ? (
            <div className="chat-streaming">
              {message.content}
              <span className="chat-caret" aria-hidden="true" />
            </div>
          ) : (
            <Markdown content={message.content} />
          )
        ) : streaming && !activeActivity ? (
          <div className="chat-typing" aria-label="正在输入">
            <span />
            <span />
            <span />
          </div>
        ) : null}

        {images.length > 0 && (
          <div className={`chat-images ${images.length === 1 ? 'is-single' : ''}`}>
            {images.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onOpenImage(asset.id)}
                title="查看图像"
              >
                <img
                  src={asset.dataUrl}
                  alt={asset.prompt?.slice(0, 80) ?? '生成图像'}
                  loading="lazy"
                  decoding="async"
                />
              </button>
            ))}
          </div>
        )}

        {message.error && (
          <p className="chat-error" role="alert">
            <CircleAlert size={13} />
            <button type="button" onClick={() => setErrorDetailsOpen(true)}>
              任务失败 · 查看详情
            </button>
            <button type="button" onClick={onRestore}>
              重新填写
            </button>
          </p>
        )}

        <NoticeDetails
          message={errorDetailsOpen ? (message.error ?? null) : null}
          onClose={() => setErrorDetailsOpen(false)}
        />

        {finishedActivities.length > 0 && (
          <details className="agent-steps">
            <summary>
              {finishedActivities.length} 步
              <ChevronDown size={12} />
            </summary>
            <ol>
              {finishedActivities.map((activity) => (
                <li key={activity.id} className={`is-${activity.status}`}>
                  {activity.status === 'error' ? <CircleAlert size={11} /> : <Check size={11} />}
                  <span>{activity.label}</span>
                </li>
              ))}
            </ol>
          </details>
        )}

        {!streaming && message.content && (
          <div className="chat-message-actions">
            <IconButton
              label={copied ? '已复制' : '复制回复'}
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              size="sm"
              onClick={onCopy}
            />
          </div>
        )}
      </div>
    </article>
  );
}
