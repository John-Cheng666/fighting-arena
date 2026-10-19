export type AtlasRegion = {
  minX: number; minY: number; maxX: number; maxY: number;
  area: number; centerX: number; centerY: number; components: number[];
};
export type AtlasExtraction = { regions: AtlasRegion[]; labels: Int32Array; width: number; height: number; seedThreshold: number };

/** Associate complete alpha islands with their intended grid slots. A foot or
 * plait may cross a nominal cell boundary; no part of that person is clipped. */
function connectedRegions(pixels: Uint8ClampedArray, width: number, height: number, threshold: number) {
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const components: AtlasRegion[] = [];
  let componentId = 0;
  for (let position = 0; position < labels.length; position++) {
    if (labels[position] || pixels[position * 4 + 3] < threshold) continue;
    componentId += 1;
    let count = 1, cursor = 0, sumX = 0, sumY = 0;
    queue[0] = position; labels[position] = componentId;
    const component: AtlasRegion = { minX: width, minY: height, maxX: 0, maxY: 0, area: 0, centerX: 0, centerY: 0, components: [componentId] };
    while (cursor < count) {
      const current = queue[cursor++], x = current % width, y = Math.floor(current / width);
      sumX += x; sumY += y;
      component.minX = Math.min(component.minX, x); component.maxX = Math.max(component.maxX, x);
      component.minY = Math.min(component.minY, y); component.maxY = Math.max(component.maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const next = (y + dy) * width + x + dx;
        if (!labels[next] && pixels[next * 4 + 3] >= threshold) { labels[next] = componentId; queue[count++] = next; }
      }
    }
    component.area = count; component.centerX = sumX / count; component.centerY = sumY / count;
    components.push(component);
  }
  return { labels, components };
}

