import { creationHistory } from '@/lib/creationHistory';
import { CreationHistory } from '@/components/CreationHistory';
import { VideoTaskResult } from '@/components/VideoTaskResult';
import { VideoComposer } from '@/components/VideoComposer';
import { hydrateVideoTasks, useVideoTasks } from '@/store/videoTasks';
import { modelConnection } from '@/lib/connections';
import { useAvailableModels } from '@/store/appStore';
import { MAX_IMAGE_ATTACHMENTS } from '@/lib/referencePolicy';
import { imageCreationGuidance } from '@/lib/creationGuidance';
import { ReferenceTray } from '@/components/ReferenceTray';
import { ReferencePicker } from '@/components/ReferencePicker';
import { VIDEO_DEFAULT_PARAMS } from '@/providers/video-capabilities';
import { InlineNotice } from '@/components/ui/Feedback';
import { failureNotice } from '@/lib/notices';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  Copy,
  Download,
  Pencil,
  FileText,
  ImagePlus,
  Square,
  WandSparkles,
} from 'lucide-react';
import type { Asset, GeneratedImage } from '@/types';
import { getAdapter } from '@/agent/runtime';
import { createId } from '@/lib/id';
import { downloadDataUrl, extensionForMime, safeImageFilename } from '@/lib/image';
import { copyText, formatDateTime } from '@/lib/text';
import { useAppStore } from '@/store/appStore';
import { useImageAttachments } from '@/hooks/useImageAttachments';
import {
  ExpandablePromptEditor as PromptEditor,
  type PromptEditorHandle,
} from '@/components/ExpandablePromptEditor';
import { PresetPicker } from '@/components/PresetPicker';
import { ImageLightbox } from '@/components/ImageLightbox';
import { PromptReviewDialog } from '@/components/PromptReviewDialog';
import { CreationModelPicker } from '@/components/CreationModelPicker';
import { GenerationProgress } from '@/components/GenerationProgress';
import { GenerationSettings } from '@/components/GenerationSettings';
import { Dialog } from '@/components/Dialog';
import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';

const ImageAnnotationDialog = lazy(() => import('@/components/ImageAnnotationDialog'));

interface StudioViewProps {
  onOpenSettings: () => void;
  onOpenPresets: () => void;
}

interface GenerationRun {
  sessionId: string;
  startedAt: number;
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
  return error instanceof Error ? error.message : '生成失败';
}

