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
  /** Whether this tab has loaded or explicitly changed its masking rules. */
  alwaysMaskInitialized: boolean;
  /** Whether the current complete rule list was saved to browser storage. */
  alwaysMaskPersisted: boolean;
  setAlwaysMask: (names: string[], persisted?: boolean) => void;
  hydrateAlwaysMask: (names: string[]) => string[];
}

export const usePrivacyStore = create<PrivacyState>()((set) => ({
  entityMap: {},
  addMapping: (realValue, tag) =>
    set((state) => ({ entityMap: { ...state.entityMap, [tag]: realValue } })),
  clearMappings: () => set({ entityMap: {} }),
  alwaysMask: [],
  alwaysMaskInitialized: false,
  alwaysMaskPersisted: false,
  setAlwaysMask: (names, persisted = false) =>
    set({
      alwaysMask: [...new Set(names.map((name) => name.trim()).filter(Boolean))],
      alwaysMaskInitialized: true,
      alwaysMaskPersisted: persisted,
    }),
  hydrateAlwaysMask: (names) => {
    let rules: string[] = [];
    set((state) => {
      if (state.alwaysMaskInitialized) {
        rules = state.alwaysMask;
        return state;
      }
      rules = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
      return { alwaysMask: rules, alwaysMaskInitialized: true, alwaysMaskPersisted: true };
    });
    return rules;
  },
}));
