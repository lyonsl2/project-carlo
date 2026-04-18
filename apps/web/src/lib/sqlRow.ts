/**
 * Narrow sql.js column values into strict nullable primitives.  Both the SPA
 * (SqlValue-typed) and the prerender path (unknown-typed rows) share these
 * guards so row-mapping stays consistent.
 */
export function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
