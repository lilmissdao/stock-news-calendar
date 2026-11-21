"use client";

import { useEffect, useState } from "react";
import { adoptSyncCode, createSyncCode, linkSyncCode, readSyncCode, syncNow, type SyncEventDetail } from "@/lib/sync-client";

export function SyncPanel() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCode(adoptSyncCode());
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<SyncEventDetail>).detail;
      if (!detail) return;
      setCode(readSyncCode());
      setStatus(
        detail.message ||
          (detail.status === "synced" ? "Synced" : detail.status === "offline" ? "Offline. Saved on this device." : "Sync did not save. Try again."),
      );
    };
    window.addEventListener("snc-sync", onSync);
    return () => window.removeEventListener("snc-sync", onSync);
  }, []);

  const link = code && typeof window !== "undefined" ? `${window.location.origin}/practice?sync=${code}` : "";

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
      setStatus(link);
    }
  }

  return (
    <section className="sync">
      <button type="button" className="text-btn sync-open" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {code ? "Synced" : "Sync"}
      </button>
      {open ? (
        <div className="sync-panel">
          {code ? (
            <>
              <p className="sync-lead">This device is linked. Open the link on your other device.</p>
              <p className="sync-code">{code}</p>
              <div className="sync-actions">
                <button type="button" className="text-btn" onClick={() => void copyLink()}>
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="sync-lead">Create a code here, then open the link on your phone. Your history is kept.</p>
              <button
                type="button"
                className="today-jump"
                onClick={() => {
                  const next = createSyncCode();
                  setCode(next);
                  syncNow();
                }}
              >
                Create sync code
              </button>
            </>
          )}
          <form
            className="sync-join"
            onSubmit={(event) => {
              event.preventDefault();
              const next = linkSyncCode(draft);
              if (!next) {
                setStatus("That code is not valid.");
                return;
              }
              setCode(next);
              setDraft("");
              syncNow();
            }}
          >
            <label>
              <span>Have a code or link?</span>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </label>
            <button type="submit" className="text-btn">
              Link
            </button>
          </form>
          {status ? <p className="sync-status">{status}</p> : null}
        </div>
      ) : null
      }
    </section>
  );
}
