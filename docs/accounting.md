# Accounting contract

- Amounts are validated non-negative integer **nano-AIU** strings handled as `BigInt`. **AIC = nano-AIU / 1,000,000,000.** No floating-point money maths.
- Control: four decimals. Details: full exact amount. Tiny positive: `<0.0001`. Missing: `—`, never `0`. A real zero needs supporting data; a legacy CLI zero without coverage metadata is not proof of a free session.

## Pi — "Observed subtotal"

`piUsage(records)` counts a completed logical invocation (one `callId`) only when it has **exactly one distinct valid billing amount**:

- identical repeated snapshots for one call → counted once;
- repeated starts/finishes → ambiguous, excluded;
- conflicting or invalid values → excluded and counted;
- completed without credits → excluded and counted;
- unfinished → excluded and counted as in flight;
- known capture loss or limits → explicit `captureIssue`.

`coverage` stays `partial`. Equal repeated values cannot prove whether an unobserved retry incurred another identical charge, so there is no summing of snapshots and no "complete" claim.

## Copilot CLI — "Session usage"

Latest cumulative checkpoint, once. Coverage `complete | partial | unavailable | unknown` comes only from `accountingSnapshot.aiCreditsStatus`. Even `complete` is not invoice reconciliation. Never add checkpoints; never add internal subagents again.

## Recording state vs billing coverage

The dot shows recording state (see the README table); the details keep the coverage caveat. This split exists because a permanent "Partial" label on healthy activity confused users.

## Out of scope

Account quotas or balances, token-to-price estimates, model probes, historical backfill, tree aggregation, invoice reconciliation.
