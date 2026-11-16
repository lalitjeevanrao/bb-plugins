import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";


export const threadId = z.string().regex(/^thr_[a-zA-Z0-9_-]{1,100}$/);
// Pi sessions are BB bridge files: `pi_<uuid>` at start, `thr_<id>` after an edit/rewind fork. Copilot CLI uses a bare UUID.
export const sessionId = z.string().regex(/^((pi_)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|thr_[a-zA-Z0-9_-]{1,100})$/i);
export const isPiSession = (value: string) => /^(pi_|thr_)/.test(value);
export const readinessSchema = z.object({ state: z.enum(["unconfirmed", "ready", "unsupported", "error", "disabled"]), runtimeVersion: z.string().max(64).nullable(), reason: z.string().max(200) }).strict();
export const usageSchema = z.object({
  aic: z.string().regex(/^\d+(\.\d{1,9})?$/).nullable(),
  coverage: z.enum(["complete", "partial", "unknown", "unavailable"]),
  source: z.enum(["pi-receipts", "copilot-checkpoint", "none"]),
  readiness: readinessSchema.default({ state: "unconfirmed", runtimeVersion: null, reason: "Capture not confirmed." }),
  captureIssue: z.boolean().default(false),
  issues: z.array(z.enum(["collector-full", "allocation-busy", "stale-lock", "capture-damaged", "host-unavailable"])).max(5).default([]),
  reported: z.number().int().nonnegative(),
  observed: z.number().int().nonnegative(),
  inFlight: z.number().int().nonnegative(),
  conflicting: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
  reason: z.string().max(300),
}).strict();
export type Usage = z.infer<typeof usageSchema>;
export const emptyUsage = (reason: string, issues: Usage["issues"] = []): Usage => ({ aic: null, readiness: { state: "unconfirmed", runtimeVersion: null, reason }, captureIssue: false, issues, coverage: "unavailable", source: "none", reported: 0, observed: 0, inFlight: 0, conflicting: 0, missing: 0, updatedAt: null, reason });
export const hostContract = defineRpcContract({
  read: { input: z.object({ provider: z.enum(["pi", "copilot"]), sessionId, sessionIds: z.array(sessionId).max(32).optional() }).strict(), output: usageSchema, experimental_retryable: true },
});
export const rpcContract = defineRpcContract({
  usage: {
    input: z.object({ threadId }).strict(),
    output: usageSchema.extend({ threadId, provider: z.string(), sessionId: sessionId.nullable() }).strict(),
  },
});
