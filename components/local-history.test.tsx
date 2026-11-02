// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalHistory } from "@/components/local-history";
import { createAssessmentRecord, emptyLocalRecords } from "@/lib/local-records";
import { emptyProfile } from "@/lib/household";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";
import { resetExercise } from "@/lib/exercise-session";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useLocalRecordsStore.setState({ data: emptyLocalRecords(), error: null, progressWriteError: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  resetExercise();
  container.remove();
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}

describe("restored current assessment history", () => {
  it("shows and confirms deletion of a report restored separately from capped history", async () => {
    const household = emptyProfile();
    household.supplies.absent = ["smoke-detector"];
    const currentAssessment = createAssessmentRecord(household);
    useLocalRecordsStore.setState({
      data: { ...emptyLocalRecords(), currentAssessment },
      error: null,
    });

    await act(async () => root.render(<LocalHistory />));
    expect(container.textContent).toContain("Dated assessments (1)");
    expect(container.textContent).toContain("Assessment snapshot from full backup");
    expect(container.textContent).toContain("No smoke detectors");
    await click("Delete assessment snapshot");
    expect(container.querySelector('[aria-label="Confirm assessment snapshot deletion"]')).not.toBeNull();
    await click("Confirm snapshot deletion");

    expect(useLocalRecordsStore.getState().data.currentAssessment).toBeNull();
    expect(useLocalRecordsStore.getState().data.assessments).toEqual([]);
    expect(JSON.parse(localStorage.getItem("readystate-local-records")!).currentAssessment).toBeNull();
    expect(container.textContent).toContain("Dated assessments (0)");
    expect(container.textContent).not.toContain("No smoke detectors");
  });
});
