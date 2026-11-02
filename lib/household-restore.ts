import { create } from "zustand";

interface HouseholdRestoreState {
  version: number;
}

export const useHouseholdRestoreStore = create<HouseholdRestoreState>()(() => ({ version: 0 }));

export function invalidateHouseholdWizards() {
  useHouseholdRestoreStore.setState(state => ({ version: state.version + 1 }));
}
