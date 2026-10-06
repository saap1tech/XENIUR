import { useState,useEffect,useRef } from "react";
import type { Rights, TabSnapshot, World } from "@xeniur/core";
import { t } from "@xeniur/ui";

/**
 * Saving what is on screen into the project.
 *
 * What is saved is what the person was looking at, in the session they are signed into —
 * not a fresh public fetch that might return a sign-in page instead. The copy is stored with
 * where it came from, when, under which account, and what may be done with it; **unknown** is
 * the default, because being able to read something is not a licence to reuse it.
 *
 * Saving, proposing suggestions and accepting a claim are three separate acts, and this sheet
 * does only the first. *Don't send this to AI* is set here, at the moment of saving, and is a
 * processing permission — not a rights change and not a deletion.
 */
export function SaveToProject({ snapshot, worlds, worldId, onSaved, onCancel }: {
  snapshot: TabSnapshot;
  worlds: readonly World[];
  worldId: string | null;
  onSaved(result: { sourceId: string; candidates: number }): void;
  onCancel(): void;
}) {
  const bridge = typeof window === "undefined" ? undefined : window.xeniur;
  const hasSelection = snapshot.selectionText.trim().length > 0;
  const [what, setWhat] = useState<"selection" | "page">(hasSelection ? "selection" : "page");
  const [title, setTitle] = useState(snapshot.title || snapshot.url);
  const [target, setTarget] = useState(worldId ?? worlds[0]?.id ?? "");
  const [rights, setRights] = useState<Rights>("unknown");
  const [never, setNever] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path,setPath]=useState<import("@xeniur/core").Journey|null>(null),[attach,setAttach]=useState(false);
  const sheet=useRef<HTMLElement>(null);
  useEffect(()=>{let active=true;setPath(null);setAttach(false);if(target)void bridge?.journey?.get(target).then(j=>{if(active){setPath(j);setAttach(j?.stage==="materials");}}).catch(()=>{});return()=>{active=false;};},[bridge,target]);
  useEffect(()=>{if(never||rights==="restricted")setAttach(false);},[never,rights]);
  useEffect(()=>{const focus=document.activeElement as HTMLElement|null;sheet.current?.querySelector<HTMLInputElement>('input')?.focus();return()=>focus?.focus();},[]);
  const trap=(e:React.KeyboardEvent)=>{if(e.key==="Escape"&&!busy){e.preventDefault();onCancel();}if(e.key!=="Tab")return;const items=[...(sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')??[])].filter(el=>el.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};

  const text = what === "selection" ? snapshot.selectionText : snapshot.pageText;
  const save = async () => {
    if (!target) { setError(t("save.needproject")); return; }
    if (text.trim() === "") { setError(t("save.nothing")); return; }
    setBusy(true); setError(null);
    try {
      const r = await bridge?.sense?.capture({
        worldId: target, kind: what === "selection" ? "clip" : "article", title: title.trim() || snapshot.url,
        text, url: snapshot.url,
        sourceIdentity: { tabId: snapshot.tabId, profileLabel: snapshot.profileLabel },
        permittedUse: rights, aiProcessing: never ? "never" : "allowed",
        ...(attach&&path?{journeyVersionId:path.versionId}:{}),
      });
      if (r) onSaved({ sourceId: r.sourceId, candidates: r.candidates.length });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return (
    <section ref={sheet} onKeyDown={trap} className="xr-save" role="dialog" aria-modal="true" aria-labelledby="save-title">
      <header className="xr-save__head">
        <h2 id="save-title">{t("save.title")}</h2>
        <p className="xr-save__from">{t("save.from", { url: snapshot.url, account: snapshot.profileLabel })}</p>
      </header>

      <div className="xr-save__what" role="radiogroup" aria-label={t("save.what")}>
        <button type="button" role="radio" aria-checked={what === "selection"} disabled={!hasSelection} onClick={() => setWhat("selection")}>
          {t("save.selection")}{hasSelection ? ` · ${snapshot.selectionText.trim().length} ${t("save.characters")}` : ` · ${t("save.noselection")}`}
        </button>
        <button type="button" role="radio" aria-checked={what === "page"} onClick={() => setWhat("page")}>
          {t("save.page")} · {snapshot.pageText.length} {t("save.characters")}
        </button>
      </div>

      <p className="xr-save__excerpt">{text.trim().slice(0, 400) || t("save.nothing")}</p>

      <label className="xr-save__field">{t("save.name")}
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("save.name")} />
      </label>
      <label className="xr-save__field">{t("save.into")}
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("save.into")}>
          {worlds.filter((w) => w.summary !== "__xeniur_settings__").map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      </label>
      <details><summary>Reuse permission</summary><label className="xr-save__field">{t("save.rights")}
        <select value={rights} onChange={(e) => setRights(e.target.value as Rights)} aria-label={t("save.rights")}>
          <option value="unknown">{t("save.rights.unknown")}</option>
          <option value="permitted">{t("save.rights.permitted")}</option>
          <option value="restricted">{t("save.rights.restricted")}</option>
        </select>
      </label></details>
      <label className="xr-save__check">
        <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />
        {t("save.neverai")}
      </label>

      {path&&<label className="xr-save__check"><input type="checkbox" checked={attach} disabled={never||rights==="restricted"} onChange={e=>setAttach(e.target.checked)}/>Use in the work path</label>}
      {attach&&path?.stage!=="materials"&&<p className="xr-save__note">Adding a source reopens the path. Previous work remains in project history.</p>}
      <details><summary>What saving means</summary><p className="xr-save__note">{t("save.note")}</p></details>
      {error && <p className="xr-save__error" role="status">{error}</p>}
      <footer className="xr-save__actions">
        <button type="button" className="xr-button xr-button--primary" disabled={busy} onClick={() => void save()}>{busy ? t("save.saving") : t("save.save")}</button>
        <button type="button" className="xr-button" disabled={busy} onClick={onCancel}>{t("firstrun.notnow")}</button>
      </footer>
    </section>
  );
}
