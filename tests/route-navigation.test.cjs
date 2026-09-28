const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildSlashUrl, buildRouteLegs } = require('../route-optimizer.js');

test('buildSlashUrl concatenates more than 10 stops into a single Google Maps directions URL', () => {
  const origin = 'Green Oil Inc, Toronto, ON';
  const stops = Array.from({ length: 22 }, (_, i) => ({
    name: `餐馆 ${i + 1}`,
    address: `Street Address ${i + 1}, Toronto, ON`
  }));

  const url = buildSlashUrl(origin, stops);

  // Starts with Google Maps dir and origin
  assert(url.startsWith('https://www.google.com/maps/dir/Green%20Oil%20Inc%2C%20Toronto%2C%20ON/'));
  // Contains stop 1, stop 10, and stop 22 (exceeding 10 stops)
  assert(url.includes(encodeURIComponent('餐馆 1, Street Address 1, Toronto, ON')));
  assert(url.includes(encodeURIComponent('餐馆 10, Street Address 10, Toronto, ON')));
  assert(url.includes(encodeURIComponent('餐馆 22, Street Address 22, Toronto, ON')));
  // Ends with slash
  assert(url.endsWith('/'));

  // Verify total slashes (origin + 22 stops + protocol/domain)
  const segments = url.replace('https://www.google.com/maps/dir/', '').split('/').filter(Boolean);
  assert.equal(segments.length, 23); // 1 origin + 22 stops
});

test('buildSlashUrl handles custom addresses and coordinate fallbacks correctly', () => {
  const origin = '43.7686,-79.4674';
  const stops = [
    { name: 'Custom Place', address: 'Custom Place', isCustomAddress: true },
    { name: '', address: '', latitude: '43.6532', longitude: '-79.3832' }
  ];

  const url = buildSlashUrl(origin, stops);
  assert(url.includes('Custom%20Place'));
  assert(url.includes('43.6532%2C-79.3832'));
});

test('buildRouteLegs segments 22 stops into 3 seamless legs (9 + 9 + 4)', () => {
  const origin = 'Green Oil Inc, Toronto, ON';
  const stops = Array.from({ length: 22 }, (_, i) => ({
    name: `餐馆 ${i + 1}`,
    address: `Street Address ${i + 1}, Toronto, ON`
  }));

  const legs = buildRouteLegs(origin, stops);
  assert.equal(legs.length, 3);

  // Leg 1: origin -> stops 1..9
  assert.equal(legs[0].index, 1);
  assert.equal(legs[0].from, 'Green Oil HQ');
  assert.equal(legs[0].to, '餐馆 9');
  assert.equal(legs[0].count, 9);
  assert(legs[0].url.startsWith(`https://www.google.com/maps/dir/${encodeURIComponent(origin)}/`));
  assert(legs[0].url.includes(encodeURIComponent('餐馆 9, Street Address 9, Toronto, ON')));

  // Leg 2: Stop 9 -> stops 10..18
  assert.equal(legs[1].index, 2);
  assert.equal(legs[1].from, '餐馆 9');
  assert.equal(legs[1].to, '餐馆 18');
  assert.equal(legs[1].count, 9);
  assert(legs[1].url.startsWith(`https://www.google.com/maps/dir/${encodeURIComponent('餐馆 9, Street Address 9, Toronto, ON')}/`));
  assert(legs[1].url.includes(encodeURIComponent('餐馆 18, Street Address 18, Toronto, ON')));

  // Leg 3: Stop 18 -> stops 19..22
  assert.equal(legs[2].index, 3);
  assert.equal(legs[2].from, '餐馆 18');
  assert.equal(legs[2].to, '餐馆 22');
  assert.equal(legs[2].count, 4);
  assert(legs[2].url.startsWith(`https://www.google.com/maps/dir/${encodeURIComponent('餐馆 18, Street Address 18, Toronto, ON')}/`));
  assert(legs[2].url.includes(encodeURIComponent('餐馆 22, Street Address 22, Toronto, ON')));
});
