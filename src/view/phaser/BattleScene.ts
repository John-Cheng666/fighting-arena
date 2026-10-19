import Phaser from "phaser";
import type { BattleRuntime } from "../../runtime/BattleRuntime";
import {
  TICK_RATE,
  type BattleEvent,
  type Fighter,
  type FighterId,
  type CharacterId,
  type Projectile,
} from "../../engine/types";
import { DEFAULT_STAGE, type StageId } from "../../content/stages";
import { StageScenery, preloadStages } from "./StageScenery";
import { getCharacterRenderer } from "../../characters/renderers";
import type { CharacterVisual } from "./CharacterRenderer";
import { PresentationClock } from "./PresentationClock";
import { SuperEffects, SUPER_EFFECT_PALETTES, type SuperEffectActor, type SuperEffectImpact } from "./SuperEffects";

type FighterView = {
  root: Phaser.GameObjects.Container;
  characterId: CharacterId;
  visual: CharacterVisual;
  health: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  move: Phaser.GameObjects.Text;
  shadow: Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Graphics;
};
type ProjectileView = {
  root: Phaser.GameObjects.Container;
  image: Phaser.GameObjects.Image;
};
type FloatingText = {
  text: Phaser.GameObjects.Text;
  life: number;
  duration: number;
  startY: number;
  vx: number;
};
type Ring = {
  x: number;
  y: number;
  life: number;
  duration: number;
  color: number;
};
type Ghost = { image: Phaser.GameObjects.Image; life: number };
type Burst = { x: number; y: number; life: number; duration: number; color: number; seed: number; large: boolean };

const FONT = 'Arial, "Microsoft YaHei", sans-serif';
const SUPER_ART_LABELS = {
  spin: "SUPER ART I  /  BREAKIN'",
  install: "SUPER ART II  /  DRUNKEN POWER",
  strike: "SUPER ART III  /  GETSUGA SAIHO",
  critical: "CRITICAL ART  /  LIMIT BREAK",
} as const;

export class BattleScene extends Phaser.Scene {
  private readonly runtime: BattleRuntime;
  private fighters = new Map<FighterId, FighterView>();
  private projectiles = new Map<number, ProjectileView>();
  private floaters: FloatingText[] = [];
  private rings: Ring[] = [];
  private ghosts: Ghost[] = [];
  private bursts: Burst[] = [];
  private effects!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Container;
  private resultTitle!: Phaser.GameObjects.Text;
  private resultCaption!: Phaser.GameObjects.Text;
  private overlayShade!: Phaser.GameObjects.Rectangle;
  private lastRevision = -1;
  private visualTime = 0;
  private resultLife = 0;
  private stageId: StageId;
  private scenery?: StageScenery;
  private cinematicZoom = 1;
  private cinematicShade!: Phaser.GameObjects.Graphics;
  private cinematicTitle!: Phaser.GameObjects.Text;
  private cinematicKicker!: Phaser.GameObjects.Text;
  private cinematicFrame!: Phaser.GameObjects.Graphics;
  private superEffects!: SuperEffects;
  private superActors: SuperEffectActor[] = [];
  private superImpacts: (Omit<SuperEffectImpact, "ageFrames"> & { born: number })[] = [];
  private readonly presentationClock = new PresentationClock();
  private aftermathFrames = 0;
  private reducedMotion = false;
  private motionPreference?: MediaQueryList;
  private readonly onMotionPreference = (event: MediaQueryListEvent) => { this.reducedMotion = event.matches; };

  constructor(runtime: BattleRuntime, stageId: StageId = DEFAULT_STAGE) {
    super({ key: "Battle" });
    this.runtime = runtime;
    this.stageId = stageId;
  }

  preload(): void {
    for (const module of this.runtime.characters.list()) getCharacterRenderer(module.id).preload(this);
    preloadStages(this);
  }

  setStage(id: StageId): void {
    this.stageId = id;
    this.scenery?.setStage(id);
  }

