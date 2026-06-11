'use client';

import { useCallback, useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

export default function useReducedMotionGuard() {
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia(QUERY);
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const guardSpring = useCallback(
    <T,>(animatedValue: T, staticValue: T): T => (
      reducedMotion ? staticValue : animatedValue
    ),
    [reducedMotion],
  );

  return { reducedMotion, guardSpring };
}
