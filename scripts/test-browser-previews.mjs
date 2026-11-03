import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviews, previewLimits} from '../plugins/browser/previews.js';

function fixture() {
  let time = 0, timer, permission = true, captures = 0, deferred;
  const tabs = new Map([[1, {id: 1, windowId: 10, url: 'https://a.test', status: 'complete', active: true}]]);
  const windows = new Map([[10, {id: 10, focused: true, type: 'normal'}]]);
  const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { this.listeners.forEach(fn => fn(...args)); }});
  const chrome = {
    permissions: {contains: async () => permission, onAdded: event(), onRemoved: event()},
    windows: {get: async id => ({...windows.get(id)}), onFocusChanged: event()},
    tabs: {
      get: async id => { if (!tabs.has(id)) throw Error('Closed'); return {...tabs.get(id)}; },
      query: async () => [...tabs.values()].filter(t => t.active),
      captureVisibleTab: async () => { captures++; return deferred ? await deferred : 'data:image/jpeg;base64,/9j/abc'; },
      onActivated: event(), onUpdated: event(), onRemoved: event(), onDetached: event(),
    },
  };
  const previews = createPreviews(chrome, {resize: async value => value, now: () => time,
    setTimeout: (fn, delay) => { timer = {fn, delay}; return timer; }, clearTimeout: () => { timer = undefined; }});
  const tick = async () => { const job = timer; timer = undefined; assert(job); time += job.delay; await job.fn(); };
  const read = (id = 1, url = tabs.get(id)?.url, context = '10') => previews.read({context, items: [{id: String(id), url}]}).then(r => r.items);
  return {previews, chrome, tabs, windows, tick, read, captures: () => captures, delay: () => timer?.delay,
    permission: value => { permission = value; }, advance: value => { time += value; }, defer: value => { deferred = value; }};
}

test('cache-only reads, debounce, global throttling and per-page cooldown', async () => {
  const f = fixture();
  assert.equal((await f.read()).length, 0); assert.equal(f.captures(), 0);
  f.previews.schedule(1); f.previews.schedule(1); assert.equal(f.delay(), 800);
  await f.tick(); assert.equal(f.captures(), 1); assert.equal((await f.read()).length, 1);
  f.previews.schedule(1); await f.tick(); assert.equal(f.captures(), 1);
  f.tabs.set(2, {...f.tabs.get(1), id: 2, url: 'https://b.test'});
  f.previews.schedule(2); await f.tick(); assert.equal(f.captures(), 2);
  await f.read(); assert.equal(f.captures(), 2);
  f.advance(10000); f.previews.schedule(1); await f.tick(); assert.equal(f.captures(), 3);
});
test('never captures private, internal, loading, inactive or unfocused pages', async () => {
  const f = fixture(), original = {...f.tabs.get(1)};
  for (const patch of [{incognito: true}, {url: 'edge://settings'}, {status: 'loading'}, {active: false}]) {
    f.tabs.set(1, {...original, ...patch}); f.previews.schedule(1); await f.tick();
  }
  f.tabs.set(1, original); f.windows.get(10).focused = false; f.previews.schedule(1); await f.tick();
  assert.equal(f.captures(), 0);
  f.windows.get(10).focused = true; f.permission(false); f.previews.schedule(1); await f.tick();
  assert.equal(f.captures(), 0);
});
test('background page navigation does not cancel the foreground capture', async () => {
  const f = fixture();
  f.previews.schedule(1); f.previews.invalidate(99); await f.tick();
  assert.equal(f.captures(), 1); assert.equal((await f.read()).length, 1);
});
test('discard in-flight images on navigation, tab switching, window moves and revocation', async () => {
  for (const change of [f => { f.tabs.get(1).url = 'https://new.test'; }, f => f.previews.schedule(2),
    f => { f.tabs.get(1).windowId = 20; }, f => f.permission(false), f => f.previews.invalidate(1)]) {
    const f = fixture(); let release;
    f.defer(new Promise(resolve => { release = resolve; }));
    f.previews.schedule(1); const pending = f.tick();
    while (!f.captures()) await new Promise(resolve => setImmediate(resolve));
    change(f); release('data:image/jpeg;base64,/9j/abc'); await pending;
    assert.equal(f.previews.stats().entries, 0);
  }
});
test('reject stale context/URL, closed tabs, permission revocation and oversized batches', async () => {
  const f = fixture(); f.previews.schedule(1); await f.tick();
  assert.equal((await f.read(1, 'https://stale.test')).length, 0);
  assert.equal((await f.read(1, 'https://a.test', '20')).length, 0);
  f.advance(10000); f.previews.schedule(1); await f.tick(); f.permission(false);
  assert.equal((await f.read()).length, 0); assert.equal(f.previews.stats().bytes, 0);
  f.permission(true); f.previews.schedule(1); await f.tick(); f.tabs.delete(1);
  assert.equal((await f.read(1, 'https://a.test')).length, 0);
  await assert.rejects(f.previews.read({context: '10', items: Array(9).fill({id: '1', url: ''})}), /Invalid/);
});
test('LRU count and byte budgets hold and oversized images are omitted', async () => {
  const f = fixture();
  for (let id = 1; id <= 101; id++) {
    f.tabs.set(id, {id, windowId: 10, url: `https://test/${id}`, active: true, status: 'complete'});
    f.previews.schedule(id); await f.tick();
  }
  assert.equal(f.previews.stats().entries, 100); assert.equal((await f.read()).length, 0);
  await f.read(2); f.tabs.set(102, {...f.tabs.get(101), id: 102}); f.previews.schedule(102); await f.tick();
  assert.equal((await f.read(2)).length, 1); assert.equal((await f.read(3)).length, 0);
  f.previews.clear(); f.defer('data:image/jpeg;base64,' + 'x'.repeat(previewLimits.image));
  f.previews.schedule(1); await f.tick(); assert.equal(f.previews.stats().entries, 0);
  f.defer('data:image/jpeg;base64,' + 'x'.repeat(60000));
  for (let id = 1; id <= 80; id++) { f.previews.schedule(id); await f.tick(); }
  assert(f.previews.stats().entries < 80); assert(f.previews.stats().bytes <= previewLimits.bytes);
});
