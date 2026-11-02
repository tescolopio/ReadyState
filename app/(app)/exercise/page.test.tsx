// @vitest-environment jsdom
import { act, Activity } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ExercisePage from "@/app/(app)/exercise/page";
import { LocalHistory } from "@/components/local-history";
import { HouseholdSaves } from "@/components/household-saves";
import { engineBaseline } from "@/lib/inventory";
import { emptyLocalRecords, exerciseRecordSchema } from "@/lib/local-records";
import { emptyProfile } from "@/lib/household";
import { createHouseholdSave } from "@/lib/household-saves";
import { openExercise } from "@/lib/saved-exercises";
import { resetExercise, exerciseChat, useExerciseSession } from "@/lib/exercise-session";
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

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
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

  it("resets a hidden retained exercise review when Journal opens a different saved session", async () => {
    const original = profile("Original region");
    const restored = profile("Restored region");
    restored.people.push({ id: "another-person", localName: "Another person", ageRange: "adult", needs: [] });
    useHouseholdStore.getState().setProfile(original);
    const saved = exerciseRecordSchema.parse({
      id: "saved-exercise", savedAt: new Date().toISOString(), profile: restored,
      sampleId: null, draft: "", baselinePending: false,
      messages: [
        { id: "baseline", role: "user", parts: [{ type: "text", text: "Earlier briefing" }] },
        { id: "response", role: "user", parts: [{ type: "text", text: "Saved participant response" }] },
      ],
      privacy: { entityMap: {}, alwaysMask: [] },
    });
    useLocalRecordsStore.setState({
      data: { ...emptyLocalRecords(), exercises: [saved] }, error: null,
    });
    const renderMode = async (mode: "visible" | "hidden") => act(async () => root.render(
      <>
        <Activity mode={mode}><ExercisePage /></Activity>
        <LocalHistory />
      </>,
    ));

    await renderMode("visible");
    const start = [...container.querySelectorAll("button")]
      .find(button => button.textContent?.trim() === "Start with my saved household");
    if (!start) throw new Error("Missing start-with-saved-household control");
    await act(async () => start.click());
    expect(container.textContent).toContain("Review what leaves this browser");

    await renderMode("hidden");
    const open = [...container.querySelectorAll("button")]
      .find(button => button.textContent?.trim() === "Open saved exercise");
    if (!open) throw new Error("Missing open-saved-exercise control");
    await act(async () => open.click());
    const replace = [...container.querySelectorAll("button")]
      .find(button => button.textContent?.trim() === "Replace tab exercise");
    if (!replace) throw new Error("Missing replace-tab-exercise control");
    await act(async () => replace.click());
    await renderMode("visible");

    expect(container.textContent).not.toContain("Review what leaves this browser");
    expect(container.textContent).toContain("Saved participant response");
    expect(useExerciseSession.getState()).toMatchObject({ activeProfile: restored });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes the retained Exercise setup wizard after a household save is restored", async () => {
    const original = profile("Original region");
    original.people[0].localName = "Original name";
    const restored = profile("Restored region");
    restored.people[0].localName = "Restored name";
    useHouseholdStore.getState().setProfile(original);
    await act(async () => root.render(
      <>
        <ExercisePage />
        <HouseholdSaves onRestore={() => {}} />
      </>,
    ));
    await click("Review my household");

    const label = "Person 1 name (optional, this device only)";
    const staleInput = [...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === label)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(staleInput, "Unsaved stale name");
      staleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const contents = JSON.stringify(createHouseholdSave(restored, []));
    const file = new File([contents], "restored-household.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => contents });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    await click("Replace household and plan");

    const refreshedInput = [...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === label)!;
    expect(refreshedInput.value).toBe("Restored name");
    expect(useHouseholdStore.getState().profile).toMatchObject({ location: { region: "Restored region" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
