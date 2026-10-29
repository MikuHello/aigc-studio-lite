import { InlineNotice } from './ui/Feedback';
import { videoReferenceDurationLimits } from '@/lib/referencePolicy';
import { connectionIdFor } from '@/lib/connections';
import { useAvailableModels } from '@/store/appStore';
import { videoCreationGuidance } from '@/lib/creationGuidance';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle } from 'lucide-react';
import type { GenerateVideoInput, VideoDraft, VideoParams } from '@/types';
import { useAppStore } from '@/store/appStore';
import { submitVideo, useVideoTasks } from '@/store/videoTasks';
import { emptyVideoDraft, normalizeVideoParams } from '@/providers/video-capabilities';
import { validateReferenceMedia, validateVideoInput } from '@/lib/video';
import {
  referenceKind,
  assetVideoReference,
  referenceLabels,
  referenceSource,
  REFERENCE_FILE_ACCEPT,
} from '@/lib/referenceMedia';
import { useVideoReferences } from '@/hooks/useVideoReferences';
import { ReferenceTray } from '@/components/ReferenceTray';
import { ReferencePicker } from '@/components/ReferencePicker';
import {
  ExpandablePromptEditor,
  type PromptEditorHandle,
} from '@/components/ExpandablePromptEditor';
import { CreationModelPicker } from '@/components/CreationModelPicker';
import { VideoGenerationSettings } from '@/components/VideoGenerationSettings';
import { videoStylePrompt } from '@/lib/videoStyles';
import { PresetPicker } from '@/components/PresetPicker';
import { VideoFrameSlot } from '@/components/VideoFrameSlot';
import { Button } from '@/components/ui/Button';

const EMPTY = emptyVideoDraft();

