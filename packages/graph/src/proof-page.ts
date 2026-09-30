import { sha256Hex, type ProcessProof, type ProcessEvent } from "@xeniur/core";

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const STAGES: Record<string, string> = {
  note_written: "Idea", source_collected: "Research", decision_accepted: "Decision",
  sketch_made: "Human work", manual_edit: "Human work", model_step: "AI-assisted step",
  tool_used: "Tool step", revision: "Revision", experiment_rejected: "Experiment", xeniur_session: "Recorded XENIUR session",
};
export interface ProofPageOptions {
  title: string;
  eventIds: string[];
  discloseHashes: boolean;
  discloseTiming: boolean;
  humanPass?: { changed: string; standBehind: string; checkNext: string };
  projectUrl?: string;
}
export interface SharedProcess {
  format: "xeniur-process/1"; title: string; events: ProcessEvent[];
  disclosedHashes: string[]; humanPass?: { changed: string; standBehind: string; checkNext: string }; rootHash: string;
}
export function shareProcess(proof: ProcessProof, options: ProofPageOptions): SharedProcess {
  const selected = new Set(options.eventIds);
  const events = proof.events.filter((event) => selected.has(event.id)).map((event, index) => ({
    ...event, label: STAGES[event.kind] ?? "Recorded step", tool: null, model: null,
    inputHashes: options.discloseHashes ? event.inputHashes : [],
    outputHashes: options.discloseHashes ? event.outputHashes : [],
    at: options.discloseTiming ? event.at : index,
    durationMs: options.discloseTiming ? event.durationMs : 0,
  }));
  const disclosedHashes = [...new Set(events.flatMap((event) => [...event.inputHashes, ...event.outputHashes]))].sort();
  const humanPass = options.humanPass && {
    changed: options.humanPass.changed.trim(), standBehind: options.humanPass.standBehind.trim(),
    checkNext: options.humanPass.checkNext.trim(),
  };
  const body = { format: "xeniur-process/1" as const, title: options.title, events, disclosedHashes,
    ...(humanPass ? { humanPass } : {}) };
  return { ...body, rootHash: sha256Hex(JSON.stringify(body)) };
}
export function verifySharedProcess(shared: SharedProcess): boolean {
  return shared.rootHash === sha256Hex(JSON.stringify({ format: shared.format, title: shared.title,
    events: shared.events, disclosedHashes: shared.disclosedHashes,
    ...(shared.humanPass ? { humanPass: shared.humanPass } : {}) }));
}

