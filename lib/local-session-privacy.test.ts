import { describe, expect, it } from "vitest";

import { loadLocalPrivacySettings, loadLocalSessionPrivacy, localSessionMaskRules, newLocalSessionPrivacy, saveLocalPrivacyDraft, saveLocalPrivacySettings, saveLocalSessionPrivacy, withLocalSessionPrivacyLock, type PrivateStorage } from "@/lib/local-session-privacy";
import { createApprover, prepareReview } from "@/lib/outgoing-review";
import { usePrivacyStore } from "@/store/usePrivacyStore";

class MemoryStorage implements PrivateStorage {
  private readonly values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
  corrupt(key: string, value: string) { this.values.set(key, value); }
}

const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const baselineA = "11111111-1111-4111-8111-111111111111";
const baselineB = "22222222-2222-4222-8222-222222222222";

describe("local session privacy", () => {
  it("restores only the saved session's rules and mappings after a reload and household change", () => {
    const storage = new MemoryStorage();
    const original = newLocalSessionPrivacy(baselineA, [
      { value: "Medication A", kind: "Medical" },
      "PrivateTermA",
    ]);
    original.entityMap["[Person 1]"] = "Alice";
    expect(saveLocalSessionPrivacy(storage, a, original)).toBe(true);

    usePrivacyStore.getState().addMapping("Unrelated global value", "[Person 1]");
    usePrivacyStore.getState().setAlwaysMask(["ChangedHouseholdTerm"]);
    const resumed = loadLocalSessionPrivacy(storage, a, baselineA);

    expect(resumed.status).toBe("ready");
    if (resumed.status !== "ready") return;
    expect(resumed.context).toEqual(original);
    expect(resumed.context.alwaysMask).not.toContain("ChangedHouseholdTerm");

    const review = prepareReview("response", mask => mask("My sister Alice takes Medication A."), resumed.context.entityMap, resumed.context.alwaysMask);
    expect(review.text).toContain("[Person 1]");
    expect(review.text).toContain("[Medical 1]");
    expect(review.text).not.toContain("Alice");
    expect(review.text).not.toContain("Medication A");
    expect(usePrivacyStore.getState().entityMap["[Person 1]"]).toBe("Unrelated global value");
  });

  it("keeps colliding tags isolated between saved sessions", () => {
    const storage = new MemoryStorage();
    const first = newLocalSessionPrivacy(baselineA, []);
    const second = newLocalSessionPrivacy(baselineB, []);
    first.entityMap["[Person 1]"] = "Alice";
    second.entityMap["[Person 1]"] = "Bob";
    expect(saveLocalSessionPrivacy(storage, a, first)).toBe(true);
    expect(saveLocalSessionPrivacy(storage, b, second)).toBe(true);

    const resumedA = loadLocalSessionPrivacy(storage, a, baselineA);
    const resumedB = loadLocalSessionPrivacy(storage, b, baselineB);
    expect(resumedA.status).toBe("ready");
    expect(resumedB.status).toBe("ready");
    if (resumedA.status !== "ready" || resumedB.status !== "ready") return;

    expect(resumedA.context.entityMap["[Person 1]"]).toBe("Alice");
    expect(resumedB.context.entityMap["[Person 1]"]).toBe("Bob");
    expect(prepareReview("response", mask => mask("Alice called."), resumedA.context.entityMap, []).text).toBe("[Person 1] called.");
    expect(prepareReview("response", mask => mask("Bob called."), resumedB.context.entityMap, []).text).toBe("[Person 1] called.");
  });

  it("recovers a pre-request draft only for the matching saved baseline", () => {
    const storage = new MemoryStorage();
    const draft = newLocalSessionPrivacy(baselineA, ["OriginalTerm"]);
    draft.entityMap["[Person 1]"] = "Alice";
    expect(saveLocalPrivacyDraft(storage, draft)).toBe(true);
    expect(loadLocalSessionPrivacy(storage, a, baselineB).status).toBe("missing");

    const resumed = loadLocalSessionPrivacy(storage, a, baselineA);
    expect(resumed.status).toBe("ready");
    if (resumed.status !== "ready") return;
    expect(resumed.context).toEqual(draft);
    expect(loadLocalSessionPrivacy(storage, a, baselineA).status).toBe("ready");
  });

  it("blocks missing, corrupt, and quota-failed browser context instead of inferring rules", () => {
    const storage = new MemoryStorage();
    expect(loadLocalSessionPrivacy(storage, a, baselineA)).toEqual({ status: "missing" });
    storage.corrupt(`readystate.local-session-privacy.v1.session.${a}`, "{broken");
    expect(loadLocalSessionPrivacy(storage, a, baselineA)).toEqual({ status: "corrupt" });

    const draft = newLocalSessionPrivacy(baselineB, ["OriginalTerm"]);
    expect(saveLocalPrivacyDraft(storage, draft)).toBe(true);
    storage.failWrites = true;
    expect(loadLocalSessionPrivacy(storage, b, baselineB).status).toBe("ready");
    expect(saveLocalSessionPrivacy(storage, b, draft)).toBe(false);
    expect(loadLocalSessionPrivacy(storage, a, baselineB)).toEqual({ status: "corrupt" });
  });

  it("serializes session writes and rebuilds stale previews without overwriting accepted tags", async () => {
    const storage = new MemoryStorage();
    const context = newLocalSessionPrivacy(baselineA, []);
    saveLocalSessionPrivacy(storage, a, context);
    const first = prepareReview("response", mask => mask("My sister Alice called."), {}, []);
    const second = prepareReview("response", mask => mask("My sister Beatrice called."), {}, []);
    const tails = new Map<string, Promise<unknown>>();
    const locks: Pick<LockManager, "request"> = {
      request: ((name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => {
        const next = (tails.get(name) ?? Promise.resolve()).then(() => callback(null));
        tails.set(name, next.catch(() => {}));
        return next;
      }) as LockManager["request"],
    };
    const submit = (review: typeof first) => withLocalSessionPrivacyLock(a, async () => {
      const restored = loadLocalSessionPrivacy(storage, a, baselineA);
      if (restored.status !== "ready") throw new Error("Missing context");
      const candidate = restored.context;
      const approve = createApprover({
        ledger: () => candidate.entityMap, alwaysMask: () => candidate.alwaysMask,
        addMapping: (value, tag) => { candidate.entityMap[tag] = value; },
        send: () => { expect(saveLocalSessionPrivacy(storage, a, candidate)).toBe(true); },
      });
      await Promise.resolve();
      return approve(review);
    }, locks);
    const results = await Promise.all([submit(first), submit(second)]);
    expect(results.map(result => result.status)).toEqual(["sent", "review-again"]);
    const restored = loadLocalSessionPrivacy(storage, a, baselineA);
    expect(restored.status === "ready" && restored.context.entityMap["[Person 1]"]).toBe("Alice");
    if (results[1].status !== "review-again") throw new Error("Expected stale review rebuild");
    expect(results[1].review.text).toContain("[Person 2]");
  });

  it("holds Settings coordination through the outbound save and releases it on failure", async () => {
    const storage = new MemoryStorage();
    const tails = new Map<string, Promise<unknown>>();
    const locks: Pick<LockManager, "request"> = {
      request: ((name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => {
        const next = (tails.get(name) ?? Promise.resolve()).then(() => callback(null));
        tails.set(name, next.catch(() => {}));
        return next;
      }) as LockManager["request"],
    };
    let reachedSend!: () => void;
    const sending = new Promise<void>(resolve => { reachedSend = resolve; });
    let finishSend!: () => void;
    const transport = new Promise<void>(resolve => { finishSend = resolve; });
    const send = withLocalSessionPrivacyLock(a, async () => {
      expect(loadLocalPrivacySettings(storage)).toEqual([]);
      reachedSend();
      await transport;
      throw new Error("lost acknowledgement");
    }, locks);
    const failure = expect(send).rejects.toThrow("lost acknowledgement");
    await sending;
    let settingSaved = false;
    const setting = saveLocalPrivacySettings(storage, ["quietorchid"], locks).then(() => { settingSaved = true; });
    await Promise.resolve();
    expect(settingSaved).toBe(false);
    expect(loadLocalPrivacySettings(storage)).toEqual([]);
    finishSend();
    await failure;
    await setting;
    expect(loadLocalPrivacySettings(storage)).toEqual(["quietorchid"]);

    const review = prepareReview("response", mask => mask("the codeword is quietorchid"), {}, []);
    const sent: string[] = [];
    const retry = await withLocalSessionPrivacyLock(a, async () => createApprover({
      ledger: () => ({}), alwaysMask: () => loadLocalPrivacySettings(storage),
      addMapping: () => {}, send: text => { sent.push(text); },
    })(review), locks);
    expect(retry.status).toBe("review-again");
    expect(sent).toEqual([]);
    if (retry.status !== "review-again") throw new Error("Expected a fresh masked review");
    expect(retry.review.text).not.toContain("quietorchid");
  });

  it("requires lock support and applies current explicit rules while preserving original session terms", async () => {
    await expect(withLocalSessionPrivacyLock(a, async () => {}, null)).rejects.toThrow("no response was saved or sent");
    const original = ["OriginalPrivateTerm"];
    const review = prepareReview("response", mask => mask("OriginalPrivateTerm and NewlyPrivateTerm"), {}, original);
    const rules = localSessionMaskRules(original, ["NewlyPrivateTerm"], original);
    const result = createApprover({
      ledger: () => ({}), alwaysMask: () => rules, addMapping: () => {},
      send: () => { throw new Error("Changed rules must not send"); },
    })(review);
    expect(result.status).toBe("review-again");
    if (result.status !== "review-again") return;
    expect(result.review.text).not.toContain("NewlyPrivateTerm");
    expect(result.review.text).not.toContain("OriginalPrivateTerm");
  });
});
