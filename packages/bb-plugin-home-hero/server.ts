import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MAX_DISPLAY_NAME, validateIconDataUrl } from "./appearance.ts";
import { appearanceSchema, rpcContract } from "./contract.ts";

const ICON_ID = "icon";

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    displayName: {
      type: "string",
      label: "Greeting name",
      description: "Shown after the greeting. Leave blank to show only the time of day.",
      default: "",
      experimental_schema: z.string().max(MAX_DISPLAY_NAME),
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE IF NOT EXISTS appearance (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL)",
  ]);

  const readIcon = () => {
    const row = db.prepare("SELECT mime, bytes FROM appearance WHERE id = ?").get(ICON_ID) as
      | { mime: string; bytes: Uint8Array }
      | undefined;
    return row ? `data:${row.mime};base64,${Buffer.from(row.bytes).toString("base64")}` : null;
  };

  const appearance = async () => {
    const raw = (await settings.get()).displayName;
    return appearanceSchema.parse({
      displayName: typeof raw === "string" ? raw.trim().slice(0, MAX_DISPLAY_NAME) : "",
      iconDataUrl: readIcon(),
    });
  };

  bb.rpc.register(rpcContract, {
    getAppearance: appearance,
    setIcon: async ({ iconDataUrl }) => {
      // Throws on invalid uploads; the stored icon is left untouched.
      const valid = validateIconDataUrl(iconDataUrl);
      if (valid === null) {
        db.prepare("DELETE FROM appearance WHERE id = ?").run(ICON_ID);
      } else {
        const mime = valid.slice("data:".length, valid.indexOf(";base64"));
        const payload = valid.slice(valid.indexOf(";base64") + ";base64".length + 1);
        db.prepare(
          "INSERT INTO appearance (id, mime, bytes) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes",
        ).run(ICON_ID, mime, Buffer.from(payload, "base64"));
      }
      return appearance();
    },
  });
}
