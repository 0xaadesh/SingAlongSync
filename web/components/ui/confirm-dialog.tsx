"use client";

import { useEffect, useRef, useState } from "react";
import { createStore, useStore } from "@/lib/store";

type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

const confirmStore = createStore<ConfirmRequest | null>(null);

/** Ask for confirmation before a destructive action. */
export function confirm(request: ConfirmRequest) {
  confirmStore.set(request);
}

export function ConfirmDialog() {
  const request = useStore(confirmStore);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    if (request && !dialog.open) {
      setError(null);
      dialog.showModal();
    } else if (!request && dialog.open) {
      dialog.close();
    }
  }, [request]);

  const close = () => {
    if (!busy) confirmStore.set(null);
  };

  const run = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await request.onConfirm();
      confirmStore.set(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="app-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-[22px] bg-surface-2 p-0 text-fg shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_24px_64px_-12px_rgb(0_0_0/0.8)]"
    >
      {request && (
        <div className="p-5">
          <h2 className="text-[17px] font-semibold">{request.title}</h2>
          <p className="mt-1.5 text-[14px] text-muted text-pretty">{request.body}</p>
          {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              autoFocus
              className="pressable h-9 rounded-full bg-white/10 px-4 text-[14px] font-medium hover:bg-white/15"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="pressable flex h-9 items-center gap-2 rounded-full bg-danger px-4 text-[14px] font-semibold text-white hover:bg-[#ff5c52] disabled:opacity-60"
            >
              {busy && <span className="spin size-3.5 rounded-full border-2 border-white/40 border-t-white" />}
              {request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
