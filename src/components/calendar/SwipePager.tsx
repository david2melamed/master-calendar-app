"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { swipeScroll } from "./swipe-state";

/**
 * iPhone-style paging between days / weeks / months / years.
 *
 * While your finger drags sideways, the current page follows it and the
 * previous/next page is already sitting beside it. Let go past ~25% of the
 * width (or flick quickly) and it glides over; otherwise it springs back.
 * Arrow buttons / keyboard get a matching short slide.
 */
export function SwipePager({
  cursor,
  shift,
  render,
  onNavigate,
  nav,
}: {
  cursor: string;
  /** Key of the neighbouring page: shift(cursor, 1) = next, -1 = previous. */
  shift: (key: string, dir: 1 | -1) => string;
  render: (key: string) => ReactNode;
  onNavigate: (dir: 1 | -1) => void;
  /** Bumped by button/keyboard navigation so we can play the slide-in. */
  nav: { dir: 1 | -1 | 0; n: number };
}) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [neighbors, setNeighbors] = useState(false);
  const busy = useRef(false); // an animation is running; ignore new drags until done
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reduceMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const setX = (x: number, ms = 0, ease = "cubic-bezier(0.22, 0.8, 0.24, 1)") => {
    const el = track.current;
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms ${ease}` : "none";
    el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
  };

  const finish = useCallback(() => {
    busy.current = false;
    clearTimeout(hideTimer.current);
    // Keep neighbours briefly in case another swipe follows, then drop them.
    hideTimer.current = setTimeout(() => {
      setNeighbors(false);
      swipeScroll.active = false;
    }, 250);
  }, []);

  // Play a short slide after button / keyboard navigation.
  useLayoutEffect(() => {
    if (!nav.dir || !track.current || reduceMotion()) return;
    track.current.animate(
      [
        { transform: `translate3d(${nav.dir * 48}px,0,0)`, opacity: 0.35 },
        { transform: "translate3d(0,0,0)", opacity: 1 },
      ],
      { duration: 240, easing: "cubic-bezier(0.22, 0.8, 0.24, 1)" },
    );
  }, [nav]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let axis: "x" | "y" | null = null;
    let dx = 0;
    let samples: { x: number; t: number }[] = [];

    const onStart = (e: TouchEvent) => {
      if (busy.current || e.touches.length !== 1) return;
      const p = e.touches[0];
      start = { x: p.clientX, y: p.clientY };
      axis = null;
      dx = 0;
      samples = [{ x: p.clientX, t: performance.now() }];
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const p = e.touches[0];
      const mx = p.clientX - start.x;
      const my = p.clientY - start.y;
      if (!axis) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = Math.abs(mx) > Math.abs(my) * 1.2 ? "x" : "y";
        if (axis === "x") {
          clearTimeout(hideTimer.current);
          swipeScroll.active = true; // neighbours open at the same time of day
          setNeighbors(true);
        }
      }
      if (axis !== "x") return;
      e.preventDefault(); // stop the page from scrolling vertically mid-swipe
      dx = mx;
      samples.push({ x: p.clientX, t: performance.now() });
      if (samples.length > 5) samples.shift();
      setX(dx);
    };

    const onEnd = () => {
      if (!start || axis !== "x") {
        start = null;
        return;
      }
      start = null;
      const width = el.clientWidth || 1;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const v = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0; // px per ms
      const flick = Math.abs(v) > 0.35 && Math.sign(v) === Math.sign(dx);
      const commit = Math.abs(dx) > width * 0.25 || (flick && Math.abs(dx) > 20);
      busy.current = true;

      if (!commit) {
        setX(0, 260);
        afterTransition(finish);
        return;
      }
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const remaining = width - Math.abs(dx);
      const ms = Math.round(Math.min(300, Math.max(140, remaining / Math.max(Math.abs(v), 1.4))));
      setX(-dir * width, ms);
      afterTransition(() => {
        // Swap in the new page and reset the track in the same frame: seamless.
        flushSync(() => onNavigate(dir));
        setX(0);
        finish();
      });
    };

    const afterTransition = (fn: () => void) => {
      const t = track.current;
      let done = false;
      const run = () => {
        if (done) return;
        done = true;
        t?.removeEventListener("transitionend", run);
        fn();
      };
      t?.addEventListener("transitionend", run);
      setTimeout(run, 400); // safety net if transitionend never fires
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [finish, onNavigate]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  return (
    <div ref={box} className="relative h-full min-h-0 overflow-hidden" style={{ touchAction: "pan-y" }}>
      <div ref={track} className="relative h-full will-change-transform">
        <div className="h-full">{render(cursor)}</div>
        {neighbors && (
          <>
            <div className="absolute inset-0 -translate-x-full" aria-hidden inert>
              {render(shift(cursor, -1))}
            </div>
            <div className="absolute inset-0 translate-x-full" aria-hidden inert>
              {render(shift(cursor, 1))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
