export function resolvePersistenceFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}
