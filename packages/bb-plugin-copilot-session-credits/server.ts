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
        if (!["pi", "acp-copilot", "acp-gh-copilot", "acp-github-copilot-cli", "acp-copilot-quiet", "acp-copilot-fm"].includes(provider)) return result(emptyUsage("Provider does not expose Copilot session credits"));
        const environment = "environment" in thread ? thread.environment : null;
        if (!environment?.hostId) return result(emptyUsage("Environment host unavailable.", ["host-unavailable"]));
        // Identity-only query: never fetch prompts, assistant messages or tool output.
        // Pi forks the provider session on message edit/rewind (`pi_<uuid>` -> `thr_<id>`), so read every identity.
        const events = await bb.sdk.threads.events.list({ threadId, types: ["thread/identity"], order: "desc", limit: "100" });
        const rows = events.filter(row => row.type === "thread/identity");
        if (!rows.length) return result(emptyUsage("Waiting for provider session identity"));
        const seq = Math.max(...rows.map(row => row.seq));
        const ids = new Set(rows.filter(row => row.seq === seq).map(row => row.data.providerThreadId));
        const parsed = ids.size === 1 ? sessionId.safeParse([...ids][0]) : null;
        if (!parsed?.success) return result(emptyUsage("Provider session identity missing or ambiguous"));
        identity = parsed.data;
        const history = [...new Set([...rows].sort((a, b) => a.seq - b.seq).map(row => sessionId.safeParse(row.data.providerThreadId)).filter(row => row.success).map(row => row.data))].slice(-32);
        const usage = provider === "pi"
          ? await host.call("read", { provider: "pi", sessionId: identity, sessionIds: history }, { hostId: environment.hostId })
          : await host.call("read", { provider: "copilot", sessionId: identity }, { hostId: environment.hostId });
        return result(usage);
      } catch { return result(emptyUsage("Host connection unavailable.", ["host-unavailable"])); }
    },
  });
}
