import { InlineNotice } from './ui/Feedback';
import { useAppStore } from '@/store/appStore';
import { useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { VideoResult } from '@/types';
import { Button } from './ui/Button';
import { downloadDataUrl } from '@/lib/image';

export function VideoPlayer({
  result,
  title = '生成视频',
}: {
  result: VideoResult;
  title?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    setError(null);
  }, [result.url]);
  return (
    <div className="video-player">
      <video
        key={result.url}
        src={result.url}
        controls
        playsInline
        preload="metadata"
        poster={result.lastFrameUrl}
        aria-label={title}
        onError={() =>
          setError('暂时无法播放，链接可能已过期，或浏览器不支持此视频编码。可尝试打开原始链接。')
        }
      />
      <div className="video-player-actions">
        <Button
          size="sm"
          icon={<Download size={14} />}
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            setError(null);
            try {
              const response = await fetch(result.url, {
                credentials: 'omit',
                signal: AbortSignal.timeout(120000),
              });
              if (!response.ok) throw new Error();
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              downloadDataUrl(url, `aigc-video-${Date.now()}.mp4`);
              window.setTimeout(() => URL.revokeObjectURL(url), 60000);
            } catch {
              useAppStore.getState().notify({
                title: '下载视频失败',
                detail: '请打开原始链接后使用浏览器另存为。',
                tone: 'error',
              });
            } finally {
              setDownloading(false);
            }
          }}
        >
          {downloading ? '下载中' : '下载视频'}
        </Button>
        <a href={result.url} target="_blank" rel="noreferrer" className="ui-text-button">
          <ExternalLink size={14} />
          打开原始链接
        </a>
        <span className="video-link-hint">结果链接通常 24 小时有效，请及时下载</span>
      </div>
      <InlineNotice title={error ? '播放视频失败' : undefined} message={error} />
    </div>
  );
}
