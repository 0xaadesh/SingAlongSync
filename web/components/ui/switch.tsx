"use client";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  describedBy?: string;
};

/** iOS-style toggle. The thumb slides with a transform, so it stays on the compositor. */
export function Switch({ checked, onChange, disabled, label, describedBy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-checked={checked}
      className="group relative h-[28px] w-[46px] shrink-0 rounded-full bg-white/15 transition-colors duration-200 data-[checked=true]:bg-success disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        aria-hidden
        className="absolute top-[2px] left-[2px] size-6 rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-[var(--ease-out)] group-data-[checked=true]:translate-x-[18px]"
      />
    </button>
  );
}
