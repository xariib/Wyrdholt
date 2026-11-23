import { selectedTalents, talentPoints, type Profile } from "@emberbound/game-core";
import type { TalentTreeDef } from "@emberbound/shared-types";
import { useState } from "react";
import { session } from "../../game/session";
import { Sheet } from "../components/Common";

export function SkillTree({ profile, tree, rank, onClose }: { profile: Profile; tree: TalentTreeDef; rank: number; onClose: () => void }) {
  const { classId, branches } = tree;
  const current = profile.pending?.talents?.[classId] ?? profile.character.talents?.[classId] ?? [];
  const [draft, setDraft] = useState(() => selectedTalents(tree, rank, current).map(node => node.id));
  const [focused, setFocused] = useState(branches[0]!.nodes[0]!.id);
  const [notice, setNotice] = useState("");
  const points = talentPoints(rank);
  const branch = branches.find(entry => entry.nodes.some(node => node.id === focused))!;
  const index = branch.nodes.findIndex(node => node.id === focused);
  const node = branch.nodes[index]!;
  const chosen = draft.includes(focused);
  const hasPrerequisite = index === 0 || draft.includes(branch.nodes[index - 1]!.id);
  const changed = draft.length !== current.length || draft.some(id => !current.includes(id));
  const toggle = () => {
    setNotice("");
    if (chosen) {
      const removed = new Set(branch.nodes.slice(index).map(entry => entry.id));
      setDraft(draft.filter(id => !removed.has(id)));
    } else setDraft([...draft, focused]);
  };
  const apply = () => {
    const result = session.dispatch({ type: "setTalents", classId, talentIds: draft });
    if (result.ok) setNotice(result.queued ? "Skills apply after this fight." : "Skills applied.");
    else setNotice(result.error);
  };
  return (
    <Sheet label={`${session.content.classDef(classId).name} skill tree`} onClose={onClose}>
      <div className="stack">
        <div className="row spread">
          <h2>{session.content.classDef(classId).name} skill tree</h2>
          <button className="btn ghost sheet-close" aria-label="Close skill tree" onClick={onClose}>×</button>
        </div>
        <p className="small muted">{points - draft.length} of {points} points available. Earn one at Mastery 3, 6, 9 and 12.</p>
        <div className="talent-branches">
          {branches.map(({ name, nodes }) => <section key={name} aria-label={name}>
            <h3>{name}</h3>
            {nodes.map(entry => <button key={entry.id} className="btn talent-node" data-learned={draft.includes(entry.id)}
              aria-pressed={focused === entry.id} onClick={() => { setFocused(entry.id); setNotice(""); }}>
              {entry.name}{draft.includes(entry.id) && <span aria-label="Learned"> ✓</span>}
            </button>)}
          </section>)}
        </div>
        <section className="stack" aria-label="Selected skill">
          <p className="small">{node.description}</p>
          {!chosen && !hasPrerequisite && <p className="small muted">Requires {branch.nodes[index - 1]!.name}.</p>}
          <button className="btn" disabled={!chosen && (!hasPrerequisite || draft.length >= points)} onClick={toggle}>
            {chosen ? "Refund from here" : "Spend 1 point"}
          </button>
        </section>
        <div className="talent-actions">
          <button className="btn" disabled={!draft.length} onClick={() => { setDraft([]); setNotice(""); }}>Reset tree</button>
          <button className="btn primary" disabled={!changed} onClick={apply}>Apply skills</button>
        </div>
        {notice && <p className="small" role="status">{notice}</p>}
      </div>
    </Sheet>
  );
}
