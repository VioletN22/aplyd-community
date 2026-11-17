import { expect, it } from 'vitest';
import { computeCockpitStats as compute, defaultReviewPeriod, type StatsInput } from '../cockpit-stats';
const empty = (): StatsInput => ({applications:[],jobSignals:[],leads:[],leadEvents:[],approvals:[]});
const computeCockpitStats = (input: StatsInput, asOf: string) => compute(input,asOf,{start:'2026-10-12',end:'2026-10-26',timeZone:'America/New_York'});
const asOf='2026-10-28T00:00:00Z';
it('keeps zero denominators undefined and all role/segment rows visible', () => {
  const result=computeCockpitStats(empty(),asOf);
  expect(result.review.jobs).toHaveLength(11);
  expect(result.outreach).toHaveLength(4);
  expect(result.review.jobs.every(row=>row.current.rate===null && row.before.rate===null)).toBe(true);
});
it('groups job cohorts by role and deduplicates response history including rejections', () => {
  const input=empty();
  input.applications=[{id:'a',job_title:'React Developer',created_at:'2026-10-12'},{id:'b',job_title:'React Developer',created_at:'2026-10-13'}];
  input.jobSignals=[{application_id:'a',at:'2026-10-14',kind:'rejected'},{application_id:'a',at:'2026-10-15',kind:'interview'},{application_id:'b',at:'2026-10-14',kind:'received'}];
  expect(computeCockpitStats(input,asOf).review.jobs.find(row=>row.key==='frontend')?.current).toEqual({total:2,replies:1,rate:0.5,progressed:1,progressRate:0.5,rejected:0,rejectRate:0});
});
it('splits progress from straight rejections', () => {
  const input=empty();
  input.applications=[{id:'a',job_title:'React Developer',created_at:'2026-10-12'},{id:'b',job_title:'React Developer',created_at:'2026-10-12'},{id:'c',job_title:'React Developer',created_at:'2026-10-12'},{id:'d',job_title:'React Developer',created_at:'2026-10-12'}];
  input.jobSignals=[{application_id:'a',at:'2026-10-14',kind:'rejection'},{application_id:'b',at:'2026-10-14',kind:'phone_screen'},{application_id:'b',at:'2026-10-16',kind:'rejected'},{application_id:'c',at:'2026-10-14',kind:'rejected'}];
  expect(computeCockpitStats(input,asOf).review.jobs.find(row=>row.key==='frontend')?.current).toEqual({total:4,replies:3,rate:0.75,progressed:1,progressRate:0.25,rejected:2,rejectRate:0.5});
});
it('DST case: includes October 12 through 26 in Sydney and excludes October 27 and late replies', () => {
  const input=empty();
  input.applications=[
    {id:'before',job_title:'Software Engineer',created_at:'2026-10-11T12:59:59Z'},
    {id:'first',job_title:'Software Engineer',created_at:'2026-10-11T13:00:00Z'},
    {id:'last',job_title:'Software Engineer',created_at:'2026-10-26T12:59:59Z'},
    {id:'after',job_title:'Software Engineer',created_at:'2026-10-26T13:00:00Z'},
  ];
  input.jobSignals=[{application_id:'before',kind:'rejected',at:'2026-10-12'},{application_id:'first',kind:'assessment',at:'2026-10-26'},{application_id:'last',kind:'offer',at:'2026-10-27'}];
  const row=compute(input,asOf,{start:'2026-10-12',end:'2026-10-26',timeZone:'Australia/Sydney'}).review.jobs.find(row=>row.key==='software')!;
  expect(row.before).toMatchObject({total:1,replies:0,rate:0});
  expect(row.current).toMatchObject({total:2,replies:1,rate:0.5,progressed:1});
});
it('counts sent/reply/call/won leads once and draft records separately', () => {
  const input=empty();
  input.leads=[{id:'l',segment:'group_a'}];
  input.leadEvents=[
    {lead_id:'l',kind:'email_sent',at:'2026-10-12'}, {lead_id:'l',kind:'email_sent',at:'2026-10-14'},
    {lead_id:'l',kind:'reply',at:'2026-10-15'}, {lead_id:'l',kind:'stage',detail:'contacted → replied',at:'2026-10-15'},
    {lead_id:'l',kind:'call',at:'2026-10-16'}, {lead_id:'l',kind:'stage',detail:'call → won',at:'2026-10-17'},
  ];
  input.approvals=[{id:'d1',lead_id:'l',created_at:'2026-10-11',status:'approved'},{id:'d2',lead_id:'l',created_at:'2026-10-12',status:'sent',sent_at:'2026-10-12',send_evidence:'message-id'}];
  expect(computeCockpitStats(input,asOf).outreach[0]).toEqual({key:'group_a',label:'Group A',drafted:2,sent:1,replies:1,calls:1,won:1,rate:1});
  expect(computeCockpitStats(input,asOf).review.outreach[0].current).toEqual({total:1,replies:1,rate:1});
});
it('uses first send cohort despite followups and requires evidence on sent approvals', () => {
  const input=empty();input.leads=[{id:'old',segment:'group_b'},{id:'new',segment:'group_b'}];
  input.leadEvents=[{lead_id:'old',kind:'email_sent',at:'2026-10-01'},{lead_id:'old',kind:'email_sent',at:'2026-10-13'},{lead_id:'old',kind:'reply',at:'2026-10-14'}];
  input.approvals=[{id:'d',lead_id:'new',created_at:'2026-10-12',status:'sent',sent_at:'2026-10-12',send_evidence:null}];
  const result=computeCockpitStats(input,asOf);
  expect(result.review.outreach[1].before).toEqual({total:1,replies:0,rate:0});
  expect(result.review.outreach[1].current.total).toBe(0);
  expect(result.outreach[1].sent).toBe(1);
});
it('caps an in-progress review at now and rejects future or pre-application responses', () => {
  const input=empty();input.applications=[{id:'a',job_title:'Network engineer',created_at:'2026-10-12'}];
  input.jobSignals=[{application_id:'a',kind:'interview',at:'2026-10-13'},{application_id:'a',kind:'assessment',at:'2026-10-11'}];
  const result=computeCockpitStats(input,'2026-10-12T01:00:00Z');
  expect(result.inProgress).toBe(true);
  expect(result.review.jobs.find(row=>row.key==='infra_network')?.current.replies).toBe(0);
});

