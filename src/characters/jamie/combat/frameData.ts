import type { JamieVariant } from "../moves";
import type { JamieAction } from "../types";

/** Published advantage is measured at the first frame of the final hit.
 * Keeping its stun length constant also preserves the advantage of a late hit. */
export function jamieContactStun(action: JamieAction, variant: JamieVariant, block: boolean): number {
  const contactFrame = variant.active.at(-1)?.[0] ?? variant.startup;
  const advantage = block ? variant.blockAdvantage : variant.hitAdvantage;
  return Math.max(0, action.duration - contactFrame + advantage + (action.rushEnhanced ? 4 : 0));
}
