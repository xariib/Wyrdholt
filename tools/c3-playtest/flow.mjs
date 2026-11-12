// node --import tsx tools/c3-playtest/flow.mjs [dist] [out]
// One disposable local origin/profile through the C3 actions. Never hosted storage.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
import {chromium,expect} from 'playwright/test';
import {CONTENT,FORGE_V1} from '@emberbound/game-content';
import {ContentIndex,createInstance,createProfile,rollLoot,applyCommand,advanceAdventure,parseSave,serializeSave,eligibleForgeIds,fuse,previewSalvage,salvageItem,previewBulkSalvage,salvageItems,currentBuild,resolveHeroStats} from '@emberbound/game-core';
const content=new ContentIndex(CONTENT),dist=resolve(process.argv[2]??'apps/mobile/dist'),out=resolve(process.argv[3]??'tools/smoke/out/c3-flow');mkdirSync(out,{recursive:true});
const report={pass:false,scope:'Controlled local Chromium/IDB flow; not natural pacing/native/human acceptance',cases:[],errors:[]};
// Controlled past clear/Gold, configured loot RNG. No DEV commands; this is not pacing evidence.
const p=createProfile(content,{name:'C3 QA',activeClassId:'mage',alternateClassId:'monk',masterSeed:1042,nowWallMs:Date.now()});
p.gold=500;p.adventure.zones.greenfields.cleared=true;
const starter=content.item(CONTENT.starterWeapons[p.character.activeClassId]);
const effectBase=content.item('crown_of_thorns').classVariants[p.character.activeClassId];
let seeds=0;
const copies=base=>p.inventory.instances.filter(i=>i.baseId===base&&i.isNew);
while(copies(starter.id).length<9||copies(effectBase).length<2){
  assert(++seeds<50000,'Fixture loot target not reached');
  if(copies(starter.id).length<9)rollLoot(p,content,'greenfields_farm',40,seeds,{source:'c3-qa-configured-loot'});
  else rollLoot(p,content,'darkwood_cache',40,seeds,{source:'c3-qa-configured-loot'});
}
const weapon=copies(starter.id),effect=copies(effectBase)[0],effectPeer=copies(effectBase)[1];
createInstance(p,'wayfarer_blade',{isNew:true}); // A sword carried over from an older build.
assert(effect&&content.item(effect.baseId).effect);
assert(applyCommand(p,content,{type:'startFarm',zoneId:'greenfields'},{contentTimeMs:0}).ok);
while(p.adventure.run.phase!=='fight')advanceAdventure(p,content,100,{offline:false,contentTimeMs:0});
p.clock.lastSettledWallMs=Date.now();
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path==='/observer'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Disposable QA</title><link rel="icon" href="/brand/I0_32_native.png">');return;}const file=resolve(dist,'.'+(path==='/'?'/index.html':path));try{assert(file.startsWith(dist+sep)&&statSync(file).isFile());res.setHeader('content-type',mime[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined});report.browser=browser.version();
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
// Freeze presentation time to inspect a real queued equip before the safe boundary.
// Existing session slow-save/time regression receipts cover elapsed time separately.
await ctx.addInitScript(()=>{window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};
  const put=IDBObjectStore.prototype.put,get=IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.put=function(value,...args){const r=put.call(this,value,...args);if(window.__c3Fault&&value?.path==='/DATA/saves/profile.json')window.__c3Committed=true;return r;};
  IDBObjectStore.prototype.get=function(key,...args){if(window.__c3Fault&&window.__c3Committed&&key==='/DATA/saves/profile.json')throw new Error('Injected C3 main readback failure');return get.call(this,key,...args);};
});
const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
async function storage(raw){return page.evaluate(async raw=>{const db=await new Promise((ok,fail)=>{const r=indexedDB.open('Disc',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('FileStorage',{keyPath:'path'});s.createIndex('by_folder','folder');};r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});try{if(raw)await new Promise((ok,fail)=>{const tx=db.transaction('FileStorage','readwrite');tx.objectStore('FileStorage').put({path:'/DATA/saves/profile.json',folder:'/DATA/saves',type:'file',content:raw,size:raw.length,ctime:1,mtime:1});tx.oncomplete=ok;tx.onerror=()=>fail(tx.error);});return await new Promise((ok,fail)=>{const r=db.transaction('FileStorage','readonly').objectStore('FileStorage').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.path.startsWith('/DATA/saves/')).map(x=>[x.path,x.content]).sort());r.onerror=()=>fail(r.error);});}finally{db.close();}},raw);}
async function profile(){const r=parseSave(await page.evaluate(()=>window.__ember.exportSave()));assert(r.ok);return r.profile;}
const state=p=>({inventory:p.inventory,gold:p.gold,equipment:p.equipment,pending:p.pending,itemLocks:p.itemLocks,forge:p.forge,schema:p.schema});
async function snapshot(name){const value=await profile();writeFileSync(join(out,name+'.json'),JSON.stringify(value,null,2)+'\n');return value;}
async function inventory(){await page.getByRole('button',{name:/^Gear/}).last().click();await page.getByRole('button',{name:/^Inventory ·/}).click();return page.getByRole('dialog',{name:'Gear inventory',exact:true});}
async function manage(sheet,base){const item=content.item(base);await sheet.getByLabel('Slot',{exact:true}).selectOption(item.slot);await sheet.getByLabel('Rarity',{exact:true}).selectOption(item.rarity);const back=sheet.getByRole('button',{name:'Back to inventory list',exact:true});if(await back.count())await back.click();await sheet.getByRole('button',{name:`Manage copies of ${item.name}`,exact:true}).click();}
async function lock(sheet,id,locked){await sheet.getByRole('button',{name:`${locked?'Lock':'Unlock'} copy #${id}`,exact:true}).click();await expect(sheet.getByRole('status').filter({hasText:`Copy #${id} ${locked?'locked':'unlocked'} and saved.`})).toBeVisible();}
function removed(before,after,ids,gold){assert.equal(after.gold,before.gold+gold);assert.deepEqual(after.inventory.instances,before.inventory.instances.filter(i=>!ids.includes(i.id)));assert.equal(after.inventory.nextInstanceId,before.inventory.nextInstanceId);for(const key of ['equipment','pending','itemLocks','forge','schema'])assert.deepEqual(after[key],before[key]);}
try{
  const raw=serializeSave(p,Date.now());assert(parseSave(raw).ok);writeFileSync(join(out,'fixture.json'),raw+'\n');
  report.fixture={controlledGold:500,controlledClear:'greenfields',lootSeeds:seeds,lootCopies:p.inventory.instances.length-6,startingSchema:p.schema,frozenRAF:true};
  await page.goto(url+'/observer');await storage(raw);await page.goto(url);await page.locator('.header').waitFor();
  const initial=await snapshot('initial');let sheet=await inventory();const bytes=await storage();
  await sheet.getByLabel('Only NEW',{exact:true}).check();await sheet.getByLabel('Search inventory',{exact:true}).fill(content.item(effect.baseId).effect.name);
  await expect(sheet.locator(`[data-base-id="${effect.baseId}"]`)).toContainText(content.item(effect.baseId).effect.name);
  await sheet.getByRole('button',{name:'Clear filters',exact:true}).click();await manage(sheet,effect.baseId);
  assert.deepEqual(state(await profile()),state(initial));assert.deepEqual(await storage(),bytes);
  await sheet.getByRole('button',{name:'Back to inventory list',exact:true}).click();
  await sheet.getByLabel('Only NEW',{exact:true}).check();
  await sheet.getByLabel('Search inventory',{exact:true}).fill(content.item(effect.baseId).effect.name);
  const effectCard=sheet.locator(`[data-base-id="${effect.baseId}"]`);
  await expect(effectCard.getByRole('region',{name:'Differences from equipped gear'})).toContainText(`Gains ${content.item(effect.baseId).effect.name}`);
  await expect(effectCard.getByRole('button',{name:`Manage copies of ${content.item(effect.baseId).name}`,exact:true})).toBeVisible();
  await effectCard.getByRole('button',{name:`Compare ${content.item(effect.baseId).name}`,exact:true}).click();
  const compare=page.getByRole('dialog',{name:'Equipment',exact:true});await expect(compare.locator('.comparison-effects')).toContainText(content.item(effect.baseId).effect.name);
  const reviewed=await profile();assert(!reviewed.inventory.instances.find(i=>i.id===effect.id).isNew);assert(reviewed.inventory.instances.find(i=>i.id===effectPeer.id).isNew);
  await compare.getByRole('button',{name:`Equip ${content.item(effect.baseId).name}`,exact:true}).click();
  const queued=await profile();assert.equal(queued.pending.equipment.head,effect.id);assert.equal(queued.equipment.head,initial.equipment.head);
  // Safe-boundary/active-effect proof on a detached copy of this exact queue snapshot.
  const boundary=structuredClone(queued);for(let n=0;n<2000&&boundary.equipment.head!==effect.id;n++)advanceAdventure(boundary,content,100,{offline:false,contentTimeMs:0});
  assert.equal(boundary.equipment.head,effect.id);assert(resolveHeroStats(content,currentBuild(boundary),new Map(boundary.inventory.instances.map(i=>[i.id,i]))).activeEffects.some(e=>e.name===content.item(effect.baseId).effect.name));
  report.cases.push({step:'loot/filter/exact-comparison/queue',id:effect.id,peerId:effectPeer.id,peerStillNEW:true,queueKeepsCurrentBuild:true,detachedCoreSafeBoundaryAndEffect:true});
  // Equip returns to the filtered list; the other exact copy is still new.
  await expect(sheet.getByLabel('Only NEW',{exact:true})).toBeChecked();
  await expect(sheet.getByLabel('Search inventory',{exact:true})).toHaveValue(content.item(effect.baseId).effect.name);
  await expect(effectCard).toContainText('1 NEW matching');
  await expect(sheet.getByRole('region',{name:'Manage inventory copies'})).toHaveCount(0);
  await sheet.getByRole('button',{name:'Clear filters',exact:true}).click();await manage(sheet,starter.id);
  const locked=weapon[0].id;await lock(sheet,locked,true);const lockedState=await snapshot('locked');assert.equal(lockedState.schema,3);assert(lockedState.inventory.instances.find(i=>i.id===locked).isNew);
  for(const id of [initial.equipment.weapon,locked])await expect(sheet.getByRole('checkbox',{name:`Select for salvage copy #${id}`,exact:true})).toBeDisabled();
  await manage(sheet,effect.baseId);await expect(sheet.getByRole('checkbox',{name:`Select for salvage copy #${effect.id}`,exact:true})).toBeDisabled();
  await sheet.getByRole('button',{name:'Close inventory',exact:true}).click();
  await page.getByRole('button',{name:'Forge',exact:true}).click();const forgeSheet=page.getByRole('dialog',{name:'Forge',exact:true});
  const materials=eligibleForgeIds(lockedState,content,'weapon','common').slice(0,5);assert.equal(materials.length,5);assert(!materials.includes(locked));
  for(let n=0;n<5;n++)await forgeSheet.getByRole('button',{name:`Add ${starter.name}`,exact:true}).click();
  const beforeForge=await profile(),forgeBytes=await storage();await forgeSheet.getByTestId('forge-review').click();
  for(const id of materials)await expect(forgeSheet.locator('.forge-materials')).toContainText(`#${id}`);
  await forgeSheet.getByRole('button',{name:'Change materials',exact:true}).click();assert.deepEqual(state(await profile()),state(beforeForge));assert.deepEqual(await storage(),forgeBytes);
  await forgeSheet.getByTestId('forge-review').click();await forgeSheet.getByTestId('forge-submit').click();await forgeSheet.getByTestId('forge-result').waitFor();
  const forged=await snapshot('forged'),receipt=forged.forge.lastReceipt;assert.deepEqual(receipt.consumedIds,materials);assert.equal(forged.gold,beforeForge.gold-100);assert.equal(receipt.outputInstanceId,beforeForge.inventory.nextInstanceId);assert(forged.inventory.instances.find(i=>i.id===receipt.outputInstanceId).isNew);assert.deepEqual(forged.pending,beforeForge.pending);assert.deepEqual(forged.itemLocks,beforeForge.itemLocks);
  assert.equal(content.item(receipt.outputBaseId).classId,p.character.activeClassId);
  const input={transactionId:receipt.transactionId,configVersion:receipt.configVersion,slot:receipt.slot,rarity:receipt.rarity,instanceIds:materials,mode:'configured'};
  const replay=structuredClone(forged);assert(fuse(replay,content,FORGE_V1,input).repeated);assert.deepEqual(replay,forged);
  report.cases.push({step:'lock/Forge/Cancel/receipt/retry',lockedId:locked,materials,receipt});
  await forgeSheet.getByRole('button',{name:'Compare result',exact:true}).click();const resultCompare=page.getByRole('dialog',{name:'Equipment',exact:true});
  assert.equal((await profile()).inventory.instances.find(i=>i.id===receipt.outputInstanceId).isNew,false);
  await resultCompare.getByRole('button',{name:'Close equipment',exact:true}).click();sheet=await inventory();await manage(sheet,receipt.outputBaseId);
  await lock(sheet,receipt.outputInstanceId,true);await lock(sheet,receipt.outputInstanceId,false);
  const beforeSingle=await profile(),singleQuote=previewSalvage(beforeSingle,content,receipt.outputInstanceId);assert(singleQuote.ok);const reward=singleQuote.salvage.gold;
  await sheet.getByRole('button',{name:`Review salvage copy #${receipt.outputInstanceId}`,exact:true}).click();await sheet.getByRole('button',{name:`Confirm salvage copy #${receipt.outputInstanceId} for ${reward} Gold`,exact:true}).click();
  await expect(sheet.getByRole('status').filter({hasText:`Copy #${receipt.outputInstanceId} salvaged for ${reward} Gold and saved.`})).toBeVisible();const single=await snapshot('single');removed(beforeSingle,single,[receipt.outputInstanceId],reward);
  const singleRetry=structuredClone(single);assert(!salvageItem(singleRetry,content,{instanceId:receipt.outputInstanceId,rulesVersion:singleQuote.salvage.rulesVersion,expectedGold:reward}).ok);assert.deepEqual(singleRetry,single);assert(fuse(singleRetry,content,FORGE_V1,input).repeated);assert.deepEqual(singleRetry,single);
  report.cases.push({step:'Forge-output/NEW/lock/unlock/single',output:receipt.outputInstanceId,reward,receiptPreservedAfterConsumption:true});
  await manage(sheet,starter.id);const ids=weapon.slice(-2).map(i=>i.id);
  for(const id of ids)await sheet.getByRole('checkbox',{name:`Select for salvage copy #${id}`,exact:true}).check();
  await lock(sheet,ids[1],true);await sheet.getByLabel('Salvage eligibility',{exact:true}).selectOption('eligible');
  const staleBytes=await storage(),stale=await profile();await sheet.getByRole('button',{name:'Review selected salvage',exact:true}).click();await expect(sheet.getByRole('alert')).toContainText('Locked copies');assert.deepEqual(await storage(),staleBytes);assert.deepEqual(state(await profile()),state(stale));
  await expect(sheet.getByRole('region',{name:'Inventory salvage selection'}).getByRole('status')).toContainText('2 copies selected');
  await sheet.getByLabel('Salvage eligibility',{exact:true}).selectOption('');await lock(sheet,ids[1],false);
  await sheet.getByLabel('Slot',{exact:true}).selectOption('ring');await expect(sheet.getByRole('region',{name:'Inventory salvage selection'}).getByRole('status')).toContainText('2 outside current filters');
  await sheet.getByRole('button',{name:'Review selected salvage',exact:true}).click();const confirmation=sheet.getByRole('region',{name:'Confirm bulk salvage',exact:true});for(const id of ids)await expect(confirmation).toContainText(`Copy #${id}`);
  const beforeBatch=await snapshot('before-batch');await page.evaluate(()=>{window.__c3Fault=true;});await sheet.getByRole('button',{name:'Confirm salvage 2 copies for 10 Gold',exact:true}).click();await expect(page.getByText('Adventure paused',{exact:true})).toBeVisible();assert.equal(await page.getByText('2 selected copies salvaged for 10 Gold and saved.',{exact:true}).count(),0);
  await page.evaluate(()=>{window.__c3Fault=false;});await page.getByRole('button',{name:'Check again (read only)',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('.header').waitFor();
  const recovered=await snapshot('recovered');removed(beforeBatch,recovered,ids,10);
  const q=previewBulkSalvage(beforeBatch,content,ids);assert(q.ok);const retry=structuredClone(recovered);assert(!salvageItems(retry,content,{rulesVersion:q.bulkSalvage.rulesVersion,copies:q.bulkSalvage.copies,expectedGold:10}).ok);assert.deepEqual(retry,recovered);
  await page.reload();await page.locator('.header').waitFor();const restored=await snapshot('restored');assert.deepEqual(state(restored),state(recovered));
  report.cases.push({step:'hidden-selection/all-or-nothing/readback-fault/recovery/reload',ids,reward:10,noFalseSuccess:true,noAutomaticRemovalOrReplacement:true,wholeAfterState:true,retryNoReward:true});
  sheet=await inventory();const sword=sheet.locator('[data-base-id="wayfarer_blade"]');
  await expect(sword).toContainText('Warrior only');
  await sword.getByRole('button',{name:'Compare Wayfarer Blade',exact:true}).click();
  await expect(page.getByRole('button',{name:'Requires Warrior',exact:true})).toBeDisabled();
  assert.equal((await profile()).equipment.weapon,restored.equipment.weapon);
  report.cases.push({step:'class gear',legacySwordDisabled:true,forgeClass:content.item(receipt.outputBaseId).classId});
  assert.deepEqual(report.errors,[]);report.pass=true;console.log(JSON.stringify(report));
}catch(e){report.failure={message:String(e),stack:e.stack};throw e;}finally{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await ctx.close();await browser.close();server.close();}
