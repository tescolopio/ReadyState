import { describe, expect, it } from "vitest";

import { reportBudgetTimeout } from "@/lib/budget-timeout";

type Chunk = { type: "start" } | { type: "abort" } | { type: "error"; errorText: string };

const run = async (chunks: Chunk[], timeout: () => unknown) => {
  const out: Chunk[] = [];
  const stream = new ReadableStream<Chunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }).pipeThrough(reportBudgetTimeout<Chunk>(timeout, () => "The model took too long to respond."));
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) out.push(next.value);
  return out;
};

describe("reportBudgetTimeout", () => {
  it("turns an abort caused by the budget into an error the page shows", async () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    expect(await run([{ type: "start" }, { type: "abort" }], () => timeout)).toEqual([
      { type: "start" },
      { type: "error", errorText: "The model took too long to respond." },
    ]);
  });

  it("leaves an abort the participant chose as an abort", async () => {
    expect(await run([{ type: "start" }, { type: "abort" }], () => undefined)).toEqual([{ type: "start" }, { type: "abort" }]);
  });
});
