import type { CharacterRenderer } from "../view/phaser/CharacterRenderer";
import { jamieRenderer } from "./jamie/view/renderer";

const renderers: Record<string, CharacterRenderer> = { jamie: jamieRenderer };
const fallback: CharacterRenderer = {
  preload() {}, prepare() {},
  create(scene, color) {
    const root = scene.add.container(0, 0, [scene.add.rectangle(0, -45, 35, 90, color).setOrigin(0.5)]);
    return { root, height: 100, update(fighter) { root.setY(-fighter.height); } };
  },
};
export function getCharacterRenderer(id: string): CharacterRenderer { return renderers[id] ?? fallback; }
export function registerCharacterRenderer(id: string, renderer: CharacterRenderer): void {
  if (renderers[id]) throw new Error(`角色绘制已注册：${id}`);
  renderers[id] = renderer;
}
