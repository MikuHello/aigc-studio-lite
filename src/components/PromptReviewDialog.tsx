import { InlineNotice } from './ui/Feedback';
import { modelConnection } from '@/lib/connections';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, LoaderCircle } from 'lucide-react';
import type { ChatImage, ModelDescriptor } from '@/types';
import { reviewPrompt } from '@/agent/review';
import { copyText } from '@/lib/text';
import { useAppStore } from '@/store/appStore';
import { Dialog } from './Dialog';
import { Markdown } from './Markdown';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

interface PromptReviewDialogProps {
  open: boolean;
  prompt: string;
  textModel?: ModelDescriptor;
  imageModel?: ModelDescriptor;
  references: ChatImage[];
  aspectRatio?: string;
  onClose: () => void;
  onApply: (prompt: string) => void;
  onOpenSettings: () => void;
}

export function PromptReviewDialog({
  open,
  prompt,
  textModel,
  imageModel,
  references,
  aspectRatio,
  onClose,
  onApply,
  onOpenSettings,
}: PromptReviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revised, setRevised] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const providerConfigs = useAppStore((state) => state.providerConfigs);
  const preferences = useAppStore((state) => state.preferences);

  useEffect(() => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    setRevised('');
    setError(null);
    setCopied(false);
    setLoading(false);

    if (!textModel) {
      setError('请选择润色模型。');
      return;
    }
    if (!prompt.trim()) {
      setError('请输入提示词。');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    void Promise.resolve()
      .then(() =>
        reviewPrompt({
          prompt,
          textModel,
          imageModel,
          config: modelConnection(providerConfigs, textModel),
          references,
          settings: preferences.reviewSettings,
          aspectRatio,
          signal: controller.signal,
        }),
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        setRevised(result.prompt);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '优化失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (abortRef.current === controller) abortRef.current = null;
    };
    // @reason A paid review starts only on opening or explicit retry; retain that request snapshot.
  }, [open, attempt]);

  const close = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    onClose();
  };

  const apply = () => {
    if (!revised) return;
    onApply(revised);
    close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="优化提示词"
      description="保留画面需求，调整可能触发审核的表述。"
      size="wide"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button
            variant="primary"
            icon={<Check size={14} />}
            disabled={!revised || loading}
            onClick={apply}
          >
            采用
          </Button>
        </>
      }
    >
      <div className="review-grid">
        <section className="review-pane" aria-labelledby="review-original-title">
          <header>
            <h3 id="review-original-title">原始</h3>
            <span>{prompt.length}</span>
          </header>
          <div className="review-content">
            <Markdown content={prompt} />
          </div>
        </section>

        <section className="review-pane is-result" aria-labelledby="review-revised-title">
          <header>
            <h3 id="review-revised-title">优化后</h3>
            {revised && (
              <IconButton
                label={copied ? '已复制' : '复制'}
                icon={copied ? <Check size={13} /> : <Copy size={13} />}
                size="sm"
                onClick={async () => {
                  setCopied(false);
                  if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
                  try {
                    await copyText(revised);
                    setCopied(true);
                    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
                  } catch {
                    useAppStore.getState().notify({
                      title: '复制失败',
                      detail: '请选中结果文字手动复制。',
                      tone: 'error',
                    });
                  }
                }}
              />
            )}
          </header>
          <div className="review-content" tabIndex={error ? 0 : undefined}>
            {loading ? (
              <div className="review-loading" aria-live="polite">
                <LoaderCircle size={18} className="spin" />
                <span>正在优化</span>
              </div>
            ) : error ? (
              <div className="review-error">
                <InlineNotice
                  field={!textModel || !prompt.trim()}
                  title={textModel && prompt.trim() ? '润色失败' : undefined}
                  message={error}
                />
                <div className="review-error-actions">
                  {!textModel ? (
                    <Button variant="primary" size="sm" onClick={onOpenSettings}>
                      设置模型
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAttempt((value) => value + 1)}
                    >
                      重试
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <Markdown content={revised} />
              </>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
