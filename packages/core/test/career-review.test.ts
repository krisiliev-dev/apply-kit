import { describe, expect, it } from "vitest";
import { createTestPreparation, fakeWriter } from "./preparation-harness.ts";

function stand() {
  const t = createTestPreparation();
  const role = (organisation: string, start: string, end: string, kind: "role" | "education" = "role", title = "Analyst", text = "") => {
    const r = t.preparation.savePiece({ kind, text, entry: { title, organisation, city: null, start, end } }, { from: `${organisation}.pdf`, quote: text || title, status: "unconfirmed" });
    if (!r.saved) throw new Error("Fixture rejected");
    return r.piece;
  };
  return { ...t, role };
}

describe("career period review", () => {
  it("suggests overlapping employer aliases and education stages without merging pieces", () => {
    const t = stand();
    t.role("Kestrel plc", "2021-06", "2021-11");
    t.role("KESTREL PC WORLD (KESTREL)", "2021-06", "2021-12", "role", "Sales advisor");
    t.role("River Works (part of Northwind)", "2022-09", "2023-09");
    t.role("Northwind", "2022-09", "2023-09");
    t.role("Danube University", "2020-09", "2024-12", "education", "BSc Computer Science");
    t.role("Danube University", "2024-09", "2024-12", "role", "Graduate student");
    t.role("Kestrel", "2018-01", "2019-01");
    t.role("Unrelated University", "2020-09", "2024-12", "education");
    const review = t.preparation.careerTimeline();
    expect(review.periods.map(p => p.heads.length).sort()).toEqual([1, 1, 2, 2, 2]);
    expect(t.preparation.listPieces().total).toBe(8);
  });

  it("remembers keep-separate decisions and prevents transitive regrouping", () => {
    const t = stand();
    const a = t.role("Kestrel", "2021-01", "2021-12"), b = t.role("Kestrel", "2021-01", "2021-12"), c = t.role("Kestrel", "2021-01", "2021-12");
    t.preparation.separateCareerPeriods([a.id, b.id], t.preparation.careerTimeline().fingerprint);
    const periods = t.preparation.careerTimeline().periods;
    expect(periods.some(p => p.heads.some(h => h.id === a.id) && p.heads.some(h => h.id === b.id))).toBe(false);
    expect(periods.flatMap(p => p.heads).map(h => h.id).sort()).toEqual([a.id,b.id,c.id].sort());
  });

  it("resolves selected roles into a new period, preserves descriptions, children and sources, and undoes exactly", () => {
    const t = stand();
    const a = t.role("Kestrel plc", "2021-06", "2021-11", "role", "Sales representative", "Advised customers");
    const b = t.role("Kestrel PC World", "2021-06", "2021-12", "role", "Sales advisor", "Managed stock");
    const fact = t.preparation.savePiece({ kind: "skill", text: "Customer service", belongsTo: a.id }, { from:"CV.pdf",quote:"Customer service",status:"unconfirmed" });
    if (!fact.saved) throw new Error("Fixture rejected");
    const before = t.preparation.listPieces();
    const result = t.preparation.reconcileCareerPeriods([a.id,b.id], { kind:"role", entry:{ ...b.entry!, organisation:"Kestrel", city:"Sofia" } }, t.preparation.careerTimeline().fingerprint);
    const list = t.preparation.listPieces().groups.flatMap(g=>g.pieces);
    expect(list).toHaveLength(2);
    const canonical = list.find(p=>p.entry)!;
    expect(canonical).toMatchObject({ status:"unconfirmed", entry:{organisation:"Kestrel",end:"2021-12"}, text:"Advised customers\n\nManaged stock" });
    expect(t.preparation.careerTimeline().periods[0]!.originals.map(p=>p.entry!.title).sort()).toEqual(["Sales advisor","Sales representative"]);
    expect(canonical.alsoFrom.map(s=>s.from)).toEqual(expect.arrayContaining(["Kestrel plc.pdf","Kestrel PC World.pdf"]));
    expect(list.find(p=>p.id===fact.piece.id)?.belongsTo).toBe(canonical.id);
    t.preparation.undoConsolidation(result.id);
    expect(t.preparation.listPieces()).toEqual(before);
  });

  it("rejects stale, invalid and non-period selections atomically", () => {
    const t = stand(); const a=t.role("Kestrel","2021-01","2021-12"), b=t.role("Kestrel","2021-01","2021-12");
    const stamp=t.preparation.careerTimeline().fingerprint;
    t.preparation.confirmPiece(a.id);
    expect(()=>t.preparation.reconcileCareerPeriods([a.id,b.id], {kind:"role",entry:b.entry!},stamp)).toThrow(/changed/i);
    const fresh=t.preparation.careerTimeline().fingerprint;
    expect(()=>t.preparation.reconcileCareerPeriods([a.id,b.id],{kind:"role",entry:{...b.entry!,end:"2020-01"}},fresh)).toThrow(/end/i);
    expect(()=>t.preparation.reconcileCareerPeriods([a.id,a.id],{kind:"role",entry:b.entry!},fresh)).toThrow();
    expect(t.preparation.listPieces().total).toBe(2);
  });
});

