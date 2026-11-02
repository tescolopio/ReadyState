import { describe, expect, it } from "vitest";

import { unmaskSavedText } from "@/lib/local-records";

describe("saved privacy output", () => {
  it("unmasks exact privacy tags without consuming surrounding JSON array brackets", () => {
    const serialized = JSON.stringify({ went_well: ["[Person 1] checked supplies"] });
    expect(unmaskSavedText(serialized, { "[Person 1]": "Synthetic Person" }))
      .toBe('{"went_well":["Synthetic Person checked supplies"]}');
  });
});
