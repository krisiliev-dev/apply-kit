import { useEffect, useRef, useState } from "react";
import type { CareerPeriod, CareerTimeline as Timeline, ConsolidationPreview, DraftFilter, ProfilePiece } from "@apply-kit/core";
import { entryLabel } from "@apply-kit/core/profile";
import { confirmDrafts, fetchCareerTimeline, fetchProfileConsolidation, reconcileCareer, resetCareerSeparations, separateCareer, undoProfileConsolidation } from "../api.ts";
import { DraftCard } from "./DraftReviewCard.tsx";
import { message } from "./common.tsx";

const matches = (p: ProfilePiece, show: DraftFilter | "all") => show === "all" || (show === "confirmed" ? p.status === "confirmed" : show === "flagged" ? p.status === "flagged" || !!p.dispute || p.checkThis : p.status !== "confirmed");
const date = (s:string) => s.length===7 ? new Date(`${s}-01T12:00:00Z`).toLocaleDateString("en-GB",{month:"short",year:"numeric",timeZone:"UTC"}) : s;
const range = (p: CareerPeriod) => `${date(p.start)} – ${p.end?date(p.end):"present"}`;

export function CareerTimeline({onChanged,version=0,show="all"}: {onChanged:(said:string)=>void;version?:number;show?:DraftFilter | "all"}) {
  const [review,setReview]=useState<Timeline|null>(null);
  const [reload,setReload]=useState(0);
  const [selected,setSelected]=useState<string[]>([]);
  const [compare,setCompare]=useState<string[]|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [last,setLast]=useState<ConsolidationPreview|null>(null);
  const compareRef=useRef<HTMLHeadingElement>(null);
  useEffect(()=> {
    const ctrl=new AbortController();
    fetchCareerTimeline(ctrl.signal).then(r=>{setReview(r);setError("");}).catch(e=>{if(!ctrl.signal.aborted)setError(message(e));});
    fetchProfileConsolidation().then(p=>{if(!ctrl.signal.aborted)setLast(p);}).catch(()=>{});
    return ()=>ctrl.abort();
  },[version,reload]);
  useEffect(()=>{if(compare)compareRef.current?.focus();},[compare]);
  const changed=(said:string)=>{setCompare(null);setSelected([]);setReload(n=>n+1);onChanged(said);};
  const run=async(act:()=>Promise<void>)=>{setBusy(true);setError("");try{await act();}catch(e){setError(message(e));}finally{setBusy(false);}};
  if(!review) return <section className="panel"><h2>Career timeline</h2>{error?<p role="alert">{error}</p>:<p role="status">Arranging your career periods…</p>}</section>;
  const allHeads=review.periods.flatMap(p=>p.heads);
  const compared=allHeads.filter(p=>compare?.includes(p.id));
  const visible=review.periods.filter(p=>[...p.heads,...p.facts].some(piece=>matches(piece,show)));
  const toggle=(id:string,checked:boolean)=>setSelected(old=>checked?[...old,id]:old.filter(key=>key!==id));
  return <section className="career-review stack" aria-labelledby="career-h">
    <div className="sec-head"><div className="grow"><h2 id="career-h">Career timeline</h2><p className="muted">{review.periods.length} career periods · {review.periods.filter(p=>p.heads.length>1).length} possible overlaps. Resolve the periods first, then review their facts together.</p></div></div>
    <p className="meta">Grouped locally by employer wording and overlapping dates. Suggestions can include separate jobs, promotions or study stages. Nothing is merged automatically.</p>
    {error&&<div className="banner error" role="alert">{error} <button className="btn sm" disabled={busy} onClick={()=>setReload(n=>n+1)}>Reload timeline</button></div>}
    <div className="row career-tools"><span className="grow meta">Select entries to compare employers or periods the suggestions missed.</span><button className="btn" disabled={busy||selected.length<2} onClick={()=>setCompare(selected)}>Compare selected ({selected.length})</button>{selected.length>0&&<button className="btn ghost" onClick={()=>setSelected([])}>Clear selection</button>}</div>
    {selected.length===1&&<p className="meta">Select one more entry to compare.</p>}
    {last?.status==="applied"&&<div className="row"><span className="grow meta">The latest merge retained its original versions. Undo is available until a profile change or another analysis.</span><button className="btn" disabled={busy} onClick={()=>void run(async()=>{await undoProfileConsolidation(last.id);changed("Latest merge undone. Original periods restored.");})}>Undo latest merge</button></div>}
    {compare&&compared.length>=2&&<div className="panel career-comparison"><h3 tabIndex={-1} ref={compareRef}>Compare career periods</h3><PeriodComparison key={`${compare.join("|")}:${review.fingerprint}`} heads={compared} fingerprint={review.fingerprint} busy={busy} run={run} changed={changed} cancel={()=>setCompare(null)}/></div>}
    <div className="career-lanes">
      {(["work","education"] as const).map(lane=><section key={lane} aria-label={lane==="work"?"Work timeline":"Education timeline"}><h3>{lane==="work"?"Work":"Education"}</h3><ol className="career-rail">{visible.filter(p=>p.lane===lane).map(period=><li key={period.id}>
        <p className="career-date">{range(period)}</p>
        <details className="career-period">
          <summary><span><b>{period.heads[0]!.entry!.organisation}</b><span className="career-title">{period.heads[0]!.entry!.title}</span></span><span className={`chip ${period.heads.length>1?"partly":"neutral"}`}>{period.heads.length>1?`${period.heads.length} versions to compare`:`${[...period.heads,...period.facts].filter(p=>p.status!=="confirmed").length} to check`}</span></summary>
          <div className="stack career-body">
            {period.heads.length>1&&<div className="row"><p className="grow meta">These may describe the same period. Compare their differences before confirming facts.</p><button className="btn" disabled={busy} onClick={()=>setCompare(period.heads.map(p=>p.id))}>Compare these {period.heads.length} versions</button></div>}
            {period.heads.map(head=><label className="row" key={head.id}><input type="checkbox" checked={selected.includes(head.id)} disabled={busy} onChange={e=>toggle(head.id,e.target.checked)}/><span>Select for comparison: {entryLabel(head.entry!)}<span className="meta">{head.kind==="education"?"Education":"Work"} · {head.source.from}</span></span></label>)}
            {period.heads.length===1&&<button className="btn sm career-confirm" disabled={busy} onClick={()=>void run(async()=>{const r=await confirmDrafts(period.heads[0]!.id);changed(`${r.confirmed} pieces confirmed. ${r.flagged} flagged pieces stay for review.${r.refused.length?` ${r.refused.length} pieces need more details.`:""}`);})}>Confirm unflagged facts in this period</button>}
            {period.originals.length>0&&<details><summary>Original imported versions ({period.originals.length})</summary>{period.originals.map(p=><div className="stack" key={p.id}><p><b>{p.entry?entryLabel(p.entry):p.text}</b></p>{p.entry&&p.text&&<p>{p.text}</p>}{p.bulgarian&&<p>Verified Bulgarian wording: {p.bulgarian}</p>}<p className="meta">{p.source.from}</p>{p.source.quote&&<blockquote>{p.source.quote}</blockquote>}{p.alsoFrom.map((s,i)=><p key={i} className="meta">{s.from}{s.quote?` — ${s.quote}`:""}</p>)}</div>)}</details>}
            <PeriodFacts pieces={[...period.heads,...period.facts]} show={show} changed={changed}/>
          </div>
        </details>
      </li>)}</ol>{!visible.some(p=>p.lane===lane)&&<p className="meta">No {lane==="work"?"work":"education"} periods in this view.</p>}</section>)}
    </div>
    {review.unattached.some(p=>matches(p,show))&&<details className="panel"><summary>Skills and facts not tied to a period ({review.unattached.filter(p=>matches(p,show)).length})</summary><PeriodFacts pieces={review.unattached} show={show} changed={changed}/></details>}
    {review.separatedPairs>0&&<p className="meta">Your keep-separate decisions are saved. <button className="btn ghost sm" disabled={busy} onClick={()=>void run(async()=>{await resetCareerSeparations(review.fingerprint);changed("Keep-separate decisions cleared. Suggestions rebuilt.");})}>Reset keep-separate decisions</button></p>}
  </section>;
}

