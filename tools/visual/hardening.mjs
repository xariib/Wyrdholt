import {chromium} from "playwright";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
const root="artifacts/hardening-20260924",fixtures=JSON.parse(readFileSync(`${root}/fixtures.json`));mkdirSync(`${root}/screens`,{recursive:true});
const browser=await chromium.launch({args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const report={checks:[],errors:[]};
try{
 const ctx=await browser.newContext({viewport:{width:360,height:640},hasTouch:true,isMobile:true});
 await ctx.addInitScript(()=>{const real=Date.now,delta=1800000000000-real();Date.now=()=>real()+delta;});
 const p=await ctx.newPage();p.on("pageerror",e=>report.errors.push(String(e)));
 await p.goto("http://127.0.0.1:4173/");await p.getByText("Begin in Greenfields").tap();
 const back=()=>p.evaluate(()=>window.__ember.back());
 const load=async name=>{await p.getByRole("button",{name:"Developer tools"}).tap();await p.locator("#import-save").fill(fixtures[name]);await p.getByRole("button",{name:/Load pasted save/}).tap();await p.waitForTimeout(150);};
 const shot=async name=>{await p.screenshot({animations:"disabled",path:`${root}/screens/${name}.png`});if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(`Horizontal overflow: ${name}`);};
 for(const cls of ["warrior","monk","mage","ranger"])for(const rank of [1,5,10,15,20]){
  await load(`${cls}-m${rank}`);await p.getByRole("button",{name:"Character",exact:true}).tap();
  const card=p.locator(`.class-card[data-class="${cls}"]`);
  if(!await card.innerText().then(t=>t.includes(`Mastery ${rank} /`)))throw Error(`Wrong mastery ${cls} ${rank}`);
  const ranks=await card.locator(".technique.unlocked .rank").allTextContents();
  if(ranks.some(t=>Number(t.slice(1))>rank)||ranks.length!==(cls==="mage"?2:1)+[5,10,15,20].filter(n=>n<=rank).length)throw Error("Wrong milestone display");
  await shot(`${cls}-m${rank}`);await back();report.checks.push(`${cls} M${rank} visible milestones`);
 }
 for(const stage of [2,5,10]){await load(`stage-${stage}`);await shot(`stage-${stage}`);report.checks.push(`stage ${stage}`);}
 await load("mage-m20");await p.waitForTimeout(6500);await shot("mage-ward");if(!await p.locator(".vitals-ward").isVisible())throw Error("Mage Ward missing");
 await p.getByRole("button",{name:/^Gear/}).tap();await p.locator('[data-slot="head"]').tap();await p.locator(".sheet").evaluate(el=>{el.style.maxHeight="270px";el.scrollTop=200;});
 const sb=await p.locator(".sheet").boundingBox(),cb=await p.getByRole("button",{name:"Close equipment"}).boundingBox();if(cb.y<sb.y||cb.y+cb.height>sb.y+sb.height)throw Error("Close scrolled out");
 await p.locator(".slot-inventory .list-item:not(.equipped)").last().tap();
 if(await p.locator(".sheet").evaluate(el=>el.scrollTop)>1)throw Error("Comparison inherited scroll");
 await shot("constrained-comparison");await back();if(await p.locator(".sheet").count())throw Error("Back did not close sheet");
 if(!await p.locator(".loadout-stage").isVisible())throw Error("Back left Gear too soon");await back();if(!await p.locator(".combat-canvas").isVisible())throw Error("Back did not return to Adventure");if(await back())throw Error("Root back unexpectedly consumed");report.checks.push("sticky close, comparison scroll reset, real sheet/tab/root Back routing");
 await load("empty");await p.getByRole("button",{name:/^Gear/}).tap();if(await p.locator(".slot-card").count()!==6)throw Error("Empty slots missing");await p.locator('[data-slot="head"]').tap();await p.getByText("No items for this slot yet.").waitFor();await shot("empty-slot");await back();
 await load("monk-m20");await p.getByRole("button",{name:/^Gear/}).tap();
 await p.locator(".slot-card .item-name").evaluateAll(els=>els.forEach(el=>el.textContent="The extraordinarily long ceremonial helm of Wyrdholt"));await shot("synthetic-long-names");
 await p.locator('[data-slot="head"]').tap();await p.locator(".slot-inventory .list-item:not(.equipped)").first().tap();
 await p.evaluate(()=>{document.documentElement.style.setProperty("--safe-area-inset-bottom","24px");});await p.setViewportSize({width:360,height:400});await p.getByRole("button",{name:/^Equip /}).scrollIntoViewIfNeeded();await shot("reduced-viewport-comparison");await back();await p.setViewportSize({width:360,height:640});
 const before=await p.evaluate(()=>window.__ember.simulatedMs());for(let i=0;i<12;i++){await p.getByRole("button",{name:"Character",exact:true}).tap();await p.getByRole("button",{name:/^Gear/}).tap();await p.getByRole("button",{name:"Adventure",exact:true}).tap();}
 if(await p.locator("canvas").count()!==1)throw Error("Renderer duplicated");if(await p.evaluate(()=>window.__ember.simulatedMs())<=before)throw Error("Tabs paused activity");report.checks.push("empty inventory, synthetic long names, reduced viewport, 36 tab switches, one canvas, activity continues");
 if(report.errors.length)throw Error(report.errors.join("\n"));writeFileSync(`${root}/hardening-ui.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
