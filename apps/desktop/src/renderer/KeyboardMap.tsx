import { t } from "@xeniur/ui";

/** Every key XENIUR listens for, in one place. Opened with `?`, closed with Esc or Close. */
export const KEY_MAP: ReadonlyArray<{ keys: readonly string[]; what: Parameters<typeof t>[0] }> = [
  { keys: ["⌘", "K"], what: "keys.palette" },
  { keys: ["⌘", "1 / 2 / 3"], what: "keys.density" },
  { keys: ["1 – 4"], what: "keys.zones" },
  { keys: ["↑", "↓"], what: "keys.move" },
  { keys: ["Enter"], what: "keys.open" },
  { keys: ["P"], what: "keys.present" },
  { keys: ["W"], what: "keys.standing" },
  { keys: ["Esc"], what: "keys.escape" },
  { keys: ["?"], what: "keys.map" },
];

export function KeyboardMap({ onClose }: { onClose(): void }) {
  return (
    <div className="xr-keymap" role="dialog" aria-modal="true" aria-labelledby="keymap-title">
      <div className="xr-keymap__sheet">
        <header className="xr-keymap__head">
          <h2 id="keymap-title">{t("keys.title")}</h2>
          <button type="button" className="xr-button" onClick={onClose}>{t("keys.close")}</button>
        </header>
        <dl className="xr-keymap__list">
          {KEY_MAP.map((row) => (
            <div key={row.what} className="xr-keymap__row">
              <dt>{row.keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
              <dd>{t(row.what)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
