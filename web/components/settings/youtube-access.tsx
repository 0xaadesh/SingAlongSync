"use client";

import { CircleAlert, CircleCheck, ClipboardPaste, Cookie, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { checkYouTubeAccess, type Settings, type SettingsUpdate } from "@/lib/api";
import { Combobox } from "@/components/ui/combobox";

type Save = (update: SettingsUpdate, optimistic?: Partial<Settings>) => Promise<boolean>;

const BROWSER_NAMES: Record<string, string> = {
  firefox: "Firefox",
  chrome: "Chrome",
  edge: "Edge",
  brave: "Brave",
  opera: "Opera",
  vivaldi: "Vivaldi",
  chromium: "Chromium",
  safari: "Safari",
};

const smallButton =
  "pressable h-7 shrink-0 rounded-full px-3 text-[12px] font-medium text-muted hover:bg-white/10 hover:text-fg disabled:opacity-50";
const wideButton =
  "pressable flex h-10 flex-1 items-center justify-center gap-2 rounded-[12px] bg-white/[0.06] text-[13px] font-medium hover:bg-white/10 disabled:opacity-50";

/**
 * When YouTube asks to "confirm you're not a bot", yt-dlp needs a signed-in session:
 * cookies read from a browser, or an exported cookies.txt (picked or pasted, saved on the server).
 */
export function YouTubeAccessCard({ settings, save }: { settings: Settings; save: Save }) {
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);

  const runCheck = async () => {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await checkYouTubeAccess());
    } catch (e) {
      setCheck({ ok: false, message: (e as Error).message });
    } finally {
      setChecking(false);
    }
  };

  const saveCookies = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setCheck(null);
    if (await save({ cookiesText: text })) {
      setPasting(false);
      setPasted("");
    }
    setBusy(false);
  };

  const pickFile = async (file: File | undefined) => {
    // Clear so picking the same file again still fires onChange
    if (fileRef.current) fileRef.current.value = "";
    if (file) await saveCookies(await file.text());
  };

  const removeCookies = () => {
    setCheck(null);
    save({ cookiesFile: "" }, { cookiesFile: null, cookiesCount: null });
  };

  const fileName = settings.cookiesFile?.split(/[\\/]/).pop();
  const count = settings.cookiesCount;

  const options = [
    { id: "", label: "None", description: "Download without signing in" },
    ...settings.cookieBrowsers.map((b) => ({
      id: b,
      label: BROWSER_NAMES[b] ?? b,
      description: b === "firefox" ? "Most reliable on Windows" : undefined,
    })),
  ];

  return (
    <section className="surface rounded-[20px]">
      <header className="flex items-start gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-fg">
          <Cookie size={20} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">YouTube access</h2>
          <p className="mt-0.5 text-[13px] text-muted text-pretty">
            If downloads fail with &ldquo;Sign in to confirm you&rsquo;re not a bot&rdquo;, let the downloader use your
            YouTube sign-in. Cookies stay on this computer.
          </p>
        </div>
      </header>

      <div className="divide-y divide-white/[0.06] border-t border-white/[0.06] px-5">
        <div className="grid gap-2.5 py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center sm:gap-6">
          <div>
            <p className="text-[14px] font-medium">Browser</p>
            <p className="text-[12px] text-subtle">One you&rsquo;re signed in to YouTube with</p>
          </div>
          <Combobox
            label="Browser"
            value={settings.cookiesBrowser ?? ""}
            options={options}
            placeholder="None"
            searchPlaceholder="Search browsers"
            onChange={(id) => {
              setCheck(null);
              save({ cookiesBrowser: id }, { cookiesBrowser: id || null });
            }}
          />
        </div>

        <div className="grid gap-2.5 py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-start sm:gap-6">
          <div className="sm:pt-2.5">
            <p className="text-[14px] font-medium">Or a cookies.txt</p>
            <p className="text-[12px] text-subtle">Overrides the browser when set</p>
          </div>
          <div className="min-w-0">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {pasting ? (
              <div className="grid gap-2">
                <textarea
                  autoFocus
                  spellCheck={false}
                  aria-label="cookies.txt contents"
                  placeholder="# Netscape HTTP Cookie File"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={5}
                  className="w-full resize-y rounded-[12px] bg-bg px-3 py-2.5 font-mono text-[12px] whitespace-pre shadow-[0_0_0_1px_rgb(255_255_255/0.1)] outline-none transition-shadow duration-150 placeholder:text-subtle focus:shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_0_0_4px_rgb(250_45_72/0.25)]"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPasting(false)} disabled={busy} className={smallButton}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => saveCookies(pasted)}
                    disabled={busy || !pasted.trim()}
                    className="pressable h-8 rounded-full bg-white px-3.5 text-[13px] font-semibold text-black hover:bg-white/85 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : settings.cookiesFile ? (
              <div className="flex h-10 items-center gap-1 rounded-[12px] bg-bg pr-1.5 pl-3 shadow-[0_0_0_1px_rgb(255_255_255/0.1)]">
                <p className="min-w-0 flex-1 truncate text-[13px]" title={settings.cookiesFile}>
                  <span className="font-mono">{fileName}</span>
                  <span className={count == null ? "text-danger" : "text-subtle"}>
                    {count == null ? " · can't be read" : ` · ${count} YouTube cookie${count === 1 ? "" : "s"}`}
                  </span>
                </p>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={smallButton}>
                  Replace
                </button>
                <button type="button" onClick={removeCookies} disabled={busy} className={smallButton}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={wideButton}>
                  <FileUp size={15} strokeWidth={2} />
                  Choose file
                </button>
                <button type="button" onClick={() => setPasting(true)} disabled={busy} className={wideButton}>
                  <ClipboardPaste size={15} strokeWidth={2} />
                  Paste
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-b-[20px] border-t border-white/[0.06] bg-white/[0.02] px-5 py-4">
        <p className="min-w-0 flex-1 text-[12px] text-pretty" aria-live="polite">
          {check ? (
            <span className={`flex items-start gap-1.5 ${check.ok ? "text-success" : "text-danger"}`}>
              {check.ok ? (
                <CircleCheck size={14} strokeWidth={2.25} className="mt-px shrink-0" />
              ) : (
                <CircleAlert size={14} strokeWidth={2.25} className="mt-px shrink-0" />
              )}
              <span className="line-clamp-3">{check.message}</span>
            </span>
          ) : (
            <span className="text-subtle">
              Chrome and Edge lock their cookies while open; close them or use Firefox or a cookies.txt.
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={runCheck}
          disabled={checking}
          className="pressable flex h-9 shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 text-[13px] font-medium hover:bg-white/15 disabled:opacity-60"
        >
          {checking && <span className="spin size-3.5 rounded-full border-2 border-white/20 border-t-white" />}
          Test
        </button>
      </div>
    </section>
  );
}
