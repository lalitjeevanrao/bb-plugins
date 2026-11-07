import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const settingsSchema = z.object({
  focusOutCollapse: z.boolean(),
  focusOutDelayMs: z.number().int().min(0).max(2000),
  idleCollapse: z.boolean(),
  idleSeconds: z.number().int().min(5).max(3600),
  idleEmptyDraft: z.boolean(),
  idleHiddenTab: z.boolean(),
}).strict();

export const rpcContract = defineRpcContract({
  getSettings: { input: z.null(), output: settingsSchema },
});
