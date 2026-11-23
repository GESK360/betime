import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export const WINDOW_OPACITY_STORAGE_KEY = "betime:window-opacity";
export const WINDOW_OPACITY_CHANGE_EVENT = "betime-window-opacity-changed";
export const WINDOW_OPACITY_MIN = 0.35;
export const WINDOW_OPACITY_MAX = 1;
export const WINDOW_OPACITY_STEP = 0.05;
const WHEEL_OPACITY_THRESHOLD = 50;

type OpacityWheelTarget = {
  readonly current: HTMLElement | null;
};

function clampWindowOpacity(value: number) {
  return Math.min(WINDOW_OPACITY_MAX, Math.max(WINDOW_OPACITY_MIN, value));
}

export function loadWindowOpacity() {
  try {
    const stored = localStorage.getItem(WINDOW_OPACITY_STORAGE_KEY);
    if (stored == null) return WINDOW_OPACITY_MAX;
    const value = Number(stored);
    return Number.isFinite(value)
      ? clampWindowOpacity(value)
      : WINDOW_OPACITY_MAX;
  } catch {
    return WINDOW_OPACITY_MAX;
  }
}

export function saveWindowOpacity(opacity: number) {
  const nextOpacity = clampWindowOpacity(opacity);
  try {
    localStorage.setItem(WINDOW_OPACITY_STORAGE_KEY, String(nextOpacity));
  } catch {
    /* Keep the current window usable even when storage is unavailable. */
  }
  window.dispatchEvent(
    new CustomEvent<number>(WINDOW_OPACITY_CHANGE_EVENT, {
      detail: nextOpacity,
    }),
  );
  try {
    void emit(WINDOW_OPACITY_CHANGE_EVENT, { opacity: nextOpacity }).catch(
      () => {
        /* browser */
      },
    );
  } catch {
    /* browser */
  }
  return nextOpacity;
}

export function subscribeWindowOpacity(
  onChange: (opacity: number) => void,
): () => void {
  const emitOpacity = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      onChange(clampWindowOpacity(value));
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === WINDOW_OPACITY_STORAGE_KEY || event.key == null) {
      onChange(loadWindowOpacity());
    }
  };
  const handleOpacityChange = (event: Event) => {
    emitOpacity((event as CustomEvent<number>).detail);
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(WINDOW_OPACITY_CHANGE_EVENT, handleOpacityChange);

  let disposed = false;
  let unlistenTauri: (() => void) | undefined;
  try {
    void listen<{ opacity?: number }>(WINDOW_OPACITY_CHANGE_EVENT, (event) => {
      if (disposed) return;
      emitOpacity(event.payload?.opacity);
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenTauri = unlisten;
        }
      })
      .catch(() => {
        /* browser */
      });
  } catch {
    /* browser */
  }

  return () => {
    disposed = true;
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(
      WINDOW_OPACITY_CHANGE_EVENT,
      handleOpacityChange,
    );
    unlistenTauri?.();
  };
}

export function adjustWindowOpacity(opacity: number, direction: -1 | 1) {
  return clampWindowOpacity(
    Number((opacity + direction * WINDOW_OPACITY_STEP).toFixed(2)),
  );
}

function getWheelDelta(event: WheelEvent) {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * 80;
  return event.deltaY;
}

export function useWindowOpacity(wheelTarget?: OpacityWheelTarget) {
  const [opacity, setOpacity] = useState(loadWindowOpacity);
  const opacityRef = useRef(opacity);

  useEffect(() => {
    opacityRef.current = opacity;
    void setWindowOpacity(opacity);
  }, [opacity]);

  useEffect(() => {
    return subscribeWindowOpacity((nextOpacity) => {
      const unchanged = opacityRef.current === nextOpacity;
      opacityRef.current = nextOpacity;
      setOpacity(nextOpacity);
      if (unchanged) {
        void setWindowOpacity(nextOpacity);
      }
    });
  }, []);

  useEffect(() => {
    const target = wheelTarget?.current;
    if (target == null) return;

    let wheelDelta = 0;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      const delta = getWheelDelta(event);
      if (delta === 0) return;

      event.preventDefault();
      event.stopPropagation();
      wheelDelta += delta;
      if (Math.abs(wheelDelta) < WHEEL_OPACITY_THRESHOLD) return;

      const direction = wheelDelta > 0 ? -1 : 1;
      saveWindowOpacity(adjustWindowOpacity(opacityRef.current, direction));
      wheelDelta = 0;
    };

    target.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      target.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [wheelTarget]);
}

export async function setWindowOpacity(opacity: number) {
  try {
    await invoke("set_window_opacity", { opacity });
  } catch {
    /* browser */
  }
}
