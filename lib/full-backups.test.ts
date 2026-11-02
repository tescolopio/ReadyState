// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureFullBackup, restoreFullBackup } from "@/lib/full-backup-state";
import {
  FULL_BACKUPS_KEY, decryptFullBackup, encryptFullBackup, fullBackupSchema,
  parseEncryptedBackup, readFullBackups, writeFullBackups,
} from "@/lib/full-backups";
import {
  exerciseChat, isCurrentExerciseGeneration, resetExercise, resendLast, useExerciseSession,
} from "@/lib/exercise-session";
import { emptyProfile, setSupplyAnswer } from "@/lib/household";
import {
  assessmentRecordSchema, createAssessmentRecord, exerciseRecordSchema, RECORDS_KEY, emptyLocalRecords, savedMessages,
} from "@/lib/local-records";
import {
  captureExercise, openExercise, recoverActiveExerciseOnce, saveExerciseLocally,
} from "@/lib/saved-exercises";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";
import { usePlanStore } from "@/store/usePlanStore";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { deriveTtxState } from "@/lib/ttx";
import { emptyGuidedAssessment } from "@/lib/guided-water";

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
    const guidedAssessment = { ...emptyGuidedAssessment(), mode: "guided" as const, screen: "water" as const,
      entry: "count" as const, counts: { ...emptyGuidedAssessment().counts, gallon1: "2" } };
    records.commit({ ...records.data, progress: 3, guidedAssessment, assessments: [createAssessmentRecord(useHouseholdStore.getState().profile)] });
    const saved = captureFullBackup(localStorage);
    const encrypted = await encryptFullBackup(saved, password);
    const json = JSON.stringify(encrypted);
    expect(json).not.toContain("synthetic-current-key");
    expect(json).not.toContain("Synthetic Person");
    expect(json).not.toContain("smoke-detector");
    expect(json).not.toContain(password);
    expect(await decryptFullBackup(parseEncryptedBackup(json), password)).toEqual(saved);
    expect(saved.records.progress).toBe(3);
    expect(saved.records.guidedAssessment).toEqual(guidedAssessment);
    expect(saved.records.currentAssessment?.report).toContain("Explicitly absent");
    expect(saved.records.assessments).toHaveLength(1);
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

  it("refuses overflow without mutations and preserves the 1,000-report boundary through encrypted restore", async () => {
    const savedAt = new Date().toISOString();
    const profile = useHouseholdStore.getState().profile;
    const assessment = createAssessmentRecord(profile);
    const restoredCurrentAssessment = assessmentRecordSchema.parse({
      ...assessment, id: "restored-current-assessment", report: "Restored historical assessment",
    });
    const assessments = Array.from({ length: 1000 }, (_, index) =>
      assessmentRecordSchema.parse({ ...assessment, report: `Historical report ${index}`, id: `assessment-${index}` }));
    const exercises = Array.from({ length: 1000 }, (_, index) => exerciseRecordSchema.parse({
      id: `exercise-${index}`, savedAt, profile: null, sampleId: null, draft: "", messages: [],
      privacy: { entityMap: {}, alwaysMask: [] },
    }));
    useLocalRecordsStore.setState({
      data: { ...emptyLocalRecords(), assessments, exercises, progress: 3,
        currentAssessment: restoredCurrentAssessment }, error: null,
    });
    useExerciseSession.getState().begin(profile);
    exerciseChat.messages = [{ id: "active", role: "user", parts: [{ type: "text", text: "Synthetic active exercise" }] }];

    const beforeStorage = { ...localStorage };
    const beforeRecords = useLocalRecordsStore.getState().data;
    expect(() => captureFullBackup(localStorage)).toThrow("1,000-report history limit");
    expect({ ...localStorage }).toEqual(beforeStorage);
    expect(useLocalRecordsStore.getState().data).toEqual(beforeRecords);
    expect(beforeRecords.assessments[0].id).toBe("assessment-0");
    useLocalRecordsStore.setState({
      data: { ...beforeRecords, assessments: assessments.slice(0, 999) },
    });
    const saved = captureFullBackup(localStorage);
    expect(saved.records.assessments).toHaveLength(1000);
    expect(saved.records.assessments).toContainEqual(restoredCurrentAssessment);
    expect(saved.records.assessments.some(record => record.id === "assessment-0")).toBe(true);
    expect(saved.records.exercises).toHaveLength(1000);
    expect(saved.records.currentAssessment).not.toBeNull();
    expect(saved.records.currentAssessment?.id).not.toBe(restoredCurrentAssessment.id);
    expect(saved.records.currentAssessment?.report).not.toBe(restoredCurrentAssessment.report);
    expect(saved.records.activeExercise?.messages).toHaveLength(1);
    expect(fullBackupSchema.parse(saved)).toEqual(saved);

    const decrypted = await decryptFullBackup(await encryptFullBackup(saved, password), password);
    restoreFullBackup(localStorage, decrypted);
    useLocalRecordsStore.getState().reload();
    expect(useLocalRecordsStore.getState().data.assessments).toEqual(saved.records.assessments);
    expect(useLocalRecordsStore.getState().data.currentAssessment).toEqual(saved.records.currentAssessment);
    expect(() => captureFullBackup(localStorage)).toThrow("1,000-report history limit");
    expect(useLocalRecordsStore.getState().data.assessments).toEqual(saved.records.assessments);
    // At capacity, an already-managed current report does not consume another slot.
    useLocalRecordsStore.setState({ data: { ...saved.records, currentAssessment: saved.records.assessments[0] } });
    const recaptured = captureFullBackup(localStorage);
    expect(recaptured.records.assessments).toHaveLength(1000);
    expect(recaptured.records.assessments).toContainEqual(restoredCurrentAssessment);
  });

  it("keeps exercise content/drafts/mappings, not metadata eval captures or retry settings; restoration cannot resend approval", () => {
    exerciseChat.messages = [{
      id: "reviewed-user", role: "user", parts: [{ type: "text", text: "[Person 1] checks supplies." }],
      metadata: { providerCalls: 2 },
    }];
    useExerciseSession.setState({ activeProfile: null, draft: "An unsent synthetic response" });
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

  it("preserves newer always-mask protections when opening an older exercise snapshot", () => {
    const saved = exerciseRecordSchema.parse({
      id: "older-privacy", savedAt: new Date().toISOString(), profile: null, sampleId: null, draft: "",
      messages: [],
      privacy: { entityMap: { "[Person 1]": "Synthetic earlier name" }, alwaysMask: ["Earlier mask"] },
    });
    usePrivacyStore.setState({ entityMap: { "[Person 1]": "Synthetic current name" },
      alwaysMask: ["Newer mask", "Earlier mask"] });
    openExercise(saved);
    expect(usePrivacyStore.getState().entityMap).toEqual(saved.privacy.entityMap);
    expect(usePrivacyStore.getState().alwaysMask).toEqual(["Newer mask", "Earlier mask"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates dated assessment and exercise IDs without requiring crypto.randomUUID", () => {
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => { throw new Error("randomUUID unavailable on plain HTTP"); });
    const assessment = createAssessmentRecord(useHouseholdStore.getState().profile);
    useExerciseSession.getState().begin(emptyProfile());
    exerciseChat.messages = [{ id: "local", role: "user", parts: [{ type: "text", text: "Synthetic local snapshot" }] }];
    const exercise = captureExercise();
    expect(assessment.id).toMatch(/^[a-z0-9]+$/);
    expect(exercise?.id).toMatch(/^[a-z0-9]+$/);
  });

  it("recovers an active exercise only once per runtime, leaving later live session changes untouched", () => {
    useExerciseSession.setState({ activeProfile: null });
    exerciseChat.messages = [{ id: "saved", role: "user", parts: [{ type: "text", text: "Saved snapshot" }] }];
    const saved = captureExercise()!;
    useLocalRecordsStore.setState({ data: { ...emptyLocalRecords(), activeExercise: saved }, error: null });
    expect(recoverActiveExerciseOnce()).toBe(true);
    expect(exerciseChat.messages).toEqual(saved.messages);

    const liveMessage = { id: "live", role: "user" as const, parts: [{ type: "text" as const, text: "Newer live state" }] };
    exerciseChat.messages = [liveMessage];
    expect(recoverActiveExerciseOnce()).toBe(false);
    expect(exerciseChat.messages).toEqual([liveMessage]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns an incomplete failed baseline snapshot into a fresh review without restoring retry approval", () => {
    const profile = useHouseholdStore.getState().profile;
    const record = exerciseRecordSchema.parse({
      id: "incomplete-baseline", savedAt: new Date().toISOString(), profile, sampleId: null, draft: "",
      baselinePending: true,
      messages: [
        { id: "failed-baseline", role: "user", parts: [{ type: "text", text: "User edited the reviewed baseline; no marker remains." }] },
        { id: "cancelled-response", role: "assistant", parts: [{ type: "text", text: "" }] },
      ],
      privacy: { entityMap: {}, alwaysMask: [] },
    });
    const oldGeneration = useExerciseSession.getState().generation;

    openExercise(record);

    expect(exerciseChat.messages).toEqual([]);
    expect(useExerciseSession.getState()).toMatchObject({
      activeProfile: profile, restored: true, baselineNeedsReview: true,
    });
    expect(isCurrentExerciseGeneration(oldGeneration)).toBe(false);
    expect(() => resendLast()).toThrow(/no retry approval/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recognizes legacy incomplete baselines from transcript shape, not editable baseline text", () => {
    const profile = useHouseholdStore.getState().profile;
    const legacy = exerciseRecordSchema.parse({
      id: "legacy-incomplete-baseline", savedAt: new Date().toISOString(), profile, sampleId: null, draft: "",
      messages: [
        { id: "edited-baseline", role: "user", parts: [{ type: "text", text: "Entire baseline replaced in review." }] },
        { id: "cancelled-response", role: "assistant", parts: [{ type: "text", text: "" }] },
      ],
      privacy: { entityMap: {}, alwaysMask: [] },
    });

    openExercise(legacy);

    expect(exerciseChat.messages).toEqual([]);
    expect(useExerciseSession.getState()).toMatchObject({ baselinePending: true, baselineNeedsReview: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves completed baseline output when its pending flag was not cleared before navigation", () => {
    const profile = useHouseholdStore.getState().profile;
    const output = {
      feedback: null, narrative_response: "Synthetic baseline result", time_elapsed: "Hour 0",
      hours_elapsed: 0, new_inject: "Synthetic inject", critical_alerts: [], suggested_actions: [],
      response_options: [], scenario_status: "ongoing" as const,
    };
    const completedBaseline = exerciseRecordSchema.parse({
      id: "completed-pending-baseline", savedAt: new Date().toISOString(), profile, sampleId: null, draft: "",
      baselinePending: true,
      messages: [
        { id: "baseline", role: "user", parts: [{ type: "text", text: "Synthetic reviewed baseline" }] },
        { id: "completed-turn", role: "assistant", parts: [{
          type: "tool-generate_turn", toolCallId: "turn", state: "output-available", input: output, output,
        }] },
      ],
      privacy: { entityMap: {}, alwaysMask: [] },
    });
    useExerciseSession.getState().begin(profile, undefined, true);
    exerciseChat.messages = completedBaseline.messages;

    const recaptured = captureExercise()!;
    expect(recaptured.baselinePending).toBe(false);

    openExercise(completedBaseline);
    expect(exerciseChat.messages).toEqual(completedBaseline.messages);
    expect(deriveTtxState(exerciseChat.messages).turns).toEqual([output]);
    expect(useExerciseSession.getState()).toMatchObject({
      baselinePending: false, baselineNeedsReview: false, activeProfile: profile,
    });
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
