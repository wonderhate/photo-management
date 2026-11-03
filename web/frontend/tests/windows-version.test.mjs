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

test('download server explicitly allows the candidate files and preserves published versions',()=>{
  const release=JSON.parse(readFileSync(new URL('../src/browser/windows-release.json',import.meta.url),'utf8'));
  const config=readFileSync(new URL('../../cloud_relay/Caddyfile',import.meta.url),'utf8');
  const matcher=config.match(/@downloads\s*\{([^}]+)\}/)?.[1];
  assert.ok(matcher,'download matcher must exist');
  assert.deepEqual(matcher.match(/\bmethod[ \t]+([^\r\n]+)/)[1].trim().split(/\s+/),['GET','HEAD']);
  const paths=matcher.match(/\bpath\s+([^\n]+)/)[1].trim().split(/\s+/);
  for(const file of release.files)assert.ok(paths.includes(new URL(file.name,release.baseUrl).pathname),file.name);
  assert.ok(paths.includes(new URL(`SHA256SUMS-${release.version}.txt`,release.baseUrl).pathname));
  for(const version of ['1.0','2.7.0','2.7.1','2.7.3']){
    for(const file of [`PhotoCollection-Setup-${version}-x64.exe`,`PhotoCollection-Windows-${version}.zip`,`SHA256SUMS-${version}.txt`]){
      assert.ok(paths.includes(`/downloads/${version}/${file}`),`keep published file ${file}`);
    }
  }
  assert.equal(new Set(paths).size,paths.length);
  for(const path of paths)assert.match(path,/^\/downloads\/\d+\.\d+(?:\.\d+)?\/(?:PhotoCollection-[A-Za-z0-9.-]+\.(?:exe|zip)|SHA256SUMS-[0-9.]+\.txt)$/);
  assert.match(config,/handle\s*\{\s*respond "Not found" 404\s*\}/);
});
