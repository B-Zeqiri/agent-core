const DEFAULT_MAX_LENGTH = 20000;

export function safeJson(value: unknown, maxLength: number = DEFAULT_MAX_LENGTH): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    text = JSON.stringify({ error: "Serialization failed", message: String(error) });
  }

  if (text.length > maxLength) {
    return text.slice(0, maxLength) + "...";
  }

  return text;
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  if (typeof raw !== "string") {
    return raw as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
