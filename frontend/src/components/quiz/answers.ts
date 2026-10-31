/** Comparison form of an answer: lower-case letters and digits only. */
export const normalizeAnswer = (answer: string): string =>
  String(answer).trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export const sameAnswer = (a: string | undefined | null, b: string | undefined | null): boolean =>
  a != null && b != null && normalizeAnswer(a) === normalizeAnswer(b);
