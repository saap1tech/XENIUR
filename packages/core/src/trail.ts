/**
 * The Agent Trail — what the agent saw, decided, was authorised to do, and executed.
 *
 * Four columns, strictly ordered. A row that stopped early leaves the later columns null.
 * Nothing is inferred to fill a gap; every cell that is filled opens its digest, and every
 * digest is verifiable against the stored plan.
 */
export interface TrailRow {
  id: string;
  worldId: string;
  objectId: string | null;
  intent: string;
  saw: { digest: string; included: number; excluded: number } | null;
  decided: { kind: string; model: string | null } | null;
  authorized: { planDigest: string; level: string } | null;
  executed: { actionId: string; outcome: string } | null;
  at: number;
}

/** The sentence a screen reader hears for one row. */
export function describeTrailRow(r: TrailRow): string {
  const parts = [
    r.saw ? `Saw ${r.saw.included} item${r.saw.included === 1 ? "" : "s"}, ${r.saw.excluded} excluded.` : "Saw nothing compiled.",
    r.decided ? `Decided: ${r.decided.kind}${r.decided.model ? ` by ${r.decided.model}` : ""}.` : "Nothing decided.",
    r.authorized ? `Authorised: ${r.authorized.level}.` : "Nothing authorised.",
    r.executed ? `Executed: ${r.executed.outcome}.` : "Nothing executed.",
  ];
  return parts.join(" ");
}
