import {mkdirSync,writeFileSync} from "node:fs";
import {CONTENT} from "@emberbound/game-content";
import {ContentIndex,createProfile,applyCommand,advanceAdventure,serializeSave} from "@emberbound/game-core";
const content=new ContentIndex(CONTENT),now=1800000000000,out:Record<string,string>={};
for(const cls of ["warrior","monk","mage","ranger"]){
 for(const rank of [1,5,10,15,20]){
 const p=createProfile(content,{name:"Wyrdholt",activeClassId:cls,alternateClassId:cls==="monk"?"mage":"monk",masterSeed:1042,nowWallMs:now});
 p.character.level=14;p.character.xp=content.levelTotals[13]!;p.character.masteryXp[cls]=content.masteryTotals(content.classDef(cls).masteryTrackId)[rank-1]!;
 applyCommand(p,content,{type:"devGrant",baseIds:CONTENT.items.map(i=>i.id)},{contentTimeMs:now});
 applyCommand(p,content,{type:"startPush",zoneId:"greenfields"},{contentTimeMs:now});
 out[`${cls}-m${rank}`]=serializeSave(p,now);
 }
}
for(const stage of [1,4,9]){
 const p=createProfile(content,{name:"Stage inspection",activeClassId:"mage",alternateClassId:"monk",masterSeed:1042,nowWallMs:now});
 p.character.level=40;p.character.xp=content.levelTotals[39]??content.levelTotals.at(-1)!;
 applyCommand(p,content,{type:"startPush",zoneId:"greenfields"},{contentTimeMs:now});
 for(let i=0;i<100000&&p.adventure.run?.stageIndex!==stage;i++)advanceAdventure(p,content,100,{offline:false,contentTimeMs:now});
 if(p.adventure.run?.stageIndex!==stage)throw Error(`Could not reach ${stage}`);
 out[`stage-${stage+1}`]=serializeSave(p,now);
}
const empty=createProfile(content,{name:"Empty loadout",activeClassId:"monk",alternateClassId:"mage",masterSeed:1042,nowWallMs:now});empty.inventory.instances=[];empty.equipment={};out.empty=serializeSave(empty,now);
mkdirSync("artifacts/hardening-20260924",{recursive:true});writeFileSync("artifacts/hardening-20260924/fixtures.json",JSON.stringify(out));
