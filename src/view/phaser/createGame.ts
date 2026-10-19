import Phaser from "phaser";
import type { BattleRuntime } from "../../runtime/BattleRuntime";
import { BattleScene } from "./BattleScene";
import type { StageId } from "../../content/stages";

export type GameController = {
  destroy: () => void;
  setStage: (stageId: StageId) => void;
};

export function createGame(
  parent: HTMLElement,
  runtime: BattleRuntime,
  stageId: StageId,
): GameController {
  const scene = new BattleScene(runtime, stageId);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 720,
    height: 720,
    backgroundColor: "#13151c",
    scene: [scene],
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, pixelArt: false, roundPixels: false },
    audio: { noAudio: true },
    banner: false,
    fps: { target: 60 },
  });
  let resizeFrame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (game.isBooted) game.scale.refresh();
    });
  });
  observer.observe(parent);
  return {
    setStage: (id) => scene.setStage(id),
    destroy: () => {
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      game.destroy(true);
    },
  };
}
