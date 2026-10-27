import { describe, expect, it, vi } from 'vitest';
import { hasReferenceTransfer, receiveReferenceTransfer } from '@/lib/referenceTransfer';
import { ASSET_DRAG_TYPE } from '@/lib/referenceMedia';

const transfer = (files: File[], data: Record<string, string> = {}) =>
  ({
    files,
    types: [...(files.length ? ['Files'] : []), ...Object.keys(data)],
    getData: (type: string) => data[type] ?? '',
  }) as unknown as DataTransfer;
describe('shared reference drop and paste', () => {
  it('delivers mixed clipboard/drop files once without stripping audio or adding a duplicate HTML image', () => {
    const files = [
      new File(['x'], 'avatar.png', { type: 'image/png' }),
      new File(['y'], 'voice.wav', { type: 'audio/wav' }),
    ];
    const target = { onFiles: vi.fn(), onError: vi.fn() };
    const data = transfer(files, { 'text/html': '<img src="https://example.com/avatar.png">' });
    expect(hasReferenceTransfer(data)).toBe(true);
    expect(receiveReferenceTransfer(data, target)).toBe(true);
    expect(target.onFiles).toHaveBeenCalledExactlyOnceWith(files);
  });
  it('reuses internal assets and recognizes external media links without downloading video', () => {
    const target = { onFiles: vi.fn(), onAsset: vi.fn(), onLink: vi.fn(), onError: vi.fn() };
    expect(
      receiveReferenceTransfer(transfer([], { [ASSET_DRAG_TYPE]: 'local-asset' }), target),
    ).toBe(true);
    expect(target.onAsset).toHaveBeenCalledExactlyOnceWith('local-asset');
    expect(
      receiveReferenceTransfer(
        transfer([], { 'text/uri-list': 'https://example.com/motion.mp4' }),
        target,
      ),
    ).toBe(true);
    expect(target.onLink).toHaveBeenCalledExactlyOnceWith('https://example.com/motion.mp4');
    expect(target.onFiles).not.toHaveBeenCalled();
  });
  it('leaves ordinary text and non-media link editing alone', () => {
    const target = { onFiles: vi.fn(), onError: vi.fn() };
    expect(receiveReferenceTransfer(transfer([], { 'text/plain': 'description' }), target)).toBe(
      false,
    );
    expect(
      receiveReferenceTransfer(
        transfer([], { 'text/uri-list': 'https://example.com/article' }),
        target,
      ),
    ).toBe(false);
  });
});
