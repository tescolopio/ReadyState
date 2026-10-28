import type { TurnOutput } from "@/lib/ttx";

/**
 * Progress as a path, not a percentage (design brief §3, work item F10):
 * completed decisions, the labeled current one, and an open continuation that
 * gives nothing away about what comes next.
 */
export function DecisionPath({ turns, complete }: { turns: TurnOutput[]; complete: boolean }) {
  if (!turns.length) return null;
  return (
    <nav aria-label="Decision path" className="overflow-x-auto">
      <ol className="flex min-w-max items-center gap-0 py-1">
        {turns.map((turn, index) => {
          const current = index === turns.length - 1 && !complete;
          return (
            <li key={index} className="flex items-center">
              {index > 0 && <span className="h-0.5 w-6 bg-action sm:w-10" aria-hidden />}
              <span className="flex flex-col items-center gap-1">
                <span
                  className={
                    current
                      ? "h-4 w-4 rounded-full border-[3px] border-attention-accent bg-surface"
                      : "h-3 w-3 rounded-full bg-action"
                  }
                  aria-hidden
                />
                <span className={`text-xs ${current ? "font-semibold text-attention" : "text-ink-3"}`}>
                  {current ? `Now: ${turn.time_elapsed}` : turn.time_elapsed}
                </span>
              </span>
            </li>
          );
        })}
        {!complete && (
          <li className="flex items-center" aria-label="The exercise continues">
            <span className="h-0.5 w-16 border-t-2 border-dashed border-line-strong" aria-hidden />
          </li>
        )}
      </ol>
    </nav>
  );
}
