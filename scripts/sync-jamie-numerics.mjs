import { readFile, writeFile } from "node:fs/promises";

// Only consumes retained, validated local game extracts. It never changes the
// installed game or downloads a table from another game version.
const read = async (path) => JSON.parse((await readFile(new URL(path, import.meta.url), "utf8")).replace(/^\uFEFF/, ""));
const profile = await read("../research/sf6-alignment/jamie-runtime-numerics.json");
const original = await read("../research/sf6-ai/combat-values/jamie-combat-profile.json");
const select = (value, fields) => Object.fromEntries(fields.map((key) => [key, value[key]]).filter(([, value]) => value !== undefined));
const hitFields = ["hitId", "attackId", "collisionType", "guardBit", "kindFlag", "condition", "active", "damage", "minimumDamage", "superGain", "driveGain", "blockSuperGain", "targetSuperGain", "blockTargetSuperGain", "blockDriveLoss", "punishDriveLoss", "hitStopOwner", "hitStopTarget", "blockHitStopOwner", "blockHitStopTarget", "hitStun", "blockStun"];
function captureProfile(capture, fallback) {
  const unlock = capture.locks?.find((lock) => lock.Type === 2) ?? fallback?.locks?.find((lock) => lock.Type === 2);
  const release = original.attacks[String(unlock?.Param02)];
  const gauge = release?._CommonGauges.find((entry) => entry.IndexID === 0);
  return {
    actionId: capture.actionId, duration: capture.duration,
    timerStops: capture.timerStops ?? [],
    releaseFrame: unlock ? unlock.from + 1 : capture.duration,
    worldStopFrames: capture.worlds?.find((world) => world.Type === 5)?.from ?? 0,
    releaseSuperGain: gauge?.GaugeOwner ?? 0, releaseDriveGain: gauge?.FocusOwner ?? 0,
    releaseStun: release?._CommonBehaviors.find((entry) => entry.IndexID === 0)?.Time ?? 0,
    hits: capture.hits.map((hit) => select(hit, [...hitFields, "from", "to"])),
  };
}
const rows = profile.rows.map((row) => {
  const trigger = original.triggers.find((entry) => entry.action === row.actionId);
  return {
    ...select(row, ["row", "styleId", "actionId", "startup", "active", "duration", "recovery", "landingRecovery", "driveNeed", "driveCost", "freezeFrames", "timerStops", "scaling", "composite", "captureAction", "components", "rawDamageTotal"]),
    superCost: trigger?.SHC_GaugeConsume ?? 0,
    hits: row.hits.map((hit) => ({ ...select(hit, hitFields), recoverableDamage: original.attacks[String(hit.attackId)]?._CommonGauges.find(gauge => gauge.IndexID === 0)?.RecoverValue ?? 0, blockDriveGain: original.attacks[String(hit.attackId)]?._CommonGauges.find(gauge => gauge.IndexID === 4)?.FocusOwner ?? 0 })),
    events: row.events.filter((event) => event.Type === 2).map((event) => select(event, ["from", "to", "ID", "Param01", "Param02", "Param03", "Param04", "_ValidStyle"])),
    eventsByStyle: Object.fromEntries(original.actions.filter((entry) => entry.id === row.actionId).map((entry) => [entry.style, entry.events.filter((event) => event.Type === 2).map((event) => ({ ...select(event, ["ID", "Param01", "Param02", "Param03", "Param04", "_ValidStyle"]), from: event.from + 1 }))])),
    ...(row.captured ? { captured: captureProfile(row.captured) } : {}),
    ...(row.punishCaptured ? { punishCaptured: captureProfile(row.punishCaptured, row.captured) } : {}),
  };
});
const variants = (profile.variants ?? []).map((variant) => ({
  ...select(variant, ["variantId", "duration", "recovery", "rawDamageTotal", "drinkFrame", "driveRestore", "level4DriveFrame", "level4DriveRestore", "timerStops"]),
  hits: variant.hits.map((hit) => ({ ...select(hit, hitFields), active: hit.active ?? [[hit.from, hit.to]] })),
}));
const output = { source: profile.source, defaults: profile.defaults, rows, variants, limitations: profile.limitations };
await writeFile(new URL("../src/characters/jamie/data/native-numerics.json", import.meta.url), JSON.stringify(output) + "\n");
console.log(JSON.stringify({ rows: rows.length, hits: rows.reduce((count, row) => count + row.hits.length, 0), build: output.source.build, resourceSha256: output.source.resourceSha256 }));
