// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureFullBackup, restoreFullBackup } from "@/lib/full-backup-state";
import {
  FULL_BACKUPS_KEY, decryptFullBackup, encryptFullBackup, fullBackupSchema,
  parseEncryptedBackup, readFullBackups, writeFullBackups,
} from "@/lib/full-backups";
import { exerciseChat, resetExercise, resendLast, useExerciseSession } from "@/lib/exercise-session";
import { emptyProfile, setSupplyAnswer } from "@/lib/household";
import { createAssessmentRecord, RECORDS_KEY, emptyLocalRecords, savedMessages } from "@/lib/local-records";
import { captureExercise, openExercise, saveExerciseLocally } from "@/lib/saved-exercises";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";
import { usePlanStore } from "@/store/usePlanStore";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { deriveTtxState } from "@/lib/ttx";

const password = "synthetic-backup-password";
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Backups must never contact a model"); }));
  localStorage.clear();
  useLocalRecordsStore.setState({ data: emptyLocalRecords(), error: null });
  resetExercise();
  useHouseholdStore.getState().setProfile(setSupplyAnswer(emptyProfile(), "smoke-detector", "absent"));
  usePlanStore.getState().clear();
  usePlanStore.getState().add({ text: "Check detector", source: "Synthetic only" });
  useSettingsStore.getState().setSettings({ provider: "groq", apiKey: "synthetic-current-key" });
  usePrivacyStore.setState({ entityMap: { "[Person 1]": "Synthetic Person" }, alwaysMask: ["Synthetic Person"] });
});
afterEach(() => { resetExercise(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("complete password-encrypted backups", () => {
  it("round-trips saved browser keys, answers, plan, stage, reports and private mappings without putting them in the envelope", async () => {
    const records = useLocalRecordsStore.getState();
    records.commit({ ...records.data, progress: 3, assessments: [createAssessmentRecord(useHouseholdStore.getState().profile)] });
    const saved = captureFullBackup(localStorage);
    const encrypted = await encryptFullBackup(saved, password);
    const json = JSON.stringify(encrypted);
    expect(json).not.toContain("synthetic-current-key");
    expect(json).not.toContain("Synthetic Person");
    expect(json).not.toContain("smoke-detector");
    expect(json).not.toContain(password);
    expect(await decryptFullBackup(parseEncryptedBackup(json), password)).toEqual(saved);
    expect(saved.records.progress).toBe(3);
    expect(saved.records.assessments[0].report).toContain("Explicitly absent");
    expect(saved.records.assessments).toHaveLength(2);
    expect(useLocalRecordsStore.getState().data.assessments).toHaveLength(1);
    expect(saved.settings?.apiKey).toBe("synthetic-current-key");
    expect(Object.keys(saved).sort()).toEqual(["appearance", "format", "householdAndPlan", "namedHouseholds", "privacy", "records", "savedAt", "settings", "version"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses a fresh salt and IV for each encryption, and refuses wrong passwords and tampering without writes", async () => {
    const saved = captureFullBackup(localStorage);
    const first = await encryptFullBackup(saved, password);
    const second = await encryptFullBackup(saved, password);
    expect(first.iv).not.toBe(second.iv);
    expect(first.salt).not.toBe(second.salt);
    const before = { ...localStorage };
    await expect(decryptFullBackup(first, "wrong-password")).rejects.toThrow(/incorrect password or damaged/);
    const changed = { ...first, ciphertext: (first.ciphertext[0] === "A" ? "B" : "A") + first.ciphertext.slice(1) };
    await expect(decryptFullBackup(changed, password)).rejects.toThrow(/incorrect password or damaged/);
    expect({ ...localStorage }).toEqual(before);
  });

  it("rejects short passwords, invalid versions, oversized input and unexpected settings/data", async () => {
    const saved = captureFullBackup(localStorage);
    await expect(encryptFullBackup(saved, "short")).rejects.toThrow(/12 characters/);
    expect(() => parseEncryptedBackup("{")).toThrow(/not valid/);
    expect(() => parseEncryptedBackup(JSON.stringify({ version: 99 }))).toThrow(/Unsupported/);
    expect(() => parseEncryptedBackup(" ".repeat(30 * 1024 * 1024 + 1))).toThrow(/30 MiB/);
    expect(fullBackupSchema.safeParse({ ...saved, serverEnvironment: {} }).success).toBe(false);
    expect(fullBackupSchema.safeParse({ ...saved, settings: { provider: "groq", retrySettings: {} } }).success).toBe(false);
    expect(fullBackupSchema.safeParse({ ...saved, records: { ...saved.records, progress: 9 } }).success).toBe(false);
  });

  it("stores named backups as ciphertext, never recursively copies them, and preserves unrelated storage on restore", async () => {
    const saved = captureFullBackup(localStorage);
    const encrypted = await encryptFullBackup(saved, password);
    writeFullBackups(localStorage, [{ id: "copy", name: "Winter", savedAt: saved.savedAt, encrypted }]);
    expect(localStorage.getItem(FULL_BACKUPS_KEY)).not.toContain("synthetic-current-key");
    expect(readFullBackups(localStorage)[0].encrypted).toEqual(encrypted);
    localStorage.setItem("unrelated-browser-data", "keep");
    useSettingsStore.getState().setSettings(null);
    useHouseholdStore.getState().setProfile(emptyProfile());
    restoreFullBackup(localStorage, saved);
    await useSettingsStore.persist.rehydrate();
    await useHouseholdStore.persist.rehydrate();
    expect(useSettingsStore.getState().settings?.apiKey).toBe("synthetic-current-key");
    expect(useHouseholdStore.getState().profile.supplies.absent).toContain("smoke-detector");
    expect(localStorage.getItem("unrelated-browser-data")).toBe("keep");
    expect(readFullBackups(localStorage)).toHaveLength(1);
    expect(captureFullBackup(localStorage)).not.toHaveProperty("encryptedBackups");
  });

  it("rolls every earlier write back if a later record fails", () => {
    const saved = captureFullBackup(localStorage);
    useSettingsStore.getState().setSettings({ provider: "google" });
    const before = { ...localStorage };
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === RECORDS_KEY) throw new DOMException("Quota", "QuotaExceededError");
      original.call(this, key, value);
    });
    expect(() => restoreFullBackup(localStorage, saved)).toThrow(/Previous ReadyState data were retained/);
    expect({ ...localStorage }).toEqual(before);
  });
});

describe("dated local records and safe exercise recovery", () => {
  it("preserves completed debrief outputs and participant-facing quality notices, not diagnostic usage", () => {
    const report = { summary: "Synthetic debrief", went_well: ["Checked supplies"], need_to_know: [], do_better: [], supply_checklist: [] };
    exerciseChat.messages = [{
      id: "debrief", role: "assistant", parts: [{
        type: "tool-after_action_report", toolCallId: "report", state: "output-available", input: report, output: report,
      }],
      metadata: {
        usage: { inputTokens: 10 },
        debriefChecks: { passedImplementedChecks: true, failedFirst: [],
          omittedImprovement: { action: "Synthetic omitted item", checks: ["one-step"] } },
      },
    }];
    const record = captureExercise()!;
    expect(deriveTtxState(record.messages).phase).toBe("aar");
    expect(record.messages[0].metadata?.debriefChecks.omittedImprovement?.action).toBe("Synthetic omitted item");
    expect(record.messages[0].metadata).not.toHaveProperty("usage");
    resetExercise();
    openExercise(record);
    expect(deriveTtxState(exerciseChat.messages).report?.summary).toBe("Synthetic debrief");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses backup or restore while a model request is active", () => {
    const saved = captureFullBackup(localStorage);
    const before = { ...localStorage };
    vi.spyOn(exerciseChat, "status", "get").mockReturnValue("streaming");
    expect(() => captureFullBackup(localStorage)).toThrow(/finish or cancel/);
    expect(() => restoreFullBackup(localStorage, saved)).toThrow(/Cancel the active request/);
    expect({ ...localStorage }).toEqual(before);
  });

  it("keeps historical assessment explanations stable when current answers change", () => {
    const profile = useHouseholdStore.getState().profile;
    const record = createAssessmentRecord(profile);
    const before = record.report;
    profile.supplies.absent = [];
    profile.supplies.have.push("smoke-detector");
    expect(record.household.supplies.absent).toContain("smoke-detector");
    expect(record.report).toBe(before);
    expect(record.report).toContain("No smoke detectors");
    expect(record.report).toContain("Source:");
  });

  it("keeps exercise content/drafts/mappings, not metadata eval captures or retry settings; restoration cannot resend approval", () => {
    exerciseChat.messages = [{
      id: "reviewed-user", role: "user", parts: [{ type: "text", text: "[Person 1] checks supplies." }],
      metadata: { providerCalls: 2 },
    }];
    useExerciseSession.setState({ activeProfile: emptyProfile(), draft: "An unsent synthetic response" });
    const record = captureExercise()!;
    expect(savedMessages(exerciseChat.messages)[0].metadata).toBeUndefined();
    expect(record.draft).toContain("unsent");
    expect(JSON.stringify(record)).not.toContain("synthetic-current-key");
    expect(JSON.stringify(record)).not.toContain("providerCalls");
    saveExerciseLocally();
    expect(useLocalRecordsStore.getState().data.exercises).toHaveLength(1);
    resetExercise();
    openExercise(record);
    expect(useExerciseSession.getState().draft).toBe(record.draft);
    expect(exerciseChat.messages).toEqual(record.messages);
    expect(usePrivacyStore.getState().entityMap["[Person 1]"]).toBe("Synthetic Person");
    expect(() => resendLast()).toThrow(/no retry approval/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports damaged history without treating it as empty or overwriting it", () => {
    localStorage.setItem(RECORDS_KEY, '{"version":99}');
    useLocalRecordsStore.getState().reload();
    expect(useLocalRecordsStore.getState().error).toContain("could not be read");
    expect(() => captureFullBackup(localStorage)).toThrow(/could not be read/);
    expect(localStorage.getItem(RECORDS_KEY)).toBe('{"version":99}');
  });
});
