import nlp from "compromise";

import { usePrivacyStore } from "@/store/usePrivacyStore";

type EntityKind = "Person" | "Location";

const TAG_PATTERN = /\[[^\]]*\]/;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Strips surrounding whitespace/punctuation that compromise keeps (e.g. "Paris."). */
const cleanEntity = (value: string) =>
  value.replace(/^[\s"'([{]+|[\s"',.;:!?)\]}]+$/g, "");

const nextTag = (kind: EntityKind, entityMap: Record<string, string>) => {
  const prefix = `[${kind} `;
  const count = Object.keys(entityMap).filter((tag) =>
    tag.startsWith(prefix),
  ).length;
  return `[${kind} ${count + 1}]`;
};

const findTagFor = (realValue: string, entityMap: Record<string, string>) => {
  const needle = realValue.toLowerCase();
  return Object.keys(entityMap).find(
    (tag) => entityMap[tag].toLowerCase() === needle,
  );
};

/**
 * Detects people and places with compromise, replaces them with stable tags
 * (`[Person 1]`, `[Location 1]`, ...), records the mapping in the privacy
 * store and returns the sanitized string. Existing `[...]` tags are preserved.
 */
export function maskInput(text: string): string {
  const doc = nlp(text);
  const detected: Array<{ value: string; kind: EntityKind }> = [
    ...doc
      .people()
      .out("array")
      .map((value: string) => ({ value, kind: "Person" as const })),
    ...doc
      .places()
      .out("array")
      .map((value: string) => ({ value, kind: "Location" as const })),
  ];

  const replacements = new Map<string, string>();
  for (const { value, kind } of detected) {
    const realValue = cleanEntity(value);
    if (!realValue || TAG_PATTERN.test(realValue)) continue;
    const key = realValue.toLowerCase();
    if (replacements.has(key)) continue;

    const { entityMap, addMapping } = usePrivacyStore.getState();
    let tag = findTagFor(realValue, entityMap);
    if (!tag) {
      tag = nextTag(kind, entityMap);
      addMapping(realValue, tag);
    }
    replacements.set(key, tag);
  }

  if (replacements.size === 0) return text;

  // Longest values first so "John Smith" wins over "John"; existing tags are
  // matched first and left untouched.
  const alternatives = [...replacements.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const pattern = new RegExp(
    `\\[[^\\]]*\\]|(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`,
    "giu",
  );

  return text.replace(pattern, (match) =>
    match.startsWith("[") ? match : (replacements.get(match.toLowerCase()) ?? match),
  );
}

/**
 * Restores real values for any tags present in the privacy store
 * (e.g. `[Person 1]` -> `Jane Doe`). Unknown tags are left as-is.
 */
export function unmaskOutput(text: string): string {
  const { entityMap } = usePrivacyStore.getState();
  const tags = Object.keys(entityMap);
  if (!text || tags.length === 0) return text;

  const pattern = new RegExp(tags.map(escapeRegExp).join("|"), "g");
  return text.replace(pattern, (tag) => entityMap[tag] ?? tag);
}
