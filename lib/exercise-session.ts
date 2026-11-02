import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { create } from "zustand";

import type { HouseholdProfile } from "@/lib/household";
import type { ProviderSettings } from "@/lib/providers";
import type { TtxUIMessage } from "@/lib/ttx";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";

/**
 * The exercise in progress, shared by every app page so moving between
 * Journal, Exercises and the exercise doesn't end it. Held in memory only,
 * like the privacy ledger that unmasks it. Explicit local exercise snapshots
 * and encrypted backups preserve selected resume points; this is not autosave.
 */
export const exerciseChat = new Chat<TtxUIMessage>({
  transport: new DefaultChatTransport<TtxUIMessage>({
    api: "/api/ttx",
    // Read at send time so saved Settings apply to the next request.
    body: () => ({ settings: useSettingsStore.getState().settings ?? undefined }),
  }),
});

/** Memory-only retry credentials; never attach to messages, history or logs. */
let sentSettings: ProviderSettings | undefined;

/** Sends a reviewed message or the disclosed debrief request, with the current Settings. */
export function sendToExercise(text: string) {
  useExerciseSession.setState({ restored: false });
  const settings = useSettingsStore.getState().settings;
  sentSettings = settings ? { ...settings } : undefined;
  return exerciseChat.sendMessage({ text }, { body: { settings: sentSettings } });
}

/** Sends the failed request again exactly as approved: the same messages and Settings. */
export function resendLast() {
  if (useExerciseSession.getState().restored) throw new Error("A restored exercise has no retry approval. Review a new response before sending.");
  return exerciseChat.regenerate({ body: { settings: sentSettings } });
}

interface SessionState {
  /** The household the exercise is running for, which may be a fictional sample. */
  activeProfile: HouseholdProfile | null;
  /** Set when the exercise is a fictional sample, so it can end in "Make this mine". */
  sampleId: string | null;
  draft: string;
  restored: boolean;
  setDraft: (draft: string) => void;
  begin: (profile: HouseholdProfile, sampleId?: string) => void;
}

export const useExerciseSession = create<SessionState>()((set) => ({
  activeProfile: null,
  sampleId: null,
  draft: "",
  restored: false,
  setDraft: draft => set({ draft }),
  begin: (activeProfile, sampleId) => set({ activeProfile, sampleId: sampleId ?? null, restored: false }),
}));

/** Ends the exercise and forgets its masking ledger. */
export function resetExercise() {
  void exerciseChat.stop();
  exerciseChat.messages = [];
  exerciseChat.clearError();
  sentSettings = undefined;
  usePrivacyStore.getState().clearMappings();
  useExerciseSession.setState({ activeProfile: null, sampleId: null, draft: "", restored: false });
  const records = useLocalRecordsStore.getState();
  if (records.data.activeExercise && !records.error) {
    try { records.commit({ ...records.data, activeExercise: null }); }
    catch { useLocalRecordsStore.setState({ error: "The exercise ended in memory, but its saved resume point could not be cleared. Check local storage before reloading." }); }
  }
}
