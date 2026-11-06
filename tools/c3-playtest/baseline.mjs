// Measurement only: reuses the existing model policy; never spends Gold/materials.
// node --import tsx tools/c3-playtest/baseline.mjs [out.json.gz] [days=14] [seedCount=3]
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CONTENT, FORGE_V1 } from '@emberbound/game-content';
import { ContentIndex, currentBuild, resolveHeroStats, forgeCeiling, eligibleForgeIds, previewSalvage } from '@emberbound/game-core';
import { SLOT_ORDER } from '@emberbound/shared-types';
import { runModelPlayer, schedule } from '../sim/model-player.ts';
const out=process.argv[2]??'tools/sim/out/c3-baseline.json.gz', days=Number(process.argv[3]??14), seedCount=Number(process.argv[4]??3);
assert(Number.isInteger(days)&&days>0&&Number.isInteger(seedCount)&&seedCount>0);
mkdirSync(dirname(out),{recursive:true});
const content=new ContentIndex(CONTENT), classes=['warrior','monk','mage','ranger'];
function opportunities(p) {
  const groups={}, salvage={copies:0,goldPotential:0,byRarity:{}}, cap=forgeCeiling(p,FORGE_V1);
  for(const i of p.inventory.instances){const rarity=content.item(i.baseId).rarity;groups[rarity]=(groups[rarity]??0)+1;const q=previewSalvage(p,content,i.id);if(q.ok){salvage.copies++;salvage.goldPotential+=q.salvage.gold;salvage.byRarity[rarity]=(salvage.byRarity[rarity]??0)+1;}}
  const forge=[];
  for(const slot of SLOT_ORDER) for(const [rarity,recipe] of Object.entries(FORGE_V1.recipes)) {
    const eligible=eligibleForgeIds(p,content,slot,rarity), materialBatches=Math.floor(eligible.length/recipe.count), unlocked=cap>=FORGE_V1.rarities.indexOf(rarity)+1;
    forge.push({slot,rarity,eligibleCopies:eligible.length,materialBatches,unlocked,price:recipe.gold,affordableBatchesInIsolation:unlocked?Math.min(materialBatches,Math.floor(p.gold/recipe.gold)):0,exampleIds:eligible.slice(0,recipe.count)});
  }
  const build=currentBuild(p), stats=resolveHeroStats(content,build,new Map(p.inventory.instances.map(i=>[i.id,i])));
  return {gold:p.gold,items:p.inventory.instances.length,newCopies:p.inventory.instances.filter(i=>i.isNew).length,byRarity:groups,protectedCopies:p.inventory.instances.length-salvage.copies,salvage,forge,equipment:build.equipment,itemEffects:stats.activeEffects.filter(e=>e.source==='item'),pending:p.pending??null,nextInstanceId:p.inventory.nextInstanceId};
}
const runs=[];
for(const classId of classes) for(const pattern of ['once','twice','model']) for(let n=0;n<seedCount;n++) {
  const seed=1042+n*7919, observations=[];
  const report=runModelPlayer(content,{classId,alternateClassId:classes.find(c=>c!==classId),seed,days,schedule:pattern,observeSessionEnd:(p,s)=>observations.push({wallMs:s.startMs+s.lengthMs,...opportunities(p)})});
  assert.equal(observations.length,schedule(days,pattern).length);
  const {nights,...deterministic}=report;
  const cleanNights=nights.map(({computeMs,...rest})=>rest);
  runs.push({classId,pattern,seed,report:{...deterministic,nights:cleanNights},observations});
  console.log(JSON.stringify({classId,pattern,seed,final:report.final,clears:report.clears.map(c=>[c.zoneId,c.day])}));
}
const digest=createHash('sha256').update(JSON.stringify(runs)).digest('hex');
const hashes=Object.fromEntries(['tools/c3-playtest/baseline.mjs','tools/sim/model-player.ts','package-lock.json'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const bytes=Buffer.from(JSON.stringify({pass:true,source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),contentVersion:CONTENT.contentVersion,contentHash:content.hash,offlineCapMs:CONTENT.config.offlineCapMs,days,seedCount,runCount:runs.length,deterministicSHA256:digest,hashes,policy:'Existing model-player: stat/effect-count heuristic, Push on check-in/leaving, strongest cleared Farm after defeat; no Forge/salvage/locks/grants/class switch. Opportunities are read-only, alternative uses of the same copies/Gold; isolated Forge rows cannot be summed as jointly affordable.',runs},null,2)+'\n');
writeFileSync(out,out.endsWith('.gz')?gzipSync(bytes,{level:9}):bytes);
