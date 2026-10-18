import type { FeedJob } from "../engine.ts";

export const seniorTitle = (title:string) => /\b(senior|sr\.?|lead|staff|principal|head|director|vp)\b|старши|ръководител/iu.test(title);
const shortExperience = (job:FeedJob) => job.requirements.some(r=>r.kind==="required" && (r.status==="gap"||r.status==="partly") && /\d.*\b(years?|yrs?)\b/i.test(r.text));
const coverage = (job:FeedJob) => job.reading==="read" ? job.fit.reasons.find(r=>r.factor==="requirements")?.score??null : null;

/** Known requirement coverage leads; unread titles cannot masquerade as proven profile matches. */
export function compareJobFit(a:FeedJob,b:FeedJob,preferJunior=true):number {
  const stretch=(j:FeedJob)=>shortExperience(j)||(preferJunior&&seniorTitle(`${j.title} ${j.titleTranslation??""}`));
  const level=Number(stretch(a))-Number(stretch(b));
  if(level)return level;
  const ac=coverage(a),bc=coverage(b);
  if(ac!==null && bc!==null && ac!==bc)return bc-ac;
  if((ac===null)!==(bc===null))return ac===null?1:-1;
  return b.fit.value-a.fit.value;
}
