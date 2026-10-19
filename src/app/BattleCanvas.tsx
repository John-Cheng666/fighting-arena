import { useEffect, useRef, useState } from "react";
import type { BattleRuntime } from "../runtime/BattleRuntime";
import { getStage, type StageId } from "../content/stages";
import type { GameController } from "../view/phaser/createGame";

export function BattleCanvas({ runtime, stageId, matchup, onError }: { runtime: BattleRuntime; stageId: StageId; matchup: string; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<GameController | null>(null);
  const currentStage = useRef(stageId);
  const [error, setError] = useState("");

  useEffect(() => {
    currentStage.current = stageId;
    controller.current?.setStage(stageId);
  }, [stageId]);

  useEffect(() => {
    let cancelled = false;
    let game: GameController | undefined;
    void import("../view/phaser/createGame")
      .then(({ createGame }) => {
        if (!cancelled && host.current) {
          game = createGame(host.current, runtime, currentStage.current);
          controller.current = game;
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          const message = reason instanceof Error ? reason.message : "竞技场加载失败";
          setError(message);
          onError(message);
        }
      });
    return () => {
      cancelled = true;
      if (controller.current === game) controller.current = null;
      game?.destroy();
    };
  }, [runtime, onError]);

  return (
    <>
      <div
        ref={host}
        className="game-host"
        role="img"
        aria-label={`${getStage(stageId).name}：${matchup}自动对战竞技场`}
      />
      {error && (
        <div className="canvas-error" role="alert">
          <strong>竞技场暂时没能入场</strong>
          <span>{error}</span>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      )}
    </>
  );
}
