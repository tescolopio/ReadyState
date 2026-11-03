import { z } from "zod";

import type { MaskTerm } from "@/utils/obfuscator";

const entityKind = z.enum([
  "Person", "Pet", "Medical", "Location", "Address", "Postcode",
  "Phone", "Email", "URL", "ID",
]);
const maskTerm = z.union([
  z.string().min(1),
  z.object({
    value: z.string().min(1),
    kind: entityKind,
    caseSensitive: z.boolean().optional(),
  }).strict(),
]);
const privacyContextSchema = z.object({
  version: z.literal(1),
  baselineApprovalId: z.string().uuid(),
  entityMap: z.record(z.string(), z.string().min(1)),
  alwaysMask: z.array(maskTerm),
}).strict();

export type LocalSessionPrivacy = {
  version: 1;
  baselineApprovalId: string;
  entityMap: Record<string, string>;
  alwaysMask: MaskTerm[];
};

export interface PrivateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PrivacyLoadResult =
  | { status: "ready"; context: LocalSessionPrivacy }
  | { status: "missing" }
  | { status: "corrupt" }
  | { status: "unavailable" };

const sessionKey = (sessionId: string) => `readystate.local-session-privacy.v1.session.${sessionId}`;
const draftKey = (approvalId: string) => `readystate.local-session-privacy.v1.draft.${approvalId}`;
export const LOCAL_PRIVACY_SETTINGS_KEY = "readystate.local-privacy-settings.v1";
const settingsLock = "readystate.local-privacy-settings";

/** Read inside the settings lock; storage events and another tab's memory are not authoritative. */
export function loadLocalPrivacySettings(storage: PrivateStorage): string[] {
  const raw = storage.getItem(LOCAL_PRIVACY_SETTINGS_KEY);
  return raw === null ? [] : z.array(z.string().min(1)).parse(JSON.parse(raw));
}

export async function withLocalPrivacySettingsLock<T>(
  operation: () => Promise<T>,
  mode: LockMode = "shared",
  locks: Pick<LockManager, "request"> | null | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("Safe cross-tab privacy coordination is unavailable. No privacy setting was changed and no response was saved or sent.");
  return locks.request(settingsLock, { mode }, operation);
}

/** Settings writes cannot take effect between a response's privacy check and its save. */
export async function saveLocalPrivacySettings(
  storage: PrivateStorage,
  names: string[],
  locks: Pick<LockManager, "request"> | null | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
): Promise<string[]> {
  const rules = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  return withLocalPrivacySettingsLock(async () => {
    storage.setItem(LOCAL_PRIVACY_SETTINGS_KEY, JSON.stringify(rules));
    return rules;
  }, "exclusive", locks);
}

export function localSessionMaskRules(...lists: MaskTerm[][]): MaskTerm[] {
  const terms = new Map<string, MaskTerm>();
  for (const term of lists.flat()) terms.set(JSON.stringify(term), term);
  return [...terms.values()];
}

export async function withLocalSessionPrivacyLock<T>(
  sessionId: string, operation: () => Promise<T>,
  locks: Pick<LockManager, "request"> | null | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("Safe cross-tab privacy coordination is unavailable. Use a browser with Web Locks support; no response was saved or sent.");
  // Always acquire settings before the session lock, including retries and masking writes.
  return withLocalPrivacySettingsLock(
    () => locks.request(`readystate.local-session-privacy.${sessionId}`, { mode: "exclusive" }, operation),
    "shared", locks,
  );
}

export function newLocalSessionPrivacy(
  baselineApprovalId: string,
  alwaysMask: MaskTerm[],
): LocalSessionPrivacy {
  return {
    version: 1,
    baselineApprovalId,
    entityMap: {},
    alwaysMask: alwaysMask.map(term => typeof term === "string" ? term : { ...term }),
  };
}

function decode(raw: string): LocalSessionPrivacy | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = privacyContextSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function encode(context: LocalSessionPrivacy): string {
  return JSON.stringify(privacyContextSchema.parse(context));
}

/** Save this before sending a new baseline, so a failed request cannot lose its private mapping. */
export function saveLocalPrivacyDraft(
  storage: PrivateStorage,
  context: LocalSessionPrivacy,
): boolean {
  try {
    storage.setItem(draftKey(context.baselineApprovalId), encode(context));
    return true;
  } catch {
    return false;
  }
}

/** Persist an existing session's updated rules or mappings before sending a response. */
export function saveLocalSessionPrivacy(
  storage: PrivateStorage,
  sessionId: string,
  context: LocalSessionPrivacy,
): boolean {
  try {
    storage.setItem(sessionKey(sessionId), encode(context));
    storage.removeItem(draftKey(context.baselineApprovalId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore only the browser-private context associated with this saved session.
 * A draft is accepted only when its private baseline approval id matches the
 * saved baseline; household state is deliberately not consulted.
 */
export function loadLocalSessionPrivacy(
  storage: PrivateStorage,
  sessionId: string,
  baselineApprovalId: string,
): PrivacyLoadResult {
  try {
    const saved = storage.getItem(sessionKey(sessionId));
    if (saved !== null) {
      const context = decode(saved);
      if (!context || context.baselineApprovalId !== baselineApprovalId) return { status: "corrupt" };
      return { status: "ready", context };
    }

    const draft = storage.getItem(draftKey(baselineApprovalId));
    if (draft === null) return { status: "missing" };
    const context = decode(draft);
    if (!context || context.baselineApprovalId !== baselineApprovalId) return { status: "corrupt" };

    return { status: "ready", context };
  } catch {
    return { status: "unavailable" };
  }
}

/** Best-effort browser storage access; some privacy modes throw on property access. */
export function getLocalPrivacyStorage(): PrivateStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