export function StudioView({ onOpenSettings, onOpenPresets }: StudioViewProps) {
  const sessionId = useAppStore((state) => state.activeSessionId);
  const imageFailure = useAppStore(
    (state) => state.sessions.find((session) => session.id === state.activeSessionId)?.imageFailure,
  );
  const draft = useAppStore((state) => state.drafts[state.activeSessionId]) ?? EMPTY_DRAFT;
  const assets = useAppStore((state) => state.assets);
  const models = useAvailableModels();
  const activeImageModelKey = useAppStore((state) => state.activeImageModelKey);
  const imageParams = useAppStore((state) => state.imageParams);
  const preferences = useAppStore((state) => state.preferences);
  const videoMode = preferences.studioMode === 'video';
  const videoTasks = useVideoTasks((state) => state.tasks);
  const videoTaskError = useVideoTasks((state) => state.error);
  const providerConfigs = useAppStore((state) => state.providerConfigs);
  const setDraftText = useAppStore((state) => state.setDraftText);
  const addAssets = useAppStore((state) => state.addAssets);
  const deleteAsset = useAppStore((state) => state.deleteAsset);
  const ensureSessionTitle = useAppStore((state) => state.ensureSessionTitle);
  const notify = useAppStore((state) => state.notify);

  const editorRef = useRef<PromptEditorHandle>(null);
  const previousHistory = useRef({ sessionId, ids: new Set<string>() });
  const abortRef = useRef<AbortController | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const [editingAsset, setEditingAsset] = useState<{ asset?: Asset; sessionId: string } | null>(
    null,
  );
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSource, setReviewSource] = useState('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const imageModels = useMemo(() => models.filter((model) => model.kind === 'image'), [models]);
  const textModels = useMemo(() => models.filter((model) => model.kind === 'text'), [models]);
  const imageModel = imageModels.find((model) => model.key === activeImageModelKey);
  const textModel = textModels.find((model) => model.key === preferences.reviewModelKey);

  const history = useMemo(
    () => creationHistory(assets, videoTasks, sessionId),
    [assets, videoTasks, sessionId],
  );
  const selectedEntry = history.find((entry) => entry.id === selectedAssetId);
  const selectedAsset = selectedEntry?.kind === 'image' ? selectedEntry.asset : null;
  const lightboxAsset = lightboxAssetId ? assets[lightboxAssetId] : null;
  const runningCurrent = run?.sessionId === sessionId;
  const runningOther = Boolean(run && run.sessionId !== sessionId);
  const hasOutput = history.length > 0 || runningCurrent;
  const promptText = draft.studio.trim();

  const {
    error: attachmentError,
    reportError: reportAttachmentError,
    attachments,
    reading: readingAttachments,
    maxAttachments,
    dragActive,
    dropHandlers,
    fileInputRef,
    onFilesSelected,
    removeAttachment,
    addAttachment,
  } = useImageAttachments(
    sessionId,
    'studio',
    Math.min(
      MAX_IMAGE_ATTACHMENTS,
      imageModel?.capabilities.image?.maxReferences ?? MAX_IMAGE_ATTACHMENTS,
    ),
  );

  useEffect(() => {
    setError(null);
  }, [sessionId, draft.studio, attachments.length]);

  const guidance = imageCreationGuidance(imageModel?.capabilities.image);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const promptAttachments = useMemo(
    () =>
      attachments.map((asset, index) => ({
        id: asset.id,
        label: asset.filename || `参考图-${index + 1}.png`,
        dataUrl: asset.dataUrl,
      })),
    [attachments],
  );

  useEffect(() => {
    const previous = previousHistory.current;
    const added = history.filter((entry) => !previous.ids.has(entry.id));
    if (previous.sessionId === sessionId && added.length) {
      setSelectedAssetId(added.at(-1)!.id);
    } else if (!selectedAssetId || !history.some((entry) => entry.id === selectedAssetId)) {
      setSelectedAssetId(history.at(-1)?.id ?? null);
    }
    previousHistory.current = { sessionId, ids: new Set(history.map((entry) => entry.id)) };
  }, [selectedAssetId, history, sessionId]);

  useEffect(() => {
    if (!run) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Date.now() - run.startedAt);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [run]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  if (!sessionId) {
    return <div className="studio-view is-empty" />;
  }

  const stopGeneration = () => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    setRun(null);
  };

  const generate = () => {
    if (run) {
      if (runningCurrent) stopGeneration();
      else notify({ title: '另一会话正在生成', tone: 'neutral' });
      return;
    }
    if (readingAttachments) return;
    if (!imageModel) {
      onOpenSettings();
      return;
    }
    const prompt = (editorRef.current?.getMarkdown() ?? draft.studio).trim();
    if (!prompt) {
      setError('请输入提示词。');
      editorRef.current?.focus();
      return;
    }

    if (imageModel.capabilities.image?.supportsEdit && attachments.length > maxAttachments) {
      setError(`当前模型最多支持 ${maxAttachments} 张参考图，请移除多余图片。`);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    ensureSessionTitle(sessionId, prompt);

    const references =
      imageModel.capabilities.image?.supportsEdit && attachments.length > 0
        ? attachments.slice(0, MAX_IMAGE_ATTACHMENTS).map((asset) => ({
            mimeType: asset.mimeType,
            dataUrl: asset.dataUrl,
            name: asset.filename,
          }))
        : [];

    setRun({
      sessionId,
      startedAt: Date.now(),
    });

    void (async () => {
      let requestKey = '';
      try {
        const adapter = getAdapter(imageModel.providerId);
        const config = modelConnection(providerConfigs, imageModel);
        requestKey = config.apiKey;
        const generated = await adapter.generateImage(
          config,
          imageModel,
          {
            prompt,
            params: imageParams,
            references,
            signal: controller.signal,
          },
          { useProxy: config.useWorkerProxy === true },
        );
        if (controller.signal.aborted) return;

        const now = Date.now();
        const newAssets: Asset[] = generated.map((image: GeneratedImage, index) => ({
          id: createId('asset'),
          sessionId,
          source: 'generated',
          mimeType: image.mimeType,
          dataUrl: image.dataUrl,
          prompt,
          revisedPrompt: image.revisedPrompt,
          modelKey: imageModel.key,
          modelLabel: imageModel.label,
          providerId: imageModel.providerId,
          params: imageParams,
          reviewed: false,
          createdAt: now + index,
        }));
        addAssets(newAssets);
        useAppStore.getState().setImageFailure(sessionId, undefined);
        setSelectedAssetId(newAssets[0]?.id ?? null);
      } catch (generationError) {
        if (isAbortError(generationError) || controller.signal.aborted) return;
        useAppStore.getState().recordImageFailure(
          sessionId,
          {
            message: errorText(generationError),
            prompt,
            modelLabel: imageModel.label,
            createdAt: Date.now(),
          },
          [requestKey],
        );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setRun(null);
        }
      }
    })();
  };

  const openReview = () => {
    if (!textModel) {
      useAppStore.getState().setActiveView('review');
      return;
    }
    const prompt = (editorRef.current?.getMarkdown() ?? draft.studio).trim();
    if (!prompt) {
      setError('请输入提示词。');
      editorRef.current?.focus();
      return;
    }
    setReviewSource(prompt);
    setReviewOpen(true);
  };

  const copyPrompt = async () => {
    if (!selectedAsset?.prompt) return;
    setCopiedPrompt(false);
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    try {
      await copyText(selectedAsset.prompt);
      setCopiedPrompt(true);
      copiedTimerRef.current = window.setTimeout(() => setCopiedPrompt(false), 1500);
    } catch {
      notify(failureNotice('复制失败', '请选中文字手动复制。'));
    }
  };

  const downloadAsset = (asset: Asset) => {
    downloadDataUrl(
      asset.dataUrl,
      safeImageFilename(
        asset.prompt?.slice(0, 40) || `aigc-${asset.id.slice(-6)}`,
        extensionForMime(asset.mimeType),
      ),
    );
  };

  return (
    <section
      className={`studio-view ${hasOutput ? 'has-output' : 'is-empty'}`}
      aria-label="创作工作台"
    >
      {history.length > 0 && (
        <CreationHistory
          entries={history}
          selectedId={selectedAssetId}
          onSelect={setSelectedAssetId}
        />
      )}
      <div className={`studio-content ${hasOutput ? 'has-output' : 'is-empty'}`}>
        {hasOutput ? (
          <div className="studio-result-scroll">
            {selectedEntry?.kind === 'video' ? (
              <VideoTaskResult
                key={selectedEntry.id}
                task={selectedEntry.task}
                asset={selectedEntry.asset}
              />
            ) : selectedAsset ? (
              <figure className="result-figure">
                <div
                  className={`result-media ${
                    selectedAsset.params?.background === 'transparent' ? 'is-transparent' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="result-image-button"
                    onClick={() => setLightboxAssetId(selectedAsset.id)}
                    aria-label="查看图像详情"
                  >
                    <img
                      src={selectedAsset.dataUrl}
                      alt={selectedAsset.prompt?.slice(0, 100) ?? '生成结果'}
                    />
                  </button>

                  <div className="result-media-actions">
                    <IconButton
                      label="查看任务记录"
                      icon={<FileText size={15} />}
                      variant="outline"
                      size="sm"
                      onClick={() => setRecordOpen(true)}
                    />
                    <IconButton
                      label="编辑图片"
                      icon={<Pencil size={15} />}
                      variant="outline"
                      size="sm"
                      onMouseEnter={() => {
                        void import('@/components/ImageAnnotationDialog');
                      }}
                      onFocus={() => {
                        void import('@/components/ImageAnnotationDialog');
                      }}
                      onClick={() => setEditingAsset({ asset: selectedAsset, sessionId })}
                    />
                    <IconButton
                      label="下载图片"
                      icon={<Download size={15} />}
                      variant="outline"
                      size="sm"
                      onClick={() => downloadAsset(selectedAsset)}
                    />
                  </div>

                  <div className="result-bottom-actions">
                    <Button
                      size="sm"
                      onClick={() => {
                        const state = useAppStore.getState();
                        const current = state.drafts[sessionId]?.video;
                        state.setVideoDraft(sessionId, {
                          firstFrameId: selectedAsset.id,
                          params: {
                            ...VIDEO_DEFAULT_PARAMS,
                            ...current?.params,
                            mode: 'first-frame',
                          },
                        });
                        state.setStudioMode('video');
                      }}
                    >
                      用作视频首帧
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={copiedPrompt ? <Check size={14} /> : <Copy size={14} />}
                      onClick={() => void copyPrompt()}
                    >
                      {copiedPrompt ? '已复制' : '复制提示词'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ImagePlus size={14} />}
                      disabled={
                        !videoMode && attachments.some((asset) => asset.id === selectedAsset.id)
                      }
                      onClick={() => {
                        const state = useAppStore.getState();
                        const ids = state.drafts[sessionId]?.studioAttachmentIds ?? [];
                        if (ids.length >= maxAttachments) {
                          reportAttachmentError(`最多同时参考 ${maxAttachments} 张图片。`);
                          return;
                        }
                        state.addDraftAttachment(sessionId, 'studio', selectedAsset.id);
                        state.setStudioMode('image');
                        requestAnimationFrame(() => editorRef.current?.focus());
                      }}
                    >
                      {videoMode
                        ? '作为图片参考'
                        : attachments.some((asset) => asset.id === selectedAsset.id)
                          ? '已作为参考图'
                          : '作为参考图'}
                    </Button>
                  </div>

                  {runningCurrent && (
                    <div className="media-generating">
                      <GenerationProgress elapsed={elapsed} />
                    </div>
                  )}
                </div>
              </figure>
            ) : (
              <div className="generating-state">
                <GenerationProgress elapsed={elapsed} />
              </div>
            )}
          </div>
        ) : (
          <div className="studio-hero">
            <h1>今天想创作什么？</h1>
          </div>
        )}

        <InlineNotice
          title={videoTaskError ? '读取任务记录失败' : undefined}
          message={videoTaskError}
        >
          <Button size="sm" onClick={() => void hydrateVideoTasks()}>
            重新读取
          </Button>
        </InlineNotice>
        {!videoMode && !runningCurrent && imageFailure && (
          <InlineNotice
            title="图片生成失败"
            message={`${imageFailure.modelLabel} · ${formatDateTime(imageFailure.createdAt)}\n\n${imageFailure.message}`}
          >
            <button
              type="button"
              className="feedback-action"
              onClick={() => setDraftText(sessionId, 'studio', imageFailure.prompt)}
            >
              重新填写
            </button>
          </InlineNotice>
        )}
        <div className="studio-composer-wrap" hidden={videoMode}>
          <div
            className={`composer studio-composer ${dragActive ? 'is-dragging' : ''}`}
            {...dropHandlers}
          >
            {dragActive && <div className="composer-drop-hint">松开以添加参考图</div>}
            <div className="composer-input-area">
              <ReferenceTray
                title="参考图片"
                help={guidance}
                addLabel="添加参考图片"
                items={attachments.map((asset, index) => ({ asset, label: `图片${index + 1}` }))}
                onAdd={() => setReferencePickerOpen(true)}
                onRemove={removeAttachment}
                busy={readingAttachments}
              />

              <PromptEditor
                key={`${sessionId}:studio`}
                ref={editorRef}
                initialValue={draft.studio}
                placeholder={guidance.placeholder}
                attachments={promptAttachments}
                onChange={(value) => {
                  setError(null);
                  setDraftText(sessionId, 'studio', value);
                }}
                onSubmit={generate}
                onAttachFiles={(files) => void onFilesSelected(files)}
                onRequestUpload={() => setReferencePickerOpen(true)}
                onAttachAsset={addAttachment}
                onAttachmentError={reportAttachmentError}
              />
            </div>
            {attachments.length > 0 &&
              imageModel &&
              !imageModel.capabilities.image?.supportsEdit && (
                <p className="composer-note">当前模型不支持参考图</p>
              )}

            <InlineNotice field message={error ?? attachmentError} />
            <footer className="composer-footer studio-composer-footer">
              <div className="composer-tools">
                <PresetPicker
                  compact
                  onSelect={(preset) => editorRef.current?.insertMarkdown(preset.content)}
                  onManage={onOpenPresets}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<WandSparkles size={16} />}
                  onClick={openReview}
                  title={textModel ? '优化提示词' : '选择润色模型'}
                >
                  润色
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Pencil size={16} />}
                  title="空白绘图"
                  onClick={() => setEditingAsset({ sessionId })}
                >
                  绘图
                </Button>
              </div>

              <div className="composer-actions">
                <div className="composer-parameter-strip">
                  <CreationModelPicker value={activeImageModelKey} onManage={onOpenSettings} />
                  {imageModel && <GenerationSettings model={imageModel} />}
                </div>
                {!imageModel ? (
                  <Button variant="primary" size="sm" onClick={onOpenSettings}>
                    生成
                  </Button>
                ) : runningCurrent ? (
                  <Button
                    variant="secondary"
                    className="composer-generate is-running"
                    icon={<Square size={12} fill="currentColor" />}
                    onClick={stopGeneration}
                    aria-label="停止生成"
                    title="停止生成"
                  />
                ) : (
                  <Button
                    variant="primary"
                    className="composer-generate"
                    icon={<ArrowUp size={19} />}
                    onClick={generate}
                    disabled={!promptText || runningOther || readingAttachments}
                    aria-label="生成"
                    title={
                      runningOther ? '另一会话正在生成' : promptText ? '生成' : '输入提示词后生成'
                    }
                  />
                )}
              </div>
            </footer>
          </div>
        </div>
        <div className="studio-composer-wrap" hidden={!videoMode}>
          <VideoComposer
            onOpenSettings={onOpenSettings}
            onOpenPresets={onOpenPresets}
            onSubmitted={(id) => setSelectedAssetId(`video-${id}`)}
          />
        </div>
      </div>

      <ReferencePicker
        open={referencePickerOpen}
        onClose={() => setReferencePickerOpen(false)}
        title="添加参考图片"
        assets={Object.values(assets)
          .filter(
            (asset) =>
              asset.mimeType.startsWith('image/') && asset.dataUrl.startsWith('data:image/'),
          )
          .sort((a, b) => b.createdAt - a.createdAt)}
        selectedIds={attachments.map((asset) => asset.id)}
        onSelect={(asset) =>
          attachments.some((item) => item.id === asset.id)
            ? removeAttachment(asset.id)
            : addAttachment(asset.id)
        }
        onFiles={onFilesSelected}
        onError={reportAttachmentError}
        error={attachmentError ?? undefined}
        busy={readingAttachments}
        accept="image/png,image/jpeg,image/webp"
      />
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

      {editingAsset && (
        <Suspense
          fallback={
            <Dialog
              open
              onClose={() => setEditingAsset(null)}
              title={editingAsset.asset ? '编辑图片' : '绘图'}
            >
              <p>正在加载编辑器…</p>
            </Dialog>
          }
        >
          <ImageAnnotationDialog
            asset={editingAsset.asset}
            onClose={() => setEditingAsset(null)}
            onComplete={(dataUrl) => {
              const state = useAppStore.getState();
              const targetId = editingAsset.sessionId;
              if (!state.sessions.some((session) => session.id === targetId))
                throw new Error('原会话已删除，请关闭编辑器。');
              const ids = state.drafts[targetId]?.studioAttachmentIds ?? [];
              if (ids.length >= maxAttachments)
                throw new Error(`最多同时参考 ${maxAttachments} 张图片，请先移除一张参考图。`);
              const id = createId('asset');
              state.addAssets([
                {
                  id,
                  sessionId: targetId,
                  source: 'upload',
                  mimeType: 'image/png',
                  dataUrl,
                  filename: editingAsset.asset ? '标注参考图.png' : '绘图参考图.png',
                  createdAt: Date.now(),
                },
              ]);
              state.addDraftAttachment(targetId, 'studio', id);
              state.setStudioMode('image');
              setEditingAsset(null);
              notify({
                title: editingAsset.asset ? '已添加标注参考图' : '已添加绘图参考图',
                tone: 'success',
              });
            }}
          />
        </Suspense>
      )}
      <PromptReviewDialog
        open={reviewOpen}
        prompt={reviewSource}
        textModel={textModel}
        imageModel={imageModel}
        references={attachments.map(({ dataUrl, mimeType }) => ({ dataUrl, mimeType }))}
        aspectRatio={imageParams.aspect}
        onClose={() => setReviewOpen(false)}
        onOpenSettings={() => {
          setReviewOpen(false);
          onOpenSettings();
        }}
        onApply={(revised) => {
          editorRef.current?.setMarkdown(revised);
          setDraftText(sessionId, 'studio', revised);
          setError(null);
        }}
      />

      <Dialog
        open={recordOpen && Boolean(selectedAsset)}
        onClose={() => setRecordOpen(false)}
        title="任务记录"
        size="wide"
      >
        {selectedAsset && (
          <div className="generation-record">
            <dl>
              <div>
                <dt>模型</dt>
                <dd>{selectedAsset.modelLabel}</dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>{formatDateTime(selectedAsset.createdAt)}</dd>
              </div>
              <div>
                <dt>画幅</dt>
                <dd>
                  {selectedAsset.params?.aspect === 'auto' ? '自动' : selectedAsset.params?.aspect}
                </dd>
              </div>
              <div>
                <dt>格式</dt>
                <dd>{extensionForMime(selectedAsset.mimeType).toUpperCase()}</dd>
              </div>
            </dl>
            <h3>提示词</h3>
            <Markdown content={selectedAsset.prompt ?? ''} />
            {selectedAsset.originalPrompt && (
              <>
                <h3>原始提示词</h3>
                <Markdown content={selectedAsset.originalPrompt} />
              </>
            )}
          </div>
        )}
      </Dialog>

      <ImageLightbox
        asset={lightboxAsset ?? null}
        onClose={() => setLightboxAssetId(null)}
        onDelete={(assetId) => {
          return deleteAsset(assetId);
        }}
      />
    </section>
  );
}
