import type { LookOption } from "@/lib/contracts";

export function LookPicker({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: LookOption[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm tracking-wide text-paper/70 uppercase">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
              className={
                selected
                  ? "rounded-full bg-paper px-3 py-1.5 text-sm text-ink"
                  : "rounded-full border border-paper/30 px-3 py-1.5 text-sm text-paper"
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
