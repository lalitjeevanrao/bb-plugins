import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract, hostContract, sessionId, emptyUsage } from "./contract";
export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.rpc.register(rpcContract, {
    usage: async ({ threadId }) => {
      let provider = "unknown", identity: string | null = null;
      const result = (value: ReturnType<typeof emptyUsage>) => ({ ...value, threadId, provider, sessionId: identity });
      try {
        const thread = await bb.sdk.threads.get({ threadId, include: "environment" });
        provider = thread.providerId;
        if (!["pi", "acp-copilot", "acp-gh-copilot"].includes(provider)) return result(emptyUsage("Provider does not expose Copilot session credits"));
        const environment = "environment" in thread ? thread.environment : null;
        if (!environment?.hostId) return result(emptyUsage("Environment host unavailable.", ["host-unavailable"]));
        // Identity-only query: never fetch prompts, assistant messages or tool output.
        const events = await bb.sdk.threads.events.list({ threadId, types: ["thread/identity"], order: "desc", limit: "2" });
        const latest = events.filter(row => row.type === "thread/identity");
        if (!latest.length) return result(emptyUsage("Waiting for provider session identity"));
        const seq = Math.max(...latest.map(row => row.seq));
        const ids = new Set(latest.filter(row => row.seq === seq).map(row => row.data.providerThreadId));
        const parsed = ids.size === 1 ? sessionId.safeParse([...ids][0]) : null;
        if (!parsed?.success) return result(emptyUsage("Provider session identity missing or ambiguous"));
        identity = parsed.data;
        const usage = await host.call("read", { provider: provider === "pi" ? "pi" : "copilot", sessionId: identity }, { hostId: environment.hostId });
        return result(usage);
      } catch { return result(emptyUsage("Host connection unavailable.", ["host-unavailable"])); }
    },
  });
}
