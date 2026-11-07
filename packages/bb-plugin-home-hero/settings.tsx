import { useEffect, useRef, useState } from "react";
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

const BUTTON_CLASS =
  "inline-flex h-7 items-center justify-center rounded-md border border-input bg-transparent px-2.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const QUIET_BUTTON_CLASS =
  "inline-flex h-7 items-center justify-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function SettingsSection() {
  const rpc = useRpc<typeof rpcContract>();
  const inputRef = useRef<HTMLInputElement>(null);
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

  const persist = async (value: string | null) => {
    const appearance = await rpc.call("setIcon", { iconDataUrl: value });
    setIconDataUrl(appearance.iconDataUrl);
    setStatus({ kind: "saved" });
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setStatus({ kind: "saving" });
    try {
      if (file.size > MAX_ICON_BYTES) throw new Error("Icon must be 256 KiB or smaller.");
      await ensureDecodable(file);
      await persist(validateIconDataUrl(await readFile(file)));
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the icon.",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setStatus({ kind: "saving" });
    try {
      await persist(null);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not remove the icon.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="@container/settings w-full min-w-0 overflow-hidden rounded-md border border-border bg-surface-recessed/70 px-3 py-3"
      data-settings-anchor="Home hero icon"
    >
      <div className="flex flex-col gap-2.5 @min-[36rem]/settings:flex-row @min-[36rem]/settings:items-start @min-[36rem]/settings:justify-between @min-[36rem]/settings:gap-5">
        <div className="min-w-0 flex-1">
          <p className="min-w-0 text-sm font-normal text-foreground">Home hero icon</p>
          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">PNG, JPEG or WebP up to 256 KiB.</p>
          <p className="text-xs leading-snug text-subtle-foreground/75">Stored with this plugin on the BB server; never committed to the repository.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {iconDataUrl ? (
            <img
              alt=""
              className="h-10 w-10 rounded-md border border-border object-cover"
              height={40}
              src={iconDataUrl}
              width={40}
            />
          ) : null}
          <input
            accept="image/png,image/jpeg,image/webp"
            aria-label="Home hero icon file"
            className="sr-only"
            tabIndex={-1}
            disabled={busy}
            onChange={event => {
              void upload(event.target.files?.[0]);
              event.target.value = "";
            }}
            ref={inputRef}
            type="file"
          />
          <button
            className={BUTTON_CLASS}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            {iconDataUrl ? "Replace icon" : "Upload icon"}
          </button>
          {iconDataUrl ? (
            <button className={QUIET_BUTTON_CLASS} disabled={busy} onClick={() => void remove()} type="button">
              Remove
            </button>
          ) : null}
        </div>
      </div>
      <p
        aria-live="polite"
        className={
          status.kind === "idle"
            ? "h-0 overflow-hidden text-xs"
            : `mt-2 text-xs leading-snug ${status.kind === "error" ? "text-destructive" : "text-subtle-foreground/75"}`
        }
        role="status"
      >
        {status.kind === "saving" ? "Saving…" : status.kind === "saved" ? "Icon saved." : status.kind === "error" ? status.message : ""}
      </p>
    </div>
  );
}
