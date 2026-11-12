// node tools/visual/combat-layout-check.mjs — real DOM clipping at native pixel scale.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {preview} from 'vite';
import {chromium} from 'playwright';
const out=resolve('tools/smoke/out/combat-layout');mkdirSync(out,{recursive:true});
const web=await preview({root:resolve('apps/mobile'),configFile:false,preview:{host:'127.0.0.1',port:0}});
let browser;const cases=[];
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:320,height:568}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${web.httpServer.address().port}`);await page.getByText('Begin in Greenfields',{exact:true}).click();
 await page.waitForFunction(()=>window.__emberRenderer?.actors.size>1);
 await page.evaluate(()=>{window.__emberRenderer.onFrame=()=>{};});
 for(const [width,height] of [[320,568],[360,640],[390,844],[480,854],[768,1024],[640,360]]){
  await page.setViewportSize({width,height});
  for(const background of ['greenfields','darkwood','ashen']){
   await page.evaluate(background=>{document.querySelector('.combat-frame').dataset.background=background;window.__emberRenderer.setBackground(background);},background);
   for(const hero of ['warrior','monk','mage','ranger']){
    const scene={hero,enemies:['wolf','spider','wolf'],pose:'idle',effect:hero==='mage'?'ward':'none',timeMs:200};
    await page.evaluate(s=>window.__emberRenderer.renderPreview(s),scene);await page.waitForTimeout(120);
    for(const pose of ['idle','attack','hit','death']){
     const result=await page.evaluate(scene=>{
      const r=window.__emberRenderer;r.renderPreview(scene);
      const host=document.querySelector('.combat-host').getBoundingClientRect(),canvas=document.querySelector('.combat-canvas').getBoundingClientRect();
      const state=r.presentationSnapshot();
      return {host:{width:host.width,height:host.height},canvas:{width:canvas.width,height:canvas.height},actors:state.actors.map(a=>({...a,cssLeft:a.left*2+canvas.left-host.left,cssRight:a.right*2+canvas.left-host.left,cssTop:a.top*2+canvas.top-host.top,cssBottom:(a.top+a.frame[1])*2+canvas.top-host.top,cssBarY:a.barY*2+canvas.top-host.top}))};
     },{...scene,pose,timeMs:pose==='death'?1000:200});
     for(const actor of result.actors){
      assert(actor.production,`${hero}/${pose}: art did not load`);
      assert.deepEqual(actor.scale,[1,1]);
      assert(actor.cssLeft>=-1&&actor.cssRight<=result.host.width+1,`${width}/${background}/${hero}/${pose}: horizontal crop ${JSON.stringify(actor)}`);
      assert(actor.cssTop>=-1&&actor.cssBottom<=result.host.height+1,`${width}/${background}/${hero}/${pose}: vertical crop ${JSON.stringify(actor)}`);
      assert(actor.cssBarY>=0,`${width}/${hero}/${pose}: clipped health bar`);
     }
     cases.push({width,height,background,hero,pose});
    }
   }
  }
 }
 assert.deepEqual(errors,[]);
 console.log(`PASS: ${cases.length} native-scale combat compositions fit their actual canvas host, including health bars.`);
}finally{writeFileSync(resolve(out,'report.json'),JSON.stringify({cases},null,2));await browser?.close();await web.close();}
