import type { AppMode } from "@/lib/config";
import { TARGET_DURATION_HOURS } from "@/lib/ttx";

/**
 * The exercise clock in in-game hours. A local eval can set a longer one with
 * READYSTATE_EVAL_TARGET_HOURS, to measure a long game (work item G6) that the
 * 72-hour clock ends after about 13 turns. The variable is ignored in hosted
 * mode and on Vercel, and anything but a whole number above the default is
 * ignored too, so a deployment always runs TARGET_DURATION_HOURS.
 */
export function exerciseHours(mode: AppMode): number {
  if (mode === "hosted" || process.env.VERCEL === "1") return TARGET_DURATION_HOURS;
  const raw = process.env.READYSTATE_EVAL_TARGET_HOURS;
  if (!raw || !/^\d+$/.test(raw)) return TARGET_DURATION_HOURS;
  const hours = Number(raw);
  return hours > TARGET_DURATION_HOURS ? hours : TARGET_DURATION_HOURS;
}
