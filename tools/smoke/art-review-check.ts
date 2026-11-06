import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createProfile, applyCommand, prepareFight, FightCache } from '@emberbound/game-core';
const content=new ContentIndex(CONTENT), out='artifacts/art-review-20260927';mkdirSync(out,{recursive:true});
const fixtures: {hero:string; fight:ReturnType<typeof prepareFight>; stage:number}[]=[];
for(const hero of ['warrior','monk','mage','ranger']){
 const p=createProfile(content,{name:'Render Test',activeClassId:hero,alternateClassId:hero==='mage'?'monk':'mage',masterSeed:123,nowWallMs:0});
 p.adventure.zones.darkwood!.unlocked=true;
 applyCommand(p,content,{type:'startPush',zoneId:'darkwood'},{contentTimeMs:0});
 for(let i=0;i<10;i++){
  p.adventure.run!.stageIndex=i;
  const fight=prepareFight(p,content,p.adventure.run!,{contentTimeMs:0,recordEvents:true,cache:new FightCache()});
  if(fight.setup.enemies.length===3)fixtures.push({hero,fight,stage:i+1});
 }
}
assert(fixtures.length>0);
const reports=[];
for(const engine of [chromium,webkit]){
 const browser=await engine.launch();
 try{
 for(const [width,height] of [[360,640],[390,844],[412,915],[480,854]]){
 const page=await browser.newPage({viewport:{width:width!,height:height!},isMobile:true,hasTouch:true});
 await page.addInitScript('window.__name = (value) => value;');
 await page.goto('http://127.0.0.1:4173/');await page.getByText('Begin in Greenfields').click();await page.locator('.combat-canvas').waitFor();
 await page.waitForTimeout(700);
 await page.evaluate(()=>{const r=(window as any).__emberRenderer;r.onFrame=()=>{};r.setBackground('darkwood');});
 for(const f of fixtures){
  await page.evaluate(f=>{const r=(window as any).__emberRenderer;r.setHeroSprite(f.hero);r.loadFight(f.fight,{},10000,false);},f);
  await page.waitForTimeout(250);
  const result=await page.evaluate(f=>{
   const r=(window as any).__emberRenderer;r.loadFight(f.fight,{},10000,false);r.play(0,10000);r.animate(10000);r.app.renderer.render(r.app.stage);
   const enemies=[...r.actors.values()].filter((a:any)=>!a.isHero) as any[];
   const bars=enemies.map(a=>a.bar.getBounds());
   const collision=bars.some((a:any,i:number)=>bars.some((b:any,j:number)=>i!==j&&a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y));
   return {names:enemies.map(a=>a.spriteName),rises:enemies.map(a=>a.groundOffset),collision,scales:enemies.filter(a=>a.motion).map(a=>a.body.scale.x)};
  },f);
  assert.deepEqual(result.rises,[0,-12,0]);assert(!result.collision);assert(result.scales.every((n:number)=>n===1));
  if(f.hero==='monk')await page.locator('.combat-canvas').screenshot({path:`${out}/${engine.name()}-${width}-stage${f.stage}.png`});
  reports.push({engine:engine.name(),width,hero:f.hero,stage:f.stage,...result});
 }
 // Isolated production renderer clock: edge conditions without mutating game state.
 const checks=await page.evaluate(()=>{
  const r=(window as any).__emberRenderer;
  const setup=(hero:string,events:any[])=>{r.renderPreview({hero,enemies:['spider'],pose:'idle',effect:'none',timeMs:0});r.preview=null;r.events=events;r.cursor=0;r.rebuilding=false;r.lastPlayback=0;};
  const hit=(t:number,crit=0)=>[{type:'attack',t,src:'hero',tgt:'preview-0'},{type:'hit',t,src:'hero',tgt:'preview-0',hp:5000,amt:1000,eff:1000,via:'basic',crit}];
  const contacts:any[]=[];const burst=r.artBurst.bind(r);r.artBurst=(name:string,...args:any[])=>{if(/impact|_hit$|splash|bite/.test(name))contacts.push({name,now:args[2]});return burst(name,...args);};
  const step=(t:number)=>{r.play(t,10000+t);r.animate(10000+t);};
  setup('monk',hit(1000,1));step(880);const noEarlyCrit=!r.actors.get('hero').motion.critical&&contacts.length===0;step(1000);const critAtContact=contacts.length===1&&contacts[0].name==='monk_impact_crit';step(1016);step(1200);const noDuplicate=contacts.length===1;
  contacts.length=0;setup('ranger',[...hit(1000),...hit(1120),...hit(1240)]);for(let t=700;t<=1500;t+=10)step(t);const rapid=contacts.length===3&&contacts.every((c:any,i:number)=>c.now===11000+i*120);
  contacts.length=0;setup('ranger',hit(1000));step(850);step(2000);const resume=contacts.length===0&&r.artEffects.length===0&&r.actors.get('preview-0').hp100===5000;
  contacts.length=0;setup('monk',hit(1000));r.rebuilding=true;step(1050);const reconstruct=contacts.length===0&&r.actors.get('preview-0').hp100===5000;
  setup('ranger',[{type:'death',t:900,actor:'hero'},...hit(1000)]);step(850);step(900);const deathCancels=r.actors.get('hero').motion.pose==='death'&&r.artEffects.length===0;
  setup('mage',hit(1000));step(850);r.clearScene();const stageClear=r.artEffects.length===0&&r.prerolled.size===0&&r.actors.size===0;
  r.setVisible(false);r.lastFrame=null;r.fightKey='old';r.setVisible(true);const visibleRebuild=r.fightKey==='';
  return {noEarlyCrit,critAtContact,noDuplicate,rapid,resume,reconstruct,deathCancels,stageClear,visibleRebuild};
 });
 assert(Object.values(checks).every(Boolean),JSON.stringify(checks));
 reports.push({engine:engine.name(),width,checks});await page.close();
 }
 }finally{await browser.close();}
}
writeFileSync(`${out}/review-check.json`,JSON.stringify({pass:true,fixtures:fixtures.length,reports},null,2));console.log('PASS real Darkwood formations and preroll lifecycle/crit/rapid/reconstruction checks in Chromium + WebKit');
