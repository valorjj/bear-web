/**
 * Isolated behind a function so tests can stub identifier generation and so a
 * fallback can be swapped in if a target browser lacks `crypto.randomUUID`.
 */
export function newId(): string {
  return crypto.randomUUID();
}
