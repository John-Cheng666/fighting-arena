import type { CharacterUI } from "../app/characterUI";
import { JamieResources } from "./jamie/ui/Resources";
import { JamieTrainingPanel, TrainingStateStrip } from "./jamie/ui/TrainingPanel";
import "./jamie/ui/styles.css";

/** UI extensions are separate from gameplay registration, keeping the engine usable without a browser. */
const panels: Record<string, CharacterUI> = { jamie: { Resources: JamieResources, TrainingPanel: JamieTrainingPanel, TrainingStatus: TrainingStateStrip } };
export function getCharacterUI(id: string): CharacterUI { return panels[id] ?? {}; }
export function registerCharacterUI(id: string, ui: CharacterUI): void {
  if (panels[id]) throw new Error(`角色界面已注册：${id}`);
  panels[id] = ui;
}
