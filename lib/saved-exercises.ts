import { exerciseChat, resetExercise, useExerciseSession } from "@/lib/exercise-session";
import { exerciseRecordSchema, savedMessages, type ExerciseRecord } from "@/lib/local-records";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";

let activeExerciseRecoveryAttempted = false;

export function recoverActiveExerciseOnce() {
  if (activeExerciseRecoveryAttempted) return false;
  activeExerciseRecoveryAttempted = true;
  const records = useLocalRecordsStore.getState();
  if (records.error || !records.data.activeExercise) return false;
  openExercise(records.data.activeExercise);
  return true;
}

export function captureExercise(): ExerciseRecord | null {
  if (exerciseChat.status === "submitted" || exerciseChat.status === "streaming") {
    throw new Error("Wait for the model request to finish or cancel it before saving/restoring.");
  }
  const session = useExerciseSession.getState();
  if (!exerciseChat.messages.length && !session.draft && !session.activeProfile) return null;
  const privacy = usePrivacyStore.getState();
  return exerciseRecordSchema.parse({
    id: crypto.randomUUID(), savedAt: new Date().toISOString(), profile: session.activeProfile,
    sampleId: session.sampleId, draft: session.draft, messages: savedMessages(exerciseChat.messages),
    privacy: { entityMap: privacy.entityMap, alwaysMask: privacy.alwaysMask },
  });
}

export function openExercise(record: ExerciseRecord) {
  if (exerciseChat.status === "submitted" || exerciseChat.status === "streaming") throw new Error("Cancel the active request before opening a saved exercise.");
  const parsed = exerciseRecordSchema.parse(record);
  const hasCompletedOutput = parsed.messages.some(message => message.role === "assistant" &&
    message.parts.some(part => part.type === "tool-generate_turn" || part.type === "tool-after_action_report"));
  const includesBaseline = parsed.messages.some(message => message.role === "user" &&
    message.parts.some(part => part.type === "text" &&
      (part.text.startsWith("People:") || part.text.includes("\nOfficial guidance"))));
  const incompleteBaseline = parsed.profile !== null && includesBaseline && !hasCompletedOutput;
  resetExercise();
  exerciseChat.messages = incompleteBaseline ? [] : parsed.messages;
  useExerciseSession.setState({
    activeProfile: parsed.profile, sampleId: parsed.sampleId, draft: parsed.draft, restored: true,
    baselineNeedsReview: incompleteBaseline,
  });
  usePrivacyStore.setState(parsed.privacy);
}

export function saveExerciseLocally() {
  const record = captureExercise();
  if (!record) throw new Error("There is no exercise or response draft to save.");
  const records = useLocalRecordsStore.getState();
  if (records.error) throw new Error(records.error);
  records.commit({ ...records.data, exercises: [...records.data.exercises, record], activeExercise: record });
}
