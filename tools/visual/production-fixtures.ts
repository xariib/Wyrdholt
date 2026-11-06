import {writeFileSync,mkdirSync} from "node:fs";
import {CONTENT} from "@emberbound/game-content";
import {ContentIndex,createProfile,applyCommand,advanceAdventure,serializeSave} from "@emberbound/game-core";
const content=new ContentIndex(CONTENT);const now=1800000000000;
const out:Record<string,string>={};
for(const [label,zone,level,stage] of [["greenfields","greenfields",7,0],["darkwood","darkwood",14,0],["three-enemy","darkwood",14,3],["safe-farm","greenfields",14,0],["failure","ashen_mountains",1,0]] as const){
 const p=createProfile(content,{name:"Wyrdholt",activeClassId:"monk",alternateClassId:"mage",masterSeed:1042,nowWallMs:now});
 p.character.level=level;p.character.xp=content.levelTotals[level-1]??0;
 p.character.masteryXp.monk=content.masteryTotals(content.classDef("monk").masteryTrackId)[6]??0;
 applyCommand(p,content,{type:"devGrant",baseIds:CONTENT.items.map(i=>i.id)},{contentTimeMs:now});
 applyCommand(p,content,{type:"devUnlockZones"},{contentTimeMs:now});
 const zoneId=content.snapshot.zones.find(z=>z.id===zone||z.id.includes("ashen")&&label==="failure")!.id;
 applyCommand(p,content,{type:"startPush",zoneId},{contentTimeMs:now});
 if(stage>0){for(let i=0;i<10000&&p.adventure.run?.stageIndex!==stage;i++)advanceAdventure(p,content,100,{offline:false,contentTimeMs:now});}
 if(stage>0 && p.adventure.run?.stageIndex!==stage) throw new Error(`Fixture failed to reach stage ${stage}`);
 if(label==="three-enemy" && content.zone(zoneId).stages[stage]?.enemies.length!==3) throw new Error("Expected three enemies");
 if(label==="safe-farm"){
  for(let i=0;i<10000&&!p.adventure.zones.greenfields?.cleared;i++)advanceAdventure(p,content,100,{offline:false,contentTimeMs:now});
  applyCommand(p,content,{type:"startFarm",zoneId:"greenfields"},{contentTimeMs:now});
 }
 out[label]=serializeSave(p,now);
}
mkdirSync("artifacts/production",{recursive:true});writeFileSync("artifacts/production/fixtures.json",JSON.stringify(out));
