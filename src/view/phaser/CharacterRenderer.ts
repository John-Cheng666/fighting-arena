import type Phaser from "phaser";
import type { BattleState, ContactEvent, Fighter } from "../../engine/types";
import type { SuperEffectStyle } from "./SuperEffects";

export interface CharacterVisual {
  root: Phaser.GameObjects.Container;
  height: number;
  update(fighter: Fighter, state: BattleState, interpolation: number): void;
}
export interface CharacterRenderer {
  preload(scene: Phaser.Scene): void;
  prepare(scene: Phaser.Scene): void;
  create(scene: Phaser.Scene, seatColor: number): CharacterVisual;
  superContact?(event: ContactEvent): { style: SuperEffectStyle; finisher: boolean } | undefined;
}
