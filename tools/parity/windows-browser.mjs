import {chromium,webkit} from "playwright";
import {readFileSync,writeFileSync} from "node:fs";
import {createServer} from "node:http";
const source=readFileSync(new URL("./out/parity-browser.js",import.meta.url));
const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/code.js"?"text/javascript":"text/html");res.end(req.url==="/code.js"?source:'<!doctype html><body><script src="/code.js"></script></body>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
try{for(const [engine,type] of [["chromium-v8",chromium],["webkit-playwright",webkit]]){
 const browser=await type.launch();try{const p=await browser.newPage();await p.goto(`http://127.0.0.1:${server.address().port}`);await p.waitForFunction(()=>window.__PARITY__);
 const result=await p.evaluate(()=>window.__PARITY__);writeFileSync(new URL(`./out/${engine}.json`,import.meta.url),JSON.stringify({engine,version:browser.version(),...result},null,2));
 console.log(engine,result.pass,result.results.length);if(!result.pass)throw Error(JSON.stringify(result));}finally{await browser.close();}
}}finally{server.close();}
