export type TimeOfDay = "Morning" | "Afternoon" | "Evening";

export function greetingFor(hours: number): TimeOfDay {
  if (!Number.isFinite(hours) || hours < 12) return "Morning";
  if (hours < 17) return "Afternoon";
  return "Evening";
}

/** "Morning", "Afternoon, Alex" — no stray comma when the name is blank. */
export function formatGreeting(hours: number, displayName: string): string {
  const name = displayName.trim();
  return name ? `${greetingFor(hours)}, ${name}` : greetingFor(hours);
}