/** Standalone, script-free, no remote assets. Only the selected filtered event snapshot leaves. */
export function renderProofPage(proof: ProcessProof, options: ProofPageOptions): { html: string; manifest: SharedProcess } {
  const manifest = shareProcess(proof, options);
  let projectUrl = "";
  if (options.projectUrl) {
    const url = new URL(options.projectUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("The shared project must have a public HTTPS link.");
    projectUrl = url.href;
  }
  const counts = { human: manifest.events.filter((e) => e.actor === "human").length,
    tool: manifest.events.filter((e) => e.actor === "tool").length,
    model: manifest.events.filter((e) => e.actor === "model").length };
  const dataUrl = `data:application/json;base64,${Buffer.from(JSON.stringify(manifest, null, 2)).toString("base64")}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>${escape(options.title)} | Made with XENIUR</title><meta name="description" content="An inspectable record of how this work developed.">
<style>
*{box-sizing:border-box}body{margin:0;background:#eeeede;color:#1a2019;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}main{max-width:1080px;margin:auto;padding:46px 32px 90px}nav{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid;padding-bottom:20px}.brand{font-weight:900;letter-spacing:.14em}.brand b{background:#c6f939;border:2px solid;padding:6px 10px;margin-right:10px}header{padding:70px 0 45px;position:relative}header small{font:12px monospace;text-transform:uppercase;letter-spacing:.15em}h1{font-family:"Avenir Next Condensed","Arial Narrow",sans-serif;font-size:clamp(48px,8vw,96px);line-height:.98;letter-spacing:-.05em;margin:20px 0;max-width:850px}header p{max-width:550px;color:#555e50}.counts{display:flex;flex-wrap:wrap;border:2px solid;box-shadow:6px 6px 0 #1a2019;background:#c6f939;margin:10px 0 68px}.counts div{flex:1;min-width:170px;padding:20px 24px;border-right:2px solid}.counts strong{font-size:36px;display:block}.timeline{list-style:none;padding:0;position:relative}.timeline li{display:grid;grid-template-columns:76px 1fr;gap:24px;position:relative;padding-bottom:32px}.timeline li:before{content:"";position:absolute;left:25px;top:48px;bottom:0;border-left:2px solid}.number{width:52px;height:52px;border:2px solid;display:grid;place-items:center;background:#eeeede;font:16px monospace;z-index:1}.step{border-top:2px solid;padding:15px 0 16px}.step h2{font-size:26px;margin:0 0 4px}.step small{font:12px monospace;color:#596451}.tag{display:inline-block;border:1px solid;padding:2px 8px;margin:0 0 12px;font-size:12px}.model .tag{background:#e2d6ba}.human .tag{background:#c6f939}.hashes{overflow-wrap:anywhere;font:11px/1.8 monospace;color:#56634f}.finish{background:#1a2019;color:#eeeede;padding:32px;border:2px solid #1a2019;box-shadow:6px 6px 0 #c6f939}.finish h2{font-size:28px;margin:0 0 12px}.finish a{display:inline-block;padding:10px 16px;background:#c6f939;color:#1a2019;text-decoration:none;font-weight:700;margin-top:14px}.integrity{margin:42px 0;overflow-wrap:anywhere}.integrity code{font-size:12px}.disclosure{font-size:13px;max-width:720px;color:#596451}footer{border-top:2px solid;padding-top:24px;display:flex;justify-content:space-between;gap:20px}a:focus-visible{outline:3px solid #587513;outline-offset:5px}@media(max-width:600px){main{padding:24px 20px 60px}header{padding-top:46px}.counts div{min-width:100px;padding:12px}.timeline li{grid-template-columns:52px 1fr;gap:14px}.counts strong{font-size:28px}footer{display:block}}
.human-pass{margin:0 0 64px;padding:30px;border:2px solid}.human-pass h2{margin:0 0 20px}.human-pass dl{display:grid;grid-template-columns:180px 1fr;gap:12px 20px;margin:0}.human-pass dt{font-weight:700}.human-pass dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){.human-pass dl{grid-template-columns:1fr}}
</style></head><body><main><nav><span class="brand"><b>XR</b>XENIUR</span><span>View Process / Shared by its creator</span></nav>
<header><small>The work behind the work</small><h1>${escape(options.title)}</h1><p>A record of activity captured by XENIUR and deliberately shared by the creator. It does not estimate unrecorded effort or originality.</p></header>
<section class="counts" aria-label="Disclosed process"><div><strong>${counts.human}</strong>human steps</div><div><strong>${counts.tool}</strong>tool steps</div><div><strong>${counts.model}</strong>AI-assisted steps</div></section>
${manifest.humanPass ? `<section class="human-pass" aria-label="Creator's review"><h2>What I stand behind</h2><dl><dt>What I changed</dt><dd>${escape(manifest.humanPass.changed)}</dd><dt>What I stand behind</dt><dd>${escape(manifest.humanPass.standBehind)}</dd><dt>What still needs checking</dt><dd>${escape(manifest.humanPass.checkNext)}</dd></dl></section>` : ""}
<ol class="timeline">${manifest.events.map((event, index) => `<li class="${event.actor}"><span class="number">${String(index + 1).padStart(2, "0")}</span><article class="step"><span class="tag">${event.actor === "model" ? "AI-assisted" : event.actor === "human" ? "Human contribution" : "Local or external tool"}</span><h2>${escape(event.label)}</h2><small>${options.discloseTiming ? escape(new Date(event.at).toISOString().slice(0, 16).replace("T", " ")) : "Timing kept private"}</small>${event.outputHashes.length ? `<details class="hashes"><summary>Disclosed output hashes</summary>${event.outputHashes.map(escape).join("<br>")}</details>` : ""}</article></li>`).join("")}</ol>
<section class="finish"><h2>Made with XENIUR.</h2><p>The final artifact is one part of the story. This record preserves the disclosed steps that led to it.</p>${projectUrl ? `<a href="${escape(projectUrl)}" rel="noreferrer">Open this project in XENIUR ↗</a>` : "<p>The creator has kept the project package private.</p>"}</section>
<section class="integrity"><h2>Inspect the record</h2><p><a href="${dataUrl}" download="process-proof.json">Download the verifiable process record</a></p><code>SHA-256 ${manifest.rootHash}</code><p>${manifest.disclosedHashes.length} source or output hashes deliberately disclosed.</p></section>
<p class="disclosure">This page includes ${manifest.events.length} selected events recorded by XENIUR. Private notes, prompts, source text, filenames, model names, and unselected events are excluded. Session durations describe recorded XENIUR sessions only. Hashes verify disclosed bytes and record integrity; this record does not establish originality, copyright ownership, or prove that similarity is infringement.</p>
<footer><strong>XENIUR</strong><span>The visual interface between humans and digital capability.</span></footer></main></body></html>`;
  return { html, manifest };
}
