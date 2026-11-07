import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract, settingsSchema } from "./contract";
import { DEFAULT_KNOBS } from "./policy.mjs";

const delaySchema = z.number().int().min(0).max(2000);
const idleSchema = z.number().int().min(5).max(3600);

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    focusOutCollapse: { type: "boolean", label: "Collapse when focus leaves", description: "Collapse the composer after focus moves outside it.", default: DEFAULT_KNOBS.focusOutCollapse },
    focusOutDelayMs: { type: "number", label: "Focus-out delay (ms)", description: "How long to wait after focus leaves. 0–2000 ms.", default: DEFAULT_KNOBS.focusOutDelayMs, experimental_schema: delaySchema },
    idleCollapse: { type: "boolean", label: "Collapse when idle", description: "Collapse the composer after it sits idle while focused.", default: DEFAULT_KNOBS.idleCollapse },
    idleSeconds: { type: "number", label: "Idle timeout (seconds)", description: "How long the composer must sit idle. 5–3600 s.", default: DEFAULT_KNOBS.idleSeconds, experimental_schema: idleSchema },
    idleEmptyDraft: { type: "boolean", label: "Idle collapse with an empty draft", description: "Only collapse on idle when the draft is empty.", default: DEFAULT_KNOBS.idleEmptyDraft },
    idleHiddenTab: { type: "boolean", label: "Idle collapse in a background tab", description: "Also collapse when the BB tab is hidden.", default: DEFAULT_KNOBS.idleHiddenTab },
  });
  bb.rpc.register(rpcContract, { getSettings: async () => settingsSchema.parse(await settings.get()) });
}
