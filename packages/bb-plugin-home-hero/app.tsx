import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountHomeHero } from "./hero-mount.mjs";
import { SettingsSection } from "./settings.tsx";

export default definePluginApp(app => {
  app.contentScripts.register({
    id: "home-hero",
    mount({ signal }) {
      return mountHomeHero({ signal });
    },
  });
  app.slots.settingsSection({ id: "appearance", component: SettingsSection });
});