function PeriodFacts({pieces,show,changed}:{pieces:ProfilePiece[];show:DraftFilter|"all";changed:(said:string)=>void}) {
  const [limit,setLimit]=useState(5);
  const visible=pieces.filter(p=>matches(p,show));
  return <div className="stack"><div className="pieces">{visible.slice(0,limit).map(p=><DraftCard key={`${p.id}:${p.updatedAt}`} piece={p} show={show==="all"?"to-check":show} onConfirmed={()=>{}} onUndone={()=>{}} changed={changed}/>)}</div>{visible.length>limit&&<button className="btn ghost sm" onClick={()=>setLimit(n=>n+5)}>Show {Math.min(5,visible.length-limit)} more facts</button>}</div>;
}

type Field="kind"|"title"|"organisation"|"city"|"start"|"end";
const fields: {key:Field;label:string}[]=[{key:"kind",label:"Work or education"},{key:"title",label:"Title or degree"},{key:"organisation",label:"Employer or school"},{key:"city",label:"City"},{key:"start",label:"Start month"},{key:"end",label:"End month"}];
const fieldValue=(p:ProfilePiece,key:Field)=>key==="kind"?p.kind:key==="city"?(p.entry!.city??"__none__"):key==="end"?(p.entry!.end??"__current__"):p.entry![key];
const pretty=(s:string)=>/^\d{4}-\d{2}$/.test(s)?date(s):s==="__none__"?"No city":s==="__current__"?"Current":s==="role"?"Work":s==="education"?"Education":s;
function PeriodComparison({heads,fingerprint,busy,run,changed,cancel}:{heads:ProfilePiece[];fingerprint:string;busy:boolean;run:(act:()=>Promise<void>)=>Promise<void>;changed:(said:string)=>void;cancel:()=>void}) {
  const [ids,setIds]=useState(heads.map(p=>p.id));
  const [resolving,setResolving]=useState(false);
  const selected=heads.filter(p=>ids.includes(p.id));
  const choices=(key:Field)=>[...new Set(selected.map(p=>fieldValue(p,key)))];
  const [values,setValues]=useState<Record<Field,string>>({kind:"",title:"",organisation:"",city:"",start:"",end:""});
  const [custom,setCustom]=useState<Field[]>([]);
  const openResolve=()=>{setValues(Object.fromEntries(fields.map(({key})=>[key,choices(key).length===1?choices(key)[0]:""])) as Record<Field,string>);setCustom([]);setResolving(true);};
  const submit=()=>void run(async()=>{
    if(fields.some(({key})=>!values[key].trim())) throw new Error("Choose every field. Conflicting details are never selected for you.");
    if(values.kind!=="role"&&values.kind!=="education") throw new Error("Choose work or education.");
    await reconcileCareer(ids,{kind:values.kind,entry:{title:values.title,organisation:values.organisation,city:values.city==="__none__"?null:values.city,start:values.start,end:values.end==="__current__"?null:values.end}},fingerprint);
    changed("Career periods combined. Original versions and sources retained; all attached facts kept together. The new period waits for confirmation.");
  });
  return <div className="stack">
    <p className="muted">Select only the entries that describe the same period. Different stages, promotions and genuinely separate jobs can stay separate.</p>
    <div className="career-table-wrap" role="region" aria-label="Original career versions" tabIndex={0}><table className="career-table"><thead><tr><th scope="col">Detail</th>{heads.map((p,i)=><th scope="col" key={p.id}><label><input type="checkbox" checked={ids.includes(p.id)} disabled={busy} onChange={e=>{setIds(old=>e.target.checked?[...old,p.id]:old.filter(id=>id!==p.id));setResolving(false);}}/> Version {i+1}</label><p className="meta">{p.source.from} · {p.status}</p></th>)}</tr></thead><tbody>{fields.map(({key,label})=><tr key={key}><th scope="row">{label}{choices(key).length>1&&<span className="career-difference">Differs</span>}</th>{heads.map(p=><td className={choices(key).length>1?"career-conflict":""} key={p.id}>{pretty(fieldValue(p,key))}</td>)}</tr>)}<tr><th scope="row">Description and evidence</th>{heads.map(p=><td key={p.id}>{p.text&&<p>{p.text}</p>}{p.source.quote&&<blockquote>{p.source.quote}</blockquote>}{p.alsoFrom.map((s,i)=><p key={i} className="meta">{s.from}{s.quote?` — ${s.quote}`:""}</p>)}{p.dispute&&<p className="err-line">This entry has a source dispute. Resolve it in its review card first.</p>}</td>)}</tr></tbody></table></div>
    <div className="row"><button className="btn" disabled={busy||ids.length<2} onClick={openResolve}>Same period — resolve details</button><button className="btn" disabled={busy||ids.length<2} onClick={()=>void run(async()=>{await separateCareer(ids,fingerprint);changed("Selected periods kept separate. This decision is saved.");})}>Keep selected separate</button><button className="btn ghost" disabled={busy} onClick={cancel}>Close comparison</button></div>
    {ids.length<2&&<p className="meta">Select at least two versions to combine or keep separate.</p>}
    {resolving&&<form className="stack" onSubmit={e=>{e.preventDefault();submit();}}><h4>Resolve the shared period</h4><p className="meta">Choose the true details once. All descriptions, attached achievements and source versions will be retained. Identical unflagged facts are combined; differing claims stay separate. The resulting period needs confirmation. Verified Bulgarian titles stay with the originals and can be verified again for the combined title.</p><div className="career-fields">{fields.map(({key,label})=><label className="field" key={key}><span>{label}</span>{custom.includes(key)?<input className="input" required type={key==="start"||key==="end"?"month":"text"} value={values[key]} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>:<select className="input" required value={values[key]} onChange={e=>{if(e.target.value==="__custom__"){setCustom(old=>[...old,key]);setValues(v=>({...v,[key]:""}));}else setValues(v=>({...v,[key]:e.target.value}));}}><option value="">Choose the correct value…</option>{(key==="kind"?["role","education"]:[...new Set([...choices(key),...(key==="city"?["__none__"]:key==="end"?["__current__"]:[])])]).map(value=><option key={value} value={value}>{pretty(value)}</option>)}{key!=="kind"&&<option value="__custom__">Enter another value…</option>}</select>}</label>)}</div><div className="row"><button className="btn primary" disabled={busy} type="submit">Combine selected periods</button><button className="btn ghost" disabled={busy} type="button" onClick={()=>setResolving(false)}>Cancel</button></div><p className="meta">Undo is available until a profile edit, import, another merge or analysis.</p></form>}
  </div>;
}
