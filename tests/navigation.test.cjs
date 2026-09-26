const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');

test('waypoint navigation smoothly pans in-page without reloading the page', async () => {
  const sentMessages = [];
  const tab = { id: 7, windowId: 2, url: 'https://www.google.com/maps/' };
  const context = vm.createContext({
    URL,
    console,
    chrome: {
      tabs: {
        query: async () => [tab],
        sendMessage: async (id, msg) => {
          sentMessages.push({ id, msg });
          return { success: true };
        },
        update: async () => assert.fail('Should not reload tab via chrome.tabs.update when smooth pan succeeds')
      }
    }
  });

  const start = source.indexOf('async function handlePanToWaypoint');
  const end = source.indexOf('// ==========================================', start);
  vm.runInContext(source.slice(start, end), context);

  const result = await vm.runInContext(
    'handlePanToWaypoint({ name: "Fran\'s Restaurant", mapsUrl: "https://www.google.com/maps/place/Fran/@43.6552,-79.3807,17z" })',
    context
  );

  assert.equal(result.success, true);
  assert.equal(result.panned, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].msg.action, 'panToLocation');
  assert.equal(sentMessages[0].msg.targetPath, '/maps/place/Fran/@43.6552,-79.3807,17z');
  assert.equal(sentMessages[0].msg.waypoint.name, "Fran's Restaurant");
});

test('waypoint navigation falls back to the MAIN-world map hook when the tab message is unanswered', async () => {
  const executedScripts = [];
  const tab = { id: 7, windowId: 2, url: 'https://www.google.com/maps/' };
  const context = vm.createContext({
    URL,
    console,
    chrome: {
      tabs: {
        query: async () => [tab],
        sendMessage: async () => { throw new Error('Could not establish connection'); },
        update: async () => assert.fail('Should not call chrome.tabs.update when scripting succeeds')
      },
      scripting: {
        executeScript: async (params) => {
          executedScripts.push(params);
          return [{ result: { success: true } }];
        }
      }
    }
  });

  const start = source.indexOf('async function injectMapHook');
  const end = source.indexOf('async function ensureMapsContentScript', start);
  vm.runInContext(source.slice(start, end), context);
  const hStart = source.indexOf('async function handlePanToWaypoint');
  const hEnd = source.indexOf('// ==========================================', hStart);
  vm.runInContext(source.slice(hStart, hEnd), context);

  const result = await vm.runInContext(
    'handlePanToWaypoint({ name: "Fran\'s Restaurant", latitude: 43.6552, longitude: -79.3807, mapsUrl: "https://www.google.com/maps/place/Fran/@43.6552,-79.3807,17z" })',
    context
  );

  assert.equal(result.success, true);
  assert.equal(result.panned, true);
  assert.equal(executedScripts.length, 2);
  assert.equal(JSON.stringify(executedScripts[0].files), JSON.stringify(['pin-math.js', 'map-hook.js']));
  assert.equal(executedScripts[0].world, 'MAIN');
  assert.equal(executedScripts[1].world, 'MAIN');
  assert.equal(JSON.stringify(executedScripts[1].args), JSON.stringify(['/maps/place/Fran/@43.6552,-79.3807,17z', 43.6552, -79.3807]));
  // No <a>.click(): that path did a full page load.
  assert.ok(!String(executedScripts[1].func).includes('.click()'));
});

test('an answered panToLocation message means no fallback navigation', async () => {
  const tab = { id: 7, windowId: 2, url: 'https://www.google.com/maps/' };
  const context = vm.createContext({
    URL,
    console,
    chrome: {
      tabs: {
        query: async () => [tab],
        sendMessage: async () => ({ success: true }),
        update: async () => assert.fail('no tab update')
      },
      scripting: { executeScript: async () => assert.fail('no scripting fallback') }
    }
  });
  const hStart = source.indexOf('async function handlePanToWaypoint');
  const hEnd = source.indexOf('// ==========================================', hStart);
  vm.runInContext(source.slice(hStart, hEnd), context);
  const result = await vm.runInContext('handlePanToWaypoint({ name: "X", mapsUrl: "https://www.google.com/maps/place/X/@1,2,17z" })', context);
  assert.equal(result.panned, true);
});
