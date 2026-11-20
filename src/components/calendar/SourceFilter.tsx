"use client";
import { CheckIcon } from "@/components/ui/icons";
import { useHiddenSources, useSources } from "./store";

/** Legend + on/off toggles for every calendar/source, grouped by account. */
export function SourceFilterList() {
  const sources = useSources();
  const { hidden, toggle } = useHiddenSources();
  if (!sources.length) return null;

  const groups = new Map<string, typeof sources>();
  for (const s of sources) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }

  return (
    <div className="flex flex-col gap-5">
      {[...groups.entries()].map(([group, items]) => (
        <section key={group}>
          <h3 className="mb-1.5 truncate px-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{group}</h3>
          <ul className="flex flex-col">
            {items.map((s) => {
              const on = !hidden.includes(s.key);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggle(s.key)}
                    className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-surface-2"
                  >
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors duration-150"
                      style={{ borderColor: s.color, background: on ? s.color : "transparent" }}
                    >
                      {on && <CheckIcon size={11} className="text-white [stroke-width:3]" />}
                    </span>
                    <span className={`truncate ${on ? "text-text" : "text-faint"}`}>{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
