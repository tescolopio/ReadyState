import type { LocalExerciseState } from "@/lib/local-exercise-service";
import type { TtxUIMessage } from "@/lib/ttx";

/** Render accepted service state using existing UI components, without a second event history. */
export function localExerciseMessages(state: LocalExerciseState): TtxUIMessage[] {
  const messages: TtxUIMessage[] = [{
    id: state.baseline.id, role: "user", parts: [{ type: "text", text: state.baseline.text }],
  }];
  for (const event of state.events) {
    if (event.response) messages.push({
      id: event.response.id, role: "user", parts: [{ type: "text", text: event.response.text }],
    });
    messages.push({
      id: event.id, role: "assistant", parts: [{
        type: "tool-generate_turn", toolCallId: event.id, state: "output-available",
        input: event.turn, output: event.turn,
      }],
    });
  }
  if (state.pendingResponse) messages.push({
    id: state.pendingResponse.id, role: "user", parts: [{ type: "text", text: state.pendingResponse.text }],
  });
  return messages;
}
