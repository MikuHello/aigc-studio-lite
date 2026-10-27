import { ASSET_DRAG_TYPE } from './referenceMedia';

export interface ReferenceTransferTarget {
  onFiles: (files: File[]) => void | Promise<void>;
  onAsset?: (id: string) => void;
  onLink?: (url: string) => void;
  onError: (message: string) => void;
}

export function hasReferenceTransfer(transfer: DataTransfer): boolean {
  return ['Files', ASSET_DRAG_TYPE, 'text/uri-list', 'text/html'].some((type) =>
    transfer.types.includes(type),
  );
}

export function receiveReferenceTransfer(
  transfer: DataTransfer,
  target: ReferenceTransferTarget,
): boolean {
  const files = Array.from(transfer.files);
  if (files.length) {
    void target.onFiles(files);
    return true;
  }
  const id = transfer.getData(ASSET_DRAG_TYPE);
  if (id && target.onAsset) {
    target.onAsset(id);
    return true;
  }
  const html = transfer.getData('text/html');
  const image = html
    ? new DOMParser().parseFromString(html, 'text/html').querySelector('img')
    : null;
  const uri = transfer
    .getData('text/uri-list')
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith('#'));
  const url = image?.getAttribute('src') || uri;
  if (!url) return false;
  if (!image && target.onLink && /\.(mp4|mov|mp3|wav)(?:[?#]|$)/i.test(url)) {
    target.onLink(url);
    return true;
  }
  if (!image && !/\.(png|jpe?g|webp)(?:[?#]|$)/i.test(url) && !url.startsWith('data:image/'))
    return false;
  if (!/^(https?:|data:image\/|blob:)/i.test(url)) {
    target.onError('无法读取拖入的图片，请保存到本地后上传。');
    return true;
  }
  void (async () => {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error();
      const length = Number(response.headers.get('content-length'));
      if (length > 12 * 1024 * 1024) throw new Error();
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size > 12 * 1024 * 1024) throw new Error();
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
      await target.onFiles([new File([blob], `拖入图片.${extension}`, { type: blob.type })]);
    } catch {
      target.onError('无法读取拖入的图片（可能受跨域限制），请保存到本地后上传。');
    }
  })();
  return true;
}
