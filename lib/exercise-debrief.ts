import { storyDefects } from "@/lib/debrief-checks";
import type { TurnOutput } from "@/lib/exercise-contracts";
import { storyFacts, storyFactsBriefing } from "@/lib/story-facts";

export function prepareDebriefContext({
  turns, baseline, participantText, briefing,
}: {
  turns: TurnOutput[];
  baseline: string;
  participantText: string[];
  briefing: string;
}) {
  const defects = storyDefects(turns, { baseline, participantText });
  return {
    context: { baseline, participantText, defects },
    briefing: `${briefing}\n\n${storyFactsBriefing(storyFacts(turns, defects))}`,
  };
}
