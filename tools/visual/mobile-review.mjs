// node --import tsx tools/visual/mobile-review.mjs [output-directory]
// Disposable local fixture, screenshots and geometry checks; never player storage.
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {CONTENT} from '@emberbound/game-content';
import {ContentIndex,createProfile,createInstance,applyCommand,serializeSave} from '@emberbound/game-core';
const out=resolve(process.argv[2]??'tools/smoke/out/visual');mkdirSync(out,{recursive:true});
const content=new ContentIndex(CONTENT);
const p=createProfile(content,{name:'WWWWWWWWWWWWWWWW',activeClassId:'mage',alternateClassId:'monk',masterSeed:1042,nowWallMs:Date.now()});
p.character.level=14;p.character.xp=content.levelTotals[13];p.gold=123456789012345;
for(const item of CONTENT.items)for(let i=0;i<2;i++)createInstance(p,item.id,{isNew:true});
applyCommand(p,content,{type:'devUnlockZones'},{contentTimeMs:Date.now()});
Object.assign(p.adventure.zones.ashen_mountains,{unlocked:true,cleared:true,bestStage:10,completions:1});
applyCommand(p,content,{type:'startPush',zoneId:'darkwood'},{contentTimeMs:Date.now()});
const web=await preview({root:resolve('apps/mobile'),configFile:false,preview:{host:'127.0.0.1',port:0}});
const url=`http://127.0.0.1:${web.httpServer.address().port}`;
const report=[];let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const [width,height] of [[320,568],[360,640],[390,844],[480,854],[768,1024],[640,360]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true});
  try{
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   const shot=async name=>{
    await page.evaluate(async()=>{await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));});
    await page.screenshot({path:join(out,`${width}x${height}-${name}.png`),animations:'disabled'});
    const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,
     shortArenas:[...document.querySelectorAll('.combat-frame .combat-host')].filter(e=>e.getClientRects().length&&e.clientHeight<220).map(e=>e.clientHeight),
     wideSheets:[...document.querySelectorAll('.sheet')].filter(e=>e.getBoundingClientRect().width>480.5).map(e=>e.getBoundingClientRect().width),
     brokenImages:[...document.images].filter(e=>e.getClientRects().length&&(!e.complete||!e.naturalWidth)).map(e=>e.src),
     outside:[...document.querySelectorAll('button,input,select,.header-name,.gold-chip,.combat-vitals,.nav')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').flatMap(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<-.5||r.right>innerWidth+.5)?[{tag:e.tagName,cls:e.className,text:(e.textContent??'').slice(0,70),left:r.left,right:r.right}]:[];})}));
    report.push({width,height,name,...layout,errors:[...errors]});
   };
   await page.goto(url);await page.locator('.class-option').first().waitFor();await shot('create');
   // Seed a disposable IndexedDB origin, then reload through the real save gate.
   p.clock.lastSettledWallMs=Date.now();const raw=serializeSave(p,Date.now());
   await page.evaluate(async raw=>{const db=await new Promise((ok,fail)=>{const r=indexedDB.open('Disc',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('FileStorage',{keyPath:'path'});s.createIndex('by_folder','folder');};r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});await new Promise((ok,fail)=>{const tx=db.transaction('FileStorage','readwrite');tx.objectStore('FileStorage').put({path:'/DATA/saves/profile.json',folder:'/DATA/saves',type:'file',content:raw,size:raw.length,ctime:1,mtime:1});tx.oncomplete=ok;tx.onerror=()=>fail(tx.error);});db.close();},raw);
   await page.reload();await page.locator('.combat-canvas').waitFor();await page.waitForTimeout(1500);
   await shot('adventure');
   await page.getByRole('button',{name:'Change Zone',exact:true}).click();await shot('zones');
   await page.getByRole('button',{name:'Close zone picker'}).click();
   const nav=name=>page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name,exact:true}).click();
   for(const tab of ['Character','Gear','Challenges','Menu']){await nav(tab);await shot(tab.toLowerCase());}
   await page.getByRole('button',{name:/Encyclopedia/}).click();await shot('encyclopedia');
   await nav('Gear');await page.locator('[data-slot="head"]').click();await shot('slot');
   await page.locator('.slot-inventory .list-item:not(.equipped)').first().click();await shot('comparison');
   await page.getByRole('button',{name:'Close equipment'}).click();
   await page.getByRole('button',{name:/^Inventory ·/}).click();await shot('inventory');
   await page.getByRole('button',{name:'Close inventory'}).click();
   await page.getByRole('button',{name:'Forge',exact:true}).click();await shot('forge');
   await page.getByRole('button',{name:'Close Forge',exact:true}).click();
   await nav('Adventure');
   await page.evaluate(()=>{document.documentElement.style.setProperty('--safe-area-inset-top','24px');document.documentElement.style.setProperty('--safe-area-inset-bottom','24px');});
   await shot('safe-area');
   await nav('Challenges');
   await page.getByRole('button',{name:'Challenge Tier 1',exact:true}).click();
   await page.locator('.boss-combat .combat-canvas').waitFor();await page.waitForTimeout(1000);
   await page.locator('.boss-combat').scrollIntoViewIfNeeded();await shot('boss');
   console.log(`Captured ${width}x${height}`);
  }finally{await context.close();}
 }
}finally{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await web.close();}
const failures=report.filter(r=>r.overflow||r.outside.length||r.errors.length||r.brokenImages.length||r.shortArenas.length||r.wideSheets.length);
assert.deepEqual(failures,[]);
console.log(`PASS: ${report.length} screen captures; no horizontal overflow, missing images, undersized arenas, oversized sheets or page errors.`);