it("keeps saved separation choices out of AI merge proposals", async()=> {
  const ids:string[]=[];
  const t=createTestPreparation({consolidator:{estimateUsd:()=>0,propose:async()=>({groups:[{ids,reason:"Similar employment"}],costUsd:0})}});
  for(let i=0;i<2;i++) {
    const r=t.preparation.savePiece({kind:"role",text:"",entry:{title:"Analyst",organisation:"Kestrel",city:null,start:"2021-01",end:"2021-12"}},{from:"CV.pdf",quote:"Analyst",status:"unconfirmed"});
    if(!r.saved) throw new Error("Fixture rejected"); ids.push(r.piece.id);
  }
  t.preparation.separateCareerPeriods(ids,t.preparation.careerTimeline().fingerprint);
  const p=await t.preparation.previewConsolidation();
  expect(p.after).toBe(2);
  expect(p.groups[0]!.blockedReason).toMatch(/separate/i);
});


it("shows facts whose parent was discarded in the unattached review",()=> {
 const t=stand(); const a=t.role("Kestrel","2021-01","2021-12");
 const saved=t.preparation.savePiece({kind:"skill",text:"Python",belongsTo:a.id},{from:"CV.pdf",quote:"Python",status:"unconfirmed"});
 if(!saved.saved) throw new Error("Fixture rejected");
 t.preparation.discardPiece(a.id);
 expect(t.preparation.careerTimeline().unattached.map(p=>p.id)).toEqual([saved.piece.id]);
});

it("retains separation choices through a manually reconciled alias",()=> {
 const t=stand(); const a=t.role("Kestrel","2021-01","2021-12"), b=t.role("Kestrel","2021-01","2021-12"), c=t.role("Kestrel","2021-01","2021-12");
 t.preparation.separateCareerPeriods([a.id,c.id],t.preparation.careerTimeline().fingerprint);
 t.preparation.reconcileCareerPeriods([a.id,b.id],{kind:"role",entry:a.entry!},t.preparation.careerTimeline().fingerprint);
 expect(t.preparation.careerTimeline().periods).toHaveLength(2);
});

it("recognises a reviewed employer alias on later imports without reopening its resolved conflict",async()=> {
 const entry={title:"Sales advisor",organisation:"Kestrel PC World",city:null,start:"2021-06",end:"2021-11"};
 const t=createTestPreparation({writer:fakeWriter({draftPieces:{pieces:[
  {kind:"role",text:"",entry,role:null,quote:"Sales advisor at Kestrel PC World"},
  {kind:"achievement",text:"Wrote the service playbook",entry:null,role:0,quote:"Wrote the service playbook"},
 ]}})});
 const ids:string[]=[];
 for(const organisation of ["Kestrel PC World","Kestrel"]){const r=t.preparation.savePiece({kind:"role",text:"",entry:{...entry,organisation}},{from:organisation+".pdf",quote:"Sales advisor",status:"unconfirmed"});if(!r.saved)throw new Error("Fixture rejected");ids.push(r.piece.id);}
 t.preparation.reconcileCareerPeriods(ids,{kind:"role",entry:{...entry,organisation:"Kestrel",end:"2021-12"}},t.preparation.careerTimeline().fingerprint);
 const canonical=t.preparation.careerTimeline().periods[0]!.heads[0]!;
 const run=await t.preparation.startImport({files:[{fileName:"later.txt",bytes:new TextEncoder().encode("Sales advisor at Kestrel PC World. Wrote the service playbook")}]});
 if(!run.started)throw new Error("Fixture import rejected");await run.done;
 const pieces=t.preparation.listPieces().groups.flatMap(g=>g.pieces);
 expect(pieces.filter(p=>p.entry)).toHaveLength(1);
 expect(pieces.find(p=>p.id===canonical.id)?.dispute).toBeNull();
 expect(pieces.find(p=>p.kind==="achievement")?.belongsTo).toBe(canonical.id);
});

it("shows identical clean facts once after reconciliation, retaining both sources and undo",()=> {
 const t=stand();const a=t.role("Kestrel","2021-01","2021-12"),b=t.role("Kestrel PC World","2021-01","2021-12");
 for(const parent of [a,b]) t.preparation.savePiece({kind:"achievement",text:"Resolved customer enquiries",belongsTo:parent.id},{from:parent.source.from,quote:"Resolved customer enquiries",status:"unconfirmed"});
 const before=t.preparation.listPieces();
 const result=t.preparation.reconcileCareerPeriods([a.id,b.id],{kind:"role",entry:a.entry!},t.preparation.careerTimeline().fingerprint);
 expect(result).toMatchObject({before:4,after:2});
 const facts=t.preparation.careerTimeline().periods[0]!.facts;
 expect(facts).toHaveLength(1);
 expect(facts[0]!.alsoFrom).toHaveLength(1);
 expect(facts[0]!.status).toBe("unconfirmed");
 t.preparation.undoConsolidation(result.id);
 expect(t.preparation.listPieces()).toEqual(before);
});
