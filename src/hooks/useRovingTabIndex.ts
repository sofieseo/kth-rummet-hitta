import { useCallback, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

/**
 * Keeps a composite group to one stop in the page Tab order while allowing
 * arrow-key navigation between its controls.
 */
export function useRovingTabIndex() {
  const [activeIndex, setActiveIndex] = useState(0);
  const controlsRef = useRef<Array<HTMLElement | null>>([]);

  const register = useCallback((index: number, node: HTMLElement | null) => {
    controlsRef.current[index] = node;
  }, []);

  const focusAt = useCallback((index: number, count: number) => {
    if (count === 0) return;
    const nextIndex = (index + count) % count;
    setActiveIndex(nextIndex);
    controlsRef.current[nextIndex]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, index: number, count: number) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        focusAt(index + 1, count);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        focusAt(index - 1, count);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusAt(0, count);
      } else if (event.key === "End") {
        event.preventDefault();
        focusAt(count - 1, count);
      }
    },
    [focusAt],
  );

  const onBlurCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      // Always make the group's first control its entry point when Tab returns.
      setActiveIndex(0);
    }
  }, []);

  return {
    register,
    tabIndex: (index: number) => (index === activeIndex ? 0 : -1),
    onFocus: setActiveIndex,
    onKeyDown,
    onBlurCapture,
  };
}
