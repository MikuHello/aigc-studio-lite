import { useEffect, useState } from 'react';

export function usePresence(open: boolean, duration = 180) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
    const timer = window.setTimeout(() => setPresent(false), delay);
    return () => window.clearTimeout(timer);
  }, [open, duration]);
  return present || open;
}
