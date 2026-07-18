'use client';
import { useEffect } from 'react';
import Lenis from 'lenis';

/**
 * Inertia-based smooth scrolling for the landing page only — mounted once per
 * page visit and torn down on unmount so it never leaks into the app routes
 * (dashboard, circle pages), which keep native scroll.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({
      duration: 1.1,
      easing: t => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
    });

    let frame: number;
    function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    }
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
