// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ExercisePage from "@/app/(app)/exercise/page";
import { engineBaseline } from "@/lib/inventory";
import { emptyLocalRecords, exerciseRecordSchema } from "@/lib/local-records";
import { emptyProfile } from "@/lib/household";
import { openExercise } from "@/lib/saved-exercises";
import { resetExercise, exerciseChat } from "@/lib/exercise-session";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";
import { usePlanStore } from "@/store/usePlanStore";
import { usePrivacyStore } from "@/store/usePrivacyStore";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Stale reviews must not send"); }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  localStorage.clear();
  resetExercise();
  useHouseholdStore.getState().setProfile(emptyProfile());
  useLocalRecordsStore.setState({ data: emptyLocalRecords(), error: null });
  usePlanStore.getState().clear();
  usePrivacyStore.setState({ entityMap: {}, alwaysMask: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  resetExercise();
  delete (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
  container.remove();
  vi.unstubAllGlobals();
});

function profile(region: string) {
  const value = emptyProfile();
  value.people = [{ id: `${region}-person`, localName: `${region} person`, ageRange: "adult", needs: [] }];
  value.location.region = region;
  return value;
}

describe("retained exercise review state", () => {
  it("reopens a failed baseline as a fresh review and rejects the prior household's outgoing approval", async () => {
    const original = profile("Original region");
    const replacement = profile("Restored region");
    replacement.people.push({ id: "second-restored-person", localName: "Second person", ageRange: "adult", needs: [] });
    useHouseholdStore.getState().setProfile(original);
    await act(async () => root.render(<ExercisePage />));

    const start = [...container.querySelectorAll("button")]
      .find(button => button.textContent?.trim() === "Start with my saved household");
    if (!start) throw new Error("Missing start-with-saved-household control");
    await act(async () => start.click());
    const staleSend = [...container.querySelectorAll("button")]
      .find(button => button.textContent?.trim() === "Send this");
    if (!staleSend) throw new Error("Missing original baseline send control");

    const baseline = engineBaseline(replacement, text => text);
    const incomplete = exerciseRecordSchema.parse({
      id: "incomplete-baseline", savedAt: new Date().toISOString(), profile: replacement,
      sampleId: null, draft: "",
      messages: [
        { id: "failed-request", role: "user", parts: [{ type: "text", text: baseline }] },
        { id: "cancelled-response", role: "assistant", parts: [{ type: "text", text: "" }] },
      ],
      privacy: { entityMap: {}, alwaysMask: [] },
    });

    await act(async () => {
      openExercise(incomplete);
      staleSend.click();
    });

    const review = container.querySelector("textarea");
    expect(review?.value).toContain("People: 2 adults.");
    expect(container.textContent).toContain("Review what leaves this browser");
    expect(exerciseChat.messages).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