export function VideoComposer({
  onOpenSettings,
  onOpenPresets,
  onSubmitted,
}: {
  onOpenSettings: () => void;
  onOpenPresets: () => void;
  onSubmitted: (id: string) => void;
}) {
  const sessionId = useAppStore((state) => state.activeSessionId);
  const storedDraft = useAppStore((state) => state.drafts[state.activeSessionId]?.video) ?? EMPTY;
  const models = useAvailableModels();
  const configs = useAppStore((state) => state.providerConfigs);
  const assets = useAppStore((state) => state.assets);
  const setDraft = useAppStore((state) => state.setVideoDraft);
  const taskState = useVideoTasks();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ sessionId: string; message: string } | null>(null);
  const submitLock = useRef(false);
  const editor = useRef<PromptEditorHandle>(null);
  const videoModels = models.filter((model) => model.kind === 'video' && model.capabilities.video);
  const model = videoModels.find((model) => model.key === storedDraft.modelKey) ?? videoModels[0];
  const caps = model?.capabilities.video;
  const hasKey = Boolean(model && configs[connectionIdFor(model)]?.apiKey);
  const params = caps ? normalizeVideoParams(storedDraft.params, caps) : storedDraft.params;
  const guidance = videoCreationGuidance(caps, params.mode);
  const draft: VideoDraft = { ...storedDraft, params, modelKey: model?.key ?? null };
  const patchParams = (patch: Partial<VideoParams>) => {
    setError(null);
    if (patch.mode !== undefined && patch.mode !== params.mode) {
      referenceControls.setChoosing(null);
    }
    setDraft(sessionId, {
      params: caps ? normalizeVideoParams({ ...params, ...patch }, caps) : { ...params, ...patch },
    });
  };
  useEffect(() => {
    if (editor.current?.getMarkdown() !== storedDraft.prompt)
      editor.current?.setMarkdown(storedDraft.prompt);
  }, [sessionId, storedDraft.prompt]);
  const report = (reason: unknown) =>
    setError(
      reason === null
        ? null
        : {
            sessionId,
            message: reason instanceof Error ? reason.message : '操作失败，请重试。',
          },
    );
  const referenceControls = useVideoReferences(
    sessionId,
    draft,
    model,
    () => editor.current?.getMarkdown() ?? draft.prompt,
    report,
  );
  const { reading, choosing, setChoosing, dragActive, dropHandlers } = referenceControls;
  const referenceIds = draft.referenceIds ?? [];
  const referenceAssets = useMemo(
    () => (storedDraft.referenceIds ?? []).map((id) => assets[id]).filter(Boolean),
    [assets, storedDraft.referenceIds],
  );
  const labels = referenceLabels(referenceAssets);
  const pickerAssets = Object.values(assets)
    .filter((asset) => choosing === 'references' || asset.mimeType.startsWith('image/'))
    .sort((a, b) => b.createdAt - a.createdAt);
  const referenceItems = referenceAssets.map((asset) => ({ asset, label: labels.get(asset.id)! }));
  const selectionError = useMemo(() => {
    if (params.mode !== 'reference' || !caps || !referenceAssets.length) return '';
    try {
      validateReferenceMedia(caps, referenceAssets.map(assetVideoReference));
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '';
    }
  }, [caps, params.mode, referenceAssets]);
  const generate = async () => {
    if (reading || submitLock.current) return;
    if (!model || !caps || !hasKey) {
      onOpenSettings();
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const prompt = (editor.current?.getMarkdown() ?? draft.prompt).trim();
      const references: GenerateVideoInput['references'] = [];
      if (params.mode === 'reference') {
        for (const id of referenceIds) {
          const asset = assets[id];
          if (!asset) throw new Error('参考素材不存在，请重新选择。');
          references.push(assetVideoReference(await referenceControls.enrich(asset)));
        }
      } else if (params.mode !== 'text') {
        const first = assets[draft.firstFrameId ?? ''];
        if (!first) throw new Error('请添加首帧图片。');
        references.push({ dataUrl: first.dataUrl, mimeType: first.mimeType, role: 'first_frame' });
        if (params.mode === 'first-last-frame') {
          const last = assets[draft.lastFrameId ?? ''];
          if (!last) throw new Error('请添加尾帧图片。');
          references.push({ dataUrl: last.dataUrl, mimeType: last.mimeType, role: 'last_frame' });
        }
      }
      if (params.mode !== 'reference') {
        for (const id of [
          draft.firstFrameId,
          ...(params.mode === 'first-last-frame' ? [draft.lastFrameId] : []),
        ]) {
          if (params.mode !== 'text' && id && assets[id])
            await referenceControls.enrich(assets[id]);
        }
      }
      if (!prompt && params.mode === 'text') throw new Error('请输入视频描述。');
      const input = { prompt: videoStylePrompt(prompt, draft.style), params, references };
      validateVideoInput(model, input);
      setDraft(sessionId, { ...draft, prompt });
      useAppStore.getState().ensureSessionTitle(sessionId, prompt);
      const id = await submitVideo(sessionId, model, { ...draft, prompt }, input);
      if (id) onSubmitted(id);
    } catch (reason) {
      report(reason);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };
  return (
    <>
      <div
        className={`composer video-composer ${dragActive ? 'is-dragging' : ''}`}
        {...dropHandlers}
      >
        {dragActive && <div className="composer-drop-hint">松开以添加参考素材</div>}
        <div className="composer-input-area">
          {params.mode !== 'text' && params.mode !== 'reference' && (
            <div className="video-frame-slots">
              <VideoFrameSlot
                label="首帧"
                asset={assets[draft.firstFrameId ?? '']}
                disabled={reading}
                onRemove={() => setDraft(sessionId, { firstFrameId: undefined })}
                onChoose={() => setChoosing('firstFrameId')}
              />
              {params.mode === 'first-last-frame' && (
                <VideoFrameSlot
                  label="尾帧"
                  asset={assets[draft.lastFrameId ?? '']}
                  disabled={reading}
                  onRemove={() => setDraft(sessionId, { lastFrameId: undefined })}
                  onChoose={() => setChoosing('lastFrameId')}
                />
              )}
            </div>
          )}
          {params.mode === 'reference' && (
            <ReferenceTray
              title="全能参考"
              help={guidance}
              items={referenceItems}
              busy={reading}
              onAdd={() => {
                patchParams({ mode: 'reference' });
                setChoosing('references');
              }}
              onRemove={(id) =>
                referenceControls.setReferences(referenceIds.filter((item) => item !== id))
              }
              onMove={(index) => {
                const next = [...referenceIds];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                referenceControls.setReferences(next);
              }}
            />
          )}
          <ExpandablePromptEditor
            key={sessionId}
            ref={editor}
            initialValue={draft.prompt}
            placeholder={guidance.placeholder}
            attachments={
              params.mode === 'reference'
                ? referenceItems.map(({ asset, label }) => ({
                    id: asset.id,
                    label,
                    dataUrl: referenceSource(asset),
                    kind: referenceKind(asset),
                  }))
                : []
            }
            allowReferences={params.mode === 'reference'}
            onAttachFiles={(files) => void referenceControls.upload(files)}
            onAttachAsset={(id) => {
              if (assets[id]) referenceControls.select(assets[id]);
            }}
            onAttachLink={referenceControls.onLink}
            onAttachmentError={(message) => report(new Error(message))}
            onRequestUpload={() =>
              setChoosing(
                params.mode === 'first-frame' || params.mode === 'first-last-frame'
                  ? 'firstFrameId'
                  : 'references',
              )
            }
            onChange={(prompt) => {
              report(null);
              setDraft(sessionId, { prompt });
            }}
            onSubmit={() => void generate()}
          />
        </div>
        <InlineNotice
          field
          message={error?.sessionId === sessionId ? error.message : selectionError}
        />
        <footer className="composer-footer studio-composer-footer">
          <div className="composer-tools">
            <PresetPicker
              compact
              onManage={onOpenPresets}
              onSelect={(preset) => editor.current?.insertMarkdown(preset.content)}
            />
          </div>
          <div className="composer-actions">
            <div className="composer-parameter-strip">
              <CreationModelPicker value={model?.key ?? null} onManage={onOpenSettings} />
              {caps && (
                <VideoGenerationSettings
                  params={params}
                  caps={caps}
                  style={draft.style}
                  onChange={patchParams}
                  onStyleChange={(style) => setDraft(sessionId, { style })}
                />
              )}
            </div>
            <Button
              variant="primary"
              className={hasKey ? 'composer-generate' : undefined}
              size="sm"
              aria-label={
                submitting
                  ? '正在提交'
                  : !model
                    ? '连接模型'
                    : !hasKey
                      ? '配置 API Key'
                      : '生成视频'
              }
              title={submitting ? '正在提交' : '生成视频'}
              icon={
                submitting ? (
                  <LoaderCircle size={16} className="spin" />
                ) : hasKey ? (
                  <ArrowUp size={19} />
                ) : undefined
              }
              disabled={reading || submitting || !taskState.loaded || Boolean(selectionError)}
              onClick={() => void generate()}
            >
              {!hasKey ? (!model ? '连接模型' : '配置 API Key') : null}
            </Button>
          </div>
        </footer>
      </div>
      <ReferencePicker
        durationLimits={{
          video: videoReferenceDurationLimits(caps, 'video'),
          audio: videoReferenceDurationLimits(caps, 'audio'),
        }}
        key={`${sessionId}:${choosing}`}
        open={Boolean(choosing)}
        onClose={() => setChoosing(null)}
        assets={pickerAssets}
        title={
          choosing === 'references'
            ? '添加参考素材'
            : choosing === 'lastFrameId'
              ? '选择尾帧'
              : '选择首帧'
        }
        selectedIds={
          choosing === 'references'
            ? referenceIds
            : [choosing === 'lastFrameId' ? (draft.lastFrameId ?? '') : (draft.firstFrameId ?? '')]
        }
        onSelect={(asset) => referenceControls.select(asset, choosing ?? 'references', true)}
        onFiles={(files) => referenceControls.upload(files, choosing ?? 'references')}
        onError={(message) => report(new Error(message))}
        onLink={referenceControls.addLink}
        allowLink={choosing === 'references'}
        accept={
          choosing === 'references' ? REFERENCE_FILE_ACCEPT : 'image/png,image/jpeg,image/webp'
        }
        busy={reading}
        error={error?.sessionId === sessionId ? error.message : undefined}
        uploadHint={
          choosing === 'references'
            ? '图片 ≤12 MB · MP3 / WAV ≤15 MB · 视频请使用链接或作品库'
            : undefined
        }
      />
    </>
  );
}
