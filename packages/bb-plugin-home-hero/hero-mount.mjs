import { chooseGreeting, greetingFor } from "./greeting.ts";
import { applyHero, findColumn, HERO_ID } from "./hero.mjs";

export const APPEARANCE_PATH = "/api/v1/plugins/home-hero/rpc/getAppearance";
const REFRESH_MS = 30_000;
// Own DOM writes also fire the observer; coalescing keeps that a single no-op pass.
const RECONCILE_MS = 50;

async function fetchAppearance() {
  const response = await fetch(APPEARANCE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  if (!response.ok) throw new Error(`Appearance request failed (${response.status})`);
  const payload = await response.json();
  // The HTTP RPC endpoint wraps results; in-app `rpc.call` does this unwrapping.
  return payload?.result ?? payload;
}

/**
 * Content-script entry. The hero is not route-scoped, so it reconciles with the
 * live page: it appears when a home composer target shows up, follows a new
 * target, is removed when the target (or the hero) disappears, and is disposed
 * with the host's abort signal.
 * @param {object} options
 * @param {AbortSignal} [options.signal]
 * @param {Document} [options.document]
 * @param {() => Promise<Partial<import("./contract.ts").Appearance>>} [options.getAppearance]
 * @param {number} [options.pollMs]
 */
export function mountHomeHero({
  signal,
  document: doc = globalThis.document,
  getAppearance = fetchAppearance,
  pollMs = REFRESH_MS,
} = {}) {
  let appearance = {};
  let appliedKey = null;
  let appliedColumn = null;
  let homeColumn = null;
  let homePath;
  let greeting;
  let pendingHomeAppearance = false;
  let requestVersion = 0;
  let disposeHero = () => {};
  let disposed = false;
  let timer = 0;
  let pollTimer = 0;
  let sweepTimer = 0;

  const clearHero = () => {
    disposeHero();
    disposeHero = () => {};
    appliedKey = null;
    appliedColumn = null;
  };

  const reconcile = (refresh = true) => {
    if (disposed) return;
    const column = findColumn(doc);
    if (!column) {
      // Not on a home surface: no hero and no hero styling.
      homeColumn = null;
      clearHero();
      return;
    }
    const path = doc.location?.pathname;
    const hours = new Date().getHours();
    if (column !== homeColumn || path !== homePath) {
      homeColumn = column;
      homePath = path;
      greeting = chooseGreeting(hours, greeting);
      if (refresh) {
        // Settings may have changed while Home was closed.
        pendingHomeAppearance = true;
        clearHero();
        void load();
        return;
      }
    }
    if (pendingHomeAppearance) return;
    const displayName = appearance.displayName ?? "";
    const iconDataUrl = appearance.iconDataUrl ?? null;
    const label = appearance.randomizeGreeting === false ? greetingFor(hours) : greeting.label;
    const fontFamily = appearance.randomizeFont === false ? undefined : greeting.fontFamily;
    const effect = appearance.animateGreeting === false ? null : greeting.effect;
    const key = JSON.stringify([displayName, iconDataUrl, label, fontFamily, effect]);
    const hero = doc.getElementById(HERO_ID);
    if (appliedKey === key && hero && appliedColumn === column && column.contains(hero)) return;
    clearHero();
    disposeHero = applyHero(doc, {
      displayName,
      iconDataUrl,
      label,
      fontFamily,
      effect,
      reducedMotion: doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    });
    // Only a hero that actually landed counts as applied.
    if (doc.getElementById(HERO_ID)) {
      appliedKey = key;
      appliedColumn = column;
    }
  };

  const schedule = () => {
    if (disposed || timer) return;
    timer = setTimeout(() => {
      timer = 0;
      reconcile();
    }, RECONCILE_MS);
  };

  const load = async () => {
    const request = ++requestVersion;
    try {
      const result = await getAppearance();
      if (!disposed && request === requestVersion) appearance = result ?? {};
    } catch {
      // Use the cached appearance if the request fails. The next poll retries.
    }
    if (disposed || request !== requestVersion) return;
    pendingHomeAppearance = false;
    reconcile(false);
  };

  const onVisible = () => {
    if (doc.visibilityState === "visible") void load();
  };

  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  const observer = Observer === undefined ? null : new Observer(schedule);

  const cleanup = () => {
    disposed = true;
    clearTimeout(timer);
    timer = 0;
    observer?.disconnect();
    doc.removeEventListener("visibilitychange", onVisible);
    clearInterval(pollTimer);
    clearInterval(sweepTimer);
    clearHero();
  };

  if (signal?.aborted) return cleanup;

  void load();
  pollTimer = setInterval(() => void load(), pollMs);
  // The app shell can swap whole subtrees during routing; the observer plus this
  // cheap sweep keep a new home target from being missed. Both are cleared on cleanup.
  sweepTimer = setInterval(reconcile, 2_000);
  doc.addEventListener("visibilitychange", onVisible);
  observer?.observe(doc.documentElement, { childList: true, subtree: true });
  signal?.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
