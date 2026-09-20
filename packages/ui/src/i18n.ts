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
  // First run
  "firstrun.title": "What would you like to work on?",
  "firstrun.lead": "Everything here works without a model key. When a task can use cloud AI, XENIUR says so at that moment — never before.",
  "firstrun.have.title": "I already have something to work with",
  "firstrun.have.body": "A document, an image, a link, a .blend, an article. XENIUR turns it into a recognizable Object.",
  "firstrun.have.verb": "Bring it in",
  "firstrun.new.title": "I want to start something new",
  "firstrun.new.body": "A question, an idea, a task or an outcome — one sentence, in your words.",
  "firstrun.new.label": "What are you trying to accomplish?",
  "firstrun.new.placeholder": "One sentence, in your words",
  "firstrun.new.verb": "Begin",
  "firstrun.continue.title": "I want to continue an existing project",
  "firstrun.continue.body": "Open a World already on this machine, or a .xeniur package someone sent you.",
  "firstrun.continue.package": "Open a .xeniur package",
  "firstrun.continue.none": "No Worlds on this machine yet.",
  "firstrun.example": "Or open the example — Rainwear 2027, marked as an example, safe to change.",
  "firstrun.skip": "Skip",
  "firstrun.notnow": "Not now",

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

/** Every key, for tests that walk the table. */
export const MESSAGE_KEYS = Object.keys(EN) as MessageKey[];