it('keeps a late imported application in its evidenced applied cohort', () => {
  const input=empty();input.applications=[{id:'imported',job_title:'Service Desk Analyst',created_at:'2026-10-13',applied_at:'2026-10-10'}];
  const result=computeCockpitStats(input,asOf);
  const row=result.review.jobs.find(row=>row.key==='support')!;
  expect(row.before.total).toBe(1);expect(row.current.total).toBe(0);
  expect(result.fallbackApplications).toBe(0);
});
it('separates the daily-loop target roles instead of hiding them in software or infrastructure', () => {
  const input=empty();input.applications=['IT Support Engineer','QA Automation Engineer','Business Analyst','E-commerce Coordinator','AI Engineer'].map((job_title,index)=>({id:String(index),job_title,created_at:'2026-10-12'}));
  const rows=computeCockpitStats(input,asOf).review.jobs;
  for(const key of ['support','qa','data_ba','ecommerce','ai_ml'])expect(rows.find(row=>row.key===key)?.current.total).toBe(1);
});
it('counts warm-introduction activity without inventing an outbound response denominator', () => {
  const input=empty();input.leads=[{id:'call',segment:'group_a'},{id:'won',segment:'group_a'}];
  input.leadEvents=[{lead_id:'call',kind:'stage',detail:'prospect → call',at:'2026-10-13'}, {lead_id:'call',kind:'call',at:'2026-10-14'}, {lead_id:'won',kind:'stage',detail:'prospect → won',at:'2026-10-15'}];
  const result=computeCockpitStats(input,asOf);
  expect(result.outreach[0]).toMatchObject({sent:0,replies:2,calls:1,won:1,rate:null});
  expect(result.review.outreach[0].current).toEqual({total:0,replies:0,rate:null});
});
it('recognizes application/product support and quality engineering target titles', () => {
  const input=empty();input.applications=['Application Support Officer','Product Support Specialist','Quality Engineer'].map((job_title,index)=>({id:String(index),job_title,created_at:'2026-10-12'}));
  const rows=computeCockpitStats(input,asOf).review.jobs;
  expect(rows.find(row=>row.key==='support')?.current.total).toBe(2);
  expect(rows.find(row=>row.key==='qa')?.current.total).toBe(1);
});

it('defaults to the latest fourteen civil days rather than a fixed historical range', () => {
  expect(defaultReviewPeriod('2027-06-03T04:00:00Z','UTC')).toEqual({start:'2027-05-21',end:'2027-06-03',timeZone:'UTC'});
  const result = compute(empty(),'2027-06-03T04:00:00Z');
  expect(result.period.end).toBe(result.asOf);
});
it('rejects backwards and invalid date ranges', () => {
  for(const period of [{start:'2027-06-04',end:'2027-06-01'},{start:'2027-02-31',end:'2027-06-01'}]) expect(()=>compute(empty(),asOf,period)).toThrow();
});
