export const DEFAULT_KNOBS = {
  focusOutCollapse: true,
  focusOutDelayMs: 120,
  idleCollapse: true,
  idleSeconds: 60,
  idleEmptyDraft: true,
  idleHiddenTab: true,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

/** Accept partial or malformed settings without ever leaving a knob undefined. */
export function normalizeKnobs(value) {
  const source = value && typeof value === 'object' ? value : {};
  const bool = key => (typeof source[key] === 'boolean' ? source[key] : DEFAULT_KNOBS[key]);
  const number = (key, min, max) => (Number.isFinite(source[key]) ? clamp(source[key], min, max) : DEFAULT_KNOBS[key]);
  return {
    focusOutCollapse: bool('focusOutCollapse'),
    focusOutDelayMs: number('focusOutDelayMs', 0, 2000),
    idleCollapse: bool('idleCollapse'),
    idleSeconds: number('idleSeconds', 5, 3600),
    idleEmptyDraft: bool('idleEmptyDraft'),
    idleHiddenTab: bool('idleHiddenTab'),
  };
}

export function shouldCollapseOnFocusOut({ knobs, focusInsideComposer, focusInPortal }) {
  return knobs.focusOutCollapse && !focusInsideComposer && !focusInPortal;
}

export function shouldCollapseWhenIdle({ knobs, idleMs, draftEmpty, hidden, focusedInside }) {
  if (!knobs.idleCollapse || !focusedInside) return false;
  if (idleMs < knobs.idleSeconds * 1000) return false;
  return (knobs.idleEmptyDraft && draftEmpty) || (knobs.idleHiddenTab && hidden);
}
