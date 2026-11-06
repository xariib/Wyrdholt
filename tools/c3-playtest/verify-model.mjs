// Proves instrumentation cannot change the existing model, and repeats one stored run.
// node --import tsx tools/c3-playtest/verify-model.mjs baseline.json out.json
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {CONTENT} from '@emberbound/game-content';
import {ContentIndex} from '@emberbound/game-core';
import {runModelPlayer,schedule} from '../sim/model-player.ts';
const [baselinePath,out]=process.argv.slice(2),baseline=JSON.parse(baselinePath.endsWith('.gz')?gunzipSync(readFileSync(baselinePath)).toString():readFileSync(baselinePath,'utf8')),content=new ContentIndex(CONTENT);
mkdirSync(dirname(out),{recursive:true});
const clean=r=>({...r,nights:r.nights.map(({computeMs,...rest})=>rest)});
const cases=[];
for(const classId of ['warrior','monk','mage','ranger'])for(const pattern of ['once','twice','model']){
 const options={classId,alternateClassId:classId==='warrior'?'monk':'warrior',seed:1042,days:1,schedule:pattern};
 const before=clean(runModelPlayer(content,options));let observed=0;
 const after=clean(runModelPlayer(content,{...options,observeSessionEnd:p=>{observed++;p.gold=0;p.inventory.instances=[];p.character.level=1;p.adventure.run=null;}}));
 assert.equal(observed,schedule(1,pattern).length);assert.deepEqual(after,before);cases.push({classId,pattern,detachedObserverMutationNoEffect:true});
}
const stored=baseline.runs[0],r=clean(runModelPlayer(content,{classId:stored.classId,alternateClassId:'monk',seed:stored.seed,days:baseline.days,schedule:stored.pattern}));assert.deepEqual(r,stored.report);
const digest=createHash('sha256').update(JSON.stringify(baseline.runs)).digest('hex');assert.equal(digest,baseline.deterministicSHA256);
writeFileSync(out,JSON.stringify({pass:true,cases,representativeRepeat:{classId:stored.classId,pattern:stored.pattern,seed:stored.seed,days:baseline.days,reportIdentical:true},baselineSHA256:digest},null,2)+'\n');console.log('PASS observer isolation, 12 variants; exact 14-day repeat and report digest');
