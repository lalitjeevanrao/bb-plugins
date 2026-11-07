# Pi receipt contract (schema 3)

The Pi extension writes these files; the BB plugin host reader consumes them. This is the single contract for both packages. If the schema changes, bump `schema` and update the writer and strict reader together.

## Location and permissions

- Directory: `~/.pi/agent/copilot-session-credits/` (owner-only `0700`, canonical path, owned by the reading user).
- One file per capture: `<epoch-uuid>.jsonl`, mode `0600`, regular single-link file, opened without following symlinks.
- Allocation lock: `.capture-lock/` (a directory created atomically).
- Cap: 256 entries (64 before `0.2.0`); new captures are refused when full. There is no prune command; use [stopped-Pi archival](cleanup.md). Per file: 1 MiB, 10,000 records, with an explicit `capture_truncated` row.

## Records

One JSON object per line. Every row carries:

| Field | Meaning |
| --- | --- |
| `schema` | `3` |
| `seq` | 1, 2, 3 … contiguous within the file; a gap invalidates the file |
| `kind` | see below |
| `at` | ISO timestamp |
| `epoch` | capture UUID; must equal the file name |
| `nativeSessionHash` | SHA-256 hex of `"pi-session-v2" + NUL + lowercase native Pi session UUID` |
| `providerSession` | BB provider session `pi_<uuid>`, taken from the Pi session file name; `null` for non-BB Pi sessions (BB never reads those) |
| `coverage` | always `provider-wrapper-partial` |

Kinds: `capture_started`, `call_started`, `observation`, `call_finished`, `capture_checkpoint`, `capture_status`, `capture_stopped`, `capture_truncated`.

- `call_started` / `observation` / `call_finished` share a random `callId` per **logical native-provider invocation** (not a physical HTTP attempt).
- `observation.billing` is an array of scalar candidates, each with a `path` (the JSON path of the `total_nano_aiu` field): `{ path, nanoAiu: "<canonical integer string>", valueType: "string" | "number" }` for a valid amount, `{ path, invalid: true }` for a malformed one, or `{ path, missingAmount: true }` when a billing object lacked the field. Repeated or revised snapshots for one `callId` are **never summed**.
- `capture_started` carries `missedCalls` (calls skipped before this capture opened, e.g. lock contention). `capture_stopped`, `capture_checkpoint` and `capture_status` carry `inFlight`, `dropped`, `rawEvents`, `amountObservations`. Non-zero `missedCalls`, `dropped` or a stop with `inFlight > 0` mean incomplete evidence.
- Never written: prompts, responses, thinking, tool data, headers, credentials, raw response IDs, absolute paths.

## What the reader enforces

First row must be `capture_started` with `schema 3`, matching `providerSession`, `epoch + ".jsonl" == file name`, and a 64-hex `nativeSessionHash`. Every later row must repeat the same identity and `seq == index + 1`. More than one distinct `nativeSessionHash` for one provider session → refused as ambiguous. A truncated capture, `dropped > 0`, `missedCalls > 0` or a stop with `inFlight > 0` marks the result as having a capture issue (*Missing data*). Reader budget: 8 MiB of matching records, 1 MiB per file, 256 KiB per line.

## Copilot CLI (read only, not written by us)

`~/.copilot/session-state/<session-uuid>/events.jsonl`: latest complete line with `type == "session.usage_checkpoint"`; fields used: `data.totalNanoAiu`, `data.accountingSnapshot.aiCreditsStatus`, `timestamp`.
