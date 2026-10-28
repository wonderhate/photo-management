import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('download search metadata identifies the same release as the actual packages',()=>{
  const release=JSON.parse(readFileSync(new URL('../src/browser/windows-release.json',import.meta.url),'utf8'));
  const html=readFileSync(new URL('../windows.html',import.meta.url),'utf8');
  const data=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.softwareVersion,release.version);
  for(const file of release.files){assert.ok(file.name.includes(release.version));assert.ok(file.bytes>0);assert.match(file.sha256,/^[a-f0-9]{64}$/);}
});
