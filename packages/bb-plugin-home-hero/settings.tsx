import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { MAX_ICON_BYTES, validateIconDataUrl } from "./appearance.ts";
import { rpcContract } from "./contract.ts";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/** Let the browser decode the file before it reaches the server, so a broken image never replaces a good icon. */
async function ensureDecodable(file: File) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("That image could not be decoded."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

export function SettingsSection() {
  const rpc = useRpc<typeof rpcContract>();
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    rpc
      .call("getAppearance")
      .then(appearance => {
        if (live) setIconDataUrl(appearance.iconDataUrl);
      })
      .catch(() => {
        if (live) setStatus({ kind: "error", message: "Could not load the current icon." });
      });
    return () => {
      live = false;
    };
  }, [rpc]);

  const save = async (value: string | null) => {
    setBusy(true);
    setStatus({ kind: "saving" });
    try {
      const appearance = await rpc.call("setIcon", { iconDataUrl: value });
      setIconDataUrl(appearance.iconDataUrl);
      setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the icon.",
      });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ICON_BYTES) {
      setStatus({ kind: "error", message: "Icon must be 256 KiB or smaller." });
      return;
    }
    try {
      await ensureDecodable(file);
      await save(validateIconDataUrl(await readFile(file)));
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the icon.",
      });
    }
  };

  return (
    <div className="bb-hero-settings">
      <p>
        Upload a PNG, JPEG or WebP image up to 256 KiB. It is stored with this plugin on your machine
        and never committed to the repository. Leave it blank to show the greeting without an icon.
      </p>
      {iconDataUrl ? (
        <img className="bb-hero-icon" alt="" src={iconDataUrl} width={52} height={52} />
      ) : null}
      <div className="bb-hero-actions" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.75rem" }}>
        <label style={{ cursor: busy ? "default" : "pointer", fontWeight: 600, border: "1px solid currentColor", borderRadius: "0.5rem", padding: "0.25rem 0.75rem", opacity: busy ? 0.6 : 1 }}>
          {iconDataUrl ? "Replace icon" : "Upload icon"}
          <input
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={event => {
              void upload(event.target.files?.[0]);
              event.target.value = "";
            }}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            type="file"
          />
        </label>
        {iconDataUrl ? (
          <button disabled={busy} onClick={() => void save(null)} type="button">
            Remove icon
          </button>
        ) : null}
      </div>
      <p aria-live="polite" role="status">
        {status.kind === "saving"
          ? "Saving…"
          : status.kind === "saved"
            ? "Icon saved."
            : status.kind === "error"
              ? status.message
              : ""}
      </p>
    </div>
  );
}
