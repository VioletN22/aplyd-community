import type { AIConfigure, AIStatus } from '../shared/ai-types';
import type {CockpitStats, ReviewPeriod} from '../shared/cockpit-stats';
import type {CalendarStatus} from '../shared/google-calendar';
import type {CalendarEvent, CalendarPreferences} from '../shared/calendar';
import type {Lead, LeadDetail} from '../shared/leads';
import type {ImportResult} from './leads';
import type {Approval, ApprovalDecision, ReviewedApproval} from '../shared/approvals';
import type {CockpitData} from '../shared/cockpit';
import { contextBridge, ipcRenderer } from 'electron';
import { JobApplication, Workflow, StageHistory, AnswerBankEntry, LockerDocument, VoiceNote, VoiceNoteKind, PortfolioLink, CoverLetter, BatchAddProgress, FlowData, AssistantHistoryMessage, AssistantReply, EmailAccount, EmailEvent, EmailEventStatus, EmailSyncStatus, PrepStatus, OutcomeStats, TodayData, QuickAddAdded, QuickAddShortcut } from '../shared/types';

/** The one IPC contract: every channel answers this, nothing throws at a page. */
type Ipc<T = void> = Promise<{ ok: boolean; data?: T; error?: string }>;

/** What a chosen job-listing file came back as, when one was chosen at all. */
interface PickedFile { filePath: string; content: string; note?: string }

// The display locale the main process settled on (see shared/locale.ts). Read
// once, synchronously, so the very first render already formats with it.
let locale = '';
try { locale = String(ipcRenderer.sendSync('locale:get') || ''); } catch { /* system default */ }

