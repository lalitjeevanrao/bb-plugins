export type TimeOfDay = "Morning" | "Afternoon" | "Evening";

const GREETINGS = [
  "Hello",
  "Hi",
  "Hey",
  "Hello there",
  "Hi there",
  "Hey there",
  "Welcome",
  "Welcome back",
  "Good to see you",
  "Nice to see you",
  "Glad you're here",
  "Good to have you here",
  "Howdy",
  "Greetings",
  "Salutations",
  "Let's get started",
  "Ready when you are",
  "Make yourself at home",
  "Yo",
  "Sup",
  "What's good",
  "Heyo",
  "G'day",
  "What's cookin'",
];

export const DEFAULT_GREETING_FONT = "Palatino, 'Palatino Linotype', 'Book Antiqua', 'DejaVu Serif', serif";
const GREETING_FONTS = [
  DEFAULT_GREETING_FONT,
  "Georgia, 'Noto Serif', 'Liberation Serif', serif",
  "system-ui, sans-serif",
  "'Trebuchet MS', 'Verdana', 'Liberation Sans', sans-serif",
  "'Courier New', 'Liberation Mono', monospace",
];

const GREETING_EFFECTS = [
  "typewriter",
  "fade",
  "rise",
  "slide",
  "pop",
  "settle",
  "focus",
  "wipe",
  "unfold",
  "flip",
  "swing",
];

export function greetingFor(hours: number): TimeOfDay {
  if (!Number.isFinite(hours) || hours < 12) return "Morning";
  if (hours < 17) return "Afternoon";
  return "Evening";
}

/** "Morning", "Afternoon, Alex" — no stray comma when the name is blank. */
export function formatGreeting(hours: number, displayName: string, label: string = greetingFor(hours)): string {
  const name = displayName.trim();
  return name ? `${label}, ${name}` : label;
}

function chooseDifferent(choices: readonly string[], previous?: string): string {
  const available = choices.filter(choice => choice !== previous);
  return available[Math.floor(Math.random() * available.length)];
}

export function chooseGreeting(hours: number, previous?: { label: string; fontFamily: string; effect: string }) {
  const timeOfDay = greetingFor(hours);
  return {
    label: chooseDifferent([...GREETINGS, timeOfDay, `Good ${timeOfDay.toLowerCase()}`], previous?.label),
    fontFamily: chooseDifferent(GREETING_FONTS, previous?.fontFamily),
    effect: chooseDifferent(GREETING_EFFECTS, previous?.effect),
  };
}
