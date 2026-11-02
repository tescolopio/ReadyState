import { replaceStorageEntries } from "@/lib/browser-storage";
import { exerciseChat } from "@/lib/exercise-session";
import { fullBackupSchema, type FullBackup } from "@/lib/full-backups";
import { SAVES_KEY, createHouseholdSave, readNamedSaves } from "@/lib/household-saves";
import { hasAssessmentAnswers } from "@/lib/household";
import { RECORDS_KEY, createAssessmentRecord } from "@/lib/local-records";
import { captureExercise } from "@/lib/saved-exercises";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";
import { usePlanStore } from "@/store/usePlanStore";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { useSettingsStore } from "@/store/useSettingsStore";

export function captureFullBackup(storage: Storage): FullBackup {
  const records = useLocalRecordsStore.getState();
  if (records.error) throw new Error(records.error);
  const activeExercise = captureExercise();
  const profile = useHouseholdStore.getState().profile;
  const currentAssessment = hasAssessmentAnswers(profile) ? createAssessmentRecord(profile) : null;
  const privacy = usePrivacyStore.getState();
  return fullBackupSchema.parse({
    format: "readystate-full-data", version: 1, savedAt: new Date().toISOString(),
    householdAndPlan: createHouseholdSave(profile, usePlanStore.getState().items),
    settings: useSettingsStore.getState().settings,
    records: { ...records.data, activeExercise,
      assessments: currentAssessment ? [...records.data.assessments, currentAssessment] : records.data.assessments,
      exercises: activeExercise ? [...records.data.exercises, activeExercise] : records.data.exercises },
    privacy: { entityMap: privacy.entityMap, alwaysMask: privacy.alwaysMask },
    appearance: storage.getItem("readystate-style"),
    namedHouseholds: { version: 1, saves: readNamedSaves(storage) },
  });
}

/** Call only after explicit replacement confirmation, then reload to discard all stale drafts/approvals. */
export function restoreFullBackup(storage: Storage, snapshot: FullBackup) {
  if (exerciseChat.status === "submitted" || exerciseChat.status === "streaming") throw new Error("Cancel the active request before restoring a full backup.");
  const saved = fullBackupSchema.parse(snapshot);
  replaceStorageEntries(storage, [
    ["readystate-household", JSON.stringify({ state: { profile: saved.householdAndPlan.household }, version: 1 })],
    ["readystate-plan", JSON.stringify({ state: { items: saved.householdAndPlan.plan }, version: 0 })],
    ["readystate-provider-settings", JSON.stringify({ state: { settings: saved.settings }, version: 0 })],
    [SAVES_KEY, JSON.stringify(saved.namedHouseholds)],
    [RECORDS_KEY, JSON.stringify(saved.records)],
    ["readystate-style", saved.appearance],
    ["readystate-restored-privacy", JSON.stringify(saved.privacy)],
  ], "ReadyState data");
}
