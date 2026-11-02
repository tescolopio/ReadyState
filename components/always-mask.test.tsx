// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { AlwaysMaskCard } from "@/components/always-mask";
import { usePrivacyStore } from "@/store/usePrivacyStore";

it("shows masking names recovered after mount while preserving an unsaved local edit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  usePrivacyStore.setState({ alwaysMask: [] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AlwaysMaskCard />));
    const input = container.querySelector("input")!;
    await act(async () => usePrivacyStore.getState().setAlwaysMask(["Synthetic Restored Name"]));
    expect(input.value).toBe("Synthetic Restored Name");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Unsaved synthetic edit");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => usePrivacyStore.getState().setAlwaysMask(["Another restored name"]));
    expect(input.value).toBe("Unsaved synthetic edit");
  } finally {
    await act(async () => root.unmount());
    container.remove(); vi.unstubAllGlobals();
  }
});
