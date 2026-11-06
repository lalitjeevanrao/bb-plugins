import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { attachCreditTarget } from "./footer-placement.mjs";
import { definePluginApp, useComposer, useRpc, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Usage } from "./contract";
import { displayAic } from "./accounting.mjs";
import { creditDetails } from "./details-copy.mjs";
import { piInstallCommand, copyPiInstallCommand } from "./setup-copy.mjs";
import "./meter.css";
const supported = (provider: string) => ["pi", "acp-copilot", "acp-gh-copilot"].includes(provider);
const popupId = "session-credit-details";
function useSessionCredits() {
  const view = useComposer(), threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const selectedProvider = view.selection?.providerId, selectedModel = view.selection?.model;
  const rpc = useRpc<typeof rpcContract>(), connection = useRealtimeConnectionState();
  const [state, setState] = useState<{ threadId: string; usage: Usage; provider: string; sessionId: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setFailed(false);
    if (!threadId) return;
    let alive = true, busy = false;
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const value = await rpc.call("usage", { threadId });
        if (alive) {
          setState({ threadId, usage: value, provider: value.provider, sessionId: value.sessionId }); setFailed(false);
        }
      } catch { if (alive) setFailed(true); } finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [threadId, rpc, connection, selectedProvider, selectedModel, retry]);
  const current = state?.threadId === threadId ? state : null, usage = current?.usage;
  const hidden = !threadId || !!(current && current.provider !== "unknown" && !supported(current.provider));
  const stale = failed || connection !== "connected", details = creditDetails(usage, { stale, provider: current?.provider === "unknown" ? selectedProvider : current?.provider ?? selectedProvider, sessionId: current?.sessionId ?? null }), label = details.label;
  const providerLabel = current?.provider === "pi" ? (usage?.observed ? "Pi · Copilot" : "Pi") : current?.provider.startsWith("acp-") ? "Copilot CLI" : "Credits";
  return { view, current, usage, hidden, stale, label, providerLabel, details, refresh: () => setRetry(value => value + 1) };
}
function CoinIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v5c0 1.7 2.7 3 6 3M3 11v5c0 1.7 2.7 3 6 3M15 8c3.3 0 6 1.3 6 3s-2.7 3-6 3-6-1.3-6-3 2.7-3 6-3Zm-6 3v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>;
}
function CreditControl({ placement = "toolbar" }: { placement?: "toolbar" | "compact" | "info-row" }) {
  const { view, usage, hidden, label, providerLabel, details } = useSessionCredits();
  if (hidden) return null;
  const amount = displayAic(usage?.aic ?? null), description = `${usage?.source === "pi-receipts" ? "Observed" : "Session"} ${amount} AIC · ${label} · ${providerLabel}`;
  return <button type="button" className={`session-credit-control session-credit-${placement}`} data-testid="session-credit-meter" data-placement={placement}
    title={description} aria-label={`Copilot session credits: ${amount} AIC, ${label}, ${providerLabel}`} aria-haspopup="dialog"
    onClick={() => view.experimental_openPopup(popupId)}>
    <CoinIcon/><strong>{details.setup && usage?.aic == null ? "Set up credits" : <>{amount} <span>AIC</span></>}</strong><span className="session-credit-dot" data-state={label} data-tone={details.tone} aria-hidden="true"/>
  </button>;
}
function CreditPlacement({ compact = false }: { compact?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null), [target, setTarget] = useState<HTMLElement | null>();
  useEffect(() => attachCreditTarget(anchor.current, setTarget), []);
  return <><span hidden ref={anchor} data-session-credit-origin=""/>{target
    ? createPortal(<CreditControl placement="info-row"/>, target)
    : target === null ? <CreditControl placement={compact ? "compact" : "toolbar"}/> : null}</>;
}
function CreditToolbar() {
  return useComposer().layout === "compact" ? null : <CreditPlacement/>;
}
function CreditCompactFallback() {
  return useComposer().layout === "compact" ? <CreditPlacement compact/> : null;
}
function CreditDetails() {
  const { view, current, usage, hidden, label, providerLabel, details, refresh } = useSessionCredits();
  const [copyMessage, setCopyMessage] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => {
    if (hidden) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [hidden]);
  if (hidden) return null;
  return <dialog ref={dialogRef} className="session-credit-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); view.experimental_closePopup(); }}><section className="session-credit-details" data-testid="session-credit-details" data-tone={details.tone}>
    <header><h3 id={titleId}>Copilot session credits</h3><button type="button" aria-label="Close credit details" onClick={() => view.experimental_closePopup()}>×</button></header>
    <div className="session-credit-total"><strong>{displayAic(usage?.aic ?? null)} AIC</strong><span className="session-credit-state" data-state={label}>{label}</span></div>
    <p className="session-credit-source">{providerLabel} · {usage?.source === "pi-receipts" ? "Observed subtotal" : usage?.source === "copilot-checkpoint" ? "Latest checkpoint" : "No captured amount"}</p>
    <p>{details.summary}</p>
    <p className="session-credit-scope">{details.scope}</p>
    {(details.notes.length > 0 || details.action) && <div className="session-credit-callout">
      {details.notes.map((note: string) => <p key={note}>{note}</p>)}
      {details.action && <p>{details.action}</p>}
    </div>}
    {details.setup && <section className="session-credit-setup" aria-label="Set up Pi credits">
      <h4>Set up Pi credits</h4>
      <p>Add the companion extension on the machine running this Pi session.</p>
      <code className="session-credit-install" tabIndex={0}>{piInstallCommand}</code>
      <div className="session-credit-setup-actions"><button type="button" onClick={async () => setCopyMessage(await copyPiInstallCommand())}>Copy install command</button><button type="button" onClick={refresh}>Retry check</button></div>
      {copyMessage && <p role="status">{copyMessage}</p>}
      <p>Use Pi 1.5.0+ with Copilot signed in. Reload or restart this session after installing.</p>
      <details><summary>Custom or remote setup</summary><p>Install on the execution host, using the same Pi runtime and agent directory as BB. Match PI_CODING_AGENT_DIR and any custom launcher configuration, then retry here.</p></details>
    </section>}
    {details.coverage && <p className="session-credit-coverage">{details.coverage}</p>}
    <details className="session-credit-debug">
      <summary>Details</summary>
      {usage?.aic != null && <p>Exact amount: <code>{usage.aic} AIC</code></p>}
      {usage?.source === "pi-receipts" && <p>{usage.reported} counted / {usage.observed} observed calls
        {usage.inFlight > 0 && <> · {usage.inFlight} unfinished</>}
        {usage.conflicting > 0 && <> · {usage.conflicting} invalid or conflicting</>}
        {usage.missing > 0 && <> · {usage.missing} without credits</>}</p>}
      {usage?.updatedAt && <p>Last record: <time dateTime={usage.updatedAt}>{new Date(usage.updatedAt).toLocaleString(undefined, { timeZoneName: "short" })}</time></p>}
      {current?.sessionId && <code className="session-credit-session">{current.sessionId}</code>}
    </details>
    <p className="session-credit-note">Provider usage. Not an invoice.</p>
  </section></dialog>;
}
export default definePluginApp(app => {
  app.composer.customize({ id: "session-credits", scopes: ["thread"],
    actions: [{ id: "session-credits", component: CreditToolbar }],
    banners: [{ id: "session-credits-compact", chrome: "bare", component: CreditCompactFallback }],
    experimental_popups: [{ id: popupId, label: "Copilot session credits", component: CreditDetails }],
  });
});
