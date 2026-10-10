const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const { test } = require('node:test');

const serverPath = path.resolve(__dirname, '../server.js');
const serverRequire = createRequire(serverPath);
const express = serverRequire('express');

// Run the real routes against a temporary library and an ephemeral local port.
async function library(t, seed = {}) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, 'photo-collection-test-'));
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith('photo-collection-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(directory, 'data'));
  for (const [name, data] of Object.entries(seed)) {
    fs.writeFileSync(path.join(directory, 'data', `${name}.json`), JSON.stringify(data));
  }
  // Preserve Express middleware, replacing only the listening port and host.
  function testExpress() {
    const app = express();
    const listen = app.listen.bind(app);
    app.listen = () => (server = listen(0, '127.0.0.1'));
    return app;
  }
  Object.assign(testExpress, express);
  vm.runInNewContext(fs.readFileSync(serverPath, 'utf8'), {
    require: (name) => name === 'express' ? testExpress : serverRequire(name),
    __dirname: directory,
    console,
  }, { filename: serverPath });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  return async (route, body) => {
    const response = await fetch(`${origin}${route}`, body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
}

test('a new library initializes photos, collections and classification rules', async (t) => {
  const request = await library(t);
  assert.deepEqual(await request('/api/photos'), { photos: [] });
  assert.equal((await request('/api/collections')).collections[0].id, 'all');
  assert.deepEqual(await request('/api/rules'), { criteria: [] });
});

test('missing collection data does not erase existing photo records or rules', async (t) => {
  const photo = { id: 'existing-photo', collectionIds: ['all'], exif: {} };
  const rules = { criteria: [{ type: 'camera' }] };
  const request = await library(t, { photos: { photos: [photo] }, rules });
  assert.deepEqual((await request('/api/photos')).photos, [photo]);
  assert.deepEqual(await request('/api/rules'), rules);
});

test('reclassification removes obsolete memberships and preserves custom collections', async (t) => {
  const request = await library(t, {
    collections: { collections: [
      { id: 'all', name: '全部照片', type: 'system' },
      { id: 'custom', name: '精选', type: 'custom' },
      { id: 'old-auto', name: '旧分类', type: 'auto' },
    ] },
    photos: { photos: [{
      id: 'photo', originalName: 'test.jpg',
      collectionIds: ['all', 'custom', 'old-auto', 'already-orphaned'],
      exif: { camera: 'Test Camera', focalLength: '50mm' },
    }] },
  });
  for (const type of ['camera', 'focalLength', 'camera']) {
    assert.equal((await request('/api/classify', { criteria: [{ type }] })).generated, 1);
    const { collections } = await request('/api/collections');
    const { photos } = await request('/api/photos');
    const generated = collections.find((item) => item.type === 'auto');
    assert.deepEqual(photos[0].collectionIds, ['all', 'custom', generated.id]);
    assert.equal(generated.count, 1);
    assert.equal((await request(`/api/photos?collectionId=${generated.id}`)).photos.length, 1);
  }
});
