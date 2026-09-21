import type { SupportStatus } from "@xeniur/core";

/**
 * The one way a citation's review is saved from a screen.
 *
 * A SupportChip used to render its supports / contradicts / ambiguous choice against a binding
 * nobody supplied, so the click changed nothing and the chip looked as if it had. This binding
 * saves through the bridge, refreshes what depends on it, and says so plainly when it fails —
 * never optimistic, never silent.
 */
export function reviewSupportBinding(deps: {
  save(supportId: string, status: SupportStatus): Promise<unknown>;
  /** Re-read the knowledge and decision state the review touches. */
  refresh(): Promise<void> | void;
  /** Tell the person, in words, when the save did not happen. */
  notify(message: string): void;
}): (supportId: string, status: SupportStatus) => Promise<void> {
  return async (supportId, status) => {
    try {
      await deps.save(supportId, status);
    } catch (cause) {
      deps.notify(`The review was not saved: ${cause instanceof Error ? cause.message : String(cause)}`);
      return;
    }
    await deps.refresh();
  };
}
