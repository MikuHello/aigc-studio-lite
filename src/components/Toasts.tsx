import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from 'lucide-react';
import type { Notice } from '@/types';
import { useAppStore } from '@/store/appStore';
import { NOTICE_DURATION_MS } from '@/lib/notices';
import { copyText, formatDateTime } from '@/lib/text';
import { Dialog } from './Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { InlineNotice, NoticeIcon, safeNoticeText } from './ui/Feedback';

export function NoticeDetails({
  message,
  onClose,
  notice,
}: {
  message: string | null;
  onClose: () => void;
  notice?: Notice | null;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const text = safeNoticeText(message);
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
                await copyText(text);
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
      {notice && (
        <div className="notice-detail-meta">
          <strong>{notice.title}</strong>
          <span>
            {[notice.context, formatDateTime(notice.updatedAt)].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
      <pre className="notice-full-message" tabIndex={0}>
        {text}
      </pre>
      <InlineNotice field message={copyError ? '复制失败，请选中上方文字手动复制。' : null} />
    </Dialog>
  );
}

function NoticeAction({ notice }: { notice: Notice }) {
  if (!notice.action) return null;
  return (
    <button
      type="button"
      className="feedback-action"
      onClick={() => {
        const state = useAppStore.getState();
        const connectionId = notice.action!.connectionId;
        if (state.providerConfigs[connectionId]) {
          state.dismissNotice(notice.id);
          state.requestConnectionEdit(connectionId);
        } else state.notify({ title: '供应商已不存在，请重新添加', tone: 'neutral' });
      }}
    >
      编辑连接
    </button>
  );
}

function ToastItem({ notice }: { notice: Notice }) {
  const dismiss = useAppStore((state) => state.dismissNotice);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef(NOTICE_DURATION_MS);
  useEffect(() => {
    remaining.current = NOTICE_DURATION_MS;
  }, [notice.updatedAt]);
  useEffect(() => {
    if (paused || notice.tone === 'error') return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(notice.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [dismiss, notice.id, notice.tone, notice.updatedAt, paused]);
  return (
    <div
      className={`toast toast-${notice.tone}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <NoticeIcon tone={notice.tone} size={17} />
      <div className="toast-body">
        <button
          className="toast-summary"
          type="button"
          aria-label={`查看消息详情：${notice.title}`}
          onClick={() => useAppStore.getState().showNoticeDetails(notice)}
        >
          {notice.title}
        </button>
        {notice.context && <span className="notice-context">{notice.context}</span>}
        {(notice.tone === 'error' || notice.detail || notice.action) && (
          <div className="notice-links">
            <NoticeAction notice={notice} />
            <button
              type="button"
              className="feedback-action"
              onClick={() => useAppStore.getState().showNoticeDetails(notice)}
            >
              查看详情
            </button>
          </div>
        )}
      </div>
      <IconButton
        label="关闭提示"
        size="sm"
        icon={<X size={14} />}
        onClick={() => dismiss(notice.id)}
      />
    </div>
  );
}

export function ToastHost() {
  const notices = useAppStore((state) => state.notices);
  const activeIds = useAppStore((state) => state.activeNoticeIds);
  const historyOpen = useAppStore((state) => state.noticeHistoryOpen);
  const detail = useAppStore((state) => state.noticeDetails);
  const detailText = detail ? (detail.detail ?? detail.title) : null;
  return (
    <>
      {createPortal(
        <div className="toast-host" aria-label="通知">
          {activeIds.map((id) => {
            const notice = notices.find((item) => item.id === id);
            return notice ? <ToastItem key={id} notice={notice} /> : null;
          })}
        </div>,
        document.body,
      )}
      <Dialog
        open={historyOpen}
        onClose={() => useAppStore.getState().setNoticeHistoryOpen(false)}
        title="最近消息"
        size="wide"
        className="notice-history-dialog"
        footer={
          <>
            <span className="notice-history-hint">仅保留本次打开期间的消息</span>
            <Button
              disabled={!notices.length}
              onClick={() => useAppStore.getState().clearNotices()}
            >
              清空记录
            </Button>
            <Button onClick={() => useAppStore.getState().setNoticeHistoryOpen(false)}>关闭</Button>
          </>
        }
      >
        {notices.length ? (
          <ul className="notice-history-list">
            {notices.map((notice) => (
              <li key={notice.id} className={`notice-history-item feedback-${notice.tone}`}>
                <NoticeIcon tone={notice.tone} />
                <div className="notice-history-body">
                  <button
                    type="button"
                    className="toast-summary"
                    onClick={() => useAppStore.getState().showNoticeDetails(notice)}
                  >
                    {notice.title}
                  </button>
                  <span className="notice-context">
                    {[notice.context, formatDateTime(notice.updatedAt)].filter(Boolean).join(' · ')}
                  </span>
                  <div className="notice-links">
                    <NoticeAction notice={notice} />
                    <button
                      type="button"
                      className="feedback-action"
                      onClick={() => useAppStore.getState().showNoticeDetails(notice)}
                    >
                      查看详情
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="notice-history-empty">暂无消息</p>
        )}
      </Dialog>
      <NoticeDetails
        message={detailText}
        notice={detail}
        onClose={() => useAppStore.getState().showNoticeDetails(null)}
      />
    </>
  );
}
