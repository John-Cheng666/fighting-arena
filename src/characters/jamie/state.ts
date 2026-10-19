import type { JamieState } from "./types";

/** The only cast from an opaque engine state to this module's state. */
export function getJamieState(fighter: { characterId: string; characterState: unknown } | null | undefined): JamieState | undefined {
  return fighter?.characterId === "jamie" ? fighter.characterState as JamieState : undefined;
}
