import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountComposerAutocollapse } from "./mount.mjs";

export default definePluginApp(app => {
  app.contentScripts.register({
    id: "composer-autocollapse",
    mount({ signal }) {
      return mountComposerAutocollapse({ signal });
    },
  });
});
