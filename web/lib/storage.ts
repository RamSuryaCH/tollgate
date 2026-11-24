"use client";

import { useSyncExternalStore } from "react";

// Same-tab updates do not fire the native "storage" event, so writes dispatch this one.
const LOCAL_EVENT = "tollgate:storage";

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be blocked (private mode, disabled cookies). Treat it as empty.
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore: the value simply will not persist across reloads.
  }
  window.dispatchEvent(new Event(LOCAL_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(LOCAL_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(LOCAL_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** A localStorage value that re-renders when it changes. Server render and hydration see null. */
export function useStoredValue(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
  return [value, (next) => writeStored(key, next)];
}
