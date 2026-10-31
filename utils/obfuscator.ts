import nlp from "compromise";

import { usePrivacyStore } from "@/store/usePrivacyStore";

type EntityKind =
  | "Person"
  | "Pet"
  | "Location"
  | "Address"
  | "Postcode"
  | "Phone"
  | "Email"
  | "URL"
  | "ID";

interface Detection {
  value: string;
  kind: EntityKind;
}

const TAG_PATTERN = /\[[^\]]*\]/;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Strips surrounding whitespace/punctuation that detectors keep (e.g. "Paris.").
 * Brackets that pair up inside the value stay, so "(206) 555-0142" keeps its "(".
 */
const cleanEntity = (value: string) => {
  const stripped = value.replace(/^[\s"'[{]+|[\s"',.;:!?\]}]+$/g, "");
  const leading = stripped.startsWith("(") && !stripped.includes(")");
  const trailing = stripped.endsWith(")") && !stripped.includes("(");
  return stripped.slice(leading ? 1 : 0, trailing ? -1 : undefined).replace(/^[\s"'[{]+|[\s"',.;:!?\]}]+$/g, "");
};

/** Matches either casing of each letter, so a pattern can be case-insensitive in one part only. */
const anyCase = (word: string) =>
  [...word]
    .map((c) => (/\p{L}/u.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : escapeRegExp(c)))
    .join("");

const anyCaseList = (words: string[]) => words.map(anyCase).join("|");

const NAME = String.raw`\p{Lu}[\p{L}'’-]+`;
/** A name optionally followed by an age, as in "Mai (3)". */
const NAME_WITH_AGE = String.raw`${NAME}(?:\s*\(\s*(?:age\s*)?\d{1,3}\s*\))?`;
const NAME_LIST = String.raw`(?:${NAME_WITH_AGE}(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*))*${NAME_WITH_AGE}`;
const MODIFIERS = String.raw`(?:[\p{L}\p{N}-]+\s+){0,2}`;

const RELATIONS = [
  "wife", "husband", "partner", "spouse", "fiance", "fiancee", "fiancé", "fiancée",
  "boyfriend", "girlfriend", "son", "daughter", "stepson", "stepdaughter", "kid", "child",
  "baby", "toddler", "infant", "teen", "teenager", "mother", "mom", "mum", "father", "dad",
  "brother", "sister", "grandmother", "grandma", "grandfather", "grandpa", "granddaughter",
  "grandson", "aunt", "uncle", "cousin", "nephew", "niece", "roommate", "neighbor",
  "neighbour", "friend", "caregiver", "nanny", "mother-in-law", "father-in-law",
  "sister-in-law", "brother-in-law", "boy", "girl", "twin", "stepmom", "stepdad", "stepmother",
  "stepfather", "youngest", "oldest", "eldest", "godson", "goddaughter",
];
const RELATION_GROUPS = [
  "kids", "children", "sons", "daughters", "twins", "parents", "grandparents", "grandkids",
  "grandchildren", "siblings", "brothers", "sisters", "roommates", "neighbors", "neighbours",
  "friends", "teens", "teenagers",
];
const ANIMALS = [
  "dog", "puppy", "pup", "cat", "kitten", "horse", "pony", "parrot", "bird", "rabbit", "bunny",
  "hamster", "guinea pig", "goat", "chicken", "hen", "rooster", "lizard", "snake", "tortoise",
  "turtle", "ferret", "lab", "labrador", "retriever", "shepherd", "husky", "poodle", "beagle",
  "terrier", "bulldog", "pit bull", "pitbull", "mutt", "tabby", "doodle", "corgi", "dachshund",
  "chihuahua", "collie", "heeler", "spaniel", "mastiff", "rottweiler", "boxer",
];
const ANIMAL_GROUPS = [
  "dogs", "puppies", "cats", "kittens", "horses", "goats", "chickens", "hens", "rabbits", "birds",
];

const STREET_SUFFIXES = [
  "street", "st", "avenue", "ave", "road", "rd", "boulevard", "blvd", "drive", "dr", "lane",
  "ln", "court", "ct", "way", "place", "pl", "terrace", "ter", "circle", "cir", "parkway",
  "pkwy", "highway", "hwy", "trail", "trl", "loop", "square", "sq", "crescent", "close", "pike",
];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN",
  "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY", "PR",
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
];

/** Units that make a 5-digit number a quantity rather than a ZIP code. */
const UNITS = [
  "mah", "btu", "btus", "w", "watt", "watts", "kw", "kwh", "wh", "v", "volt", "volts", "lb",
  "lbs", "pound", "pounds", "kg", "g", "mg", "ml", "l", "liter", "liters", "litre", "litres",
  "gal", "gallon", "gallons", "oz", "ounce", "ounces", "cal", "calorie", "calories", "kcal",
  "rpm", "ft", "feet", "mi", "mile", "miles", "km", "m", "hp", "psi", "mph", "dollars", "usd",
  "rounds", "steps", "sq",
];

/** Capitalized words that start sentences or clauses, never names. */
const NOT_NAMES = new Set(
  [
    "i", "a", "an", "the", "and", "or", "but", "so", "if", "then", "we", "he", "she", "they",
    "it", "is", "are", "was", "were", "has", "have", "had", "our", "my", "his", "her",
    "their", "this", "that", "these", "those", "who", "also", "both", "in", "on", "at", "to",
    "for", "with", "from", "by", "no", "not", "yes", "all", "each", "every", "some", "one",
    "two", "three", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
    "sunday", "mr", "mrs", "ms", "dr", "people", "persons", "adults", "children", "kids", "teens",
    "infants", "pets", "dogs", "cats", "animals", "household", "emergency", "location", "home", "notes",
  ],
);

/** Words that come before place names without being part of them ("rural Colorado"). */
const NOT_PLACES = new Set(
  [
    "rural", "northern", "southern", "eastern", "western", "central", "upstate", "downstate",
    "coastal", "north", "south", "east", "west", "northeast", "northwest", "southeast",
    "southwest", "greater", "downtown", "suburban",
  ],
);
const US_STATE_NAMES = new Set(US_STATES.map((state) => state.toLowerCase()));

/**
 * Preparedness brands, stores and agencies that compromise mistakes for people
 * ("the Coleman stove"). Only loose detections skip these: "our dog Buddy" is
 * still masked everywhere.
 */
const KNOWN_BRANDS = new Set(
  [
    "coleman", "generac", "honda", "champion", "westinghouse", "jackery", "ecoflow", "bluetti",
    "anker", "goal zero", "mr. heater", "mr heater", "buddy", "big buddy", "lifestraw", "sawyer",
    "berkey", "mylar", "mountain house", "readywise", "duracell", "energizer", "midland",
    "baofeng", "garmin", "inreach", "starlink", "yeti", "igloo", "walmart", "costco",
    "home depot", "lowe's", "lowes", "target", "kroger", "walgreens", "cvs", "red cross",
    "fema", "noaa", "nws", "epipen", "tylenol", "advil", "benadryl", "narcan", "sterno",
  ],
);
const isKnownBrand = (value: string) => KNOWN_BRANDS.has(value.toLowerCase());

const isLikelyName = (word: string) => {
  const bare = word.replace(/\s*\(.*\)$/, "");
  return bare.length > 1 && !NOT_NAMES.has(bare.toLowerCase());
};

/** For loosely matched words: compromise must read it as a noun, not a verb, adjective or date. */
const looksLikeProperNoun = (word: string) =>
  isLikelyName(word) &&
  !nlp(word).has("(#Verb|#Adjective|#Adverb|#Preposition|#Conjunction|#Determiner|#Pronoun|#Value|#Date)");

const isLikelyPlace = (value: string) => {
  const words = value.split(/\s+/);
  return (
    !US_STATE_NAMES.has(value.toLowerCase()) &&
    !NOT_PLACES.has(words[0].toLowerCase()) &&
    !NOT_NAMES.has(words[0].toLowerCase())
  );
};

/** Drops values contained in a longer detected value ("555-0142" inside "303-555-0142"). */
const dropContained = (detections: Detection[]) =>
  detections.filter(
    ({ value }) => !detections.some((other) => other.value.length > value.length && other.value.includes(value)),
  );

/** Splits "Linh (8), Bao and Mai" into ["Linh", "Bao", "Mai"]. */
const splitNameList = (list: string) =>
  list
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/)
    .map((name) => name.replace(/\s*\(.*\)$/, "").trim())
    .filter(isLikelyName);

const matchAll = (text: string, pattern: RegExp, kind: EntityKind, group = 0): Detection[] =>
  [...text.matchAll(pattern)]
    .map((match) => match[group])
    .filter(Boolean)
    .map((value) => ({ value, kind }));

const matchLists = (text: string, pattern: RegExp, kind: EntityKind): Detection[] =>
  [...text.matchAll(pattern)].flatMap((match) =>
    splitNameList(match[1]).map((value) => ({ value, kind })),
  );

// Contact details and identifiers. These are unambiguous, so they run first.
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'\])]+/giu;
const CARD = /(?<!\d)\d{4}(?:[ -]\d{4}){3}(?!\d)/gu;
const SSN = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/gu;
const PHONE =
  /(?<![\p{N}-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-]?)\d{3}[\s.-]?\d{4}(?![\p{N}-])/gu;
const INTL_PHONE = /\+\d{1,3}(?:[\s.-]?\d){7,12}(?!\p{N})/gu;
const SHORT_PHONE = /(?<![\p{N}-])\d{3}-\d{4}(?![\p{N}-])/gu;
const LONG_NUMBER = /(?<![\p{N}.,])\d{9,}(?![\p{N}.,])/gu;

const STREET_WORD = String.raw`(?:\p{Lu}[\p{L}'.-]*|\d+(?:st|nd|rd|th))`;
const ADDRESS = new RegExp(
  String.raw`\b\d{1,6}[A-Za-z]?(?:\s+(?:[NSEW]|N[EW]|S[EW]|North|South|East|West)\.?)?(?:\s+${STREET_WORD}){1,4}\s+(?:${anyCaseList(STREET_SUFFIXES)})\b\.?(?:,?\s*(?:${anyCaseList(["apt", "apartment", "unit", "suite", "ste"])}|#)\.?\s*[\p{L}\p{N}-]+)?`,
  "gu",
);
const PO_BOX = new RegExp(String.raw`\b${anyCase("p")}\.?\s?${anyCase("o")}\.?\s+${anyCase("box")}\s+\d+\b`, "gu");
const COORDINATES = /-?\d{1,2}\.\d{3,},\s*-?\d{1,3}\.\d{3,}/gu;
const ZIP = new RegExp(
  String.raw`(?<![\p{N}$.,-])\d{5}(?:-\d{4})?(?![\p{N}.,]\d)(?!\s*(?:${anyCaseList(UNITS)})\b)(?!\s*%)`,
  "gu",
);
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b/gu;
const CA_POSTCODE = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/gu;

// Places. The state itself is kept: it's coarse and the simulation needs the region.
const CITY_STATE = new RegExp(
  String.raw`\b(\p{Lu}[\p{L}'.-]+(?:\s+\p{Lu}[\p{L}'.-]+){0,2}),?\s+(?:${US_STATES.join("|")})\b`,
  "gu",
);
/** A town right before a UK or Canadian postcode, as in "Bath BA1 2AB". */
const CITY_BEFORE_POSTCODE = new RegExp(
  String.raw`\b(\p{Lu}[\p{L}'.-]+(?:\s+\p{Lu}[\p{L}'.-]+){0,2}),?\s+(?=[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b|[A-Z]\d[A-Z]\s?\d[A-Z]\d\b)`,
  "gu",
);
const LIVES_IN = new RegExp(
  String.raw`\b(?:${anyCaseList(["live", "lives", "living", "located", "based", "reside", "resides", "moved", "moving", "relocated", "house", "home", "apartment", "condo", "cabin", "farm", "ranch"])})\s+(?:in|near|to|outside(?:\s+of)?|just\s+outside(?:\s+of)?)\s+(\p{Lu}[\p{L}'.-]+(?:\s+\p{Lu}[\p{L}'.-]+){0,2})`,
  "gu",
);

// Pets, before people, so a dog named Max isn't tagged as a person.
const ANIMAL = anyCaseList(ANIMALS);
const PET_AFTER_ANIMAL = new RegExp(
  String.raw`\b(?:${ANIMAL})\s*,?\s+(?:(?:named|called)\s+)?(${NAME})`,
  "gu",
);
/** "a German shepherd mix called Oso", "a barn cat we call Whiskers". */
const PET_NAMED = new RegExp(
  String.raw`\b(?:${ANIMAL})\s+(?:[\p{L}-]+\s+){0,2}?(?:named|called|we\s+call|we\s+named)\s+(${NAME})`,
  "gu",
);
const PET_BEFORE_ANIMAL = new RegExp(
  String.raw`\b(${NAME})\s*,?\s+(?:is\s+)?(?:our|my|the|a|an|his|her|their)\s+${MODIFIERS}(?:${ANIMAL})\b`,
  "gu",
);
const PET_LIST = new RegExp(
  String.raw`\b(?:${anyCaseList(ANIMAL_GROUPS)})\s*(?:[,:(—–-]\s*)?(?:(?:named|called)\s+)?(${NAME_LIST})`,
  "gu",
);

// People.
const RELATION = new RegExp(
  String.raw`\b(?:${anyCaseList(["my", "our", "his", "her", "their", "a", "an"])})\s+${MODIFIERS}(?:${anyCaseList(RELATIONS)})\s*,?\s+(?:(?:is|was|named|called|goes\s+by)\s+)?(${NAME}(?:\s+${NAME})?)`,
  "gu",
);
const RELATION_LIST = new RegExp(
  String.raw`\b(?:${anyCaseList(RELATION_GROUPS)})\s*(?:[,:(—–-]\s*)?(?:(?:named|called|are)\s+)?(${NAME_LIST})`,
  "gu",
);
/** Family titles used like names: "Grandpa Ernesto", "Aunt Rosa". */
const TITLE = new RegExp(
  String.raw`\b(?:Grandpa|Grandma|Granny|Gramps|Nana|Nanna|Papa|Abuela|Abuelo|Aunt|Auntie|Uncle|Cousin)\s+(${NAME})`,
  "gu",
);
/** The writer's own name: "me (Aisha)", "me, Ximena,", "I'm Rahul". */
const SELF = new RegExp(
  String.raw`\b(?:${anyCaseList(["me", "myself"])})\s*[(,]\s*(${NAME}(?:\s+${NAME})?)|\b(?:I'm|I am|${anyCaseList(["my name is", "this is"])})\s+(${NAME}(?:\s+${NAME})?)`,
  "gu",
);
/** A name in brackets after a relation: "Dad (Hamid)". */
const RELATION_PAREN = new RegExp(
  String.raw`\b(?:${anyCaseList(RELATIONS)})\s*\(\s*(${NAME}(?:\s+${NAME})?)\s*\)`,
  "gu",
);
/** "Kenji and I", "me and Kenji". */
const AND_ME = new RegExp(
  String.raw`\b(${NAME})\s+and\s+(?:I|me|myself)\b|\b(?:${anyCaseList(["me", "I"])})\s+and\s+(${NAME})\b`,
  "gu",
);
const NAMED = new RegExp(
  String.raw`\b(?:named|called|we\s+call|name is|name's|goes\s+by|known\s+as|nicknamed)\s+(${NAME}(?:\s+${NAME})?)`,
  "gu",
);
const NAME_WITH_AGE_ONLY = new RegExp(String.raw`(${NAME})\s*\(\s*(?:age\s*)?\d{1,2}\s*\)`, "gu");
const FAMILY = new RegExp(
  String.raw`\b(?:${anyCase("the")}\s+(${NAME})\s+family)|\b${anyCase("the")}\s+(${NAME}s)\b(?=\s+(?:next\s+door|across|down\s+the|nearby|live|have|are|family|two\s+doors))|\b(?:${anyCaseList(["neighbors", "neighbours", "friends"])})\s*,?\s+(?:are\s+)?the\s+(${NAME}s)\b`,
  "gu",
);

const contactDetectors = (text: string): Detection[] => dropContained([
  ...matchAll(text, EMAIL, "Email"),
  ...matchAll(text, URL_PATTERN, "URL"),
  ...matchAll(text, CARD, "ID"),
  ...matchAll(text, SSN, "ID"),
  ...matchAll(text, PHONE, "Phone"),
  ...matchAll(text, INTL_PHONE, "Phone"),
  ...matchAll(text, SHORT_PHONE, "Phone"),
  ...matchAll(text, LONG_NUMBER, "ID"),
  ...matchAll(text, ADDRESS, "Address"),
  ...matchAll(text, PO_BOX, "Address"),
  ...matchAll(text, COORDINATES, "Location"),
  ...matchAll(text, ZIP, "Postcode"),
  ...matchAll(text, UK_POSTCODE, "Postcode"),
  ...matchAll(text, CA_POSTCODE, "Postcode"),
]);

const contextDetectors = (text: string): Detection[] => [
  // A keyword right before the name ("our dog", "my wife", "named") makes these reliable.
  ...[
    ...matchAll(text, PET_AFTER_ANIMAL, "Pet", 1),
    ...matchAll(text, PET_NAMED, "Pet", 1),
    ...matchLists(text, PET_LIST, "Pet"),
    ...matchAll(text, RELATION, "Person", 1),
    ...matchLists(text, RELATION_LIST, "Person"),
    ...matchAll(text, NAMED, "Person", 1),
    ...matchAll(text, TITLE, "Person", 1),
    ...matchAll(text, RELATION_PAREN, "Person", 1),
    // Not checked with compromise below: it reads plurals like "Nguyens" as verbs.
    ...matchAll(text, FAMILY, "Person", 1),
    ...matchAll(text, FAMILY, "Person", 2),
    ...matchAll(text, FAMILY, "Person", 3),
  ].filter(({ value }) => isLikelyName(value)),
  // Looser shapes, where a capitalized verb or adjective could match ("Bring the dog").
  ...[
    ...matchAll(text, PET_BEFORE_ANIMAL, "Pet", 1),
    ...matchAll(text, NAME_WITH_AGE_ONLY, "Person", 1),
    ...matchAll(text, SELF, "Person", 1),
    ...matchAll(text, SELF, "Person", 2),
    ...matchAll(text, AND_ME, "Person", 1),
    ...matchAll(text, AND_ME, "Person", 2),
  ].filter(({ value }) => looksLikeProperNoun(value.split(/\s+/)[0]) && !isKnownBrand(value)),
  ...[
    ...matchAll(text, CITY_STATE, "Location", 1),
    ...matchAll(text, LIVES_IN, "Location", 1),
    ...matchAll(text, CITY_BEFORE_POSTCODE, "Location", 1),
  ].filter(({ value }) => isLikelyPlace(value)),
];

/** "Lakeland, Florida" -> "Lakeland": the state is kept, as everywhere else. */
const withoutTrailingState = (place: string) =>
  place.match(new RegExp(String.raw`^(.+?),?\s+(?:${US_STATES.join("|")})$`, "u"))?.[1] ?? place;

/**
 * compromise also tags lowercase nouns ("the fridge") and acronyms ("MS",
 * "COPD") as people or places; only capitalized words that aren't all caps count.
 */
const isProperName = (value: string) =>
  /^\p{Lu}/u.test(value) &&
  value !== value.toUpperCase() &&
  !/[()]/.test(value) && // "Dad (Hamid": the bracketed name is caught by RELATION_PAREN
  !isKnownBrand(value);

const nlpDetectors = (text: string): Detection[] => {
  const doc = nlp(text);
  return [
    ...doc
      .people()
      .out("array")
      .map((value: string) => ({ value: cleanEntity(value), kind: "Person" as const })),
    ...doc
      .places()
      .out("array")
      .map((value: string) => ({
        value: withoutTrailingState(cleanEntity(value)),
        kind: "Location" as const,
      }))
      .filter(({ value }: Detection) => !US_STATE_NAMES.has(value.toLowerCase())),
  ].filter(({ value }) => isProperName(value));
};

/** "Tim Escolopio": extends a detected first name with the capitalized word after it. */
const surnameDetectors = (text: string, people: string[]): Detection[] =>
  people.flatMap((person) => {
    // Same line only: a name that ends one line isn't followed by a surname on the next.
    const pattern = new RegExp(
      String.raw`(?<![\p{L}\p{N}_])${escapeRegExp(person)}[ \t]+(${NAME})(?![\p{L}\p{N}_])`,
      "gu",
    );
    return [...text.matchAll(pattern)]
      .filter((match) => looksLikeProperNoun(match[1]))
      .flatMap((match) => [
        { value: `${person} ${match[1]}`, kind: "Person" as const },
        { value: match[1], kind: "Person" as const },
      ]);
  });

/** "Marina" -> "Marina del Rey": extends a place over lowercase connectors. */
const placeExtensions = (text: string, places: string[]): Detection[] =>
  places.flatMap((place) => {
    const pattern = new RegExp(
      String.raw`(?<![\p{L}\p{N}_])${escapeRegExp(place)}(?:\s+(?:del|de|la|le|los|las|of|on|upon|sur|du|des)\s+${NAME})+`,
      "gu",
    );
    return [...text.matchAll(pattern)].map((match) => ({ value: match[0], kind: "Location" as const }));
  });

const nextTag = (kind: EntityKind, entityMap: Record<string, string>) => {
  const prefix = `[${kind} `;
  const count = Object.keys(entityMap).filter((tag) => tag.startsWith(prefix)).length;
  return `[${kind} ${count + 1}]`;
};

const findTagFor = (realValue: string, entityMap: Record<string, string>) => {
  const needle = realValue.toLowerCase();
  return Object.keys(entityMap).find((tag) => entityMap[tag].toLowerCase() === needle);
};

export interface MaskOptions {
  /** Names to mask wherever they appear, even when no detector catches them. */
  alwaysMask?: string[];
  /** Return the masked text without recording anything in the ledger (for previews). */
  dryRun?: boolean;
}

/**
 * Replaces personal details with stable tags (`[Person 1]`, `[Pet 1]`,
 * `[Phone 1]`, ...), records each mapping in the privacy store and returns the
 * sanitized string. Detection runs in priority order: contact details and
 * identifiers (patterns), pets and people named in context ("my wife Priya",
 * "our dog Max"), the user's always-mask list, compromise NLP, then surnames
 * following a detected name. Values already in the ledger from earlier
 * messages are masked too, and existing `[...]` tags are preserved.
 */
export function maskInput(text: string, options: MaskOptions = {}): string {
  const { entityMap: initialMap, alwaysMask: storedAlwaysMask } = usePrivacyStore.getState();
  const alwaysMask = options.alwaysMask ?? storedAlwaysMask;

  const detected: Detection[] = [
    ...contactDetectors(text),
    ...contextDetectors(text),
    ...alwaysMask.map((value) => ({ value, kind: "Person" as const })),
    ...nlpDetectors(text),
  ];
  const people = detected.filter((d) => d.kind === "Person").map((d) => cleanEntity(d.value));
  detected.push(...surnameDetectors(text, people));
  const places = detected.filter((d) => d.kind === "Location").map((d) => cleanEntity(d.value));
  detected.push(...placeExtensions(text, places));
  // Earlier messages' values, so "Priya" stays masked even without context.
  detected.push(
    ...Object.values(initialMap).map((value) => ({ value, kind: "Person" as const })),
  );

  // Work on a copy so a dry run (a preview) leaves the real ledger untouched.
  const ledger = { ...initialMap };
  const replacements = new Map<string, string>();
  for (const { value, kind } of detected) {
    const realValue = cleanEntity(value);
    if (!realValue || TAG_PATTERN.test(realValue)) continue;
    const key = realValue.toLowerCase();
    if (replacements.has(key)) continue;

    let tag = findTagFor(realValue, ledger);
    if (!tag) {
      tag = nextTag(kind, ledger);
      ledger[tag] = realValue;
      if (!options.dryRun) usePrivacyStore.getState().addMapping(realValue, tag);
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
