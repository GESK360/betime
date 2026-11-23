import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import {
  loadWindowOpacity,
  saveWindowOpacity,
  subscribeWindowOpacity,
  WINDOW_OPACITY_CHANGE_EVENT,
  WINDOW_OPACITY_MAX,
  WINDOW_OPACITY_MIN,
  WINDOW_OPACITY_STORAGE_KEY,
} from "./windowOpacity";

describe("windowOpacity", () => {
  let stored: Map<string, string>;
  let ipcCalls: Array<{ command: string; payload: unknown }>;

  beforeEach(() => {
    stored = new Map<string, string>();
    ipcCalls = [];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    vi.stubGlobal("window", new EventTarget());
    mockWindows("main");
    mockIPC((command, payload) => {
      ipcCalls.push({ command, payload });
      if (command === "plugin:event|listen") {
        return 1;
      }
      return undefined;
    });
  });

  afterEach(() => {
    clearMocks();
    vi.unstubAllGlobals();
  });

  it("persists opacity, dispatches DOM event, and broadcasts Tauri event", () => {
    const receivedDom: number[] = [];
    window.addEventListener(WINDOW_OPACITY_CHANGE_EVENT, (event) => {
      receivedDom.push((event as CustomEvent<number>).detail);
    });

    const saved = saveWindowOpacity(0.6);
    expect(saved).toBe(0.6);
    expect(stored.get(WINDOW_OPACITY_STORAGE_KEY)).toBe("0.6");
    expect(loadWindowOpacity()).toBe(0.6);
    expect(receivedDom).toEqual([0.6]);

    const emitCall = ipcCalls.find(
      (call) => call.command === "plugin:event|emit",
    );
    expect(emitCall).toBeDefined();
    expect(emitCall?.payload).toMatchObject({
      event: WINDOW_OPACITY_CHANGE_EVENT,
      payload: { opacity: 0.6 },
    });
  });

  it("subscribes to DOM change and storage events and clamps values", () => {
    const observed: number[] = [];
    const unsubscribe = subscribeWindowOpacity((value) => {
      observed.push(value);
    });

    window.dispatchEvent(
      new CustomEvent<number>(WINDOW_OPACITY_CHANGE_EVENT, { detail: 0.1 }),
    );
    window.dispatchEvent(
      new CustomEvent<number>(WINDOW_OPACITY_CHANGE_EVENT, { detail: 1.5 }),
    );

    stored.set(WINDOW_OPACITY_STORAGE_KEY, "0.75");
    window.dispatchEvent(
      Object.assign(new Event("storage"), {
        key: WINDOW_OPACITY_STORAGE_KEY,
      }),
    );

    expect(observed).toEqual([WINDOW_OPACITY_MIN, WINDOW_OPACITY_MAX, 0.75]);

    unsubscribe();
    window.dispatchEvent(
      new CustomEvent<number>(WINDOW_OPACITY_CHANGE_EVENT, { detail: 0.5 }),
    );
    expect(observed).toEqual([WINDOW_OPACITY_MIN, WINDOW_OPACITY_MAX, 0.75]);
  });
});
