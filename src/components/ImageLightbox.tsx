import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Trash2 } from 'lucide-react';
import type { Asset } from '@/types';
import { downloadDataUrl, extensionForMime, safeImageFilename } from '@/lib/image';
import { copyText, formatDateTime, formatDuration } from '@/lib/text';
import { Dialog } from './Dialog';
import { FloatingNotice } from './Toasts';
import { Markdown } from './Markdown';
import { Button } from './ui/Button';
import { VideoPlayer } from './VideoPlayer';
import { VIDEO_DEFAULT_PARAMS } from '@/providers/video-capabilities';
import { useAppStore } from '@/store/appStore';

interface ImageLightboxProps {
  asset: Asset | null;
  onClose: () => void;
  onDelete?: (assetId: string) => void | Promise<void>;
}

export function ImageLightbox({ asset, onClose, onDelete }: ImageLightboxProps) {
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  const close = () => {
    if (!deleting) onClose();
  };

  useEffect(() => {
    setCopied(false);
    setConfirmingDelete(false);
    setError(null);
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, [asset?.id]);

  if (!asset) return null;

  const filename = safeImageFilename(
    asset.prompt ? asset.prompt.slice(0, 42) : asset.filename || 'aigc-image',
    extensionForMime(asset.mimeType),
  );

  return (
    <Dialog
      open={Boolean(asset)}
      onClose={close}
      title={asset.video ? '视频' : '图像'}
      description={[
        asset.modelLabel,
        asset.params?.aspect === 'auto' ? '自动' : asset.params?.aspect,
        formatDateTime(asset.createdAt),
        asset.generationElapsedMs === undefined
          ? undefined
          : `耗时 ${formatDuration(asset.generationElapsedMs)}`,
      ]
        .filter(Boolean)
        .join(' · ')}
      size="large"
      className="lightbox-dialog"
      footer={
        <>
          <div className="lightbox-delete">
            {onDelete &&
              (confirmingDelete ? (
                <>
                  <span>将从作品库、会话和参考图移除，无法撤销。</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleting}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    取消
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={deleting}
                    onClick={async () => {
                      setDeleting(true);
                      setError(null);
                      try {
                        await onDelete(asset.id);
                        onClose();
                      } catch (reason) {
                        setError(reason instanceof Error ? reason.message : '删除失败，请重试');
                      } finally {
                        setDeleting(false);
                      }
                    }}
                  >
                    {deleting ? '删除中' : '删除'}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={13} />}
                  onClick={() => setConfirmingDelete(true)}
                >
                  删除
                </Button>
              ))}
          </div>
          <div className="lightbox-actions">
            {asset.prompt && (
              <Button
                variant="secondary"
                size="sm"
                icon={copied ? <Check size={14} /> : <Copy size={14} />}
                onClick={async () => {
                  setCopied(false);
                  if (copyTimer.current) window.clearTimeout(copyTimer.current);
                  try {
                    await copyText(asset.prompt ?? '');
                    setCopied(true);
                    if (copyTimer.current) window.clearTimeout(copyTimer.current);
                    copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
                  } catch {
                    setError('复制失败，请重试或选中文字手动复制。');
                  }
                }}
              >
                {copied ? '已复制' : '复制提示词'}
              </Button>
            )}
            {!asset.video && (
              <Button
                size="sm"
                onClick={() => {
                  const state = useAppStore.getState();
                  const sessionId = state.activeSessionId;
                  state.setVideoDraft(sessionId, {
                    firstFrameId: asset.id,
                    params: {
                      ...VIDEO_DEFAULT_PARAMS,
                      ...state.drafts[sessionId]?.video?.params,
                      mode: 'first-frame',
                    },
                  });
                  state.setStudioMode('video');
                  state.setActiveView('studio');
                  onClose();
                }}
              >
                用作视频首帧
              </Button>
            )}
            {!asset.video && (
              <Button
                variant="primary"
                size="sm"
                icon={<Download size={14} />}
                onClick={() => downloadDataUrl(asset.dataUrl, filename)}
              >
                下载
              </Button>
            )}
          </div>
        </>
      }
    >
      <FloatingNotice message={error} />
      <div className="lightbox-layout">
        <div
          className={`lightbox-image ${
            asset.params?.background === 'transparent' ? 'is-transparent' : ''
          }`}
        >
          {asset.video ? (
            <VideoPlayer result={asset.video} title={asset.prompt} />
          ) : (
            <img src={asset.dataUrl} alt={asset.prompt?.slice(0, 120) || '生成图像'} />
          )}
        </div>
        <div className="lightbox-side">
          {asset.params?.background === 'transparent' && (
            <div className="lightbox-meta">
              <span>透明底</span>
            </div>
          )}
          <div className="lightbox-prompt">
            <header>
              <h3>提示词</h3>
            </header>
            {asset.prompt ? <Markdown content={asset.prompt} /> : <p className="muted">无提示词</p>}
          </div>
          {asset.revisedPrompt && asset.revisedPrompt !== asset.prompt && (
            <details className="original-prompt">
              <summary>修订提示词</summary>
              <Markdown content={asset.revisedPrompt} />
            </details>
          )}
          {asset.originalPrompt && asset.originalPrompt !== asset.prompt && (
            <details className="original-prompt">
              <summary>原始提示词</summary>
              <Markdown content={asset.originalPrompt} />
            </details>
          )}
        </div>
      </div>
    </Dialog>
  );
}
