import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ProviderSettings } from "@/lib/providers";

/**
 * Self-hosted provider choice and API key. Persisted to this browser's
 * localStorage so it survives reloads, and sent only to this ReadyState
 * server with each request. Unlike the privacy ledger, nothing here is a real
 * identity. The hosted service ignores these settings entirely.
 */
interface SettingsState {
  /** `null` until the user saves a choice; the server default applies. */
  settings: ProviderSettings | null;
  setSettings: (settings: ProviderSettings | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: null,
      setSettings: (settings) => set({ settings }),
    }),
    {
      name: "readystate-provider-settings",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
