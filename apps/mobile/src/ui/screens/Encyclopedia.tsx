import { useState, type ReactNode } from "react";
import { canUseItem } from "@emberbound/game-core";
import { session } from "../../game/session";
import { ItemIcon, NavIcon, SpriteImage } from "../components/icons";
import { pct, rarityColor, rate, SLOT_LABELS } from "../format";
import { statRows } from "../gearModel";
import { TechniqueList } from "./Character";

const sections = ["Classes", "Gear", "Bestiary", "Regions", "Challenges"] as const;
type Section = typeof sections[number];

function Entry({ name, detail, art, children }: { name: string; detail: string; art?: ReactNode; children: ReactNode }) {
  return <details className="encyclopedia-entry">
    <summary>
      {art && <span className="entry-art" aria-hidden="true">{art}</span>}
      <span className="entry-heading"><b>{name}</b><small>{detail}</small></span>
    </summary>
    <div className="stack entry-body">{children}</div>
  </details>;
}

export function EncyclopediaScreen({ classId, onBack }: { classId: string; onBack: () => void }) {
  const [section, setSection] = useState<Section>("Classes");
  const [search, setSearch] = useState("");
  const content = session.content;
  const zones = content.snapshot.zones.filter(zone => zone.implemented && !zone.hidden);
  const query = search.trim().toLowerCase();
  const matches = (...parts: string[]) => parts.some(part => part.toLowerCase().includes(query));
  let entries: ReactNode[];

  switch (section) {
    case "Classes":
      entries = content.snapshot.classes.filter(cls => cls.implemented && cls.tier === 1).flatMap(cls => {
        const track = content.track(cls.masteryTrackId);
        const promotion = content.promotions.get(cls.id);
        if (!matches(cls.name, cls.tagline, ...cls.identity, promotion?.name ?? "", ...track.techniques.map(technique => technique.name))) return [];
        return <Entry key={cls.id} name={cls.name} detail={cls.identity.join(" · ")} art={<SpriteImage name={cls.sprite} />}>
          <p>{cls.tagline}</p>
          <p className="small muted">{cls.base.hp} base HP · {cls.base.attack} base Attack · {cls.base.armor} base Armor</p>
          <TechniqueList classId={cls.id} rank={track.maxRank} nextId={null} />
          {promotion && <p className="small"><b>{promotion.name}</b> · Level {promotion.level}, Mastery {promotion.mastery}, and a trial victory. Grants +{pct(promotion.attackBp)} Attack.</p>}
        </Entry>;
      });
      break;
    case "Gear":
      entries = content.snapshot.items.flatMap(item => {
        if (!canUseItem(item, classId)) return [];
        const rarity = content.rarity(item.rarity);
        const slot = SLOT_LABELS[item.slot] ?? item.slot;
        const className = item.classId ? content.classDef(item.classId).name : "";
        if (!matches(item.name, className, rarity.name, slot, item.effect?.name ?? "", item.effect?.description ?? "", ...item.tags)) return [];
        return <Entry key={item.id} name={item.name} detail={`${rarity.name} · ${slot}${className ? ` · ${className} only` : ""}`} art={<ItemIcon item={item} icon={item.icon} rarityColor={rarityColor(content, item.rarity)} size={34} />}>
          <div className="chips">{statRows(null, item, { pct, rate }).map(stat => <span className="tag" key={stat.key}>{stat.format(stat.candidate)} {stat.label}</span>)}</div>
          {item.effect && <p><b>{item.effect.name}</b> · {item.effect.description}</p>}
          <p className="small muted">Minimum encounter level {item.minEncounterLevel}</p>
        </Entry>;
      });
      break;
    case "Bestiary":
      entries = content.snapshot.enemies.flatMap(enemy => {
        const habitats = zones.filter(zone => zone.stages.some(stage => stage.enemies.includes(enemy.id))).map(zone => zone.name);
        if (habitats.length === 0 || !matches(enemy.name, enemy.damageType, ...habitats)) return [];
        return <Entry key={enemy.id} name={enemy.name} detail={habitats.join(" · ")} art={<SpriteImage name={enemy.sprite} />}>
          <p>{enemy.damageType === "magic" ? "Magic" : "Physical"} damage · {enemy.armor} Armor · {rate(enemy.attackRateMilli)} attack rate</p>
          <p className="small muted">Appears in {habitats.join(", ")}.</p>
        </Entry>;
      });
      break;
    case "Regions":
      entries = zones.filter(zone => matches(zone.name, zone.description)).map(zone => <Entry key={zone.id} name={zone.name} detail={`${zone.stages.length} stages`}>
        <p>{zone.description}</p>
        <p className="small muted">Normal encounters can drop up to {content.rarity(content.lootTable(zone.lootTableId).maxRarity).name} gear.</p>
        {zone.stages.filter(stage => stage.role !== "normal").map(stage => <div className="row spread small" key={stage.index}>
          <b>Stage {stage.index + 1} · {stage.role === "boss" ? "Boss" : "Elite"}</b>
          <span>{stage.enemies.map(id => content.enemy(id).name).join(", ")}</span>
        </div>)}
      </Entry>);
      break;
    case "Challenges":
      entries = [...content.soloBosses.values()].flatMap(boss => {
        const region = content.zone(boss.unlockZoneId).name;
        const season = content.seasons.get(boss.id);
        const promotion = [...content.promotions.values()].find(path => path.boss.id === boss.id);
        const type = season ? season.name : promotion ? "Promotion trial" : "Solo Boss";
        if (!matches(boss.name, region, type, season?.rule.name ?? "")) return [];
        return <Entry key={boss.id} name={boss.name} detail={`${type} · ${boss.tiers.length} ${boss.tiers.length === 1 ? "tier" : "tiers"}`} art={<SpriteImage name={boss.sprite} />}>
          <p>Entry requires a {region} clear.</p>
          {promotion && <p className="small muted">Requires {content.classDef(promotion.classId).name} Mastery {promotion.mastery} and Character Level {promotion.level}.</p>}
          {season && <p className="small muted">{season.rule.name} · Relic {season.relicName}</p>}
        </Entry>;
      });
      break;
  }

  return <main className="screen encyclopedia-screen" aria-labelledby="encyclopedia-title">
    <div className="row spread encyclopedia-title">
      <span className="row"><NavIcon name="book" /><h2 id="encyclopedia-title">Encyclopedia</h2></span>
      <button className="btn small" onClick={onBack}>Back to menu</button>
    </div>
    <div className="encyclopedia-filters" role="group" aria-label="Encyclopedia categories">
      {sections.map(category => <button key={category} className="btn" aria-pressed={category === section} onClick={() => { setSection(category); setSearch(""); }}>{category}</button>)}
    </div>
    <label className="stack small">Search {section.toLowerCase()}
      <input type="search" className="text-input" value={search} onChange={event => setSearch(event.target.value)} />
    </label>
    <div className="stack" aria-label={`${section} entries`}>{entries.length ? entries : <p className="small muted">No entries match your search.</p>}</div>
  </main>;
}
