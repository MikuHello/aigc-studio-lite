import { useEffect, useRef } from 'react';

// @reason Nested drop targets can stop React propagation; reset at the window.
export function useDragReset(reset: () => void) {
  const callback = useRef(reset);
  callback.current = reset;
  useEffect(() => {
    const clear = () => callback.current();
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) clear();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    window.addEventListener('drop', clear, true);
    window.addEventListener('dragend', clear, true);
    window.addEventListener('blur', clear);
    window.addEventListener('dragleave', leave);
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('drop', clear, true);
      window.removeEventListener('dragend', clear, true);
      window.removeEventListener('blur', clear);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', clear);
    };
  }, []);
}