export function extractJamieSpriteRegions(pixels: Uint8ClampedArray, width: number, height: number, columns = 3, rows = 4): AtlasExtraction {
  const count = columns * rows, cellWidth = width / columns, cellHeight = height / rows;
  const isBody = (component: AtlasRegion) => component.area >= cellWidth * cellHeight * 0.025
    && component.maxX - component.minX >= cellWidth * 0.1 && component.maxY - component.minY >= cellHeight * 0.14;
  let { labels, components } = connectedRegions(pixels, width, height, 32);
  let primary = components.filter(isBody);
  let seedThreshold = 32;
  if (primary.length !== count) {
    // A faint alpha bridge can join two adjacent people. Opaque body seeds
    // separate those people, then grow back through the ORIGINAL alpha pixels;
    // the threshold is used for ownership, never to erase translucent hair.
    let seeds = connectedRegions(pixels, width, height, 48);
    let bodies = seeds.components.filter(isBody);
    for (const threshold of [48, 64, 96, 128, 160]) {
      if (threshold !== 48) { seeds = connectedRegions(pixels, width, height, threshold); bodies = seeds.components.filter(isBody); }
      seedThreshold = threshold;
      if (bodies.length === count) break;
    }
    if (bodies.length !== count) throw new Error(`Jamie atlas contains ${primary.length} separate full figures (${bodies.length} opaque body seeds); expected ${count}. Tiny alpha fragments cannot substitute for missing figures.`);
    const seedIds = new Set(bodies.map((body) => body.components[0]));
    const grown = new Int32Array(labels.length), queue = new Int32Array(labels.length);
    let end = 0;
    for (let pixel = 0; pixel < grown.length; pixel++) if (seedIds.has(seeds.labels[pixel])) {
      grown[pixel] = seeds.labels[pixel]; queue[end++] = pixel;
    }
    for (let cursor = 0; cursor < end; cursor++) {
      const pixel = queue[cursor], x = pixel % width, y = Math.floor(pixel / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const next = (y + dy) * width + x + dx;
        if (!grown[next] && pixels[next * 4 + 3] >= 32) { grown[next] = grown[pixel]; queue[end++] = next; }
      }
    }
    const byId = new Map<number, AtlasRegion>();
    const sums = new Map<number, { x: number; y: number }>();
    for (const body of bodies) {
      const id = body.components[0];
      byId.set(id, { minX: width, minY: height, maxX: 0, maxY: 0, area: 0, centerX: 0, centerY: 0, components: [id] });
      sums.set(id, { x: 0, y: 0 });
    }
    for (let pixel = 0; pixel < grown.length; pixel++) {
      const body = byId.get(grown[pixel]); if (!body) continue;
      const x = pixel % width, y = Math.floor(pixel / width), sum = sums.get(grown[pixel])!;
      body.area++; sum.x += x; sum.y += y;
      body.minX = Math.min(body.minX, x); body.maxX = Math.max(body.maxX, x);
      body.minY = Math.min(body.minY, y); body.maxY = Math.max(body.maxY, y);
    }
    components = [...byId].map(([id, body]) => ({ ...body, centerX: sums.get(id)!.x / body.area, centerY: sums.get(id)!.y / body.area }));
    // Keep disconnected costume fragments available to the same nearest-body
    // attachment below, with labels distinct from all opaque seed labels.
    let nextId = Math.max(...seedIds);
    for (const fragment of connectedRegions(pixels, width, height, 32).components) {
      const oldId = fragment.components[0];
      if (fragment.area >= cellWidth * cellHeight * 0.025) continue;
      const id = ++nextId; let added = false;
      for (let y = fragment.minY; y <= fragment.maxY; y++) for (let x = fragment.minX; x <= fragment.maxX; x++) {
        const pixel = y * width + x;
        if (!grown[pixel] && labels[pixel] === oldId) { grown[pixel] = id; added = true; }
      }
      if (added) components.push({ ...fragment, components: [id] });
    }
    labels = grown; primary = components.filter(isBody);
  }
  if (primary.length !== count || primary.some((body) => body.maxY - body.minY > cellHeight * 1.55)) {
    throw new Error(`Jamie atlas does not contain ${count} independently extractable full figures`);
  }
  // A small assignment problem preserves row-major identity even when a tall
  // inverted leg crosses into the row above or a kick crosses a column border.
  const states = 1 << count;
  const costs = new Float64Array(states).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(states).fill(-1), chosen = new Int16Array(states).fill(-1);
  costs[0] = 0;
  for (let mask = 0; mask < states; mask++) {
    if (!Number.isFinite(costs[mask])) continue;
    let slot = 0; for (let bits = mask; bits; bits &= bits - 1) slot++;
    if (slot >= count) continue;
    const expectedX = (slot % columns + 0.5) * width / columns;
    const expectedY = (Math.floor(slot / columns) + 0.58) * height / rows;
    for (let candidate = 0; candidate < count; candidate++) {
      if (mask & (1 << candidate)) continue;
      const component = primary[candidate];
      const dx = (component.centerX - expectedX) / (width / columns);
      const dy = (component.centerY - expectedY) / (height / rows);
      const next = mask | (1 << candidate), cost = costs[mask] + dx * dx + dy * dy;
      if (cost < costs[next]) { costs[next] = cost; previous[next] = mask; chosen[next] = candidate; }
    }
  }
  const regions: AtlasRegion[] = new Array(count);
  for (let mask = states - 1, slot = count - 1; slot >= 0; slot--) {
    const component = primary[chosen[mask]];
    regions[slot] = { ...component, components: [...component.components] };
    mask = previous[mask];
  }
  const mainIds = new Set(primary.map((component) => component.components[0]));
  for (const component of components) {
    if (mainIds.has(component.components[0])) continue;
    let nearest: AtlasRegion | undefined, best = Number.POSITIVE_INFINITY;
    for (const region of regions) {
      const dx = Math.max(region.minX - component.maxX, component.minX - region.maxX, 0);
      const dy = Math.max(region.minY - component.maxY, component.minY - region.maxY, 0);
      const distance = dx * dx + dy * dy;
      if (distance < best) { best = distance; nearest = region; }
    }
    const reach = Math.min(width / columns, height / rows) * (component.area > 12 ? 0.16 : 0.035);
    if (nearest && best <= reach * reach) {
      nearest.components.push(...component.components);
      nearest.minX = Math.min(nearest.minX, component.minX); nearest.maxX = Math.max(nearest.maxX, component.maxX);
      nearest.minY = Math.min(nearest.minY, component.minY); nearest.maxY = Math.max(nearest.maxY, component.maxY);
    }
  }
  return { regions, labels, width, height, seedThreshold };
}
