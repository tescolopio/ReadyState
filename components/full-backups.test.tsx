// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FullBackups } from "@/components/full-backups";
import { captureFullBackup } from "@/lib/full-backup-state";
import { FULL_BACKUPS_KEY, encryptFullBackup, readFullBackups } from "@/lib/full-backups";
import { emptyLocalRecords } from "@/lib/local-records";
import { emptyProfile } from "@/lib/household";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";
import { usePlanStore } from "@/store/usePlanStore";
import { useSettingsStore } from "@/store/useSettingsStore";

let root: Root;
let container: HTMLDivElement;
const password = "synthetic-backup-password";
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Backups must stay offline"); }));
  localStorage.clear();
  useHouseholdStore.getState().setProfile(emptyProfile());
  usePlanStore.getState().clear();
  useLocalRecordsStore.setState({ data: emptyLocalRecords(), error: null });
  useSettingsStore.getState().setSettings({ provider: "groq", apiKey: "synthetic-ui-key" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => { button.click(); });
}
async function fill(label: string, value: string) {
  const input = [...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === label)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function settle(text: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (container.textContent?.includes(text)) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  throw new Error(`No feedback: ${text}. ${container.textContent}`);
}

describe("full encrypted backup controls", () => {
  it("requires matching passwords, stores ciphertext only and unlocks without restoring until confirmed", async () => {
    await act(async () => root.render(<FullBackups />));
    await fill("Full backup name", "Winter");
    await fill("Backup password", password);
    await click("Save named encrypted backup");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("do not match");
    await fill("Confirm password (when saving a new backup)", password);
    await click("Save named encrypted backup");
    await settle("Encrypted full backup saved");
    expect(localStorage.getItem(FULL_BACKUPS_KEY)).not.toContain("synthetic-ui-key");
    expect(readFullBackups(localStorage)).toHaveLength(1);
    expect(container.textContent).not.toContain("synthetic-ui-key");
    await fill("Backup password", "wrong-password");
    const before = { ...localStorage };
    await click("Unlock Winter");
    await settle("incorrect password or damaged");
    expect({ ...localStorage }).toEqual(before);
    await fill("Backup password", password);
    await click("Unlock Winter");
    await settle("Replace ReadyState data");
    expect(container.querySelector('[aria-label="Confirm full restore"]')).not.toBeNull();
    expect({ ...localStorage }).toEqual(before);
    await click("Cancel full restore");
    expect(container.querySelector('[aria-label="Confirm full restore"]')).toBeNull();
    expect({ ...localStorage }).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
    await click("Delete backup");
    await click("Keep backup");
    expect(readFullBackups(localStorage)).toHaveLength(1);
    await click("Delete backup");
    await click("Confirm backup deletion");
    expect(readFullBackups(localStorage)).toEqual([]);
    expect(useSettingsStore.getState().settings?.apiKey).toBe("synthetic-ui-key");
  });

  it("reads a real encrypted file locally, validates it and asks before replacement", async () => {
    const encrypted = await encryptFullBackup(captureFullBackup(localStorage), password);
    await act(async () => root.render(<FullBackups />));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const text = JSON.stringify(encrypted);
    const file = new File([text], "synthetic-full-backup.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => text });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await fill("Backup password", password);
    await click("Unlock selected backup");
    await settle("Replace ReadyState data");
    expect(container.querySelector('[aria-label="Confirm full restore"]')?.textContent).toContain("including an API key");
    await click("Cancel full restore");
    expect(fetch).not.toHaveBeenCalled();
  });
});
