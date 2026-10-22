import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckCircle2, CircleAlert, Copy, Info, X } from 'lucide-react';
import { useAppStore, type Toast } from '@/store/appStore';
import { copyText } from '@/lib/text';
import { Dialog } from './Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

export function NoticeDetails({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    setCopied(false);
    setCopyError(false);
  }, [message]);
  return (
    <Dialog
      open={message !== null}
      onClose={onClose}
      title="消息详情"
      size="wide"
      className="notice-detail-dialog"
      footer={
        <>
          <Button onClick={onClose}>关闭</Button>
          <Button
            variant="primary"
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            onClick={async () => {
              try {
                await copyText(message ?? '');
                setCopied(true);
                setCopyError(false);
              } catch {
                setCopyError(true);
              }
            }}
          >
            {copied ? '已复制' : '复制完整信息'}
          </Button>
        </>
      }
    >
      <pre className="notice-full-message" tabIndex={0}>
        {message}
      </pre>
      {copyError && <p className="notice-copy-error">复制失败，请选中上方文字手动复制。</p>}
    </Dialog>
  );
}

export function FloatingNotice({
  message,
  tone = 'error',
}: {
  message: string | null;
  tone?: Toast['tone'];
}) {
  useEffect(() => {
    if (!message) return;
    const id = useAppStore.getState().addToast(message, tone);
    return () => useAppStore.getState().dismissToast(id);
  }, [message, tone]);
  return null;
}

function ToastItem({ toast, onDetails }: { toast: Toast; onDetails: (message: string) => void }) {
  const dismiss = useAppStore((state) => state.dismissToast);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (paused || toast.tone === 'error' || toast.message.length > 160) return;
    const timer = window.setTimeout(() => dismiss(toast.id), 5000);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.id, toast.tone, toast.message, paused]);
  const hasDetails = toast.tone === 'error' || toast.message.length > 160;
  const Icon =
    toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? CircleAlert : Info;
  return (
    <div
      className={`toast toast-${toast.tone} ${hasDetails ? '' : 'is-passive'}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <Icon size={17} />
      {hasDetails ? (
        <button
          className="toast-summary"
          type="button"
          onClick={() => onDetails(toast.message)}
          aria-label={`查看完整消息：${toast.message}`}
        >
          {toast.message}
        </button>
      ) : (
        <span className="toast-summary">{toast.message}</span>
      )}
      {hasDetails && (
        <div className="toast-actions">
          <IconButton
            label={copied ? '已复制消息' : '复制完整消息'}
            size="sm"
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            onClick={async () => {
              try {
                await copyText(toast.message);
                setCopied(true);
              } catch {
                onDetails(toast.message);
              }
            }}
          />
          <IconButton
            label="关闭提示"
            size="sm"
            icon={<X size={14} />}
            onClick={() => dismiss(toast.id)}
          />
        </div>
      )}
    </div>
  );
}

export function ToastHost() {
  const toasts = useAppStore((state) => state.toasts);
  const [detail, setDetail] = useState<string | null>(null);
  return (
    <>
      {createPortal(
        <div className="toast-host" aria-label="通知">
          {toasts.map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onDetails={(message) => {
                setDetail(message);
                useAppStore.getState().dismissToast(toast.id);
              }}
            />
          ))}
        </div>,
        document.body,
      )}
      <NoticeDetails message={detail} onClose={() => setDetail(null)} />
    </>
  );
}
