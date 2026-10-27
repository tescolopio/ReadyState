import { create } from "zustand";

/**
 * Client-side privacy ledger. Maps obfuscation tags (e.g. `[Person 1]`) to the
 * real values they replace. Intentionally kept in memory only (no `persist`
 * middleware) so real identities never leave the browser tab.
 */
interface PrivacyState {
  /** tag -> real value, e.g. `{ "[Person 1]": "Jane Doe" }` */
  entityMap: Record<string, string>;
  addMapping: (realValue: string, tag: string) => void;
  clearMappings: () => void;
}

export const usePrivacyStore = create<PrivacyState>()((set) => ({
  entityMap: {},
  addMapping: (realValue, tag) =>
    set((state) => ({ entityMap: { ...state.entityMap, [tag]: realValue } })),
  clearMappings: () => set({ entityMap: {} }),
}));
