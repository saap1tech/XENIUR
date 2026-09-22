import { formRoleName } from "@xeniur/core";

/**
 * The language seam.
 *
 * One table, English. Every sentence the M6 surfaces say to a person goes through `t()` so
 * that French and Arabic (M7) are a translation and not a rewrite. Keys name the *place*
 * and the *fact*, never the English wording, so a key survives its own rephrasing.
 *
 * Interpolation is `{name}`; a missing variable is left visible, never silently dropped —
 * a sentence with a hole in it is easier to notice than one that quietly says less.
 *
 * Direction follows the locale: the stylesheet uses logical properties (`inline-start`,
 * `inline-end`) so that switching `dir` is the whole of the RTL work.
 */
export const EN = {
  // The nouns a person sees. Code, tables and IPC keep World / Object; these are the words.
  "term.project": "project",
  "term.projects": "projects",
  "term.item": "item",
  "term.items": "items",
  "term.suggestion": "suggestion",
  "term.suggestions": "suggestions",
  "term.activity": "Activity",

  // First run
  "firstrun.title": "What would you like to work on?",
  "firstrun.lead": "Everything here works without a model key. When a task can use cloud AI, XENIUR says so at that moment — never before.",
  "firstrun.have.title": "I already have something to work with",
  "firstrun.have.body": "A document, an image, a link, a .blend, an article. XENIUR turns it into a recognizable item.",
  "firstrun.have.verb": "Bring it in",
  "firstrun.new.title": "I want to start something new",
  "firstrun.new.body": "A question, an idea, a task or an outcome — one sentence, in your words.",
  "firstrun.new.label": "What are you trying to accomplish?",
  "firstrun.new.placeholder": "One sentence, in your words",
  "firstrun.new.verb": "Begin",
  "firstrun.continue.title": "I want to continue an existing project",
  "firstrun.continue.body": "Open a project already on this machine, or a .xeniur package someone sent you.",
  "firstrun.continue.package": "Open a .xeniur package",
  "firstrun.continue.none": "No projects on this machine yet.",
  "firstrun.example": "Or open the example — Rainwear 2027, marked as an example, safe to change.",
  "firstrun.skip": "Skip",
  "firstrun.notnow": "Not now",

  // Home
  "home.eyebrow": "Your visual workspace",
  "home.title": "Pick up where you left off.",
  "home.lead": "What you were doing, what changed, and what you can accomplish next — from the record, not a summary.",
  "home.needsyou": "Needs you",
  "home.today": "Today",
  "home.recent": "Most recent",
  "home.projects": "Your projects",
  "home.count": "{count} on this machine",
  "home.more": "{count} more in the palette",
  "home.projectsubtitle": "Research, decisions, outcomes",
  "home.empty": "Begin with a source, a thought, or a thing.",
  "home.languagehint": "Language is available inside each project as a shortcut.",
  "home.lastactive": "Last active project",
  "home.reading": "Reading your projects…",
  "home.quiet": "Open a project when you want to; nothing here is waiting.",
  "home.morebehind": "{count} more behind these, in the projects they belong to.",
  "home.bringbody": "Add a document, image, link, project or other material. XENIUR turns it into a recognizable item.",
  "home.newfrommaterial": "New project from material",
  "palette.projects": "Projects",
  "palette.home": "Back to projects",
  "object.back": "← Project",
  "arrival.critique": "Their work opens read-only, in its own project, for you to review. Your claims sit beside it.",
  "world.arrived": "“{title}” arrived and verified. It is a project now.",
  "world.askabout": "Ask about {title}, or say what to do — “compare these two”, “make a delivery preview”",
  "world.thisproject": "this project",
  "web.chooseproject": "Choose a project",
  "moves.connect": "Find relationships with other items in this project.",
  "thinking.empty": "Nothing has been captured in this project yet.",
  "recipe.empty": "No recipe on this item yet.",
  "recipe.candidate": "produces a suggestion",
  "challenge.ticketnone": "No ticket is held here yet. Drop the organizer's ticket file on this project.",
  "organizer.noassessments": "None yet. A judge's file dropped on this project is verified and added here.",

  // The plan
  "plan.title": "Plan",
  "plan.aria": "The plan: {sentence}",
  "plan.proposed": "{count} steps proposed from your goal — adopt them, skip them, or write your own.",
  "plan.adoptall": "Adopt all",
  "plan.adopt": "Adopt",
  "plan.skip": "Skip",
  "plan.unskip": "Take back",
  "plan.rename": "Rename",
  "plan.skipped": "skipped",
  "plan.proposedword": "proposed",
  "plan.tools": "Edit {purpose}",
  "plan.addstep": "Add a step",
  "plan.add": "Add",
  "plan.addplaceholder": "What this step is for, in your words",
  "plan.kind": "Kind of step",
  "plan.none": "No step is in front of you. Adopt one from the plan, or add your own.",
  "plan.start": "Start",
  "plan.complete": "Mark complete",
  "plan.reopen": "Reopen",
  "plan.block": "Blocked",
  "plan.byrule": "found in the record",
  "plan.byperson": "your word",
  "plan.confirmplaceholder": "A note, in your words — this is your evidence",
  "plan.rule": "Complete when:",
  "plan.rule.form": "{role} exists at the current version.",
  "plan.rule.decision": "a decision is accepted.",
  "plan.rule.claim": "a claim is reviewed by a person against its source.",
  "plan.rule.receipt": "a receipt is confirmed.",
  "plan.rule.person": "you say so, with a note.",
  "plan.material": "Material",
  "plan.showplan": "Plan",
  "sr.plan": "The plan has {total} adopted steps: {complete} complete, {review} needing review, {skipped} skipped, {proposed} still proposed.",
  "sr.step": "Step: {purpose}. State: {state}.",
  "dock.step": "Now",
  "dock.next": "Next",
  "dock.nothing": "No step in front of you.",
  "after.import": "Added “{title}”. Next: {next}.",
  "after.importonly": "Added “{title}”.",
  "after.complete": "Finished: {outcome}. The delivery report says what was chosen despite uncertainty.",

  // Browsing inside XENIUR
  "browser.back": "Back",
  "browser.forward": "Forward",
  "browser.reload": "Reload",
  "browser.address": "Address or search",
  "browser.addressplaceholder": "An address, or something to look for",
  "browser.go": "Go",
  "browser.accounts": "Your accounts",
  "browser.noaccounts": "No account yet",
  "browser.needaccount": "Add one of your accounts first — a tab belongs to an account.",
  "browser.accountplaceholder": "A name for this account — Work, Supplier portal…",
  "browser.addaccount": "Add an account",
  "browser.readingonly": "reading only",
  "browser.signedin": "signs in and stays signed in",
  "browser.profilenote": "{label} — {kind}.",
  "browser.footnote": "HTTPS only · every address checked · downloads held, never taken · no page reaches XENIUR itself.",
  "browser.takeover": "Take over",
  "browser.layout": "How much room",
  "browser.layout.fill": "Full",
  "browser.layout.wide": "Wide",
  "browser.layout.beside": "Beside",
  "browser.find": "Find on this page",
  "browser.closetab": "Close this tab",
  "browser.save": "Save to project",
  "browser.downloads": "Downloads waiting for you",
  "browser.keep": "Keep in project",
  "browser.discard": "Discard",
  "browser.emptytitle": "The web, inside your work.",
  "browser.emptybody": "Open a tab with one of your accounts. What you sign into stays signed in; what you save enters the project only when you say so.",

  // Protected Web
  "web.explore.proposed": "{count} suggestions proposed for review — none accepted until you say so",

  // What works here
  "avail.title": "What works here",
  "avail.lead": "Read from this build as it is assembled on this machine, each time this screen opens. Four words, kept apart: available · needs setup · disabled by policy · not implemented.",
  "avail.reading": "Reading the runtime…",
  "avail.foot": "Nothing on this list is a promise. A thing named but built nowhere says not implemented; a thing held off by a switch says that the switch is not on this screen.",
  "web.act.unavailable": "Actions from a tab are {state}: {because}",

  // Your models — reachable when a task needs it, and from the palette
  "models.title": "Your models",
  "models.needed": "This task can use cloud AI. Connect a key, or continue with local capabilities.",
  "models.back": "Back",

  // Keyboard map
  "keys.title": "Keyboard",
  "keys.close": "Close",
  "keys.palette": "Command palette",
  "keys.density": "Density: compact · comfortable · detailed",
  "keys.zones": "Zones: sources · decisions · work · deliveries",
  "keys.move": "Move through what is listed",
  "keys.open": "Open the selected thing",
  "keys.present": "Present the current Scene",
  "keys.escape": "Leave any mode",
  "keys.standing": "Where do I stand",
  "keys.map": "This map",

  // Screen-reader sentences — facts, no adjectives
  "sr.standing": "Where you stand on {goal}, {status}: {known} known, {proposed} proposed, {disputed} disputed, {unknown} unknown, {chosen} chosen despite uncertainty. {changed} changed since you left. {next} next actions open. {needed} things needed to finish.",
  "sr.proposals": "{count} proposals waiting for review. Nothing among them is recorded until you accept it.",
  "sr.proposals.none": "No proposals waiting.",
  "sr.moves": "Four thinking moves on {title}: find the basis, challenge it, connect it, test it. {unavailable} of them need a model that is not available.",
  "sr.context": "Context for this request: {included} items included, {excluded} left out, {destination}.",
  "sr.context.local": "stays on this machine",
  "sr.context.remote": "sent to {model}",
  "sr.trust.settled": "Trust: every fact is settled.",
} as const;

export type MessageKey = keyof typeof EN;
type Vars = Readonly<Record<string, string | number>>;

/** The sentence for `key`, in the active language, with `{name}` filled from `vars`. */
export function t(key: MessageKey, vars?: Vars): string {
  const template: string = EN[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (hole, name: string) => name in vars ? String(vars[name]) : hole);
}

/** A form role as a person would say it: Document, 3D model, Print — never "doc.primary". */
export function formRoleWord(role: string): string { return formRoleName(role); }

/**
 * The implementation's nouns. They stay in code, tables, IPC and the technical detail a
 * person can open; they do not appear in the words a screen says. A test holds every
 * rendered surface to it, outside `.xr-technical`.
 */
export const IMPLEMENTATION_WORDS = /\b(World|Worlds|Object|Objects|candidate|candidates|Hands|Brain)\b/;
export function stripTechnical(html: string): string {
  return html.replace(/<span class="xr-technical">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, " ");
}

/** Every key, for tests that walk the table. */
export const MESSAGE_KEYS = Object.keys(EN) as MessageKey[];
