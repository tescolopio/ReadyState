/** Truncate display only, so a value just below a target never appears to meet it. */
export function waterDisplay(value: number, digits = 3): string {
  if (value > 0 && value < 10 ** -digits) return `less than ${10 ** -digits}`;
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits, useGrouping: false, roundingMode: "floor",
  });
}

export function waterInput(value: number | undefined): string {
  if (value === undefined) return "";
  return value > 0 && value < 0.001
    ? value.toLocaleString("en-US", { notation: "scientific", maximumFractionDigits: 2, roundingMode: "floor", useGrouping: false })
    : waterDisplay(value);
}
