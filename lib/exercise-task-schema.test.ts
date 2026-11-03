import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { feedbackSchema, turnSchema } from "@/lib/exercise-contracts";
import { exerciseTurnCandidateSchema } from "@/lib/exercise-turn-validation";
import { LocalExerciseService } from "@/lib/local-exercise-service";

const properties = z.record(z.string(), z.object({
  description: z.string().optional(), maxItems: z.number().optional(),
}));

describe("published generation schema guidance", () => {
  it("preserves every controller field description when adding strict acceptance bounds", () => {
    const original = z.toJSONSchema(turnSchema);
    const bounded = z.toJSONSchema(exerciseTurnCandidateSchema);
    const originalFields = properties.parse(original.properties);
    const boundedFields = properties.parse(bounded.properties);
    for (const [field, schema] of Object.entries(originalFields)) {
      expect(boundedFields[field].description, field).toBe(schema.description);
    }
    const feedback = exerciseTurnCandidateSchema.shape.feedback.unwrap();
    for (const field of ["covered", "consider", "why"] as const) {
      expect(feedback.shape[field].description).toBe(feedbackSchema.shape[field].description);
    }
    expect(bounded.additionalProperties).toBe(false);
    expect(boundedFields.response_options.maxItems).toBe(4);
    expect(boundedFields.suggested_actions.maxItems).toBe(2);
  });

  it("publishes ongoing and completed choice requirements in the actual generation task", () => {
    const service = new LocalExerciseService(":memory:");
    try {
      const owner = randomUUID();
      const session = service.createApprovedSession(owner, { id: randomUUID(), text: "Approved fictional household." });
      const task = service.getGenerationTask(session.sessionId, owner);
      const field = properties.parse(task.outputSchema.properties).response_options;
      expect(field.description).toBe(turnSchema.shape.response_options.description);
      expect(field.description).toContain("Three or four");
      expect(field.description).toContain("Empty once the exercise is complete.");
      expect(field.maxItems).toBe(4);
    } finally { service.close(); }
  });
});
