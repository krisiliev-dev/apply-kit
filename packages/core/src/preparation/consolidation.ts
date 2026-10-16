import { createHash } from "node:crypto";
import type { PreparationDeps } from "./ports.ts";
import type { ProfilePiece, ProfileStore } from "./profile.ts";
import { arrangeCareer, periodPair, type CareerResolution } from "./career.ts";
import { quantities } from "./numbers.ts";

export interface ConsolidationSuggestion { ids: string[]; reason: string }
export interface ProfileConsolidator {
  estimateUsd(pieces: ProfilePiece[]): number;
  propose(pieces: ProfilePiece[]): Promise<{ groups: ConsolidationSuggestion[]; costUsd: number }>;
}
export interface ConsolidationGroup {
  id: string;
  keep: ProfilePiece;
  others: ProfilePiece[];
  reason: string;
  blockedReason: string | null;
  requires: string[];
}
export interface ConsolidationPreview {
  id: string;
  status: "preview" | "applied" | "undone";
  before: number;
  after: number;
  groups: ConsolidationGroup[];
  costUsd: number;
}
const normal = (s: string) => s.toLowerCase().normalize("NFKC").replace(/\b(ltd|limited|inc|llc|plc|eood|ood|gmbh)\b|еоод|оод/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
const numbers = (s: string) => quantities(s).map(q => `${q.kind}:${q.value}:${q.hedge?.direction ?? "exact"}`).sort().join("|");
const seniority = (s: string) => (s.toLowerCase().match(/\b(senior|junior|lead|head|director|manager|principal|intern)\b|старши|младши|стажант/gu) ?? []).sort().join("|");

export function createConsolidationStore(deps: PreparationDeps, profile: ProfileStore) {
  const { db, clock } = deps;
  let pending: Promise<ConsolidationPreview> | null = null;
  const rows = () => db.prepare("SELECT * FROM profile_piece ORDER BY id").all();
  const links = () => db.prepare("SELECT * FROM profile_merge_source ORDER BY piece_id").all();
  const fingerprint = () => createHash("sha256").update(JSON.stringify([rows(), links(), db.prepare("SELECT * FROM import_merge ORDER BY id").all(), db.prepare("SELECT pair FROM career_separation ORDER BY pair").all()])).digest("hex");
  const load = (id: string) => db.prepare("SELECT * FROM profile_consolidation WHERE id = ?").get(id);
  const view = (r: Record<string, unknown>): ConsolidationPreview => JSON.parse(String(r.preview)) as ConsolidationPreview;
  const latest = () => { const r = db.prepare("SELECT * FROM profile_consolidation ORDER BY rowid DESC LIMIT 1").get(); return r ? view(r) : null; };

  function isSeparated(a: ProfilePiece, b: ProfilePiece, saved: Set<string>) {
    if (!saved.size) return false;
    const left=[a.id,...profile.sourceVersions(a.id).map(p=>p.id)];
    const right=[b.id,...profile.sourceVersions(b.id).map(p=>p.id)];
    return left.some(x=>right.some(y=>saved.has(periodPair(x,y))));
  }
  const separationChoices=()=>new Set(db.prepare("SELECT pair FROM career_separation").all().map(r=>String(r.pair)));

  function groupsOf(id: string, pieces: ProfilePiece[], suggestions: ConsolidationSuggestion[]): ConsolidationGroup[] {
    const separated=separationChoices();
    const byId = new Map(pieces.map(p => [p.id, p]));
    const used = new Set<string>();
    const groups = suggestions.flatMap((s, i): ConsolidationGroup[] => {
      if (s.ids.length < 2 || s.ids.some(key => !byId.has(key))) throw new Error("The model proposed an unknown piece or an incomplete group. Nothing changed.");
      const ids = [...new Set(s.ids)].filter(key => !used.has(key));
      if (ids.length < 2) return [];
      ids.forEach(key => used.add(key));
      const members = ids.map(key => byId.get(key)!);
      members.sort((a, b) => Number(b.status === "confirmed") - Number(a.status === "confirmed") || Number(!!b.belongsTo) - Number(!!a.belongsTo) || Number(!!b.entry?.end) - Number(!!a.entry?.end) || ((b.entry?.start.length ?? 0) + Number(!!b.entry?.city)) - ((a.entry?.start.length ?? 0) + Number(!!a.entry?.city)) || b.text.length - a.text.length);
      const keep = members[0]!;
      let blockedReason: string | null = null;
      if (members.some((p,i)=>members.slice(i+1).some(other=>isSeparated(p,other,separated)))) blockedReason = "You chose to keep these periods separate.";
      else if (members.some(p => p.kind !== keep.kind)) blockedReason = "Different kinds of piece.";
      else if (members.some(p => p.dispute || p.checkThis || p.status === "flagged")) blockedReason = "A source conflict or scanned text still needs your review.";
      else if (members.filter(p => p.status === "confirmed").length > 1) blockedReason = "More than one confirmed piece: keep your existing decisions.";
      else if (members.some(p => numbers(p.text) !== numbers(keep.text))) blockedReason = "Different numbers or quantities: review the original claims.";
      else if (members.some(p => p.tags.some(tag => !keep.tags.includes(tag)) || p.angles.some(angle => !keep.angles.includes(angle)))) blockedReason = "Different tags or profile angles: preserve those classifications.";
      else if (members.some(p => p.numberSource && p.numberSource !== keep.numberSource)) blockedReason = "Different number-source decisions: review those versions.";
      else if (members.some(p => p.bulgarian && keep.bulgarian !== p.bulgarian)) blockedReason = "Verified Bulgarian wordings differ.";
      else if (members.some(p => /\b(led|owned|managed)\b|ръковод/iu.test(p.text)) && members.some(p => /\b(helped|supported|contributed|participated|assisted)\b|подпом|участвах/iu.test(p.text))) blockedReason = "Different responsibility or ownership: review the original claims.";
      if (!blockedReason && keep.entry) {
        const e = keep.entry;
        if (members.some(p => normal(p.text) !== normal(keep.text))) blockedReason = "Role descriptions may contain unique facts; keep those versions for review.";
        if (!blockedReason && members.some(p => !p.entry || normal(p.entry.organisation) !== normal(e.organisation))) blockedReason = "Different employers or schools.";
        else if (members.some(p => p.entry!.start.slice(0, 4) !== e.start.slice(0, 4) || (p.entry!.start.length > 4 && e.start.length > 4 && p.entry!.start !== e.start))) blockedReason = "Different start dates or employment periods.";
        else if (members.some(p => p.entry!.end && e.end && p.entry!.end !== e.end)) blockedReason = "Conflicting end dates.";
        else if (members.some(p => p.entry!.city && normal(p.entry!.city) !== normal(e.city ?? ""))) blockedReason = "Different or missing locations: preserve the original role details.";
        else if (members.some(p => p.entry!.start.length > e.start.length)) blockedReason = "A version has a more precise start date: preserve that detail.";
        else if (members.some(p => seniority(p.entry!.title) !== seniority(e.title))) blockedReason = "Possible promotion or different seniority.";
        else if (keep.status === "confirmed" && members.some(p => p.entry!.end !== e.end || p.entry!.start !== e.start || normal(p.entry!.title) !== normal(e.title))) blockedReason = "A confirmed role has different facts; review the versions first.";
      }
      return [{ id: `${id}:${i}`, keep, others: members.slice(1), reason: s.reason, blockedReason, requires: [] }];
    });
    const roleGroups = new Map<string, ConsolidationGroup>();
    for (const g of groups.filter(g => g.keep.entry)) for (const p of [g.keep, ...g.others]) roleGroups.set(p.id, g);
    for (const g of groups.filter(g => !g.keep.entry && !g.blockedReason)) {
      const parents = new Set([g.keep, ...g.others].map(p => p.belongsTo).filter((p): p is string => !!p));
      if (parents.size < 2) continue;
      const matches = [...parents].map(p => roleGroups.get(p));
      const roleGroup = matches[0];
      if (!roleGroup || roleGroup.blockedReason || matches.some(m => m !== roleGroup)) g.blockedReason = "Facts belong to different roles. Merge their matching roles first.";
      else g.requires = [roleGroup.id];
    }
    return groups;
  }

  async function generate(): Promise<ConsolidationPreview> {
    if (!deps.consolidator) throw new Error("Profile consolidation isn't configured.");
    const pieces = profile.all();
    const stamp = fingerprint();
    const outcome = await deps.budget.call({ task: "consolidate-profile", estimateUsd: deps.consolidator.estimateUsd(pieces) }, () => deps.consolidator!.propose(pieces));
    if (outcome.refused) throw new Error("This consolidation doesn't fit the remaining monthly AI budget. Nothing changed.");
    if (stamp !== fingerprint()) throw new Error("Your profile changed during the analysis. Run the preview again.");
    const id = `consolidation:${crypto.randomUUID()}`;
    const groups = groupsOf(id, pieces, outcome.result.groups);
    const preview: ConsolidationPreview = { id, status: "preview", before: pieces.length, after: pieces.length - groups.filter(g => !g.blockedReason).reduce((n, g) => n + g.others.length, 0), groups, costUsd: outcome.result.costUsd };
    db.prepare("INSERT INTO profile_consolidation (id, preview, fingerprint, created_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(preview), stamp, clock.now().toISOString());
    return preview;
  }
  function transaction<T>(run: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try { const result = run(); db.exec("COMMIT"); return result; } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  function mergeInto(into: string, from: string) {
    db.prepare("UPDATE profile_piece SET belongs_to = ?, updated_at = ? WHERE belongs_to = ?").run(into,clock.now().toISOString(),from);
    db.prepare("UPDATE profile_merge_source SET into_id = ? WHERE into_id = ?").run(into,from);
    db.prepare("INSERT INTO profile_merge_source (piece_id, into_id) VALUES (?, ?)").run(from,into);
    db.prepare("UPDATE profile_piece SET discarded_at = ?, updated_at = ? WHERE id = ?").run(clock.now().toISOString(),clock.now().toISOString(),from);
  }

  function selectedPeriods(ids: string[], stamp: string) {
    if (stamp !== fingerprint()) throw new Error("Your profile changed. Reload the timeline before deciding.");
    if (ids.length < 2 || new Set(ids).size !== ids.length) throw new Error("Select at least two distinct career periods.");
    const selected = ids.map(id => profile.get(id));
    if (selected.some(p=>!p?.entry)) throw new Error("Select active work or education entries only.");
    return selected as ProfilePiece[];
  }
  return {
    timeline() {
      const pieces=profile.all(), heads=pieces.filter(p=>p.entry), choices=separationChoices(), expanded=new Set(choices);
      for(let a=0;a<heads.length;a++) for(let b=a+1;b<heads.length;b++) if(isSeparated(heads[a]!,heads[b]!,choices)) expanded.add(periodPair(heads[a]!.id,heads[b]!.id));
      const timeline=arrangeCareer(pieces,expanded,fingerprint());
      timeline.separatedPairs=choices.size;
      for (const period of timeline.periods) period.originals=period.heads.flatMap(p=>profile.sourceVersions(p.id));
      return timeline;
    },
    separate(ids: string[], stamp: string) {
      transaction(()=> {
        selectedPeriods(ids,stamp);
        for (let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++) db.prepare("INSERT OR IGNORE INTO career_separation (pair) VALUES (?)").run(periodPair(ids[a]!,ids[b]!));
      });
    },
    resetSeparations(stamp: string) {
      transaction(()=> { if (stamp!==fingerprint()) throw new Error("Your profile changed. Reload the timeline."); db.exec("DELETE FROM career_separation"); });
    },
    reconcile(ids: string[], resolution: CareerResolution, stamp: string): ConsolidationPreview {
      return transaction(()=> {
        const selected=selectedPeriods(ids,stamp);
        if (selected.some(p=>p.dispute)) throw new Error("Resolve source disputes in these entries before combining periods.");
        if (resolution.kind!=="role" && resolution.kind!=="education") throw new Error("Choose work or education.");
        const e=resolution.entry;
        if (!e || typeof e.title!=="string" || typeof e.organisation!=="string" || !e.title.trim() || !e.organisation.trim()) throw new Error("Give the title and organisation.");
        const month=/^\d{4}-(0[1-9]|1[0-2])$/;
        if (typeof e.start!=="string" || !month.test(e.start) || (e.end!==null && (typeof e.end!=="string" || !month.test(e.end)))) throw new Error("Give start and end as month and year, or leave end empty for current.");
        if (e.end && e.end<e.start) throw new Error("The end cannot be before the start.");
        if (e.city!==null && typeof e.city!=="string") throw new Error("Give a city or leave it empty.");
        const before=profile.all().length;
        const snapshot=JSON.stringify({rows:rows(),links:links()});
        const text=[...new Set(selected.map(p=>p.text).filter(Boolean))].join("\n\n");
        const numberSources=[...new Set(selected.map(p=>p.numberSource).filter(Boolean))];
        const saved=profile.save({kind:resolution.kind,entry:e,text,tags:[...new Set(selected.flatMap(p=>p.tags))],angles:[...new Set(selected.flatMap(p=>p.angles))],numberSource:numberSources.length===1?numberSources[0]:null}, {from:"Career period review",quote:null,status:"unconfirmed",checkThis:selected.some(p=>p.checkThis)});
        if (!saved.saved) throw new Error(saved.problems.map(p=>p.message).join(" "));
        const keep=saved.piece;
        for (const other of selected) mergeInto(keep.id,other.id);
        const facts=new Map<string,ProfilePiece[]>();
        for (const fact of profile.all().filter(p=>p.belongsTo===keep.id && !p.entry && !p.dispute && !p.checkThis && p.status!=="flagged")) {
          const key=JSON.stringify([fact.kind,fact.text.normalize("NFKC").toLowerCase().replace(/\s+/g," ").trim(),fact.numberSource,[...fact.tags].sort(),[...fact.angles].sort(),fact.bulgarian??null]);
          const versions=facts.get(key)??[];versions.push(fact);facts.set(key,versions);
        }
        for (const versions of facts.values()) {
          if (versions.length<2 || versions.filter(p=>p.status==="confirmed").length>1) continue;
          versions.sort((a,b)=>Number(b.status==="confirmed")-Number(a.status==="confirmed"));
          for (const other of versions.slice(1)) mergeInto(versions[0]!.id,other.id);
        }
        const id=`consolidation:${crypto.randomUUID()}`;
        const preview:ConsolidationPreview={id,status:"applied",before,after:profile.all().length,groups:[{id:`${id}:0`,keep,others:selected,reason:"Career periods explicitly reconciled by you",blockedReason:null,requires:[]}],costUsd:0};
        db.prepare("INSERT INTO profile_consolidation (id,preview,fingerprint,snapshot,created_at) VALUES (?,?,?,?,?)").run(id,JSON.stringify(preview),fingerprint(),snapshot,clock.now().toISOString());
        return preview;
      });
    },
    latest,
    preview() { pending ??= generate().finally(() => { pending = null; }); return pending; },
    apply(id: string, groupIds: string[]): ConsolidationPreview {
      return transaction(() => {
        const r = load(id); if (!r) throw new Error("No such consolidation preview.");
        const p = view(r);
        if (p.status === "applied") return p;
        if (p.status !== "preview" || r.fingerprint !== fingerprint()) throw new Error("Your profile changed. Run a fresh preview before merging.");
        if (!groupIds.length || new Set(groupIds).size !== groupIds.length) throw new Error("Choose at least one distinct group.");
        const chosen = groupIds.map(key => p.groups.find(g => g.id === key));
        if (chosen.some(g => !g || g.blockedReason)) throw new Error("A selected group needs review and cannot be merged.");
        for (const g of chosen) if (g!.requires.some(key => !groupIds.includes(key))) throw new Error("Select the matching role group too, or leave its facts separate.");
        const snapshot = JSON.stringify({ rows: rows(), links: links() });
        for (const g of chosen) for (const other of g!.others) mergeInto(g!.keep.id,other.id);
        p.status = "applied";
        p.after = profile.all().length;
        db.prepare("UPDATE profile_consolidation SET preview = ?, fingerprint = ?, snapshot = ? WHERE id = ?").run(JSON.stringify(p), fingerprint(), snapshot, id);
        return p;
      });
    },
    undo(id: string): ConsolidationPreview {
      return transaction(() => {
        const r = load(id); if (!r) throw new Error("No such consolidation.");
        const p = view(r);
        if (p.status === "undone") return p;
        if (p.status !== "applied" || latest()?.id !== id || r.fingerprint !== fingerprint()) throw new Error("Your profile changed after merging. Undo cannot overwrite those changes; the original pieces remain stored.");
        const snapshot = JSON.parse(String(r.snapshot)) as { rows: Record<string, string | number | null>[]; links: { piece_id: string; into_id: string }[] };
        db.exec("DELETE FROM profile_merge_source");
        for (const row of snapshot.rows) db.prepare("UPDATE profile_piece SET belongs_to = ?, discarded_at = ?, updated_at = ? WHERE id = ?").run(row.belongs_to!, row.discarded_at!, row.updated_at!, row.id!);
        const originalIds=new Set(snapshot.rows.map(row=>row.id));
        for (const row of rows()) if (!originalIds.has(row.id as string)) db.prepare("DELETE FROM profile_piece WHERE id = ?").run(String(row.id));
        for (const link of snapshot.links) db.prepare("INSERT INTO profile_merge_source (piece_id, into_id) VALUES (?, ?)").run(link.piece_id, link.into_id);
        p.status = "undone"; p.after = p.before;
        db.prepare("UPDATE profile_consolidation SET preview = ? WHERE id = ?").run(JSON.stringify(p), id);
        return p;
      });
    },
  };
}
