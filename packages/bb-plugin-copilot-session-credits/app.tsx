import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { createPortal } from "react-dom";
import { attachCreditTarget } from "./footer-placement.mjs";
import { definePluginApp, useComposer, useRpc, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Usage } from "./contract";
import { displayAic } from "./accounting.mjs";
import { creditDetails } from "./details-copy.mjs";
import { piInstallCommand, copyPiInstallCommand } from "./setup-copy.mjs";
import "./meter.css";
const supported = (provider: string) => ["pi", "acp-copilot", "acp-gh-copilot", "acp-github-copilot-cli"].includes(provider);
function useSessionCredits() {
  const view = useComposer(), threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const selectedProvider = view.selection?.providerId, selectedModel = view.selection?.model;
  const rpc = useRpc<typeof rpcContract>(), connection = useRealtimeConnectionState();
  const [state, setState] = useState<{ threadId: string; usage: Usage; provider: string; sessionId: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
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
  }, [threadId, rpc, connection, selectedProvider, selectedModel]);
  const current = state?.threadId === threadId ? state : null, usage = current?.usage;
  const hidden = !threadId || !!(current && current.provider !== "unknown" && !supported(current.provider));
  const stale = failed || connection !== "connected", details = creditDetails(usage, { stale, provider: current?.provider === "unknown" ? selectedProvider : current?.provider ?? selectedProvider, sessionId: current?.sessionId ?? null }), label = details.label;
  const providerLabel = current?.provider === "pi" ? (usage?.observed ? "Pi · Copilot" : "Pi") : current?.provider.startsWith("acp-") ? "Copilot CLI" : "Credits";
  return { view, current, usage, hidden, stale, label, providerLabel, details };
}
function CoinIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v5c0 1.7 2.7 3 6 3M3 11v5c0 1.7 2.7 3 6 3M15 8c3.3 0 6 1.3 6 3s-2.7 3-6 3-6-1.3-6-3 2.7-3 6-3Zm-6 3v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>;
}
function CreditControl({ placement = "toolbar" }: { placement?: "toolbar" | "compact" | "info-row" }) {
  const credits = useSessionCredits(), titleId = useId();
  const { usage, hidden, label, providerLabel, details } = credits;
  if (hidden) return null;
  const amount = displayAic(usage?.aic ?? null), description = `${usage?.source === "pi-receipts" ? "Observed" : "Session"} ${amount} AIC · ${label} · ${providerLabel}`;
  // React portal mouse events otherwise reach the composer handler that steals focus.
  return <Popover.Root modal={false}><Popover.Trigger asChild><button type="button" className={`copilot-session-credit-control copilot-session-credit-${placement}`} data-testid="copilot-session-credit-meter" data-placement={placement}
    title={description} aria-label={`Copilot session credits: ${amount} AIC, ${label}, ${providerLabel}`} aria-haspopup="dialog">
    <CoinIcon/><strong>{details.setup && usage?.aic == null ? "Set up credits" : <>{amount} <span>AIC</span></>}</strong><span className="copilot-session-credit-dot" data-state={label} data-tone={details.tone} aria-hidden="true"/>
  </button></Popover.Trigger><Popover.Portal><Popover.Content data-bb-plugin-root="" data-bb-plugin="copilot-session-credits" className="copilot-session-credit-panel" onMouseDown={event => event.stopPropagation()} side="top" align="end" sideOffset={8} collisionPadding={12} aria-labelledby={titleId}>
    <CreditDetails credits={credits} titleId={titleId}/>
  </Popover.Content></Popover.Portal></Popover.Root>;
}
function CreditPlacement({ compact = false }: { compact?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null), [target, setTarget] = useState<HTMLElement | null>();
  useEffect(() => attachCreditTarget(anchor.current, setTarget), []);
  return <><span hidden ref={anchor} data-copilot-session-credit-origin=""/>{target
    ? createPortal(<CreditControl placement="info-row"/>, target)
    : target === null ? <CreditControl placement={compact ? "compact" : "toolbar"}/> : null}</>;
}
function CreditToolbar() {
  return useComposer().layout === "compact" ? null : <CreditPlacement/>;
}
function CreditCompactFallback() {
  return useComposer().layout === "compact" ? <CreditPlacement compact/> : null;
}
function CreditDetails({ credits, titleId }: { credits: ReturnType<typeof useSessionCredits>; titleId: string }) {
  const { current, usage, label, providerLabel, details } = credits;
  const [copyMessage, setCopyMessage] = useState("");
  const unconfigured = details.setup && usage?.aic == null;
  return <section className="copilot-session-credit-details" data-testid="copilot-session-credit-details" data-tone={details.tone}>
    <header><h3 id={titleId}>Copilot session credits</h3><Popover.Close asChild><button type="button" aria-label="Close credit details">×</button></Popover.Close></header>
    {!unconfigured && <><div className="copilot-session-credit-total"><strong>{displayAic(usage?.aic ?? null)} AIC</strong><span className="copilot-session-credit-state" data-state={label}>{label}</span></div>
    <p className="copilot-session-credit-source">{providerLabel} · {usage?.source === "pi-receipts" ? "Observed subtotal" : usage?.source === "copilot-checkpoint" ? "Latest checkpoint" : "No captured amount"}</p>
    <p>{details.summary}</p>
    <p className="copilot-session-credit-scope">{details.scope}</p></>}
    {(details.notes.length > 0 || details.action) && <div className="copilot-session-credit-callout">
      {details.notes.map((note: string) => <p key={note}>{note}</p>)}
      {details.action && <p>{details.action}</p>}
    </div>}
    {details.setup && <section className="copilot-session-credit-setup" aria-label="Set up Pi credits">
      <h4>Pi collector not detected</h4>
      <p>If the companion is installed, restart this Pi session. Otherwise, install it below. Status updates automatically.</p>
      <code className="copilot-session-credit-install" tabIndex={0}>{piInstallCommand}</code>
      <div className="copilot-session-credit-setup-actions"><button type="button" onClick={async () => setCopyMessage(await copyPiInstallCommand())}>Copy install command</button></div>
      {copyMessage && <p role="status">{copyMessage}</p>}
      <p>Use Pi 1.5.0+ with Copilot signed in. Install on the machine running Pi.</p>
      <details><summary>Custom or remote setup</summary><p>Use the same Pi runtime and agent directory as BB. For remote threads, install on the execution host. Match PI_CODING_AGENT_DIR and any custom launcher configuration.</p></details>
    </section>}
    {!unconfigured && details.coverage && <p className="copilot-session-credit-coverage">{details.coverage}</p>}
    {!unconfigured && <details className="copilot-session-credit-debug">
      <summary>Details</summary>
      {usage?.aic != null && <p>Exact amount: <code>{usage.aic} AIC</code></p>}
      {usage?.source === "pi-receipts" && <p>{usage.reported} counted / {usage.observed} observed calls
        {usage.inFlight > 0 && <> · {usage.inFlight} unfinished</>}
        {usage.conflicting > 0 && <> · {usage.conflicting} invalid or conflicting</>}
        {usage.missing > 0 && <> · {usage.missing} without credits</>}</p>}
      {current?.provider === "pi" && usage?.readiness?.state !== "ready" && usage?.readiness?.reason && <p>Pi collector: {usage.readiness.reason}</p>}
      {usage?.updatedAt && <p>Last record: <time dateTime={usage.updatedAt}>{new Date(usage.updatedAt).toLocaleString(undefined, { timeZoneName: "short" })}</time></p>}
      {current?.sessionId && <code className="copilot-session-credit-session">{current.sessionId}</code>}
    </details>}
    {!unconfigured && <p className="copilot-session-credit-note">Provider usage. Not an invoice.</p>}
  </section>;
}
export default definePluginApp(app => {
  app.composer.customize({ id: "copilot-session-credits", scopes: ["thread"],
    actions: [{ id: "copilot-session-credits", component: CreditToolbar }],
    banners: [{ id: "copilot-session-credits-compact", chrome: "bare", component: CreditCompactFallback }],
  });
});
