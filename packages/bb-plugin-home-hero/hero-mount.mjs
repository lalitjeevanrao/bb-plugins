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
 * @param {() => Promise<{displayName?: string, iconDataUrl?: string | null}>} [options.getAppearance]
 * @param {number} [options.pollMs]
 */
export function mountHomeHero({
  signal,
  document: doc = globalThis.document,
  getAppearance = fetchAppearance,
  pollMs = REFRESH_MS,
} = {}) {
  let appearance = { displayName: "", iconDataUrl: null };
  let appliedKey = null;
  let appliedColumn = null;
  let loadedColumn = null;
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

  const reconcile = () => {
    if (disposed) return;
    const column = findColumn(doc);
    if (!column) {
      // Not on a home surface: no hero and no hero styling.
      clearHero();
      return;
    }
    if (column !== loadedColumn) {
      // A new home surface shows the cached appearance at once and re-reads it.
      loadedColumn = column;
      void load();
    }
    const key = JSON.stringify([appearance.displayName ?? "", appearance.iconDataUrl ?? null]);
    const hero = doc.getElementById(HERO_ID);
    if (appliedKey === key && hero && appliedColumn === column && column.contains(hero)) return;
    clearHero();
    disposeHero = applyHero(doc, {
      displayName: appearance.displayName ?? "",
      iconDataUrl: appearance.iconDataUrl ?? null,
      reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
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
    try {
      appearance = (await getAppearance()) ?? { displayName: "", iconDataUrl: null };
    } catch {
      return; // keep the current hero; the next poll retries
    }
    loadedColumn = findColumn(doc);
    reconcile();
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
    clearTimeout(pollTimer);
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
