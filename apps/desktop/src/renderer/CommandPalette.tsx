import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run(): void | Promise<void>;
}

/**
 * Everything XENIUR can do, one keystroke away.
 *
 * A palette rather than a menu bar because the set of actions depends on what is in front
 * of you: the commands are supplied by whatever is on screen, so it never offers something
 * that would fail.
 */
export function CommandPalette({ commands, open, onClose }: {
  commands: Command[];
  open: boolean;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return commands;
    return commands.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      (c.hint ?? "").toLowerCase().includes(q));
  }, [commands, query]);

  if (!open) return null;

  const choose = (index: number) => {
    const command = matches[index];
    if (!command) return;
    onClose();
    void command.run();
  };

  return (
    <div className="xr-palette__scrim" onClick={onClose} role="presentation">
      <div className="xr-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Commands">
        <input
          ref={inputRef}
          className="xr-palette__input"
          placeholder="What do you want to do?"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { onClose(); return; }
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); choose(cursor); }
          }}
        />
        {matches.length === 0 ? (
          <p className="xr-palette__empty">Nothing matches that.</p>
        ) : (
          <ul className="xr-palette__list">
            {matches.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`xr-palette__item${i === cursor ? " is-active" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(i)}
                >
                  <span className="xr-palette__group">{c.group}</span>
                  <span className="xr-palette__label">{c.label}</span>
                  {c.hint && <span className="xr-palette__hint">{c.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Opens on the platform's usual chord, and closes on Escape from anywhere. */
export function usePaletteShortcut(setOpen: (fn: (v: boolean) => boolean) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}
