/**
 * Bottom-anchor controller for the chat timeline — the DOM half of `timeline/bottom-anchor.ts`
 * (which owns every decision and is unit-tested on its own). This file only turns browser events
 * into the four anchor events and executes the one side effect they can ask for: scroll the
 * viewport to its very end.
 *
 * **Gesture window, not a suppression flag.** Detaching requires a user input, but `wheel`/
 * `touchmove` do not carry their resulting `scroll` event with them, so a gesture is recorded as a
 * timestamp and any scroll within `GESTURE_WINDOW_MS` of it counts as user-driven. The alternative
 * — flagging our own programmatic scrolls and treating everything else as the user's — loses to a
 * genuine race: a `display:none` tab restores its old `scrollTop` (and fires a scroll event) at
 * the same layout tick in which it becomes measurable again, so "not ours" would mean "the user
 * detached" exactly when the user did nothing. A gesture cannot be faked by the browser, so this
 * direction has no race to lose.
 *
 * **Why a `ResizeObserver`, not a `visible` prop.** The controller must re-assert the bottom when
 * the viewport becomes measurable again, and a hidden chat tab is only one way to get there —
 * pane splits/divider drags, workspace switches, window resizes and the mobile keyboard all change
 * the box the same way. Observing the scroller covers all of them locally, and keeps `PanelProps`
 * (shared by every panel kind) out of a problem that belongs to this one scroller.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import {
  nextAnchorState,
  type AnchorEvent,
  type ViewportMetrics,
} from "@pi-studio-ui/timeline/bottom-anchor.js";

/** How long after a user input a `scroll` event still counts as that input's doing. */
const GESTURE_WINDOW_MS = 500;

export interface BottomAnchor {
  /** `false` once the user has scrolled away — render the jump-to-latest affordance. */
  pinned: boolean;
  /** Follow the tail if still pinned (rows appended, or a row's identity changed). */
  followTail: () => void;
  /** Pin and scroll to the end regardless of state (jump-to-latest, the user's own message). */
  pinToBottom: () => void;
}

export function useBottomAnchor(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  scrollRef: RefObject<HTMLDivElement | null>,
): BottomAnchor {
  // Two copies of one truth on purpose: the ref is what event handlers read (they run outside
  // React and must never see a stale render's value), the state is what renders the button.
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const lastGestureAtRef = useRef(0);

  const dispatch = useCallback(
    (event: AnchorEvent) => {
      const el = scrollRef.current;
      const metrics: ViewportMetrics = el
        ? { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
        : { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
      const decision = nextAnchorState(pinnedRef.current, event, metrics);
      if (decision.pinned !== pinnedRef.current) {
        pinnedRef.current = decision.pinned;
        setPinned(decision.pinned);
      }
      // `behavior: "auto"` is required, not cosmetic: the virtualizer disables its own
      // end-anchoring while a smooth scroll is in flight, which is exactly the window in which
      // streamed text grows the row we are trying to stay pinned to.
      if (decision.stick && virtualizer.options.count > 0) {
        virtualizer.scrollToEnd({ behavior: "auto" });
      }
    },
    [scrollRef, virtualizer],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const markGesture = () => {
      lastGestureAtRef.current = performance.now();
    };
    const onScroll = () => {
      dispatch({
        kind: "scroll",
        gesture: performance.now() - lastGestureAtRef.current < GESTURE_WINDOW_MS,
      });
    };
    // `pointerdown` covers scrollbar drags and click-drag text selection, which produce scroll
    // events without ever emitting `wheel`/`touchmove`; `keydown` covers PageUp/Home/arrows once
    // focus sits inside the scroller.
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", markGesture, { passive: true });
    el.addEventListener("touchmove", markGesture, { passive: true });
    el.addEventListener("pointerdown", markGesture, { passive: true });
    el.addEventListener("keydown", markGesture, { passive: true });

    // Fires once on `observe()` with the current box, which is what re-pins a freshly mounted
    // timeline; afterwards only a real box change gets here, never a content change.
    const observer = new ResizeObserver(() => {
      // A collapsed box (a tab parked under `display:none`) can neither be measured nor scrolled.
      if (el.clientHeight > 0) dispatch({ kind: "shown" });
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", markGesture);
      el.removeEventListener("touchmove", markGesture);
      el.removeEventListener("pointerdown", markGesture);
      el.removeEventListener("keydown", markGesture);
    };
  }, [dispatch, scrollRef]);

  const followTail = useCallback(() => dispatch({ kind: "tail" }), [dispatch]);
  const pinToBottom = useCallback(() => dispatch({ kind: "pin" }), [dispatch]);

  return { pinned, followTail, pinToBottom };
}
