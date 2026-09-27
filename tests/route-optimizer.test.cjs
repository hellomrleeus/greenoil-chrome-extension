const { test } = require('node:test');
const assert = require('node:assert/strict');

const { optimizeRoute, routeLengthKm } = require('../route-optimizer.js');

const ORIGIN = { lat: 43.7686, lng: -79.4674 };
// ~1 unit = 0.01 degree (~1 km) from the origin.
const wp = (name, dLat, dLng, extra = {}) => ({
  name,
  latitude: String(ORIGIN.lat + dLat * 0.01),
  longitude: String(ORIGIN.lng + dLng * 0.01),
  ...extra,
});
const names = (list) => list.map(w => w.name);

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((x, i) => {
    for (const rest of permutations(arr.slice(0, i).concat(arr.slice(i + 1)))) out.push([x, ...rest]);
  });
  return out;
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('does not detour to a far stop between two close stops', () => {
  // A and B sit next to each other, C is far away on the other side.
  // Greedy nearest-neighbour went O -> A -> B -> (long way back) -> C;
  // the best open path picks up C first, or keeps A,B adjacent.
  const A = wp('A', 0, 3);
  const B = wp('B', 0, 3.6);
  const C = wp('C', 0, -2.5);
  const out = names(optimizeRoute([A, C, B], ORIGIN));
  const ia = out.indexOf('A');
  const ib = out.indexOf('B');
  assert.equal(Math.abs(ia - ib), 1, `A and B must be adjacent, got ${out}`);
  assert.deepEqual(out, ['C', 'A', 'B']);
});

test('matches brute force on random small routes', () => {
  const rand = mulberry32(42);
  for (let round = 0; round < 40; round++) {
    const n = 3 + (round % 5);
    const pts = Array.from({ length: n }, (_, i) => wp(`P${i}`, rand() * 20 - 10, rand() * 20 - 10));
    const got = routeLengthKm(optimizeRoute(pts, ORIGIN), ORIGIN);
    const best = Math.min(...permutations(pts).map(p => routeLengthKm(p, ORIGIN)));
    assert.ok(Math.abs(got - best) < 1e-6, `round ${round}: ${got} vs optimum ${best}`);
  }
});

test('large routes never come out longer than greedy nearest-neighbour', () => {
  const rand = mulberry32(7);
  const greedy = (pts) => {
    const rest = [...pts];
    const out = [];
    let cur = ORIGIN;
    while (rest.length) {
      let bi = 0;
      let bd = Infinity;
      rest.forEach((p, i) => {
        const d = routeLengthKm([p], cur);
        if (d < bd) { bd = d; bi = i; }
      });
      const [p] = rest.splice(bi, 1);
      out.push(p);
      cur = { lat: +p.latitude, lng: +p.longitude };
    }
    return out;
  };
  for (let round = 0; round < 10; round++) {
    const pts = Array.from({ length: 30 }, (_, i) => wp(`P${i}`, rand() * 40 - 20, rand() * 40 - 20));
    const opt = optimizeRoute(pts, ORIGIN);
    assert.equal(opt.length, 30);
    assert.equal(new Set(opt).size, 30);
    assert.ok(routeLengthKm(opt, ORIGIN) <= routeLengthKm(greedy(pts), ORIGIN) + 1e-9);
  }
});

test('locked groups stay together in their original order', () => {
  const g1 = wp('G1', 0, 10, { lockGroupId: 'lock_1' });
  const x = wp('X', 0, 1);
  const g2 = wp('G2', 0, 2, { lockGroupId: 'lock_1' });
  const y = wp('Y', 0, 5);
  const out = names(optimizeRoute([g1, x, g2, y], ORIGIN));
  const i1 = out.indexOf('G1');
  assert.equal(out[i1 + 1], 'G2', `group split or reordered: ${out}`);
  assert.equal(out.length, 4);
});

test('waypoints without coordinates go to the end in original order', () => {
  const a = wp('A', 0, 5);
  const noCoords1 = { name: 'N1', latitude: '', longitude: null };
  const b = wp('B', 0, 1);
  const noCoords2 = { name: 'N2' };
  const out = names(optimizeRoute([noCoords1, a, noCoords2, b], ORIGIN));
  assert.deepEqual(out, ['B', 'A', 'N1', 'N2']);
});
