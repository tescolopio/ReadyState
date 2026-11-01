import { create } from "zustand";

/**
 * Client-side privacy ledger. Maps obfuscation tags (e.g. `[Person 1]`) to the
 * real values they replace. Intentionally kept in memory only (no `persist`
 * middleware). Only the tags are sent, never the real values they stand for.
 * Masking can still miss identifiers it doesn't recognize.
 */
interface PrivacyState {
  /** tag -> real value, e.g. `{ "[Person 1]": "Jane Doe" }` */
  entityMap: Record<string, string>;
  addMapping: (realValue: string, tag: string) => void;
  clearMappings: () => void;
  /** Names the user wants masked wherever they appear, even if no detector catches them. */
  alwaysMask: string[];
  setAlwaysMask: (names: string[]) => void;
}

export const usePrivacyStore = create<PrivacyState>()((set) => ({
  entityMap: {},
  addMapping: (realValue, tag) =>
    set((state) => ({ entityMap: { ...state.entityMap, [tag]: realValue } })),
  clearMappings: () => set({ entityMap: {} }),
  alwaysMask: [],
  setAlwaysMask: (names) =>
    set({ alwaysMask: [...new Set(names.map((name) => name.trim()).filter(Boolean))] }),
}));
