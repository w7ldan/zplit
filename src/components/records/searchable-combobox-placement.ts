import { useCallback, useEffect, useState, type RefObject } from "react";

export type SearchableComboboxPlacement = {
  direction: "down" | "up";
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

type PlacementRect = Pick<DOMRect, "top" | "right" | "bottom" | "left">;
type TriggerRect = PlacementRect & Pick<DOMRect, "width">;

export function calculateSearchableComboboxPlacement(triggerRect: TriggerRect, boundaryRect: PlacementRect, naturalHeight: number, gap = 4): SearchableComboboxPlacement {
  const boundaryWidth = Math.max(boundaryRect.right - boundaryRect.left, 0);
  const width = Math.min(Math.max(triggerRect.width, 0), boundaryWidth);
  const left = Math.min(Math.max(triggerRect.left, boundaryRect.left), boundaryRect.right - width);
  const below = Math.max(boundaryRect.bottom - triggerRect.bottom - gap, 0);
  const above = Math.max(triggerRect.top - boundaryRect.top - gap, 0);
  const height = Math.max(naturalHeight, 0);
  const direction = below >= height || below >= above ? "down" : "up";
  const available = direction === "down" ? below : above;
  const maxHeight = Math.min(height, available);

  return {
    direction,
    top: direction === "down" ? triggerRect.bottom + gap : triggerRect.top - gap - maxHeight,
    left,
    width,
    maxHeight,
  };
}

function isClippingOverflow(value: string) {
  return value === "auto" || value === "clip" || value === "hidden" || value === "scroll";
}

function getClippingRect(element: HTMLElement) {
  const visualViewport = window.visualViewport;
  const viewportLeft = visualViewport?.offsetLeft ?? 0;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const boundary = {
    top: viewportTop,
    right: viewportLeft + (visualViewport?.width ?? window.innerWidth),
    bottom: viewportTop + (visualViewport?.height ?? window.innerHeight),
    left: viewportLeft,
  };

  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    const clipX = isClippingOverflow(style.overflowX || style.overflow);
    const clipY = isClippingOverflow(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;
    const rect = ancestor.getBoundingClientRect();
    if (clipX) {
      boundary.left = Math.max(boundary.left, rect.left);
      boundary.right = Math.min(boundary.right, rect.right);
    }
    if (clipY) {
      boundary.top = Math.max(boundary.top, rect.top);
      boundary.bottom = Math.min(boundary.bottom, rect.bottom);
    }
  }

  return boundary;
}

type SearchableComboboxPlacementProps = {
  open: boolean;
  portalTarget: HTMLElement | null;
  rootRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  options: readonly unknown[];
  error: string;
  loading: boolean;
};

export function useSearchableComboboxPlacement({ open, portalTarget, rootRef, triggerRef, panelRef, options, error, loading }: SearchableComboboxPlacementProps) {
  const [placement, setPlacement] = useState<SearchableComboboxPlacement | null>(null);
  const clearPlacement = useCallback(() => setPlacement(null), []);

  useEffect(() => {
    if (!open || !portalTarget) return;

    let frame: number | null = null;
    const schedulePlacement = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const trigger = triggerRef.current;
        const panel = panelRef.current;
        if (!trigger || !panel) return;
        const triggerRect = trigger.getBoundingClientRect();
        const boundaryRect = getClippingRect(rootRef.current ?? trigger);
        const width = Math.min(Math.max(triggerRect.width, 0), Math.max(boundaryRect.right - boundaryRect.left, 0));
        panel.style.width = `${width}px`;
        panel.style.maxHeight = "none";
        setPlacement(calculateSearchableComboboxPlacement(triggerRect, boundaryRect, panel.scrollHeight));
      });
    };

    schedulePlacement();
    window.addEventListener("resize", schedulePlacement);
    window.addEventListener("scroll", schedulePlacement, true);
    window.visualViewport?.addEventListener("resize", schedulePlacement);
    window.visualViewport?.addEventListener("scroll", schedulePlacement);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedulePlacement);
      window.removeEventListener("scroll", schedulePlacement, true);
      window.visualViewport?.removeEventListener("resize", schedulePlacement);
      window.visualViewport?.removeEventListener("scroll", schedulePlacement);
    };
  }, [error, loading, open, options, portalTarget, rootRef, triggerRef, panelRef]);

  return { placement, clearPlacement };
}
