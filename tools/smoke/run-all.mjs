import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function runChecks(checks, {cwd, outDir}) {
  mkdirSync(outDir,{recursive:true});
  const report={passed:false,checks:[]};
  for(const check of checks){
    const started=Date.now();
    const result=spawnSync(check.command,check.args,{cwd,encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024});
    const log=join(outDir,`${check.name}.log`);
    writeFileSync(log,`${result.stdout??''}\n${result.stderr??''}`);
    const entry={name:check.name,command:check.command,args:check.args,exitCode:result.status,signal:result.signal,error:result.error?.message??null,passed:result.status===0&&!result.error&&!result.signal,elapsedMs:Date.now()-started,log};
    report.checks.push(entry);report.passed=report.checks.every(c=>c.passed);
    writeFileSync(join(outDir,'smoke-exit-codes.json'),JSON.stringify(report,null,2));
    console.log(`${entry.passed?'PASS':'FAIL'} ${check.name}: exit=${entry.exitCode}, signal=${entry.signal??'none'}${entry.error?`, error=${entry.error}`:''}`);
  }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const cwd=fileURLToPath(new URL('../../',import.meta.url)),base=process.argv[2]??'http://127.0.0.1:4173/';
 const specs=[
  ['ui-smoke',['tools/smoke/ui-smoke.mjs',base]],
  ['classes-check',['tools/smoke/classes-check.mjs',base]],
  ['zones-check',['tools/smoke/zones-check.mjs',base]],
  ['overlay-check',['tools/smoke/overlay-check.mjs',base]],
  ['offline-mastery-check',['tools/smoke/offline-mastery-check.mjs']],
  ['strict-csp-check',['tools/smoke/strict-csp-check.mjs']],
  ['render-independence',['--import','tsx','tools/smoke/b3-render-independence.ts',base]],
 ];
 const result=runChecks(specs.map(([name,args])=>({name,command:process.execPath,args})),{cwd,outDir:resolve(cwd,process.env.SMOKE_REPORT_DIR??'tools/smoke/out/suite')});
 process.exitCode=result.passed?0:1;
}
