import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encryptSettings,decryptSettings,validateSettings} from '../src/core/settings-transfer.ts';
import {aiProfile,aiEndpoint,normalizeAIAnnotation,aiAnnotationFields,validateAIResult} from '../src/core/ai-studio.ts';
const profile={id:'fixture-account',name:'Synthetic account',provider:'qwen-cn' as const,region:'cn-beijing' as const,workspace:'',image_model:'qwen-image-3.0',vision_model:'qwen3-vl-plus',revision:1};
const options={language:'both' as const,tag_count:2,caption_length:30,ocr:true,place_guess:true};
const raw={version:1,caption_zh:'山和湖',caption_en:'Mountains and lake',tags:[{zh:'山',en:'Mountain'},{zh:'湖',en:'Lake'}],detected_text:'TEST 42',place_guess:{name:'Possible lake',confidence:.3,evidence:'Shape only'}};
const password='synthetic-transfer-password';

test('encrypted selected preferences and explicit keys round-trip without plaintext leakage',async()=>{
  const value={application:'photocollection-settings',version:1,preferences:{global:{theme:'dark',lang:'zh'},tools:{viewer:{quality:4096,pinned:true}}},accounts:[{profile,api_key:'synthetic-account-secret'}]};
  const cipher=await encryptSettings(value,password);
  assert.ok(!cipher.includes('synthetic-account-secret')&&!cipher.includes(profile.name));
  assert.deepEqual(await decryptSettings(cipher,password),value);
  assert.notEqual(await encryptSettings(value,password),cipher);
  await assert.rejects(()=>decryptSettings(cipher,'different-password'));
  const envelope=JSON.parse(cipher),bytes=Buffer.from(envelope.data,'base64');bytes[0]^=1;envelope.data=bytes.toString('base64');
  await assert.rejects(()=>decryptSettings(JSON.stringify(envelope),password));
  for(const change of [{version:0},{iterations:1},{cipher:'AES-CBC'},{iv:'AA=='}])await assert.rejects(()=>decryptSettings(JSON.stringify({...JSON.parse(cipher),...change}),password));
});

test('settings whitelist rejects private paths, implicit keys and malformed account bundles',()=>{
  const base={application:'photocollection-settings',version:1,preferences:{}};
  assert.deepEqual(validateSettings(base),base);
  for(const value of [{...base,version:2},{...base,key:'secret'},{...base,preferences:{data_dir:'private'}},{...base,preferences:{global:{theme:['dark']}}},{...base,accounts:[{profile,api_key:'bad key'}]},{...base,accounts:[{profile:{...profile,api_key:'unexpected'}}]}])assert.throws(()=>validateSettings(value));
});

test('domestic profiles keep official protocols, models and regions distinct',()=>{
  assert.equal(aiProfile(profile).provider,'qwen-cn');assert.ok(aiEndpoint(profile).startsWith('https://dashscope.aliyuncs.com/'));
  const ark={...profile,provider:'ark-cn' as const,image_model:'doubao-seedream-4-0-250828',vision_model:''};
  assert.equal(aiEndpoint(aiProfile(ark)),'https://ark.cn-beijing.volces.com/api/v3/images/generations');
  for(const change of [{region:'overseas'},{image_model:'foreign-model'},{workspace:'evil.example/'},{name:' '},{api_key:'never-persist'}])assert.throws(()=>aiProfile({...profile,...change}));
  assert.throws(()=>aiProfile({...ark,vision_model:profile.vision_model}));
});

test('bilingual normalization bounds descriptions and retains concept translations for search',()=>{
  const r=normalizeAIAnnotation({...raw,caption_en:'x'.repeat(100),tags:[{zh:' 山 ',en:'Ｍountain'},{zh:'山',en:'mountain'},{zh:'湖',en:'Lake'}]},options);
  assert.equal(r.tags.length,2);assert.equal(r.caption_en.length,30);
  assert.deepEqual(aiAnnotationFields(r,options).tags,['山','Mountain','湖','Lake']);
  assert.equal(normalizeAIAnnotation(raw,{...options,ocr:false,place_guess:false}).place_guess,null);
  for(const change of [{version:2},{coordinates:[1,2]},{tags:[{zh:'山'}]},{place_guess:{name:'x',confidence:NaN,evidence:'x'}}])assert.throws(()=>normalizeAIAnnotation({...raw,...change},options));
});

test('history schema protects source identity, revisions, dimensions and place provenance',()=>{
  const record={id:'fixture-result',kind:'annotation',photo_id:'fixture-photo',created_at:'2026-10-27T00:00:00Z',version:1,revision:1,source:{id:'fixture-photo',name:'synthetic.jpg',hash:'a'.repeat(64),revision:0},provider:'qwen-cn',profile_id:profile.id,model:profile.vision_model,request_id:'fixture-request',options,result:raw,applied:true};
  assert.deepEqual(validateAIResult(record),record);
  for(const change of [{source:{...record.source,revision:-1}},{photo_id:'another-photo'},{result:null},{api_key:'secret'},{place_review:{status:'automatic',reviewed_at:record.created_at}}])assert.throws(()=>validateAIResult({...record,...change}));
});

test('all 25 style presets retain visible prompts independent of watercolor',()=>{
  const styles=JSON.parse(readFileSync(new URL('../src/core/ai-styles.json',import.meta.url),'utf8'));
  assert.equal(styles.length,25);assert.equal(new Set(styles.map((s:{id:string})=>s.id)).size,25);
  assert.ok(styles.every((s:{prompt:string;name_zh:string;name_en:string})=>s.prompt.length>20&&s.name_zh&&s.name_en));
});
