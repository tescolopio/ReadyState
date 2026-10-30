import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { newId } from "@/lib/household";

export const PLAN_STATUSES = { open: "Open", "in-progress": "In progress", done: "Done" } as const;
export type PlanStatus = keyof typeof PLAN_STATUSES;

export interface PlanItem {
  id: string;
  /** The practical step, unmasked. */
  text: string;
  /** Where it came from, such as "Hour 6 · Extended power outage" or "Household check". */
  source: string;
  /** "get" or "plan" for household-check findings; unset for exercise lessons. */
  kind?: "get" | "plan";
  status: PlanStatus;
  addedAt: string;
}

/**
 * The action plan (design brief UX04, Modern treatment §7.7): practical steps
 * the participant chose to keep. Persisted to this browser's localStorage,
 * like the household profile (decision D9), so it survives reloads. The full
 * running plan, grouped as Get, Plan and Practice, is work item F12.
 */
interface PlanState {
  items: PlanItem[];
  add: (item: Pick<PlanItem, "text" | "source" | "kind">) => void;
  setStatus: (id: string, status: PlanStatus) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set) => ({
      items: [],
      add: (item) =>
        set((state) =>
          state.items.some((existing) => existing.text === item.text)
            ? state
            : { items: [...state.items, { ...item, id: newId(), status: "open", addedAt: new Date().toISOString() }] },
        ),
      setStatus: (id, status) =>
        set((state) => ({ items: state.items.map((item) => (item.id === id ? { ...item, status } : item)) })),
      remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: "readystate-plan",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
