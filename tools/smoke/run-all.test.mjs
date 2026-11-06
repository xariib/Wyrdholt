import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {runChecks} from './run-all.mjs';
test('records each actual exit code; later success cannot hide an earlier failure',()=>{
 const outDir=mkdtempSync(join(tmpdir(),'wyrdholt-smoke-test-'));
 try{
  const result=runChecks([0,7,0].map((code,i)=>({name:`probe-${i}`,command:process.execPath,args:['-e',`process.exit(${code})`]})),{cwd:process.cwd(),outDir});
  assert.equal(result.passed,false);assert.deepEqual(result.checks.map(c=>c.exitCode),[0,7,0]);
  assert.deepEqual(result.checks.map(c=>c.passed),[true,false,true]);
  assert.equal(JSON.parse(readFileSync(join(outDir,'smoke-exit-codes.json'))).passed,false);
 }finally{assert.equal(dirname(resolve(outDir)),resolve(tmpdir()));assert.ok(basename(outDir).startsWith('wyrdholt-smoke-test-'));rmSync(outDir,{recursive:true,force:true});}
});
