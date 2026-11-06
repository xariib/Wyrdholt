import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=process.argv[2]??'tools/smoke/out/forge';mkdirSync(out,{recursive:true});const report=[];
const baseUrl=process.env.FORGE_UI_URL??'http://127.0.0.1:4173/';
const selected=(process.env.FORGE_UI_ENGINES??'chromium,webkit').split(',');
assert(selected.length&&selected.every(e=>['chromium','webkit'].includes(e)));
const profile=async page=>page.evaluate(()=>JSON.parse(JSON.parse(window.__ember.exportSave()).payload));
const allIds=p=>[...Object.values(p.inventory.groups).flatMap(g=>g[0]),...p.inventory.full.map(i=>i.id)];
for(const engine of [chromium,webkit].filter(e=>selected.includes(e.name()))){
 const browser=await engine.launch(engine===chromium&&process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{});
 try{for(const [width,height] of [[360,640],[390,844],[412,915],[480,854]]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(baseUrl);await page.getByText('Begin in Greenfields').click();
  await page.getByRole('button',{name:/^Gear/}).last().click();await page.getByRole('button',{name:'Forge',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'Forge',exact:true});
  await sheet.getByText(/Forge unlocks this tier after/).waitFor();assert(await sheet.getByTestId('forge-review').isDisabled());
  await page.screenshot({path:`${out}/${engine.name()}-${width}-locked.png`});
  const dev=sheet.locator('.forge-dev');await dev.locator('summary').click();
  await dev.getByRole('button',{name:'Unlock Forge for testing'}).click();await dev.getByRole('button',{name:'Grant 5 Common Weapon',exact:true}).click();
  await sheet.getByRole('button',{name:'Select up to 5',exact:true}).click();assert(await sheet.getByTestId('forge-review').isDisabled());
  await dev.getByRole('button',{name:'Grant 50,000 Gold'}).click();
  await dev.getByLabel('Forge DEV outcome').selectOption('normal');
  await sheet.getByRole('button',{name:'Remove Wayfarer Blade'}).click();assert(await sheet.getByTestId('forge-review').isDisabled());
  await sheet.getByRole('button',{name:'Add Wayfarer Blade'}).click();
  await sheet.getByTestId('forge-review').click();await page.screenshot({path:`${out}/${engine.name()}-${width}-confirm.png`});
  await page.evaluate(()=>window.__ember.back());await sheet.getByTestId('forge-confirmation').waitFor({state:'hidden'});
  await sheet.getByTestId('forge-review').click();
  const before=await profile(page);
  await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));});
  await page.waitForTimeout(100);assert.equal((await profile(page)).forge.nextTransactionId,1);
  await sheet.getByTestId('forge-submit').evaluate(b=>{b.click();b.click();});
  await sheet.getByTestId('forge-result').waitFor();
  const normal=await profile(page),receipt=normal.forge.lastReceipt;assert.equal(receipt.outputRarity,'uncommon');assert.equal(normal.forge.nextTransactionId,2);assert.equal(allIds(normal).filter(id=>id===receipt.outputInstanceId).length,1);assert(receipt.consumedIds.every(id=>!allIds(normal).includes(id)));assert.equal(receipt.gold,100);
  await page.screenshot({path:`${out}/${engine.name()}-${width}-normal.png`});
  await page.reload();await page.locator('.header').waitFor();if(await page.getByRole('button',{name:'Continue',exact:true}).count())await page.getByRole('button',{name:'Continue',exact:true}).click();
  const restored=await profile(page);assert.deepEqual(restored.forge.lastReceipt,receipt);assert.equal(allIds(restored).filter(id=>id===receipt.outputInstanceId).length,1);
  await page.getByRole('button',{name:/^Gear/}).last().click();await page.getByRole('button',{name:'Forge',exact:true}).click();
  await sheet.getByLabel('Forge rarity').selectOption('rare');await dev.locator('summary').click();
  await dev.getByRole('button',{name:'Grant 6 Rare Weapon',exact:true}).click();await dev.getByLabel('Forge DEV outcome').selectOption('critical');
  await sheet.getByRole('button',{name:'Select up to 6',exact:true}).click();await sheet.getByTestId('forge-review').click();await sheet.getByTestId('forge-submit').click();await sheet.getByTestId('forge-result').waitFor();
  const critical=await profile(page);assert.equal(critical.forge.lastReceipt.critical,true);assert.equal(critical.forge.lastReceipt.outputRarity,'legendary');
  await page.screenshot({path:`${out}/${engine.name()}-${width}-critical.png`});
  await sheet.getByRole('button',{name:'Compare result'}).click();await page.getByRole('button',{name:'Equip Venomstring',exact:true}).click();
  const equip=await profile(page),iid=critical.forge.lastReceipt.outputInstanceId;assert(equip.equipment.weapon===iid||equip.pending?.equipment?.weapon===iid);
  let large=null;
  if(width===390){
   await page.getByRole('button',{name:'Forge',exact:true}).click();await dev.locator('summary').click();
   const start=Date.now();for(let i=0;i<3;i++)await dev.getByRole('button',{name:'Grant 2,000 test copies'}).click();
   await sheet.getByText('6000 available · 0 selected',{exact:true}).waitFor();large={items:allIds(await profile(page)).length,grantAndRenderMs:Date.now()-start,rows:await sheet.locator('.forge-item').count()};assert.equal(large.rows,1);
   await sheet.locator('.forge-item-name strong').evaluate(e=>e.textContent='Very Long Named Equipment For Narrow Phone Layout Validation '.repeat(4));
   assert(await sheet.evaluate(e=>e.scrollWidth<=e.clientWidth));await sheet.evaluate(e=>e.scrollTop=0);await page.screenshot({path:`${out}/${engine.name()}-${width}-large-long-name.png`});
   if(engine===chromium){
    await sheet.getByRole('button',{name:'Select up to 5',exact:true}).scrollIntoViewIfNeeded();const box=await sheet.getByRole('button',{name:'Select up to 5',exact:true}).boundingBox();const cdp=await page.context().newCDPSession(page);const beforeScroll=await sheet.evaluate(e=>e.scrollTop);let y=box.y+20;const x=box.x+20;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=0;i<8;i++){y-=12;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);assert.equal(await sheet.getByText('Selected: 0 / 5',{exact:true}).count(),1);large.touchScrolled=await sheet.evaluate(e=>e.scrollTop)>beforeScroll;assert(large.touchScrolled);
   }
   await sheet.getByLabel('Forge rarity').selectOption('legendary');await dev.getByRole('button',{name:'Grant 2,000 test copies'}).click();await sheet.getByText('Legendary is the highest Forge rarity.').waitFor();assert.equal(await sheet.getByTestId('forge-review').count(),0);
   await dev.getByRole('button',{name:'Reset Forge test materials'}).click();
  }
  assert.deepEqual(errors,[]);report.push({engine:engine.name(),width,height,normal:true,critical:true,reload:true,doubleTap:true,back:true,backgroundConfirmation:true,equip:true,large});await page.close();
 }}finally{await browser.close();}
}
writeFileSync(`${out}/report.json`,JSON.stringify({pass:true,selected,notRun:['chromium','webkit'].filter(e=>!selected.includes(e)),report},null,2));console.log('PASS Forge UI, persistence and mobile checks',report);
