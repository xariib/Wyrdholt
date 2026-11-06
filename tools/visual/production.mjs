import {chromium} from "playwright";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const root=new URL("../../artifacts/production/",import.meta.url);mkdirSync(root,{recursive:true});
const fixtures=JSON.parse(readFileSync(new URL("fixtures.json",root)));const report=[];
const browser=await chromium.launch({args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
try{for(const [width,height] of [[360,640],[390,844],[412,915],[480,854]]){
 const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,hasTouch:true,isMobile:true});
 await ctx.addInitScript(()=>{const original=Date.now;const delta=1800000000000-original();window.__offset=0;Date.now=()=>original()+delta+window.__offset;let hidden=false;Object.defineProperty(document,"visibilityState",{get:()=>hidden?"hidden":"visible"});window.__hide=h=>{hidden=h;document.dispatchEvent(new Event("visibilitychange"));};});
 const p=await ctx.newPage();const errors=[];p.on("pageerror",e=>errors.push(String(e)));
 const shot=async name=>{await p.screenshot({animations:"disabled",path:fileURLToPath(new URL(`${name}-${width}x${height}.png`,root))});if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error("Overflow "+name);};
 await p.goto("http://127.0.0.1:4173/");await p.getByText("Begin in Greenfields").tap();await p.locator(".combat-canvas").waitFor();
 const load=async name=>{await p.evaluate(()=>{window.__offset=0;});await p.getByRole("button",{name:"Developer tools"}).tap();await p.locator("#import-save").fill(fixtures[name]);await p.getByRole("button",{name:/Load pasted save/}).tap();await p.waitForTimeout(350);await p.getByRole("button",{name:"Adventure",exact:true}).tap();await p.waitForTimeout(250);};
 await load("greenfields");await shot("adventure-greenfields");
 await load("darkwood");await shot("adventure-darkwood");
 await load("three-enemy");if(!await p.locator(".combat-names").innerText().then(t=>t.includes("3 enemies")))throw Error("Three-enemy capture missing pack");await shot("combat-three-enemy");
 await p.getByRole("button",{name:"Character",exact:true}).tap();await shot("character");
 await p.getByRole("button",{name:/^Gear/}).tap();await shot("gear");
 const cards=p.locator(".slot-card");if(await cards.count()!==6)throw Error("Missing slots");
 for(const card of await cards.all()){const b=await card.boundingBox();if(b.y+b.height>height-64)throw Error("Slot below fold "+width);}
 await p.locator('[data-slot="head"]').tap();await shot("slot-sheet");
 await p.locator(".slot-inventory .list-item:not(.equipped)").first().tap();await shot("comparison-sheet");
 const before=await p.evaluate(()=>window.__ember.simulatedMs());await p.waitForTimeout(250);const after=await p.evaluate(()=>window.__ember.simulatedMs());if(after<=before)throw Error("Gear paused activity");
 await p.getByRole("button",{name:/^Equip /}).tap();if(await p.locator('.sheet').count())throw Error("Equip did not close sheet");
 await p.locator('[data-slot="head"]').tap();
 const cdp=await ctx.newCDPSession(p);
 const swipe=async(locator,dy)=>{const b=await locator.boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});for(let i=1;i<=10;i++){await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y:y+dy*i/10}]});await p.waitForTimeout(16);}await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await p.waitForTimeout(200);};
 // Constrain the sheet to exercise real overflow even with the small current catalog.
 await p.locator(".sheet").evaluate(el=>el.style.maxHeight="320px");
 await swipe(p.locator(".slot-inventory .list-item").nth(1),-100);
 if(await p.locator(".equip-cta").count())throw Error("Scroll selected an item");
 if(await p.locator(".sheet").evaluate(el=>el.scrollTop)<=0)throw Error("Item swipe did not scroll");
 await p.locator(".sheet").evaluate(el=>el.scrollTop=0);
 await swipe(p.locator(".sheet-drag"),100);
 if(await p.locator(".sheet").count())throw Error("Swipe down did not close");
 await p.locator('[data-slot="head"]').tap();await p.getByRole("button",{name:"Close equipment"}).tap();
 await load("safe-farm");await shot("safe-farm");
 await p.evaluate(()=>{window.__hide(true);window.__offset+=7200000;window.__hide(false);});await p.getByText("While you were away…").waitFor();await shot("offline-summary");await p.getByRole("button",{name:"Continue",exact:true}).tap();
 await load("failure");await p.getByText("Defeated",{exact:true}).waitFor({timeout:30000});await shot("push-failure");
 await p.locator(".modal").getByRole("button",{name:/^(Keep farming|Farm) /}).tap();
 await p.locator(".nav-btn").getByText("Gear",{exact:true}).tap();
 await p.evaluate(()=>{document.documentElement.style.setProperty("--safe-area-inset-top","24px");document.documentElement.style.setProperty("--safe-area-inset-bottom","24px");});
 const header=await p.locator(".header").boundingBox();
 if(header.y<24)throw Error("Top safe area ignored");
 for(const button of await p.locator(".nav-btn").all()){const b=await button.boundingBox();if(b.y+b.height>height-23)throw Error("Bottom safe area ignored");}
 report.push({width,height,captures:10,safeInsetCheck:true,activityContinued:true,slotsVisible:true,touchScrollCancelsTap:true,swipeDismiss:true,errors});if(errors.length)throw Error(errors.join("\n"));await ctx.close();
}writeFileSync(new URL("report.json",root),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}finally{await browser.close();}
