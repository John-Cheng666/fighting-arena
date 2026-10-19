import { type BattleEvent, type BattleState, type ContactEvent, type PendingHit } from "../types";
import type { CharacterRegistry, HitContext, HitLedger } from "../characters";

function fallbackHit(context: HitContext): void {
  const { state, hit, source, target, events, ledger } = context;
  const amount = Math.max(0, hit.damage);
  ledger.damage.set(target.id, (ledger.damage.get(target.id) ?? 0) + amount);
  ledger.healing.set(source.id, (ledger.healing.get(source.id) ?? 0) + Math.max(0, hit.heal));
  target.stunUntilTick = Math.max(target.stunUntilTick, state.tick + (hit.stun ?? 12));
  target.knockdownUntilTick = Math.max(target.knockdownUntilTick, state.tick + (hit.knockdown ?? 0));
  target.height = Math.max(target.height, hit.launch ?? 0);
  target.lastHitBy = source.id; target.lastHitTick = state.tick; target.hitUntilTick = state.tick + 7;
  if (hit.finish) ledger.finishing.add(target.id);
  context.outcome = { kind: "hit", amount, armor: false };
  events.push({ type: "hit", tick: state.tick, sourceId: source.id, targetId: target.id, amount, moveId: hit.moveId, x: target.x, y: target.y - 84 });
}

export function resolveHits(state: BattleState, hits: readonly PendingHit[], events: BattleEvent[], registry: CharacterRegistry): void {
  const ledger: HitLedger = { alive: new Set(state.fighters.filter((fighter) => fighter.hp > 0).map((fighter) => fighter.id)), damage: new Map(), healing: new Map(), finishing: new Set(), suppressed: new Set() };
  const { damage, healing, finishing } = ledger;
  const contacts: ContactEvent[] = [];
  for (const hit of hits) {
    if (!ledger.alive.has(hit.sourceId) || !ledger.alive.has(hit.targetId) || hit.sourceId === hit.targetId) continue;
    if (ledger.suppressed.has(hit.sourceId) || ledger.suppressed.has(hit.targetId)) continue;
    const source = state.fighters.find((fighter) => fighter.id === hit.sourceId)!;
    const target = state.fighters.find((fighter) => fighter.id === hit.targetId)!;
    const context: HitContext = { state, hit, source, target, events, ledger, outcome: { kind: "ignored", amount: 0, armor: false } };
    const previousDamage = damage.get(target.id) ?? 0;
    const name = registry.get(source.characterId).describe(state, source).actionName;
    const receiver = registry.get(target.characterId).resolveIncomingHit;
    if (receiver) receiver(context); else fallbackHit(context);
    if (context.outcome.kind === "hit") { source.hits += 1; source.damageDealt += context.outcome.amount; }
    registry.get(source.characterId).onContact?.(context);
    if (context.outcome.kind !== "ignored") {
      const amount = Math.max(0, (damage.get(target.id) ?? 0) - previousDamage);
      const contact: ContactEvent = {
        type: "contact", tick: state.tick, sourceId: source.id, targetId: target.id,
        moveId: hit.moveId, variantId: hit.variantId, segment: hit.segment,
        name: name || hit.moveId || (hit.projectile ? "弹体" : "攻击"),
        ...context.details,
        outcome: context.outcome.kind, amount, hpLoss: 0, hpBefore: target.hp, hpAfter: target.hp,
        damageType: context.outcome.kind === "block" && amount > 0 ? "chip" : hit.throw ? "throw" : hit.projectile ? "projectile" : "strike",
        armor: context.outcome.armor, recoverable: !!hit.recoverable,
        captured: !!(hit.capture || hit.capturedHit), finish: !!hit.finish,
      };
      contacts.push(contact);
      events.push(contact);
    }
  }
  for (const fighter of state.fighters) {
    const before = fighter.hp;
    let afterDamage = Math.max(0, before - (damage.get(fighter.id) ?? 0));
    if (afterDamage === 0 && fighter.capture && !finishing.has(fighter.id)) {
      afterDamage = 1;
      fighter.capture.pendingKnockout = true;
    }
    // Attribute the committed HP loss in contact order. Overkill and cinematic
    // survival at 1 HP must not inflate the actual health removed.
    let remainingHp = before;
    for (const contact of contacts) if (contact.targetId === fighter.id) {
      contact.hpBefore = remainingHp;
      contact.hpLoss = Math.min(contact.amount, Math.max(0, remainingHp - afterDamage));
      remainingHp -= contact.hpLoss;
      contact.hpAfter = remainingHp;
    }
    // A lethal hit cannot be undone by healing in the same simulation step.
    const recovered =
      afterDamage > 0
        ? Math.min(healing.get(fighter.id) ?? 0, fighter.maxHp - afterDamage)
        : 0;
    fighter.hp = afterDamage + recovered;
    if (recovered > 0) {
      fighter.healing += recovered;
      events.push({
        type: "heal",
        tick: state.tick,
        targetId: fighter.id,
        amount: recovered,
        reason: "hit", hpBefore: afterDamage, hpAfter: fighter.hp,
        x: fighter.x + 14,
        y: fighter.y - 96,
      });
    }
    if (before > 0 && fighter.hp === 0)
      events.push({
        type: "death",
        tick: state.tick,
        fighterId: fighter.id,
        x: fighter.x,
        y: fighter.y,
      });
  }
  for (const fighter of state.fighters) if (finishing.has(fighter.id) && fighter.capture?.phase === "finish") {
    const source = state.fighters.find((candidate) => candidate.id === fighter.capture!.sourceId)!;
    registry.get(source.characterId).releaseCapture?.(state, source, true, events);
  }
}
