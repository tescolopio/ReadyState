// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyProfile } from "@/lib/household";
import { useHouseholdStore } from "@/store/useHouseholdStore";

const { push, resetExercise } = vi.hoisted(() => ({
  push: vi.fn(),
  resetExercise: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/exercise-session", () => ({ resetExercise }));

import HouseholdPage from "./page";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Household setup must not make requests."); }));
  window.history.replaceState(null, "", "/household");
  localStorage.clear();
  useHouseholdStore.getState().setProfile(emptyProfile());
  push.mockClear();
  resetExercise.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<HouseholdPage />));
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}
async function cancel() {
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Close household setup"]');
  if (!button) throw new Error("Missing setup cancellation");
  await act(async () => button.click());
}
const setup = () => container.querySelector('[aria-label="Household setup"]');

describe("household setup visit", () => {
  it("keeps direct first-run setup open through autosave and reaches scenario selection without requests", async () => {
    await render();
    expect(setup()).not.toBeNull();
    await click("adult");
    expect(useHouseholdStore.getState().profile.people).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("readystate-household")!).state.profile.people).toHaveLength(1);
    expect(setup()).not.toBeNull();
    await click("Next");
    await click("Next");
    await click("Next");
    await click("Next");
    await click("Review");
    const scenario = [...container.querySelectorAll("select")].find(select =>
      select.labels?.[0]?.textContent === "Emergency to practice");
    if (!scenario) throw new Error("Missing scenario selection");
    await act(async () => {
      scenario.value = "power-outage";
      scenario.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(useHouseholdStore.getState().profile.scenario).toBe("power-outage");
    expect(setup()).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    await click("Start exercise");
    expect(resetExercise).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/exercise?start=1");
    expect(setup()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows cancellation after the first answer without losing the saved partial household", async () => {
    await render();
    await click("adult");
    await cancel();
    expect(setup()).toBeNull();
    expect(useHouseholdStore.getState().profile.people).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    await click("Edit household");
    expect(setup()).not.toBeNull();
  });

  it("cancels an empty first-run setup back to the journal without starting an exercise", async () => {
    await render();
    await cancel();
    expect(push).toHaveBeenCalledWith("/journal");
    expect(resetExercise).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens an existing household in details and keeps explicit editing open while saving answers", async () => {
    const profile = emptyProfile();
    profile.location.region = "Colorado";
    useHouseholdStore.getState().setProfile(profile);
    await render();
    expect(setup()).toBeNull();
    await click("Edit household");
    await click("adult");
    expect(setup()).not.toBeNull();
    await cancel();
    expect(setup()).toBeNull();
    await click("Edit household");
    expect(setup()).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honors explicit setup for a persisted household without reopening after cancellation", async () => {
    const profile = emptyProfile();
    profile.location.region = "Colorado";
    localStorage.setItem("readystate-household", JSON.stringify({ state: { profile }, version: 0 }));
    await useHouseholdStore.persist.rehydrate();
    window.history.replaceState(null, "", "/household?setup=1");
    await render();
    expect(setup()).not.toBeNull();
    await click("adult");
    await cancel();
    expect(setup()).toBeNull();
    expect(useHouseholdStore.getState().profile.location.region).toBe("Colorado");
  });
});
