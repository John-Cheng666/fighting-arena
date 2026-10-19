import { TICK_RATE } from "../../../engine/types";
import type { CharacterRenderer } from "../../../view/phaser/CharacterRenderer";
import { JamieRig } from "./phaser/JamieRig";
import { preloadJamieSprites, prepareJamieSprites } from "./phaser/JamieSprites";
import { getJamieState } from "../state";
import { describeJamieSuperContact } from "../presentation";

export const jamieRenderer: CharacterRenderer = {
  preload: preloadJamieSprites, prepare: prepareJamieSprites,
  superContact: describeJamieSuperContact,
  create: (scene, color) => {
    const rig = new JamieRig(scene, color);
    return { root: rig.root, height: 142,
      update(fighter, state, interpolation) {
        const source = fighter.capture ? state.fighters.find((other) => other.id === fighter.capture?.sourceId) : undefined;
        rig.update(fighter, state.tick, (state.tick + ((state.superFreezeRemaining ?? 0) > 0 ? 0 : interpolation)) / TICK_RATE,
          state.phase === "running", state.phase === "finished" && state.winner === fighter.id, getJamieState(source)?.action ?? undefined, source);
      },
    };
  },
};
