import type { PieceEntry, ProfilePiece } from "./profile.ts";

export interface CareerPeriod {
  id: string;
  lane: "work" | "education";
  heads: ProfilePiece[];
  originals: ProfilePiece[];
  facts: ProfilePiece[];
  start: string;
  end: string | null;
}
export interface CareerTimeline {
  fingerprint: string;
  periods: CareerPeriod[];
  unattached: ProfilePiece[];
  separatedPairs: number;
}
export interface CareerResolution { kind: "role" | "education"; entry: PieceEntry }

const employerWords = (s: string) => s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu)?.filter(w => w.length > 2 && !new Set(["the","and","part","of","plc","ltd","limited","inc","llc","group","university","college","school","world"]).has(w)) ?? [];
const endOf = (s: string | null) => !s ? "9999-12" : s.length === 4 ? `${s}-12` : s;
const startOf = (s: string) => s.length === 4 ? `${s}-01` : s;
export const periodPair = (a: string, b: string) => JSON.stringify([a,b].sort());

/** Broad comparison suggestions only: overlapping periods do not establish equivalence. */
export function arrangeCareer(pieces: ProfilePiece[], separated: Set<string>, fingerprint: string): CareerTimeline {
  const heads = pieces.filter(p => p.entry);
  const activeHeads=new Set(heads.map(p=>p.id));
  const clusters = heads.map(p => [p]);
  for (let a=0; a<clusters.length; a++) for (let b=a+1; b<clusters.length; b++) {
    const left=clusters[a]!, right=clusters[b]!;
    if (left.some(x=>right.some(y=>separated.has(periodPair(x.id,y.id))))) continue;
    const similar=left.some(x=>right.some(y=> {
      const e=x.entry!, f=y.entry!;
      if (!e.start || !f.start || startOf(e.start)>endOf(f.end) || startOf(f.start)>endOf(e.end)) return false;
      const words=employerWords(e.organisation), other=employerWords(f.organisation);
      return words.some(w=>other.includes(w));
    }));
    if (similar) { left.push(...right); clusters.splice(b,1); b--; }
  }
  const periods=clusters.map((h): CareerPeriod => {
    h.sort((a,b)=>Number(b.kind==="education")-Number(a.kind==="education") || b.entry!.start.localeCompare(a.entry!.start) || a.id.localeCompare(b.id));
    const ids=new Set(h.map(p=>p.id));
    return {id:h.map(p=>p.id).sort().join("|"), lane:h.some(p=>p.kind==="education")?"education":"work",heads:h,originals:[],facts:pieces.filter(p=>!!p.belongsTo && ids.has(p.belongsTo)),start:h.map(p=>p.entry!.start).sort()[0]!,end:h.some(p=>!p.entry!.end)?null:h.map(p=>p.entry!.end!).sort().at(-1)!};
  }).sort((a,b)=>b.start.localeCompare(a.start));
  return {fingerprint,periods,unattached:pieces.filter(p=>!p.entry && (!p.belongsTo || !activeHeads.has(p.belongsTo))),separatedPairs:separated.size};
}
