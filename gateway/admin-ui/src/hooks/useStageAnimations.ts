import { useEffect } from "react";

/**
 * Scroll-triggered stage animations.
 * Any element with .stage-title / .stage-description / .stage-content /
 * .stage-item starts hidden; when it enters the viewport we add
 * .animate-in-view and CSS plays the choreography (see index.css).
 *
 * Call once from a high-level mount (App or a layout component). Observers
 * are disconnected on unmount; re-observed elements are idempotent.
 */
export function useStageAnimations() {
  useEffect(() => {
    const els = document.querySelectorAll(
      ".stage-title, .stage-description, .stage-content, .stage-item",
    );
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-in-view");
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}
