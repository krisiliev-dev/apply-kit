import { describe, expect,it } from "vitest";
import {createTestEngine, fakeExtractor} from "./harness.ts";

describe("reading a listing whose description is supplied separately",()=>{
 it("fetches a Workday job description before extracting requirements and preserves it on the next source check",async()=>{
  let details=0;
  const extractor=fakeExtractor();
  const t=createTestEngine({extractor,fetch:async input=>{
   const url=String(input);
   if(url.endsWith('/jobs'))return Response.json({total:1,jobPostings:[{title:"Junior Security Engineer",externalPath:"/job/Sofia/Junior-Security_JR1",locationsText:"Sofia, Bulgaria"}]});
   if(url.includes('/job/')){details++;return Response.json({jobPostingInfo:{jobDescription:"<p>Protect our cloud platform.</p><p>Experience with Python.</p>"}});}
   throw new Error('Unexpected request '+url);
  }});
  await t.engine.addSource({kind:"workday",config:"https://kestrel.wd1.myworkdayjobs.com/Careers"});await t.engine.checkAll();
  const id=(await t.engine.queryFeed({view:"new"})).jobs[0]!.id;
  const job=await t.engine.readJob(id);
  expect(job.reading.state).toBe("read");expect(job.postingText).toContain("Protect our cloud platform.");
  await t.engine.checkAll();expect((await t.engine.getJob(id))!.reading.state).toBe("read");
  await t.engine.readJob(id);expect(details).toBe(1);
 });
 it("fetches SmartRecruiters description and qualifications from the posting detail API",async()=>{
  const t=createTestEngine({fetch:async input=>{
   const url=String(input);
   if(url.endsWith('/postings/j1'))return Response.json({jobAd:{sections:{jobDescription:{text:"<p>Build secure services.</p>"},qualifications:{text:"<p>Python experience.</p>"},additionalInformation:{text:"<p>Salary EUR 3000 per month.</p>"}}}});
   if(url.includes('/postings?'))return Response.json({totalFound:1,content:[{id:"j1",name:"Junior Engineer",company:{name:"Kestrel"},location:{city:"Sofia",country:"bg"}}]});
   throw new Error('Unexpected request '+url);
  }});
  await t.engine.addSource({kind:"smartrecruiters",config:"Kestrel:bg"});await t.engine.checkAll();
  const id=(await t.engine.queryFeed({view:"new"})).jobs[0]!.id;
  const job=await t.engine.readJob(id);
  expect(job.reading.state).toBe("read");expect(job.postingText).toContain("Python experience.");expect(job.postingText).toContain("Salary EUR 3000");
 });
 it("reports a detail fetch failure without inventing requirements or calling AI",async()=>{
  const extractor=fakeExtractor();
  const t=createTestEngine({extractor,fetch:async input=>String(input).endsWith('/jobs')?Response.json({total:1,jobPostings:[{title:"Junior Engineer",externalPath:"/job/Sofia/Junior_JR1",locationsText:"Sofia"}]}):new Response("",{status:503})});
  await t.engine.addSource({kind:"workday",config:"https://kestrel.wd1.myworkdayjobs.com/Careers"});await t.engine.checkAll();
  const id=(await t.engine.queryFeed({view:"new"})).jobs[0]!.id;
  const job=await t.engine.readJob(id);
  expect(job.reading).toMatchObject({state:"failed",error:expect.stringMatching(/503/)});expect(extractor.calls).toHaveLength(0);
 });
});

it("spends a limited reading budget on relevant local junior roles before senior or unrelated jobs",async()=>{
 const extractor=fakeExtractor();
 const board={jobs:[
  {id:1,title:"Senior Software Engineer",first_published:"2026-10-12T00:00:00Z"},
  {id:2,title:"Junior Software Engineer",first_published:"2026-10-01T00:00:00Z"},
  {id:3,title:"Junior Accountant",first_published:"2026-10-13T00:00:00Z"},
 ].map(j=>({...j,absolute_url:`https://example.test/jobs/${j.id}`,location:{name:"Sofia"},content:"<p>Work with Python.</p>"}))};
 const t=createTestEngine({extractor,aiMonthlyCapUsd:0.0015,fetch:async()=>Response.json(board)});
 await t.engine.addSource({kind:"greenhouse",config:"budget-priority"});await t.engine.checkAll();await t.engine.readPending();
 expect(extractor.calls.map(c=>c.title)).toEqual(["Junior Software Engineer"]);
});

it("lets a user supply missing posting text and immediately read that existing job",async()=>{
 const t=createTestEngine({fetch:async()=>Response.json({total:1,jobPostings:[{title:"Junior Security Engineer",externalPath:"/job/Sofia/Junior_JR1",locationsText:"Sofia"}]})});
 await t.engine.addSource({kind:"workday",config:"https://kestrel.wd1.myworkdayjobs.com/Careers"});await t.engine.checkAll();
 const id=(await t.engine.queryFeed({view:"new"})).jobs[0]!.id;
 const job=await t.engine.pasteJobText(id,"Protect our cloud platform.\nExperience with Python.");
 expect(job.reading.state).toBe("read");expect(job.postingText).toContain("Experience with Python.");
 await expect(t.engine.pasteJobText(id,"  ")).rejects.toThrow();
});

it("does not replace a supplied description with empty markup from a later source listing",async()=>{
 const board={jobs:[{id:1,title:"Junior Engineer",absolute_url:"https://example.test/empty",location:{name:"Sofia"},content:"<p></p>"}]};
 const t=createTestEngine({fetch:async()=>Response.json(board)});
 await t.engine.addSource({kind:"greenhouse",config:"empty"});await t.engine.checkAll();
 const id=(await t.engine.queryFeed({view:"new"})).jobs[0]!.id;
 await t.engine.pasteJobText(id,"Protect cloud services with Python.");await t.engine.checkAll();
 expect((await t.engine.getJob(id))!.postingText).toBe("Protect cloud services with Python.");
 expect((await t.engine.getJob(id))!.reading.state).toBe("read");
});

it("can explicitly refresh a cached source description when the employer changes its requirements",async()=>{
 let description="<p>Python experience.</p>";
 const t=createTestEngine({fetch:async input=>String(input).endsWith('/jobs')?Response.json({total:1,jobPostings:[{title:"Junior Engineer",externalPath:"/job/Sofia/Junior_JR1",locationsText:"Sofia"}]}):Response.json({jobPostingInfo:{jobDescription:description}})});
 await t.engine.addSource({kind:"workday",config:"https://kestrel.wd1.myworkdayjobs.com/Careers"});await t.engine.checkAll();
 const id=(await t.engine.queryFeed({view:"new"})).jobs[0]!.id;
 await t.engine.readJob(id);description="<p>Kubernetes experience.</p>";
 expect((await t.engine.readJob(id,true)).postingText).toContain("Kubernetes experience.");
});

it("does not fetch thousands of detail pages in the background once the AI cap is exhausted",async()=>{
 let details=0;
 const t=createTestEngine({aiMonthlyCapUsd:0,fetch:async input=>{
  if(String(input).endsWith('/jobs'))return Response.json({total:1,jobPostings:[{title:"Junior Engineer",externalPath:"/job/Sofia/Junior_JR1",locationsText:"Sofia"}]});
  details++;return Response.json({jobPostingInfo:{jobDescription:"<p>Python experience.</p>"}});
 }});
 await t.engine.addSource({kind:"workday",config:"https://kestrel.wd1.myworkdayjobs.com/Careers"});await t.engine.checkAll();
 expect((await t.engine.readPending()).unscreened).toBe(1);expect(details).toBe(0);
});
