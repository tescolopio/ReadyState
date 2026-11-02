import { exerciseChat, resetExercise, useExerciseSession } from "@/lib/exercise-session";
import { exerciseRecordSchema, savedMessages, type ExerciseRecord } from "@/lib/local-records";
import { newId } from "@/lib/household";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";

let activeExerciseRecoveryAttempted = false;

function hasCompletedOutput(messages: ExerciseRecord["messages"]) {
  return messages.some(message => message.role === "assistant" &&
    message.parts.some(part => part.type === "tool-generate_turn" || part.type === "tool-after_action_report"));
}

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
  const messages = savedMessages(exerciseChat.messages);
  const completedOutput = hasCompletedOutput(messages);
  return exerciseRecordSchema.parse({
    id: newId(), savedAt: new Date().toISOString(), profile: session.activeProfile,
    sampleId: session.sampleId, draft: session.draft,
    baselinePending: session.baselinePending && !completedOutput,
    messages,
    privacy: { entityMap: privacy.entityMap, alwaysMask: privacy.alwaysMask },
  });
}

export function openExercise(record: ExerciseRecord) {
  if (exerciseChat.status === "submitted" || exerciseChat.status === "streaming") throw new Error("Cancel the active request before opening a saved exercise.");
  const parsed = exerciseRecordSchema.parse(record);
  const completedOutput = hasCompletedOutput(parsed.messages);
  const isLegacyIncompleteBaseline = parsed.profile !== null && !completedOutput &&
    parsed.messages.filter(message => message.role === "user").length === 1 &&
    parsed.messages[0]?.role === "user";
  const incompleteBaseline = !completedOutput && (parsed.baselinePending || isLegacyIncompleteBaseline);
  resetExercise();
  exerciseChat.messages = incompleteBaseline ? [] : parsed.messages;
  useExerciseSession.setState({
    activeProfile: parsed.profile, sampleId: parsed.sampleId, draft: parsed.draft, restored: true,
    baselinePending: incompleteBaseline, baselineNeedsReview: incompleteBaseline,
  });
  const privacy = usePrivacyStore.getState();
  privacy.setAlwaysMask([...privacy.alwaysMask, ...parsed.privacy.alwaysMask]);
  usePrivacyStore.setState({ entityMap: parsed.privacy.entityMap });
}

export function saveExerciseLocally() {
  const record = captureExercise();
  if (!record) throw new Error("There is no exercise or response draft to save.");
  const records = useLocalRecordsStore.getState();
  if (records.error) throw new Error(records.error);
  records.commit({ ...records.data, exercises: [...records.data.exercises, record], activeExercise: record });
}
