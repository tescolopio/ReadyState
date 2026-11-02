import { create } from "zustand";

import { RECORDS_KEY, emptyLocalRecords, localRecordsSchema, type LocalRecords } from "@/lib/local-records";

interface RecordsState {
  data: LocalRecords;
  error: string | null;
  reload: () => void;
  commit: (data: LocalRecords) => void;
}

const read = (): Pick<RecordsState, "data" | "error"> => {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(RECORDS_KEY);
    return { data: raw === null ? emptyLocalRecords() : localRecordsSchema.parse(JSON.parse(raw)), error: null };
  } catch {
    return { data: emptyLocalRecords(), error: "Local progress/history could not be read. Existing records were not overwritten. Check browser storage or restore an encrypted backup." };
  }
};

export const useLocalRecordsStore = create<RecordsState>()((set) => ({
  ...read(),
  reload: () => set(read()),
  commit: data => {
    const parsed = localRecordsSchema.parse(data);
    localStorage.setItem(RECORDS_KEY, JSON.stringify(parsed));
    set({ data: parsed, error: null });
  },
}));
