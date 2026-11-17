import {it,expect} from 'vitest';
import {yesterdayNumbers} from '../cockpit';
it('counts Sydney yesterday applications and distinct real job replies',()=>{
  const apps=[{created_at:'2026-10-11T14:00:00Z'},{created_at:'2026-10-12T13:30:00Z'}];
  const emails=[{application_id:'a',kind:'rejection',status:'applied',sent_at:'2026-10-12T01:00:00Z'},{application_id:'a',kind:'interview',status:'applied',sent_at:'2026-10-12T02:00:00Z'},{application_id:'b',kind:'assessment',status:'pending',sent_at:'2026-10-12T03:00:00Z'}];
  expect(yesterdayNumbers(apps,emails,new Date('2026-10-13T00:00:00Z'))).toEqual({applied:1,jobReplies:1,outreachSent:0,outreachReplies:0});
});
