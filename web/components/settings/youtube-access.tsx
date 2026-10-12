"use client";

import { CircleAlert, CircleCheck, Cookie } from "lucide-react";
import { useState, type FormEvent } from "react";
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

/**
 * When YouTube asks to "confirm you're not a bot", yt-dlp needs a signed-in session:
 * cookies read from a browser, or an exported cookies.txt.
 */
export function YouTubeAccessCard({ settings, save }: { settings: Settings; save: Save }) {
  const [path, setPath] = useState(settings.cookiesFile ?? "");
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);

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

  const savePath = async (e?: FormEvent) => {
    e?.preventDefault();
    if (path.trim() === (settings.cookiesFile ?? "")) return;
    await save({ cookiesFile: path.trim() });
  };

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

        <div className="grid gap-2.5 py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center sm:gap-6">
          <div>
            <p className="text-[14px] font-medium">Or a cookies.txt</p>
            <p className="text-[12px] text-subtle">Overrides the browser when set</p>
          </div>
          <form onSubmit={savePath} className="flex h-10 items-center rounded-[12px] bg-bg px-3 shadow-[0_0_0_1px_rgb(255_255_255/0.1)] transition-shadow duration-150 focus-within:shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_0_0_4px_rgb(250_45_72/0.25)]">
            <input
              type="text"
              spellCheck={false}
              aria-label="Path to cookies.txt"
              placeholder="C:\path\to\cookies.txt"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onBlur={() => savePath()}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-subtle"
            />
          </form>
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
