"use client";

import { Check, ExternalLink, Eye, EyeOff, Languages, RotateCw, Server } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import {
  fetchModels,
  fetchSettings,
  fetchTranslationStatus,
  translateLibrary,
  updateSettings,
  type ModelOption,
  type ProviderId,
  type Settings,
  type SettingsUpdate,
  type TranslationStatus,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { PageHeading, plural } from "@/components/library/states";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { AlignmentCard } from "./alignment-card";
import { YouTubeAccessCard } from "./youtube-access";

const PROVIDER_INFO: Record<ProviderId, { tagline: string; keyUrl: string | null; keyHint: string }> = {
  openai: { tagline: "GPT models", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…" },
  google: { tagline: "Gemini models", keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza…" },
  anthropic: { tagline: "Claude models", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…" },
  groq: { tagline: "Fast open models", keyUrl: "https://console.groq.com/keys", keyHint: "gsk_…" },
  xai: { tagline: "Grok models", keyUrl: "https://console.x.ai", keyHint: "xai-…" },
  openrouter: { tagline: "Hundreds of models, one key", keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-…" },
  custom: { tagline: "Ollama, LM Studio, vLLM or any /v1 endpoint", keyUrl: null, keyHint: "optional" },
};

/** Typed model name, endpoint URL and optional key instead of a model list and required key. */
const isCustom = (provider: ProviderId | null) => provider === "custom";

/** Brand mark from /public/providers (sourced from thesvg.org), on a small dark tile. */
function ProviderLogo({ id, size = 24 }: { id: ProviderId; size?: number }) {
  const mark = size * 0.62;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[7px] bg-white/[0.07] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
      style={{ width: size, height: size }}
    >
      {isCustom(id) ? (
        <Server size={mark} strokeWidth={2} className="text-muted" />
      ) : (
        <img src={`/providers/${id}.svg`} alt="" width={mark} height={mark} className="object-contain" style={{ width: mark, height: mark }} />
      )}
    </span>
  );
}

type Save = (update: SettingsUpdate, optimistic?: Partial<Settings>) => Promise<boolean>;

export function SettingsView() {
  const { tab, selectTab } = useSettingsTab();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings().then(setSettings).catch((e: Error) => setLoadError(e.message));
  }, []);

  /** Apply a change optimistically; roll back and explain if the server refuses. */
  const save: Save = async (update, optimistic) => {
    const previous = settings;
    if (previous && optimistic) setSettings({ ...previous, ...optimistic });
    try {
      setSettings(await updateSettings(update));
      return true;
    } catch (e) {
      setSettings(previous);
      toast({ title: "Couldn't save settings", description: (e as Error).message, tone: "error" });
      return false;
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeading title="Settings" />
      {loadError ? (
        <p className="text-[14px] text-danger">{loadError}</p>
      ) : !settings ? (
        <div className="skeleton h-[340px] rounded-[20px]" aria-hidden />
      ) : (
        <>
          <div className="mb-4">
            <Tabs tabs={SETTINGS_TABS} value={tab} onChange={selectTab} label="Settings sections" idPrefix="settings" />
          </div>
          <div
            key={tab}
            role="tabpanel"
            id={`settings-panel-${tab}`}
            aria-labelledby={`settings-tab-${tab}`}
            className="enter-up"
          >
            {tab === "ai" && <TranslationCard settings={settings} save={save} />}
            {tab === "lyrics" && <AlignmentCard settings={settings} save={save} />}
            {tab === "youtube" && <YouTubeAccessCard settings={settings} save={save} />}
          </div>
        </>
      )}
    </div>
  );
}

const SETTINGS_TABS = [
  { id: "ai", label: "AI translation" },
  { id: "lyrics", label: "Lyrics" },
  { id: "youtube", label: "YouTube access" },
];

type SettingsTab = "ai" | "lyrics" | "youtube";

/** Selected tab, mirrored in the URL hash (#ai, #lyrics, #youtube) so it survives reloads and links. */
function useSettingsTab() {
  const [tab, setTab] = useState<SettingsTab>("ai");

  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (SETTINGS_TABS.some((t) => t.id === hash)) setTab(hash as SettingsTab);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const selectTab = (id: string) => {
    setTab(id as SettingsTab);
    window.history.replaceState(null, "", `#${id}`);
  };

  return { tab, selectTab };
}

/**
 * Everything for AI translation in one card: the switch, then provider, key and model
 * as numbered rows. Each row unlocks once the one above is done.
 */
function TranslationCard({ settings, save }: { settings: Settings; save: Save }) {
  const hintId = useId();
  const provider = settings.provider;
  const custom = isCustom(provider);
  const hasKey = !!(provider && settings.keys[provider]);
  // An OpenAI-compatible server needs its URL instead of a key; the key is optional there
  const connected = custom ? !!settings.baseUrl : hasKey;
  const configured = connected && !!settings.model;
  const providerName = settings.providers.find((p) => p.id === provider)?.name;
  const missing = !provider ? "provider" : !connected ? (custom ? "url" : "key") : !settings.model ? "model" : null;
  const MISSING_LABEL = {
    provider: "choose a provider",
    url: "enter the server URL",
    key: "add an API key",
    model: custom ? "enter a model name" : "pick a model",
  } as const;
  // Set when the switch is flipped before setup is finished
  const [nudge, setNudge] = useState(false);

  const toggle = (on: boolean) => {
    if (on && missing) {
      setNudge(true);
      // Take them straight to the step that's missing
      const target = document.getElementById(`settings-${missing}`);
      target?.focus();
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setNudge(false);
    save({ translationEnabled: on }, { translationEnabled: on });
  };

  return (
    <section className="surface rounded-[20px]">
      <header className="flex items-start gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
          <Languages size={20} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">AI translation</h2>
          <p
            id={hintId}
            aria-live="polite"
            className={`mt-0.5 text-[13px] text-pretty transition-colors duration-150 ${
              missing && (nudge || settings.translationEnabled) ? "text-accent" : "text-muted"
            }`}
          >
            {settings.ready
              ? `On · ${providerName} · ${settings.model}`
              : settings.translationEnabled && missing
                ? // On but incomplete (switching providers clears the model): nothing gets translated
                  `On, but paused: ${MISSING_LABEL[missing]} below. Songs aren't translated until then.`
              : configured
                ? "Ready to switch on. English appears under every non-English line, including romanised lyrics."
                : nudge && missing
                  ? `Almost there: ${MISSING_LABEL[missing]} below to turn this on.`
                  : "English under every non-English lyric line. Finish the steps below to turn it on."}
          </p>
        </div>
        <Switch
          label="AI translation"
          describedBy={hintId}
          checked={settings.translationEnabled}
          onChange={toggle}
        />
      </header>

      <div className="divide-y divide-white/[0.06] border-t border-white/[0.06] px-5">
        <Row step={1} done={!!provider} label="Provider" hint="Whose models translate">
          <Combobox
            id="settings-provider"
            label="Provider"
            value={provider}
            placeholder="Choose a provider"
            searchPlaceholder="Search providers"
            options={settings.providers.map((p) => ({
              id: p.id,
              label: p.name,
              description: PROVIDER_INFO[p.id].tagline,
              icon: <ProviderLogo id={p.id} />,
              trailing: settings.keys[p.id] ? (
                <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                  Key saved
                </span>
              ) : undefined,
            }))}
            onChange={(id) => id !== provider && save({ provider: id as ProviderId }, { provider: id as ProviderId, model: null })}
          />
        </Row>

        {custom && (
          <Row step={2} done={!!settings.baseUrl} label="Server URL" hint="Its OpenAI-compatible /v1 address">
            <TextSetting
              id="settings-url"
              label="Server URL"
              placeholder="http://localhost:11434/v1"
              value={settings.baseUrl}
              mono
              onSave={(url) => save({ baseUrl: url })}
            />
          </Row>
        )}

        <Row
          step={custom ? 3 : 2}
          done={custom ? connected : hasKey}
          disabled={!provider || (custom && !connected)}
          label={custom ? "API key (optional)" : "API key"}
          hint={
            !provider ? (
              "Pick a provider first"
            ) : PROVIDER_INFO[provider].keyUrl ? (
              <a
                href={PROVIDER_INFO[provider].keyUrl!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 hover:text-fg hover:underline"
              >
                Get a {providerName} key <ExternalLink size={11} strokeWidth={2} />
              </a>
            ) : (
              "Leave empty if the server needs none"
            )
          }
        >
          {/* Re-mount per provider so the field resets */}
          <KeyField key={provider ?? "none"} settings={settings} save={save} />
        </Row>

        <Row
          step={custom ? 4 : 3}
          done={configured}
          disabled={!connected}
          label="Model"
          hint={custom ? "As the server names it" : "A fast, cheap one is plenty"}
        >
          {custom ? (
            <TextSetting
              id="settings-model"
              label="Model"
              placeholder={connected ? "e.g. llama3.1:8b" : "Enter the server URL first"}
              value={settings.model}
              disabled={!connected}
              mono
              onSave={(model) => save({ model }, { model: model || null })}
            />
          ) : (
            <ModelPicker key={`${provider}-${settings.keys[provider ?? "openai"]}`} settings={settings} save={save} disabled={!hasKey} />
          )}
        </Row>
      </div>

      {settings.ready && <LibraryRow />}
    </section>
  );
}

function Row({
  step,
  done,
  disabled,
  label,
  hint,
  children,
}: {
  step: number;
  done: boolean;
  disabled?: boolean;
  label: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2.5 py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center sm:gap-6">
      <div className={`flex items-center gap-3 transition-opacity duration-200 ${disabled ? "opacity-45" : ""}`}>
        {/* Step number turns into a check once the row is complete */}
        <span className="icon-swap size-6 shrink-0">
          <span
            data-hidden={done}
            className="grid size-6 place-items-center rounded-full text-[12px] font-semibold text-muted shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.18)]"
          >
            {step}
          </span>
          <span data-hidden={!done} className="grid size-6 place-items-center rounded-full bg-accent text-white">
            <Check size={13} strokeWidth={3} />
          </span>
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-medium">{label}</p>
          <p className="text-[12px] text-subtle">{hint}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KeyField({ settings, save }: { settings: Settings; save: Save }) {
  const provider = settings.provider;
  const saved = provider ? settings.keys[provider] : null;
  const [editing, setEditing] = useState(!saved);
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!provider) {
    return <div className="h-10 rounded-[12px] bg-bg opacity-40 shadow-[0_0_0_1px_rgb(255_255_255/0.1)]" aria-hidden />;
  }

  /** Saved on paste, Enter, Save or leaving the field, so a pasted key is never left unsaved. */
  const commit = async (key: string) => {
    if (!key.trim() || busy) return;
    setBusy(true);
    if (await save({ apiKey: key })) {
      setValue("");
      setEditing(false);
      toast({ title: "API key saved" });
    }
    setBusy(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    commit(value);
  };

  if (!editing && saved) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-white/[0.04] px-3 font-mono text-[13px] text-muted">
          <Check size={14} strokeWidth={2.5} className="shrink-0 text-success" aria-hidden />
          <span className="truncate">{saved}</span>
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="pressable h-10 rounded-full bg-white/10 px-3.5 text-[13px] font-medium hover:bg-white/15"
        >
          Replace
        </button>
        <button
          type="button"
          onClick={() => save({ apiKey: "" })}
          className="pressable h-10 rounded-full px-3 text-[13px] font-medium text-danger hover:bg-danger/10"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <div className="flex h-10 min-w-0 flex-1 items-center rounded-[12px] bg-bg pr-1 pl-3 shadow-[0_0_0_1px_rgb(255_255_255/0.1)] transition-shadow duration-150 focus-within:shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_0_0_4px_rgb(250_45_72/0.25)]">
        <input
          type={visible ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          id="settings-key"
          aria-label="API key"
          placeholder={`Paste key (${PROVIDER_INFO[provider].keyHint})`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text").trim();
            if (pasted.length >= 16) {
              e.preventDefault();
              setValue(pasted);
              commit(pasted);
            }
          }}
          onBlur={(e) => {
            // Leaving via Cancel discards instead of saving
            if ((e.relatedTarget as HTMLElement | null)?.dataset.cancel) return;
            commit(value);
          }}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-subtle"
        />
        <button
          type="button"
          aria-label={visible ? "Hide key" : "Show key"}
          onClick={() => setVisible((v) => !v)}
          className="pressable grid size-8 place-items-center rounded-[8px] text-subtle hover:text-fg"
        >
          {visible ? <EyeOff size={15} strokeWidth={2} /> : <Eye size={15} strokeWidth={2} />}
        </button>
      </div>
      <button
        type="submit"
        disabled={!value.trim() || busy}
        className="pressable h-10 rounded-full bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
      >
        Save
      </button>
      {saved && (
        <button
          type="button"
          data-cancel
          onClick={() => {
            setValue("");
            setEditing(false);
          }}
          className="pressable h-10 rounded-full bg-white/10 px-3.5 text-[13px] font-medium hover:bg-white/15"
        >
          Cancel
        </button>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------

function ModelPicker({ settings, save, disabled }: { settings: Settings; save: Save; disabled: boolean }) {
  const provider = settings.provider;
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Live list from the provider; this also proves the key works.
  useEffect(() => {
    if (disabled || !provider) return;
    let cancelled = false;
    setModels(null);
    setError(null);
    fetchModels(provider)
      .then((m) => !cancelled && setModels(m))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [provider, disabled, reload]);

  return (
    <div>
      <Combobox
        id="settings-model"
        label="Model"
        value={settings.model}
        disabled={disabled}
        placeholder={disabled ? "Add a key first" : "Choose a model"}
        searchPlaceholder={models ? `Search ${plural(models.length, "model")} or type an ID` : "Loading models…"}
        allowCustom
        options={models && models.map((m) => ({ id: m.id, label: m.name, description: m.name !== m.id ? m.id : undefined }))}
        display={settings.model ?? undefined}
        onChange={(id) => save({ model: id }, { model: id })}
        status={
          error ? (
            <div className="flex items-center gap-3 text-[13px] text-danger">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setReload((n) => n + 1)}
                className="pressable flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 font-medium text-fg hover:bg-white/15"
              >
                <RotateCw size={13} strokeWidth={2} /> Retry
              </button>
            </div>
          ) : undefined
        }
      />
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A free-text setting, saved on Enter or when the field loses focus. */
function TextSetting({
  id,
  label,
  placeholder,
  value,
  disabled,
  mono,
  onSave,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string | null;
  disabled?: boolean;
  mono?: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  // Follow the saved value (e.g. after the server normalises it or a save is rolled back)
  useEffect(() => setDraft(value ?? ""), [value]);

  const commit = () => {
    if (draft.trim() !== (value ?? "")) onSave(draft.trim());
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className={`flex h-10 items-center rounded-[12px] bg-bg px-3 shadow-[0_0_0_1px_rgb(255_255_255/0.1)] transition-[box-shadow,opacity] duration-150 focus-within:shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_0_0_4px_rgb(250_45_72/0.25)] ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <input
        id={id}
        type="text"
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={`h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:font-sans placeholder:text-subtle ${
          mono ? "font-mono" : ""
        }`}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------

function LibraryRow() {
  const [status, setStatus] = useState<TranslationStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const working = !!status && (status.pending > 0 || status.current !== null);

  // Poll while translations are running.
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const tick = () =>
      fetchTranslationStatus()
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          if (s.pending > 0 || s.current) timer = window.setTimeout(tick, 2000);
        })
        .catch(() => {});
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [starting]);

  const start = async () => {
    setStarting(true);
    try {
      const { queued } = await translateLibrary();
      toast({ title: queued ? `Translating ${plural(queued, "song")}` : "Everything is already translated" });
    } catch (e) {
      toast({ title: "Couldn't start translating", description: (e as Error).message, tone: "error" });
    } finally {
      setStarting(false);
    }
  };

  const errorCount = status ? Object.keys(status.errors).length : 0;

  return (
    <div className="enter-up flex items-center gap-3 rounded-b-[20px] border-t border-white/[0.06] bg-white/[0.02] px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">Existing songs</p>
        <p className="text-[12px] text-subtle tabular-nums" aria-live="polite">
          {!status
            ? "Checking…"
            : working
              ? `Translating… ${plural(status.pending + (status.current ? 1 : 0), "song")} left`
              : status.untranslated
                ? `${plural(status.untranslated, "song")} without translations. New songs are translated automatically.`
                : "Every song is translated"}
          {errorCount > 0 && (
            <span className="text-danger" title={Object.values(status!.errors)[0]}>
              {" "}
              · {plural(errorCount, "song")} failed
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={start}
        disabled={starting || working || !status?.untranslated}
        className="pressable flex h-9 shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 text-[13px] font-medium hover:bg-white/15 disabled:opacity-40"
      >
        {working && <span className="spin size-3.5 rounded-full border-2 border-white/20 border-t-white" />}
        Translate all
      </button>
    </div>
  );
}