// Define the API object
const electronAPI = {
  locale,
  skills: {
    status: () => ipcRenderer.invoke('skills:status'),
    preview: (target: 'codex' | 'claude' | 'both' | 'auto', update = false) => ipcRenderer.invoke('skills:preview', target, update),
    install: (target: 'codex' | 'claude' | 'both' | 'auto', update = false) => ipcRenderer.invoke('skills:install', target, update),
  },
  ai: {
    status: (): Ipc<AIStatus> => ipcRenderer.invoke('ai:status'),
    configure: (input: AIConfigure): Ipc<AIStatus> => ipcRenderer.invoke('ai:configure', input),
    test: (): Ipc<AIStatus> => ipcRenderer.invoke('ai:test'),
    cancelAll: (): Ipc => ipcRenderer.invoke('ai:cancelAll'),
  },
  system: { getInfo: (): Ipc<{ dataDirectory: string }> => ipcRenderer.invoke('system:getInfo') },
  calendar: {
    preferences: (): Ipc<CalendarPreferences> => ipcRenderer.invoke('calendar:preferences'),
    savePreferences: (input: CalendarPreferences): Ipc<CalendarPreferences> => ipcRenderer.invoke('calendar:savePreferences', input),
    status: (): Ipc<CalendarStatus> => ipcRenderer.invoke('calendar:status'),
    connect: (clientId: string, clientSecret: string): Ipc<CalendarStatus> => ipcRenderer.invoke('calendar:connect', {clientId,clientSecret}),
    disconnect: (): Ipc => ipcRenderer.invoke('calendar:disconnect'),
    sync: (): Ipc => ipcRenderer.invoke('calendar:sync'),
    week: (startDay: string): Ipc<CalendarEvent[]> => ipcRenderer.invoke('calendar:week', startDay),
    onChanged: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('calendar:changed',handler);
      return () => ipcRenderer.removeListener('calendar:changed',handler);
    },
  },
  leads: {
    list: (): Ipc<Lead[]> => ipcRenderer.invoke('leads:list'),
    get: (id: string): Ipc<LeadDetail | null> => ipcRenderer.invoke('leads:get', id),
    save: (lead: Partial<Lead> & Pick<Lead, 'org' | 'segment' | 'stage'>, expectedUpdatedAt?: string): Ipc<Lead> => ipcRenderer.invoke('leads:save', lead, expectedUpdatedAt),
    importTracker: (): Ipc<ImportResult> => ipcRenderer.invoke('leads:importTracker'),
  },
  approvals: {
    list: (filter?: { applicationId?: string; leadId?: string }): Ipc<Approval[]> => ipcRenderer.invoke('approvals:list', filter),
    decide: (id: string, decision: ApprovalDecision): Ipc<Approval> => ipcRenderer.invoke('approvals:decide', id, decision),
    approveAll: (reviewed: ReviewedApproval[]): Ipc<number> => ipcRenderer.invoke('approvals:approveAll', reviewed),
  },
  cockpit: {
    get: (): Ipc<CockpitData> => ipcRenderer.invoke('cockpit:get'),
    onChanged: (cb: () => void): (() => void) => {
      const h = () => cb();
      ipcRenderer.on('db:changed',h);
      return () => ipcRenderer.removeListener('db:changed',h);
    },
  },
  // Database operations
  db: {
    getAllApplications: (filters?: any): Ipc<JobApplication[]> => ipcRenderer.invoke('db:getAllApplications', filters),
    getApplication: (id: string): Ipc<JobApplication | null> => ipcRenderer.invoke('db:getApplication', id),
    updateApplication: (id: string, updates: Partial<JobApplication>): Ipc<JobApplication> =>
      ipcRenderer.invoke('db:updateApplication', id, updates),
    deleteApplication: (id: string): Ipc => ipcRenderer.invoke('db:deleteApplication', id),
    getStageHistory: (applicationId: string): Ipc<StageHistory[]> =>
      ipcRenderer.invoke('db:getStageHistory', applicationId),
    createStageHistory: (applicationId: string, stage: string, notes?: string): Ipc<StageHistory> =>
      ipcRenderer.invoke('db:createStageHistory', applicationId, stage, notes),
    updateStageHistory: (id: string, updates: Partial<StageHistory>): Ipc<StageHistory> =>
      ipcRenderer.invoke('db:updateStageHistory', id, updates),
    // Workflow shims: stages are the fixed STAGES list now. getAllWorkflows
    // answers one synthetic workflow carrying STAGES; the writes refuse.
    // Delete once the renderer stops calling them.
    getAllWorkflows: (): Ipc<Workflow[]> => ipcRenderer.invoke('db:getAllWorkflows'),
    createWorkflow: (company: string, name: string, stages: string[], isDefault: boolean): Ipc<Workflow> =>
      ipcRenderer.invoke('db:createWorkflow', company, name, stages, isDefault),
    updateWorkflow: (id: string, updates: Partial<Workflow>): Ipc<Workflow> =>
      ipcRenderer.invoke('db:updateWorkflow', id, updates),
    deleteWorkflow: (id: string): Ipc => ipcRenderer.invoke('db:deleteWorkflow', id),
  },

  // Per-application fields outside the generic update.
  applications: {
    // Which locker resume was sent. null clears it. A manual pick is never
    // overwritten by letter hydration.
    setResume: (applicationId: string, docId: string | null): Ipc<JobApplication> =>
      ipcRenderer.invoke('applications:setResume', applicationId, docId),
  },

  // Background prep: fit score + a working letter draft on add, and an
  // interview prep sheet (into prep_notes) on entering phone_screen/interview.
  prep: {
    files: (applicationId: string): Ipc<{ path: string; name: string; kind: string; modifiedAt: string; linked: boolean }[]> => ipcRenderer.invoke('prep:files', applicationId),
    openFile: (applicationId: string, filePath: string): Ipc => ipcRenderer.invoke('prep:openFile', applicationId, filePath),
    onProgress: (cb: (s: PrepStatus) => void): (() => void) => {
      const h = (_e: unknown, s: PrepStatus) => cb(s);
      ipcRenderer.on('prep:progress', h);
      return () => ipcRenderer.removeListener('prep:progress', h);
    },
    // Forces a rebuild of prep_notes; resolves when the sheet is written.
    regenerateInterviewPrep: (applicationId: string): Ipc<JobApplication> =>
      ipcRenderer.invoke('prep:regenerateInterviewPrep', applicationId),
  },

  // "What's working": reply rate by source, resume and role family.
  stats: {
    cockpit: (period?: ReviewPeriod): Ipc<CockpitStats> => ipcRenderer.invoke('stats:cockpit', period),
    outcomes: (): Ipc<OutcomeStats> => ipcRenderer.invoke('stats:outcomes'),
  },

  // The landing page's lists.
  today: {
    get: (): Ipc<TodayData> => ipcRenderer.invoke('today:get'),
    markActionItemDone: (id: string): Ipc => ipcRenderer.invoke('today:markActionItemDone', id),
    dismissActionItem: (id: string): Ipc => ipcRenderer.invoke('today:dismissActionItem', id),
  },

  // Quick add: capture a posting from anywhere with a global shortcut. The
  // handlers live in quick-add.ts (merged separately).
  quickAdd: {
    onAdded: (cb: (p: QuickAddAdded) => void): (() => void) => {
      const h = (_e: unknown, p: QuickAddAdded) => cb(p);
      ipcRenderer.on('quickadd:added', h);
      return () => ipcRenderer.removeListener('quickadd:added', h);
    },
    getShortcut: (): Ipc<QuickAddShortcut> => ipcRenderer.invoke('quickadd:getShortcut'),
    setShortcut: (accel: string): Ipc<QuickAddShortcut> => ipcRenderer.invoke('quickadd:setShortcut', accel),
  },

  // File operations
  file: {
    // data is null when the picker was dismissed.
    selectFile: (): Ipc<PickedFile | null> => ipcRenderer.invoke('file:selectFile'),
  },

  // Claude operations
  claude: {
    ingestJobListing: (jobListingText: string, company: string, jobSource?: string | null) =>
      ipcRenderer.invoke('claude:ingestJobListing', jobListingText, company, jobSource ?? null),
    checkAuth: () => ipcRenderer.invoke('claude:checkAuth'),
  },

  // The add flow: one box that takes a posting, a link, or a burst of links.
  // Everything answers { ok, data?, error? }, and a failure never leaves a stub
  // row behind, so the modal can show the reason and let them retry.
  apps: {
    addFromText: (opts: { text: string; autoGenerate?: boolean; jobSource?: string | null }): Ipc<{ applicationId: string }> =>
      ipcRenderer.invoke('apps:addFromText', opts),
    // Returns as soon as the queue is accepted; the items then land one by one
    // on apps:batchProgress, and keep landing if the modal is closed.
    addBatch: (items: string[], jobSource?: string | null): Ipc =>
      ipcRenderer.invoke('apps:addBatch', { items, jobSource: jobSource ?? null }),
    // Attach the posting to a row that was quick-added, and fill its details.
    setRawText: (applicationId: string, text: string): Ipc =>
      ipcRenderer.invoke('apps:setRawText', { applicationId, text }),
    onBatchProgress: (cb: (p: BatchAddProgress) => void): (() => void) => {
      const h = (_e: unknown, p: BatchAddProgress) => cb(p);
      ipcRenderer.on('apps:batchProgress', h);
      return () => ipcRenderer.removeListener('apps:batchProgress', h);
    },
  },

  // Menu-driven navigation. The application menu owns the keyboard shortcuts
  // (Cmd+N), and the renderer decides what they open.
  nav: {
    onNew: (cb: () => void): (() => void) => {
      const h = () => cb();
      ipcRenderer.on('nav:new', h);
      return () => ipcRenderer.removeListener('nav:new', h);
    },
  },

  // Application flow (Sankey) data
  flow: {
    getData: (): Ipc<FlowData> => ipcRenderer.invoke('flow:getData'),
  },

  // Preferred Claude model for the letters (the chip in the letter section).
  // get never fails (it falls back to the default), set answers the envelope.
  model: {
    get: (): Promise<string> => ipcRenderer.invoke('model:get'),
    set: (model: string): Ipc<string> => ipcRenderer.invoke('model:set', model),
  },

  // Per-application cover letter: live company research + full personal context,
  // generate / refine-with-feedback / copy, persisted on the application.
  coverLetter: {
    getForApp: (applicationId: string): Promise<CoverLetter | null> => ipcRenderer.invoke('coverletter:getForApp', applicationId),
    generate: (opts: { applicationId: string; company: string; role: string; jobText?: string; jobUrl?: string; location?: string }): Promise<{ body: string; note?: string; researched: boolean; sources: string[]; error?: string }> =>
      ipcRenderer.invoke('coverletter:generate', opts),
    // stage 'stream' carries `delta`: the next slice of the draft as the model
    // writes it, already decoded out of the JSON it is streaming.
    onProgress: (cb: (p: { applicationId: string; stage: string; message: string; delta?: string }) => void) => {
      const h = (_e: any, p: any) => cb(p);
      ipcRenderer.on('coverletter:progress', h);
      return () => ipcRenderer.removeListener('coverletter:progress', h);
    },
    refine: (opts: { applicationId: string; company: string; role: string; body: string; feedback: string; remember?: boolean; jobUrl?: string }): Promise<{ body: string; note?: string; error?: string }> =>
      ipcRenderer.invoke('coverletter:refine', opts),
    saveForApp: (opts: { applicationId: string; company: string; role: string; jobUrl?: string; body: string }): Promise<CoverLetter> =>
      ipcRenderer.invoke('coverletter:saveForApp', opts),
    // Save a version you like → BOTH the app's vault and a labelled PDF on disk.
    saveVersion: (opts: { applicationId: string; company: string; role: string; jobUrl?: string; body: string; label?: string }): Promise<{ version: CoverLetter; pdfPath: string }> =>
      ipcRenderer.invoke('coverletter:saveVersion', opts),
    getVersions: (applicationId: string): Promise<CoverLetter[]> => ipcRenderer.invoke('coverletter:getVersions', applicationId),
    deleteVersion: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('coverletter:deleteVersion', id),
    getDir: (): Promise<string> => ipcRenderer.invoke('coverletter:getDir'),
    setDir: (): Promise<{ dir: string }> => ipcRenderer.invoke('coverletter:setDir'),
    openFolder: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('coverletter:openFolder'),
  },
  // The per-application assistant: it already knows this posting, every resume
  // variant and the letters, so nothing has to be pasted into it. A reply
  // carrying formAnswer was a form question, and saveAnswer files that answer
  // under the question itself in the answer bank.
  assistant: {
    send: (applicationId: string, text: string): Ipc<AssistantReply> =>
      ipcRenderer.invoke('assistant:send', { applicationId, text }),
    history: (applicationId: string): Ipc<AssistantHistoryMessage[]> =>
      ipcRenderer.invoke('assistant:history', applicationId),
    saveAnswer: (label: string, value: string): Ipc =>
      ipcRenderer.invoke('assistant:saveAnswer', { label, value }),
  },

  // How well an application matches their best-fit resume. Scored once at ingest;
  // this recomputes on demand, e.g. after a resume variant has changed.
  fit: {
    recompute: (applicationId: string): Ipc<{ score: number; reason: string }> =>
      ipcRenderer.invoke('fit:recompute', { applicationId }),
  },

  // The material the letters and the assistant read: their answers, their documents,
  // their voice rules, their portfolio, their letter vault. The channel names keep
  // their historical autopilot: prefix.
  autopilot: {
    getAnswerBank: (): Promise<AnswerBankEntry[]> => ipcRenderer.invoke('autopilot:getAnswerBank'),
    upsertAnswer: (entry: Partial<AnswerBankEntry> & { label: string; value: string }): Promise<AnswerBankEntry> =>
      ipcRenderer.invoke('autopilot:upsertAnswer', entry),
    deleteAnswer: (id: string) => ipcRenderer.invoke('autopilot:deleteAnswer', id),
    getDocuments: (): Promise<LockerDocument[]> => ipcRenderer.invoke('autopilot:getDocuments'),
    pickDocument: (): Promise<string | null> => ipcRenderer.invoke('autopilot:pickDocument'),
    addDocument: (label: string, filePath: string, tags: string[], isDefault: boolean): Ipc<LockerDocument> =>
      ipcRenderer.invoke('autopilot:addDocument', label, filePath, tags, isDefault),
    deleteDocument: (id: string) => ipcRenderer.invoke('autopilot:deleteDocument', id),
    setDocumentDefault: (id: string) => ipcRenderer.invoke('autopilot:setDocumentDefault', id),
    getResumeFocus: (): Promise<Record<string, string>> => ipcRenderer.invoke('autopilot:getResumeFocus'),
    setResumeFocus: (docId: string, focus: string) => ipcRenderer.invoke('autopilot:setResumeFocus', docId, focus),
    getVoiceNotes: (): Promise<VoiceNote[]> => ipcRenderer.invoke('autopilot:getVoiceNotes'),
    addVoiceNote: (kind: VoiceNoteKind, note: string): Promise<VoiceNote> =>
      ipcRenderer.invoke('autopilot:addVoiceNote', kind, note),
    deleteVoiceNote: (id: string) => ipcRenderer.invoke('autopilot:deleteVoiceNote', id),
    getPortfolioLinks: (): Promise<PortfolioLink[]> => ipcRenderer.invoke('autopilot:getPortfolioLinks'),
    addPortfolioLink: (label: string, url: string): Promise<PortfolioLink> =>
      ipcRenderer.invoke('autopilot:addPortfolioLink', label, url),
    deletePortfolioLink: (id: string) => ipcRenderer.invoke('autopilot:deletePortfolioLink', id),
    getCoverLetters: (): Promise<CoverLetter[]> => ipcRenderer.invoke('autopilot:getCoverLetters'),
    saveCoverLetter: (input: Partial<CoverLetter> & { company: string; role: string; body: string }): Promise<CoverLetter> =>
      ipcRenderer.invoke('autopilot:saveCoverLetter', input),
    deleteCoverLetter: (id: string) => ipcRenderer.invoke('autopilot:deleteCoverLetter', id),
    generateCoverLetter: (opts: { company: string; role: string; jobText?: string; extra?: string }): Promise<{ body: string; note: string; questions: string[] }> =>
      ipcRenderer.invoke('autopilot:generateCoverLetter', opts),
    refineCoverLetter: (opts: { company: string; role: string; body: string; feedback: string; remember?: boolean; jobText?: string }): Promise<{ body: string; note: string }> =>
      ipcRenderer.invoke('autopilot:refineCoverLetter', opts),
  },

  // Structured profile (Core)
  profile: {
    get: (): Promise<Record<string, string>> => ipcRenderer.invoke('autopilot:profile:get'),
    set: (profile: Record<string, string>): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('autopilot:profile:set', profile),
    seed: (): Promise<Record<string, string>> => ipcRenderer.invoke('autopilot:profile:seed'),
  },

  // Inbox sync: job email moves application stages. The app password is sent
  // once, on addAccount, and main keeps it in the Keychain; nothing here ever
  // returns it. addAccount verifies over IMAP first, then starts the backlog
  // sync in the background (progress on onProgress).
  email: {
    addAccount: (email: string, appPassword: string): Ipc<EmailAccount> =>
      ipcRenderer.invoke('email:addAccount', email, appPassword),
    removeAccount: (email: string): Ipc => ipcRenderer.invoke('email:removeAccount', email),
    listAccounts: (): Ipc<EmailAccount[]> => ipcRenderer.invoke('email:listAccounts'),
    syncNow: (): Ipc<EmailSyncStatus> => ipcRenderer.invoke('email:syncNow'),
    status: (): Ipc<EmailSyncStatus> => ipcRenderer.invoke('email:status'),
    onProgress: (cb: (s: EmailSyncStatus) => void): (() => void) => {
      const h = (_e: unknown, s: EmailSyncStatus) => cb(s);
      ipcRenderer.on('email:progress', h);
      return () => ipcRenderer.removeListener('email:progress', h);
    },
    // Newest sentAt first.
    listEvents: (opts: { status?: EmailEventStatus | 'all'; applicationId?: string } = {}): Ipc<EmailEvent[]> =>
      ipcRenderer.invoke('email:listEvents', opts),
    openAppPasswordPage: (): Ipc => ipcRenderer.invoke('email:openAppPasswordPage'),
  },

  // Quick add operation
  quickAddApplication: (company: string, jobTitle: string, jobSource?: string | null) =>
    ipcRenderer.invoke('quickAddApplication', company, jobTitle, jobSource ?? null),

  // Legacy shortcuts for backwards compatibility
  getAllApplications: (filters?: any): Ipc<JobApplication[]> => ipcRenderer.invoke('db:getAllApplications', filters),
  selectFile: (): Ipc<PickedFile | null> => ipcRenderer.invoke('file:selectFile'),
};

// Expose in main world
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
