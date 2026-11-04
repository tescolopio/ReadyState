import type { TurnOutput } from "@/lib/exercise-contracts";

export const EXERCISE_CONTEXT_VERSION = "1";
export const RECENT_LOG_TURNS = 4;

export interface ExerciseExchange {
  action?: string;
  turn: TurnOutput;
}

export interface ExerciseContext {
  baseline?: string;
  exchanges: readonly ExerciseExchange[];
  pendingAction?: string;
}

const alertsLine = (alerts: string[]) => alerts.length ? alerts.join("; ") : "none";

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
};

const firstSentence = (text: string) => text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;

/** Formats already-approved context; it neither masks text nor authorizes disclosure. */
export function buildExerciseBriefing({ baseline, exchanges, pendingAction }: ExerciseContext): string {
  const sections = [`HOUSEHOLD BASELINE (sanitized):\n${baseline ?? "(not provided)"}`];
  const latest = exchanges.at(-1);
  const older = exchanges.slice(0, -1);
  if (older.length) {
    const firstRecent = older.length - RECENT_LOG_TURNS;
    const log = older.map(({ action, turn }, index) => {
      if (index < firstRecent) {
        const did = action ? `Participant: ${clip(action, 100)} | ` : "";
        return `- ${turn.time_elapsed}: ${did}Inject: ${clip(firstSentence(turn.new_inject), 140)}`;
      }
      const did = action ? `Participant: ${action} | ` : "";
      return `- ${turn.time_elapsed}: ${did}Inject: ${turn.new_inject} | Alerts: ${alertsLine(turn.critical_alerts)}`;
    });
    sections.push(`EXERCISE LOG (earlier turns, condensed):\n${log.join("\n")}`);
  }
  if (latest) {
    const { action, turn } = latest;
    sections.push(
      [
        `LATEST TURN (${turn.time_elapsed}, hours_elapsed ${turn.hours_elapsed}):`,
        ...(action ? [`Participant action: ${action}`] : []),
        `Outcome: ${turn.narrative_response}`,
        `Inject: ${turn.new_inject}`,
        `Critical alerts: ${alertsLine(turn.critical_alerts)}`,
      ].join("\n"),
    );
  }
  if (pendingAction) sections.push(`PARTICIPANT ACTION:\n${pendingAction}`);
  return sections.join("\n\n");
}
