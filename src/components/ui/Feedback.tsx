import type { ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Info } from 'lucide-react';
import type { NoticeTone } from '@/types';
import { noticeSummary, noticeText } from '@/lib/notices';
import { useAppStore } from '@/store/appStore';

export function safeNoticeText(value: unknown): string {
  return noticeText(
    value,
    Object.values(useAppStore.getState().providerConfigs).map((config) => config.apiKey),
  );
}

export function NoticeIcon({ tone, size = 16 }: { tone: NoticeTone; size?: number }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? CircleAlert : Info;
  return <Icon size={size} aria-hidden="true" />;
}

export function InlineNotice({
  message,
  title,
  tone = 'error',
  field = false,
  children,
}: {
  message?: unknown;
  title?: string;
  tone?: NoticeTone;
  field?: boolean;
  children?: ReactNode;
}) {
  const text = safeNoticeText(message);
  if (!text && !title) return null;
  const summary = title ? safeNoticeText(title) : noticeSummary(text);
  const hasDetails = !field && Boolean(text && (title || summary !== text));
  return (
    <div
      className={`feedback feedback-${tone} ${field ? 'feedback-field' : 'feedback-status'}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <NoticeIcon tone={tone} size={field ? 13 : 16} />
      <span className="feedback-summary">{field ? text : summary}</span>
      {hasDetails && (
        <button
          type="button"
          className="feedback-action"
          onClick={() =>
            useAppStore.getState().showNoticeDetails({ title: summary, detail: text, tone })
          }
        >
          查看详情
        </button>
      )}
      {children}
    </div>
  );
}
