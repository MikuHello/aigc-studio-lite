import type { Asset } from '@/types';
import { ReferenceTray } from './ReferenceTray';

export function VideoFrameSlot({
  label,
  asset,
  disabled,
  onRemove,
  onChoose,
}: {
  label: string;
  asset?: Asset;
  disabled: boolean;
  onRemove: () => void;
  onChoose: () => void;
}) {
  return (
    <ReferenceTray
      title={label}
      addLabel={`添加${label}`}
      items={asset ? [{ asset, label }] : []}
      busy={disabled}
      onAdd={onChoose}
      onRemove={onRemove}
    />
  );
}
