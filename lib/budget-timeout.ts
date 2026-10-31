/**
 * Running out of the request's model budget aborts the stream, which the page would take as a quiet stop: no reply,
 * no error, nothing to say what to do. This turns that abort into an error chunk, so the participant sees why and can
 * resubmit. An abort without a timeout (the participant stopped the request) passes through unchanged.
 */
export function reportBudgetTimeout<T extends { type: string }>(
  timeout: () => unknown,
  describe: (error: unknown) => string,
): TransformStream<T, T> {
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      const error = chunk.type === "abort" ? timeout() : undefined;
      controller.enqueue(error === undefined ? chunk : ({ type: "error", errorText: describe(error) } as unknown as T));
    },
  });
}
