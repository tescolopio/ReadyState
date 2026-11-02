import { z } from "zod";

import { collectionSchema, householdSaveSchema } from "@/lib/household-saves";
import { localRecordsSchema, privacySnapshotSchema } from "@/lib/local-records";
import { providerSettingsSchema } from "@/lib/providers";

export const FULL_BACKUPS_KEY = "readystate-encrypted-backups";
export const MAX_BACKUP_BYTES = 30 * 1024 * 1024;
const MAX_DATA_BYTES = 20 * 1024 * 1024;
const ITERATIONS = 600_000;
const AAD = new TextEncoder().encode("ReadyState full backup v1 / AES-256-GCM / PBKDF2-SHA256");
export const fullBackupSchema = z.strictObject({
  format: z.literal("readystate-full-data"), version: z.literal(1), savedAt: z.iso.datetime(),
  householdAndPlan: householdSaveSchema,
  settings: providerSettingsSchema.strict().nullable(),
  records: localRecordsSchema,
  privacy: privacySnapshotSchema,
  appearance: z.enum(["a", "b"]).nullable(),
  namedHouseholds: collectionSchema,
});
export type FullBackup = z.infer<typeof fullBackupSchema>;
const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).refine(value => value.length % 4 === 0, "Invalid base64 length");
export const encryptedBackupSchema = z.strictObject({
  format: z.literal("readystate-encrypted-backup"), version: z.literal(1),
  cipher: z.literal("AES-256-GCM"), kdf: z.literal("PBKDF2-SHA256"),
  iterations: z.literal(ITERATIONS),
  salt: base64.length(24), iv: base64.length(16),
  ciphertext: base64.min(24).max(MAX_BACKUP_BYTES),
});
export type EncryptedBackup = z.infer<typeof encryptedBackupSchema>;
const namedBackupSchema = z.strictObject({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(100),
  savedAt: z.iso.datetime(), encrypted: encryptedBackupSchema,
});
export type NamedFullBackup = z.infer<typeof namedBackupSchema>;
const librarySchema = z.strictObject({ version: z.literal(1), backups: z.array(namedBackupSchema) })
  .refine(({ backups }) =>
    new Set(backups.map(item => item.id)).size === backups.length &&
    new Set(backups.map(item => item.name.toLocaleLowerCase())).size === backups.length, "Duplicate encrypted backups");

const encode = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
};
const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));
function cryptoApi() {
  if (!globalThis.crypto?.subtle) throw new Error("Encrypted backups require Web Crypto on HTTPS or localhost. No unencrypted fallback is used.");
  return globalThis.crypto;
}
async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const api = cryptoApi();
  const material = await api.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return api.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptFullBackup(data: FullBackup, password: string): Promise<EncryptedBackup> {
  if (password.length < 12) throw new Error("Use a backup password of at least 12 characters.");
  const bytes = new TextEncoder().encode(JSON.stringify(fullBackupSchema.parse(data)));
  if (bytes.length > MAX_DATA_BYTES) throw new Error("Full backup data exceeds the 20 MiB limit. Keep earlier backups before removing unneeded history or copies.");
  const api = cryptoApi();
  const salt = api.getRandomValues(new Uint8Array(16));
  const iv = api.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt);
  const ciphertext = await api.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, bytes);
  return encryptedBackupSchema.parse({
    format: "readystate-encrypted-backup", version: 1, cipher: "AES-256-GCM",
    kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: encode(salt), iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  });
}
export function parseEncryptedBackup(json: string): EncryptedBackup {
  if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) throw new Error("Encrypted backup files must be 30 MiB or smaller.");
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch { throw new Error("This file is not valid encrypted-backup JSON. Nothing was loaded."); }
  const parsed = encryptedBackupSchema.safeParse(raw);
  if (!parsed.success || decode(parsed.data.salt).length !== 16 || decode(parsed.data.iv).length !== 12) {
    throw new Error("Unsupported or damaged encrypted backup. No data was changed.");
  }
  return parsed.data;
}
export async function decryptFullBackup(value: EncryptedBackup, password: string): Promise<FullBackup> {
  const encrypted = parseEncryptedBackup(JSON.stringify(value));
  const key = await passwordKey(password, decode(encrypted.salt));
  let bytes: ArrayBuffer;
  try {
    bytes = await cryptoApi().subtle.decrypt({
      name: "AES-GCM", iv: decode(encrypted.iv), additionalData: AAD,
    }, key, decode(encrypted.ciphertext));
  } catch { throw new Error("Could not unlock backup: incorrect password or damaged data. Nothing was changed."); }
  if (bytes.byteLength > MAX_DATA_BYTES) throw new Error("Backup data exceeds the supported size. Nothing was changed.");
  const parsed = fullBackupSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  if (!parsed.success) throw new Error("The decrypted data is not a supported ReadyState backup. Nothing was changed.");
  return parsed.data;
}
export function readFullBackups(storage: Storage): NamedFullBackup[] {
  const raw = storage.getItem(FULL_BACKUPS_KEY);
  if (raw === null) return [];
  const parsed = librarySchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Encrypted backup library is damaged or unsupported; existing backups were not overwritten.");
  return parsed.data.backups;
}
export function writeFullBackups(storage: Storage, backups: NamedFullBackup[]) {
  storage.setItem(FULL_BACKUPS_KEY, JSON.stringify(librarySchema.parse({ version: 1, backups })));
}
