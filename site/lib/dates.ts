/** Postgres timestamps come back from the driver as Date objects, sometimes as strings. */
export function dayOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return "";
}
