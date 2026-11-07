import { useEffect, useState } from "react";
import { definePluginApp, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { MAX_DISPLAY_NAME } from "./appearance.ts";
import { rpcContract } from "./contract.ts";
import { applyHero } from "./hero.mjs";
import { SettingsSection } from "./settings.tsx";

const REFRESH_MS = 30_000;
const ATTACH_RETRY_MS = 150;
const ATTACH_ATTEMPTS = 20;

function HomeHero() {
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  const rawName = values?.displayName;
  const displayName = typeof rawName === "string" ? rawName.trim().slice(0, MAX_DISPLAY_NAME) : "";
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      rpc
        .call("getAppearance")
        .then(appearance => {
          if (live) setIconDataUrl(appearance.iconDataUrl);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [rpc]);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reducedMotion = query?.matches ?? false;
    let dispose = () => {};
    let timer = 0;
    let attempts = 0;
    const attach = () => {
      const cleanup = applyHero(document, { displayName, iconDataUrl, reducedMotion });
      if (document.getElementById("bb-hero")) {
        dispose = cleanup;
        return;
      }
      cleanup();
      if (++attempts < ATTACH_ATTEMPTS) timer = window.setTimeout(attach, ATTACH_RETRY_MS);
    };
    attach();
    return () => {
      clearTimeout(timer);
      dispose();
    };
  }, [displayName, iconDataUrl]);

  return null;
}

export default definePluginApp(app => {
  app.slots.homepageSection({ id: "hero", title: "Home hero", component: HomeHero });
  app.slots.settingsSection({ id: "appearance", title: "Home hero icon", component: SettingsSection });
});
