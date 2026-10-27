import { useRef, useState, type DragEvent } from 'react';
import { useDragReset } from './useDragReset';
import {
  hasReferenceTransfer,
  receiveReferenceTransfer,
  type ReferenceTransferTarget,
} from '@/lib/referenceTransfer';

export function useReferenceDrop(target: ReferenceTransferTarget, disabled = false) {
  const depth = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const reset = () => {
    depth.current = 0;
    setDragActive(false);
  };
  useDragReset(reset);
  return {
    dragActive,
    dropHandlers: {
      onDragEnterCapture(event: DragEvent) {
        if (disabled || !hasReferenceTransfer(event.dataTransfer)) return;
        event.preventDefault();
        depth.current++;
        setDragActive(true);
      },
      onDragOverCapture(event: DragEvent) {
        if (disabled || !hasReferenceTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDragLeaveCapture() {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragActive(false);
      },
      onDropCapture(event: DragEvent) {
        reset();
        if (!hasReferenceTransfer(event.dataTransfer)) return;
        if (disabled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (receiveReferenceTransfer(event.dataTransfer, target)) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}
