import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { emptyProfile, migrateHousehold, type HouseholdProfile } from "@/lib/household";

/**
 * The household profile from the setup wizard. Persisted to this browser's
 * localStorage so people can add detail over time (decision D9: profiles stay
 * on the device). Only `describeHousehold`'s masked summary is ever sent.
 */
interface HouseholdState {
  profile: HouseholdProfile;
  setProfile: (profile: HouseholdProfile) => void;
  clearProfile: () => void;
}

export const useHouseholdStore = create<HouseholdState>()(
  persist(
    (set) => ({
      profile: emptyProfile(),
      setProfile: (profile) => set({ profile }),
      clearProfile: () => set({ profile: emptyProfile() }),
    }),
    {
      name: "readystate-household",
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { profile: HouseholdProfile };
        return { profile: migrateHousehold(state.profile) };
      },
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