  create(): void {
    this.scenery = new StageScenery(this, this.stageId);
    for (const module of this.runtime.characters.list()) getCharacterRenderer(module.id).prepare(this);
    this.prepareProjectileTexture();
    this.effects = this.add.graphics().setDepth(800);
    this.cinematicShade = this.add.graphics().setDepth(80);
    this.superEffects = new SuperEffects(this);
    this.cinematicFrame = this.add.graphics().setDepth(965);
    this.cinematicKicker = this.add.text(360, 26, "", {
      fontFamily: FONT, fontSize: "11px", fontStyle: "bold", color: "#ffe4a0",
      stroke: "#060b13", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(974).setVisible(false);
    this.cinematicTitle = this.add.text(360, 51, "", {
      fontFamily: FONT, fontSize: "25px", fontStyle: "bold", color: "#fff5dd",
      stroke: "#060b13", strokeThickness: 5,
    }).setOrigin(0.5).setDepth(975).setVisible(false);
    this.motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.motionPreference?.matches ?? false;
    this.motionPreference?.addEventListener("change", this.onMotionPreference);
    this.presentationClock.reset(this.runtime.getState().tick);
    for (const fighter of this.runtime.getState().fighters)
      this.fighters.set(fighter.id, this.createFighter(fighter));
    this.overlayShade = this.add.rectangle(360, 360, 720, 720, 0x070912, 0.48);
    const resultPlate = this.add.graphics();
    resultPlate.fillStyle(0x10131c, 0.94).fillRoundedRect(-304, -72, 608, 148, 12);
    resultPlate.lineStyle(1, 0xffc78b, 0.42).strokeRoundedRect(-304, -72, 608, 148, 12);
    this.resultTitle = this.add
      .text(0, -12, "", {
        fontFamily: FONT,
        fontSize: "47px",
        fontStyle: "bold",
        color: "#fff2dc",
        stroke: "#10131c",
        strokeThickness: 2,
      })
      .setOrigin(0.5);
    this.resultCaption = this.add
      .text(0, 41, "", {
        fontFamily: FONT,
        fontSize: "16px",
        color: "#c0c4d2",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.overlay = this.add
      .container(360, 360, [resultPlate, this.resultTitle, this.resultCaption])
      .setDepth(1100);
    this.overlayShade.setDepth(1000).setVisible(false);
    this.overlay.setVisible(false);
    this.scale.on(Phaser.Scale.Events.RESIZE, () =>
      this.cameras.main.setViewport(0, 0, 720, 720),
    );
    this.lastRevision = this.runtime.getSummary().revision;
    this.runtime.setLoaded(true);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      this.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
      this.scenery?.destroy();
      this.scenery = undefined;
      this.clearEffects();
      this.superEffects.destroy();
      this.motionPreference?.removeEventListener("change", this.onMotionPreference);
      this.runtime.setLoaded(false);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  }

  update(_time: number, deltaMs: number): void {
    this.scenery?.update(this.runtime.isPaused ? 0 : Math.min(deltaMs / 1000, 0.05) * this.runtime.timeScale);
    if (this.lastRevision !== this.runtime.getSummary().revision) {
      this.lastRevision = this.runtime.getSummary().revision;
      this.clearEffects();
      this.projectiles.forEach((view) => view.root.destroy());
      this.projectiles.clear();
      this.resultLife = 0;
      this.cinematicZoom = 1;
      this.cameras.main.setZoom(1).setScroll(0, 0);
      this.fighters.forEach((view) => view.root.destroy());
      this.fighters.clear();
      for (const fighter of this.runtime.getState().fighters)
        this.fighters.set(fighter.id, this.createFighter(fighter));
    }
    const events = this.runtime.advance(deltaMs / 1000);
    const state = this.runtime.getState();
    this.superActors = state.phase === "running" ? state.fighters.flatMap(fighter => {
      const cinematic = this.runtime.battle.describe(fighter).cinematic;
      if (!cinematic?.superArt) return [];
      const target = state.fighters.find(other => other.id === cinematic.targetId);
      return [{ ...cinematic.superArt, name: cinematic.title, x: fighter.x, y: fighter.y,
        height: fighter.height, facing: fighter.facing,
        target: target ? { x: target.x, y: target.y, height: target.height } : undefined }];
    }) : [];
    const presentationDelta = this.presentationClock.sample(state.tick, this.superActors);
    if (state.phase === "finished") this.aftermathFrames += Math.min(deltaMs / 1000, 0.05) * TICK_RATE;
    const effectDelta =
      state.phase === "finished"
        ? Math.min(deltaMs / 1000, 0.05)
        : Math.min(deltaMs / 1000, 0.05) * this.runtime.timeScale;
    const frozen = (state.superFreezeRemaining ?? 0) > 0;
    if (!frozen) this.visualTime += effectDelta;
    for (const fighter of state.fighters) this.syncFighter(fighter);
    this.syncProjectiles(state.projectiles);
    this.consume(events);
    this.updateEffects(frozen ? 0 : effectDelta);
    const effectFrame = this.presentationClock.frame + this.aftermathFrames;
    this.superImpacts = this.superImpacts.filter(impact => effectFrame - impact.born < (impact.blocked ? 17 : impact.finisher ? 34 : 23));
    this.superEffects.render(this.superActors, this.superImpacts.map(impact => ({ ...impact, ageFrames: effectFrame - impact.born })), this.reducedMotion);
    this.updateCinematic(presentationDelta / TICK_RATE);
    this.updateOverlay();
  }

  private prepareProjectileTexture(): void {
    const texture = this.textures.createCanvas("projectile", 48, 48)!;
    const context = texture.getContext();
    const fill = context.createRadialGradient(24,24,2,24,24,23);
    fill.addColorStop(0,"#ffffff"); fill.addColorStop(0.3,"#a5f3ff"); fill.addColorStop(1,"#68d8ff00");
    context.fillStyle=fill; context.fillRect(0,0,48,48); texture.refresh();
  }

  private createFighter(fighter: Fighter): FighterView {
    const root = this.add.container(fighter.x, fighter.y);
    const color = fighter.id === "p1" ? 0xffd275 : 0x84dfdf;
    const visual = getCharacterRenderer(fighter.characterId).create(this, color);
    const shadow = this.add.ellipse(0,1,80,17,0x080a12,0.25);
    const ring = this.add.graphics();
    const health = this.add.graphics().setPosition(0, -visual.height - 10);
    const label = this.add.text(0,-visual.height-22,"",{fontFamily:FONT,fontSize:"11px",fontStyle:"bold",color:fighter.id === "p1" ? "#ffdfa4" : "#b0f3ef",stroke:"#151520",strokeThickness:3}).setOrigin(0.5);
    const move = this.add.text(0,-visual.height-40,"",{fontFamily:FONT,fontSize:"10px",color:"#fff3d7",backgroundColor:"#111821d9",padding:{x:5,y:3},align:"center"}).setOrigin(0.5);
    root.add([shadow,ring,visual.root,health,label,move]);
    return { root, characterId: fighter.characterId, visual, health, label, move, shadow, ring };
  }

  private syncFighter(fighter: Fighter): void {
    let view = this.fighters.get(fighter.id);
    if (!view || view.characterId !== fighter.characterId) {
      view?.root.destroy(); view=this.createFighter(fighter); this.fighters.set(fighter.id,view);
    }
    const state=this.runtime.getState();
    const status=this.runtime.battle.describe(fighter);
    const alpha=this.runtime.isPaused ? 1 : this.runtime.alpha;
    const x=Phaser.Math.Linear(fighter.previousX,fighter.x,alpha), y=Phaser.Math.Linear(fighter.previousY,fighter.y,alpha);
    const opening = this.runtime.getOpening(), entrance = opening?.entrances[fighter.id] ?? 1;
    const enter = this.reducedMotion ? 1 : 1 - Math.pow(1 - entrance, 3);
    const entranceOffset = (fighter.id === "p1" ? -340 : 340) * (1 - enter);
    const alive=fighter.hp>0;
    view.root.setPosition(x + entranceOffset,y).setDepth(y).setAlpha(entrance > 0 || !opening ? 1 : 0);
    if(status.foreground && status.cinematic?.targetId) {
      const target=state.fighters.find(other=>other.id===status.cinematic?.targetId);
      if(target)view.root.setDepth(Math.max(y,target.y)+2);
    }
    view.visual.update(opening && enter < 1 ? { ...fighter, vx: fighter.id === "p1" ? 90 : -90 } : fighter,state,alpha);
    view.shadow.setScale(Math.max(0.45,1-fighter.height/240)).setAlpha(Math.max(0.08,0.27-fighter.height/800));
    const color=fighter.id === "p1" ? 0xffd275 : 0x84dfdf;
    view.ring.clear().lineStyle(1.5,color,alive?0.75:0.2).strokeEllipse(0,1,66,18).lineStyle(3,color,0.16).strokeEllipse(0,1,74,21);
    const seat=fighter.id === "p1" ? "1P" : "2P";
    view.label.setText(`${seat} ${this.runtime.characters.get(fighter.characterId).metadata.name}${status.subLabel ? "  "+status.subLabel : ""}`);
    const overheadY=-view.visual.height-22-Math.min(fighter.height,55);
    const below=y+overheadY<58;
    const other=state.fighters.find(other=>other.id!==fighter.id)!;
    const nearby=Math.hypot(fighter.x-other.x,fighter.y-other.y)<120;
    const labelX=nearby?(fighter.x<=other.x?-20:20):0;
    view.label.setPosition(labelX,(below?22:overheadY)-(nearby && fighter.id === "p2"?35:0));
    view.health.setPosition(labelX,view.label.y+13);
    const name=status.actionId ? status.actionName+(status.hitCount>1?` · ${status.hitCount} HIT`:"") : fighter.knockdownUntilTick>state.tick?"倒地":fighter.stunUntilTick>state.tick?"受击硬直":"";
    view.move.setPosition(labelX,view.label.y+(below?27:-20)).setText(name.length>30?name.slice(0,29)+"…":name);
    const cinematic=state.fighters.some(actor=>Boolean(this.runtime.battle.describe(actor).cinematic));
    view.label.setVisible(alive&&!cinematic); view.health.setVisible(alive&&!cinematic); view.move.setVisible(alive&&!cinematic&&Boolean(name));
    const ratio=fighter.hp/fighter.maxHp;
    view.health.clear().fillStyle(0x101621,0.9).fillRoundedRect(-36,-2,72,5,2).fillStyle(ratio<0.3?0xfb6b79:color).fillRoundedRect(-35,-1,Math.max(1,70*ratio),3,1);
  }

  private syncProjectiles(projectiles: Projectile[]): void {
    const visible = new Set(projectiles.map((projectile) => projectile.id));
    for (const [id, view] of this.projectiles) {
      if (!visible.has(id)) {
        view.root.destroy();
        this.projectiles.delete(id);
      }
    }
    const alpha = this.runtime.isPaused ? 1 : this.runtime.alpha;
    for (const projectile of projectiles) {
      let view = this.projectiles.get(projectile.id);
      if (!view) {
        const image = this.add
          .image(0, 0, "projectile")
          .setDisplaySize(33, 37);
        const bar = this.add.graphics();
        bar.fillStyle(0x245b74, 0.8).fillRect(-11, -23, 22, 2);
        bar
          .fillStyle(projectile.gold ? 0xffddac : 0xe9b1ec)
          .fillRect(-11, -23, 7, 2);
        view = { root: this.add.container(0, 0, [image, bar]), image };
        this.projectiles.set(projectile.id, view);
      }
      const x = Phaser.Math.Linear(projectile.previousX, projectile.x, alpha);
      const y = Phaser.Math.Linear(projectile.previousY, projectile.y, alpha);
      view.root.setPosition(x, y).setDepth(y + 20);
      view.root.setAlpha(
        Math.min(1, (projectile.expiresAt - this.runtime.getState().tick) / 40),
      );
      view.image.setAngle(Math.sin(this.visualTime * 4 + projectile.id) * 9);
    }
  }

  private consume(events: readonly BattleEvent[]): void {
    for (const event of events) {
      if (event.type === "contact") {
        const state = this.runtime.getState();
        const source = state.fighters.find(fighter => fighter.id === event.sourceId);
        const target = state.fighters.find(fighter => fighter.id === event.targetId);
        const effect = source && getCharacterRenderer(source.characterId).superContact?.(event);
        if (effect && source && target) {
          this.superImpacts.push({ ...effect, x: target.x, y: target.y - target.height - 70,
            born: this.presentationClock.frame, seed: event.tick * 17 + (event.segment ?? 0) * 31,
            blocked: event.outcome === "block", direction: Math.sign(source.x - target.x) || -target.facing });
          if (this.superImpacts.length > 24) this.superImpacts.shift();
        }
        continue;
      }
      if (event.type === "hit" || event.type === "heal") {
        const healing = event.type === "heal";
        // Rapid super hits are counted once in the actor label and resource
        // panel. Stacked damage numbers would hide the limbs being animated.
        if (event.type === "heal" || event.category !== "super") {
        const text = this.add
          .text(
            event.x + Phaser.Math.Between(-12, 12),
            event.y,
            `${healing ? "+" : "−"}${event.amount}`,
            {
              fontFamily: FONT,
              fontSize: healing ? "22px" : "24px",
              fontStyle: "bold",
              color: healing ? "#9effd4" : "#ffe59c",
              stroke: "#171b28",
              strokeThickness: 2,
            },
          )
          .setOrigin(0.5)
          .setDepth(900);
        this.floaters.push({
          text,
          life: 0.7,
          duration: 0.7,
          startY: event.y,
          vx: Phaser.Math.Between(-9, 9),
        });
        }
        if (!healing && event.category !== "super") {
          this.rings.push({
            x: event.x,
            y: event.y + 13,
            life: 0.23,
            duration: 0.23,
            color: 0xffffff,
          });
          const source = this.runtime.getState().fighters.find((fighter) => fighter.id === event.sourceId);
          this.bursts.push({ x: event.x, y: event.y + 10, life: 0.18, duration: 0.18, color: 0xffe9b0, seed: event.tick, large: Boolean(source && this.runtime.battle.describe(source).cinematic?.finalImpact) });
        }
      } else if (event.type === "cast") {
        this.rings.push({
          x: event.x,
          y: event.y,
          life: 0.36,
          duration: 0.36,
          color: 0xf0c2ff,
        });
      } else if (event.type === "death") {
        this.rings.push({
          x: event.x,
          y: event.y - 35,
          life: 0.65,
          duration: 0.65,
          color: 0xffe6bc,
        });
        this.bursts.push({ x: event.x, y: event.y - 25, life: 0.6, duration: 0.6, color: 0xffd177, seed: event.tick, large: true });
        if (!this.reducedMotion) this.cameras.main.shake(180, 0.003);
      } else if (event.type === "drink") {
        this.floatingLabel(event.x, event.y - 150, `饮酒 Lv.${event.level}`, "#ffdf9b", 0.9);
        this.rings.push({ x: event.x, y: event.y, life: 0.55, duration: 0.55, color: 0xf5cf75 });
        this.bursts.push({ x: event.x, y: event.y - 108, life: 0.45, duration: 0.45, color: 0xffe4a0, seed: event.tick, large: false });
      } else if (event.type === "interrupt") {
        this.floatingLabel(event.x, event.y - 144, event.label ?? "动作被打断", "#ffb3ae", 0.8);
      } else if (event.type === "block") {
        const color = event.parry ? 0xa9acff : 0xa4dfff;
        this.bursts.push({ x: event.x, y: event.y - 75, life: 0.22, duration: 0.22, color, seed: event.tick, large: false });
        if (event.perfect) this.floatingLabel(event.x, event.y - 130, "PERFECT PARRY", "#c6c1ff", 0.8);
      }
    }
  }

  private floatingLabel(x: number, y: number, content: string, color: string, duration: number, size = 13): void {
    const text = this.add.text(x, y, content, {
      fontFamily: FONT, fontSize: `${size}px`, fontStyle: "bold", color,
      stroke: "#13131e", strokeThickness: 4, align: "center",
    }).setOrigin(0.5).setDepth(950);
    this.floaters.push({ text, life: duration, duration, startY: y, vx: 0 });
  }

  private updateEffects(delta: number): void {
    this.effects.clear();
    this.floaters = this.floaters.filter((floating) => {
      floating.life -= delta;
      if (floating.life <= 0) {
        floating.text.destroy();
        return false;
      }
      const progress = 1 - floating.life / floating.duration;
      floating.text
        .setY(floating.startY - progress * 49)
        .setX(floating.text.x + floating.vx * delta)
        .setAlpha(Math.min(1, floating.life * 3.5));
      return true;
    });
    this.rings = this.rings.filter((ring) => {
      ring.life -= delta;
      if (ring.life <= 0) return false;
      const progress = 1 - ring.life / ring.duration;
      this.effects
        .lineStyle(2 - progress, ring.color, (1 - progress) * 0.55)
        .strokeEllipse(ring.x, ring.y, 18 + progress * 56, 9 + progress * 29);
      return true;
    });
    this.ghosts = this.ghosts.filter((ghost) => {
      ghost.life -= delta;
      if (ghost.life <= 0) {
        ghost.image.destroy();
        return false;
      }
      ghost.image.setAlpha((ghost.life / 0.22) * 0.19);
      return true;
    });
    this.bursts = this.bursts.filter((burst) => {
      burst.life -= delta;
      if (burst.life <= 0) return false;
      const progress = 1 - burst.life / burst.duration;
      const length = burst.large ? 54 : 32;
      for (let i = 0; i < (burst.large ? 12 : 7); i++) {
        const angle = i * 2.4 + burst.seed * 0.17;
        const inner = 3 + progress * length * 0.65;
        const outer = inner + (1 - progress) * length * (0.4 + (i % 3) * 0.2);
        this.effects.lineStyle((burst.large ? 3 : 2) * (1 - progress), burst.color, (1 - progress) * 0.85)
          .lineBetween(burst.x + Math.cos(angle) * inner, burst.y + Math.sin(angle) * inner,
            burst.x + Math.cos(angle) * outer, burst.y + Math.sin(angle) * outer);
      }
      if (progress < 0.35) this.effects.fillStyle(0xfff6df, (1 - progress / 0.35) * 0.8)
        .fillCircle(burst.x, burst.y, (burst.large ? 10 : 6) * (1 - progress));
      return true;
    });
    for (const projectile of this.runtime.getState().projectiles) {
      if (!projectile.gold) continue;
      const length = Math.hypot(projectile.vx, projectile.vy);
      this.effects
        .lineStyle(1.5, 0xffffff, 0.2)
        .lineBetween(
          projectile.x - (projectile.vx / length) * 8,
          projectile.y - (projectile.vy / length) * 8,
          projectile.x - (projectile.vx / length) * 28,
          projectile.y - (projectile.vy / length) * 28,
        );
    }
  }

  private updateOverlay(): void {
    const summary = this.runtime.getSummary();
    const finished = this.runtime.getState().phase === "finished";
    const paused = summary.phase === "paused";
    const demonstration = this.runtime.battle.demonstration;
    if (demonstration) {
      this.overlay.setVisible(false);
      this.overlayShade.setVisible(false);
      return;
    }
    this.overlay.setVisible(finished || paused);
    this.overlayShade.setVisible(finished || paused);
    if (finished) {
      this.resultLife += this.game.loop.delta / 1000;
      const winner = this.runtime.getState().winner;
      const winnerFighter = this.runtime.getState().fighters.find((fighter) => fighter.id === winner);
      this.resultTitle
        .setText(
          winnerFighter
            ? `${winnerFighter.id === "p1" ? "1P" : "2P"} ${this.runtime.characters.get(winnerFighter.characterId).metadata.name.replace(" ", "")}获胜`
            : "平分秋色",
        )
        .setColor("#fff2dc")
        .setFontSize(47);
      this.resultCaption.setText(
        `${(this.runtime.getState().tick / TICK_RATE).toFixed(1)} 秒的对决 · ${summary.result === "timeout" ? "时间到，按剩余生命判定" : winner ? "胜负已分，再来一局？" : "势均力敌，再来一局？"}`,
      );
      this.overlay.setAlpha(Math.min(1, this.resultLife * 2));
    } else if (paused) {
      this.resultTitle.setText("已暂停").setFontSize(42).setColor("#fff2dc");
      this.resultCaption.setText("按空格，继续这场对决");
      this.overlay.setAlpha(1);
    }
  }

  private updateCinematic(delta: number): void {
    const state=this.runtime.getState();
    const actor=state.phase === "running" ? state.fighters.find(f=>this.runtime.battle.describe(f).cinematic) : undefined;
    const cinematic=actor ? this.runtime.battle.describe(actor).cinematic : undefined;
    const target=cinematic?.targetId ? state.fighters.find(f=>f.id===cinematic.targetId) : undefined;
    const art = cinematic?.superArt;
    const desiredZoom = this.reducedMotion ? 1 : cinematic?.zoom ?? 1;
    this.cinematicZoom=Phaser.Math.Linear(this.cinematicZoom,desiredZoom,Math.min(1,delta*8));
    if(state.phase === "finished" || this.reducedMotion)this.cinematicZoom=1;
    const focusX=actor?(actor.x+(target?.x??actor.x))/2:360, focusY=actor?(actor.y+(target?.y??actor.y))/2-67:360;
    const half=360/this.cinematicZoom;
    const effectFrame = this.presentationClock.frame + this.aftermathFrames;
    const impulse = !this.reducedMotion ? [...this.superImpacts].reverse().find(impact => !impact.blocked && effectFrame - impact.born < (impact.finisher ? 16 : 6)) : undefined;
    const age = impulse ? effectFrame - impulse.born : 0;
    const amplitude = impulse ? (impulse.finisher ? 5 : 1.8) * (1 - age / (impulse.finisher ? 16 : 6)) : 0;
    this.cameras.main.setZoom(this.cinematicZoom).centerOn(
      Phaser.Math.Clamp(Phaser.Math.Linear(360,focusX,Math.min(1,(this.cinematicZoom-1)*2.2)),half,720-half) + Math.sin(age * 2.4) * amplitude,
      Phaser.Math.Clamp(Phaser.Math.Linear(360,focusY,Math.min(1,(this.cinematicZoom-1)*2.2)),half,720-half) + Math.sin(age * 3.1) * amplitude * 0.6);
    this.cinematicTitle.setVisible(Boolean(cinematic));
    this.cinematicKicker.setVisible(Boolean(art));
    const frame = this.cinematicFrame.clear();
    if(cinematic) {
      const camera = this.cameras.main, z = this.cinematicZoom;
      // Phaser zooms around the viewport center; scroll is not its visible edge.
      const viewX = camera.scrollX + camera.width * (1 - 1 / z) / 2;
      const viewY = camera.scrollY + camera.height * (1 - 1 / z) / 2;
      this.cinematicTitle.setText(cinematic.title).setPosition(viewX+360/z,viewY+53/z).setScale(1/z);
      if (art) {
        const palette = SUPER_EFFECT_PALETTES[art.style];
        const opening = Math.min(1, (art.introFrame + art.frame) / 12);
        this.cinematicKicker.setText(SUPER_ART_LABELS[art.style]).setColor(`#${palette.primary.toString(16).padStart(6, "0")}`)
          .setPosition(viewX+360/z,viewY+27/z).setScale(1/z);
        frame.fillStyle(0x040811, 0.9 * opening).fillRect(viewX,viewY,720/z,79/z)
          .fillRect(viewX,viewY+688/z,720/z,32/z)
          .lineStyle(1/z,palette.primary,0.7).lineBetween(viewX+34/z,viewY+78/z,viewX+686/z,viewY+78/z);
        for (const x of [34, 686]) frame.lineStyle(3/z,palette.secondary,0.85).lineBetween(viewX+x/z,viewY+78/z,viewX+(x < 360 ? x+48 : x-48)/z,viewY+78/z);
      }
    }
    const shade=this.cinematicShade.clear();
    if(cinematic&&this.cinematicZoom>1.02) {
      shade.fillStyle(cinematic.shade,Math.min(0.46,(this.cinematicZoom-1)*0.8)).fillRect(0,0,720,720);
    }
  }

  private clearEffects(): void {
    this.floaters.forEach((floating) => floating.text.destroy());
    this.ghosts.forEach((ghost) => ghost.image.destroy());
    this.floaters = [];
    this.rings = [];
    this.ghosts = [];
    this.bursts = [];
    this.superActors = [];
    this.superImpacts = [];
    this.aftermathFrames = 0;
    this.presentationClock.reset(this.runtime.getState().tick);
    this.superEffects?.clear();
    this.cinematicFrame?.clear();
    this.cinematicTitle?.setVisible(false);
    this.cinematicKicker?.setVisible(false);
  }
}
