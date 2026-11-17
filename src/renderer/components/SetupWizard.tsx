import React, { useEffect, useRef, useState } from 'react';
import { ProfileSection } from './ProfileSection';
import { AIProviderSection } from './AIProviderSection';
import { EmailSection } from './EmailSetup';
import { CalendarSetup } from './CalendarSetup';
import { SkillsSetup } from './SkillsSetup';
import { advanceSetup, SETUP_STEPS, type SetupProgress, type SetupStep, type SettingsSection } from '../lib/setupProgress';
import '../styles/setup.css';

const labels: Record<SetupStep, string> = { welcome: 'Welcome', profile: 'Profile', ai: 'AI', email: 'Email', calendar: 'Calendar', skills: 'Agent skills', ready: 'Ready' };
const titles: Record<SetupStep, string> = {
  welcome: 'Make room for your next role.', profile: 'Start with your details.', ai: 'Choose how you want help.',
  email: 'Keep up with replies.', calendar: 'Keep your dates together.', skills: 'Bring your own agent.', ready: 'Your workspace is ready to use.',
};
const descriptions: Record<SetupStep, string> = {
  welcome: 'Aplyd keeps your applications, notes and next steps in one place. Set up what you need; come back for the rest.',
  profile: 'Add your name and a resume. Fields save when you leave them. You can fill in the rest later.',
  ai: 'AI can draft letters, answer questions about a role, and help interpret job emails. Manual tracking works without it.',
  email: 'Choose automatic Gmail sync in Aplyd, an email review in your own agent, or keep tracking replies yourself.',
  calendar: 'The local calendar works straight away. Set your timezone, then connect Google Calendar if you want.',
  skills: 'Optional skills help Codex or Claude Code update Aplyd from your own agent session. Installing them does not start a job search.',
  ready: 'Add an application, record its stage and keep a note of what happens next. You can change any connection in Settings.',
};

function CopyText({ text, label }: { text: string; label: string }) {
  const [message, setMessage] = useState('');
  return <div className="setup-copy"><code>{text}</code><button className="btn" onClick={() => {
    void navigator.clipboard.writeText(text).then(() => setMessage('Copied')).catch(() => setMessage('Could not copy. Select the text above.'));
  }}>{label}</button>{message && <span role="status">{message}</span>}</div>;
}

export default function SetupWizard({ progress, onChange, onPause, onFinish, onOpenSettings }: {
  progress: SetupProgress;
  onChange: (progress: SetupProgress) => void;
  onPause: () => void;
  onFinish: (addApplication: boolean) => void;
  onOpenSettings: (section: SettingsSection) => void;
}) {
  const step = progress.step;
  const index = SETUP_STEPS.indexOf(step);
  const heading = useRef<HTMLHeadingElement>(null);
  const [dataDirectory, setDataDirectory] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  useEffect(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'start' }); }, [step]);
  useEffect(() => {
    window.electronAPI.system.getInfo().then(result => {
      if (result.ok && result.data?.dataDirectory) setDataDirectory(result.data.dataDirectory);
      else setDirectoryError('Could not read the data folder. Open AI settings to try again.');
    }).catch(() => setDirectoryError('Could not read the data folder. Open AI settings to try again.'));
  }, []);
  return <div className="setup-shell">
    <header className="setup-top"><strong>Aplyd Community</strong><button className="btn btn-ghost" onClick={onPause}>Save and leave setup</button></header>
    <div className="setup-layout">
      <nav className="setup-steps" aria-label="Setup steps">
        <ol>{SETUP_STEPS.map((item, number) => <li key={item}>
          <button aria-current={step === item ? 'step' : undefined} onClick={() => onChange({ ...progress, step: item })}>
            <span className="setup-step-number">{number + 1}</span><span>{labels[item]}{progress.choices[item] && <small>{progress.choices[item] === 'skipped' ? 'Skipped for now' : 'Reviewed'}</small>}</span>
          </button>
        </li>)}</ol>
        <p>Every connection is optional.<br />Your place is saved on this device.</p>
      </nav>
      <main className="setup-main">
        <div className="setup-heading"><p className="setup-position">Step {index + 1} of {SETUP_STEPS.length}</p><h1 ref={heading} tabIndex={-1}>{titles[step]}</h1><p>{descriptions[step]}</p></div>
        <div className="setup-body">
          {step === 'welcome' && <>
            <div className="setup-start"><h2>Start with one application</h2><p>You can add jobs, move them through stages, keep notes and track dates without connecting any accounts.</p><button className="btn" onClick={() => onFinish(true)}>Start tracking manually</button></div>
            <h2>Connect only what helps</h2>
            <ul className="setup-feature-list"><li><strong>Profile and resume</strong><span>Give drafts the right details about you.</span></li><li><strong>AI</strong><span>Use a Codex CLI login or an Anthropic API key for built-in help.</span></li><li><strong>Email and calendar</strong><span>Bring replies and appointments into your workspace.</span></li><li><strong>Agent skills</strong><span>Run application workflows in your own Codex or Claude Code session.</span></li></ul>
            <p className="setup-note">Your tracker is stored locally. Connecting AI sends relevant text to that provider; email and calendar contact the accounts you connect.</p>
          </>}
          {step === 'profile' && <><p className="setup-note">Choose your resume below. “Fill from resume” needs an AI provider, so leave it until the next step if you have not connected one.</p><ProfileSection /></>}
          {step === 'ai' && <>
            <details className="setup-help"><summary>Set up Codex CLI</summary><ol>
              <li>Open Terminal on macOS/Linux or PowerShell on Windows and run <code>codex --version</code> first. If you have a newer version, keep it: use agent skills or an Anthropic API key with this Aplyd release. The command below would replace your global Codex installation.</li>
              <li>Only if Codex is not installed, install Node.js from <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">nodejs.org</a>. Node.js 24 (tested). Node 22.13 or newer should work; newer major versions are untested. Then install Aplyd’s supported version:<CopyText text="npm install -g @openai/codex@0.169.0" label="Copy install command" /></li>
              <li>Run <code>codex --version</code>, then <code>codex login status</code>. If you are signed out, run <code>codex login</code> and finish signing in in your browser.</li>
              <li>Select Codex below, save, then test the connection. The test makes a small AI request. If Aplyd cannot find a fresh install, quit and reopen Aplyd.</li>
            </ol><p>This release supports Codex CLI 0.169.0, including its prereleases. Other versions need a compatibility review. <a href="https://learn.chatgpt.com/" target="_blank" rel="noreferrer">Official Codex CLI guide</a></p></details>
            <details className="setup-help"><summary>Use Claude: API key or Claude Code?</summary><p>For the built-in assistant, create an API key in the <a href="https://platform.claude.com/" target="_blank" rel="noreferrer">Claude Console</a> and choose Claude below. API usage is billed separately from a Claude subscription.</p><p>For skills in your own Claude Code session, sign in to Claude Code in the Agent skills step. Aplyd does not reuse Claude subscription tokens as API keys.</p></details>
            <AIProviderSection />
          </>}
          {step === 'email' && <>
            <details className="setup-help"><summary>What happens when Gmail is connected?</summary><p>Aplyd reads job-related mail and matches replies to applications. It does not send mail or change messages in Gmail. Stage changes happen in Aplyd. AI interpretation needs the provider from the previous step and may send relevant email text to it.</p><p>Use a Google app password, not your normal Google password. Turn on 2-Step Verification first, create a password named Aplyd, and paste the 16-character password below. If Google does not offer app passwords, your account may not allow them; you can skip this step.</p></details>
            <EmailSection />
            <details className="setup-help"><summary>Run an email pass in Codex or Claude Code instead</summary><p>An email pass is a review you ask your agent to run. Install <code>aplyd-email-pass</code> in the Agent skills step, then give the agent your Aplyd data folder and access to the mail it should review.</p><p>A Codex or Claude login does not connect Gmail. The agent needs the Gmail sync already connected here, or a mail connection you separately authorize. Unclear matches should be left for your review.</p><button className="btn" onClick={() => onChange({ ...progress, step: 'skills' })}>Go to Agent skills</button></details>
          </>}
          {step === 'calendar' && <><p className="setup-note">Google sync takes a one-time Google Cloud setup. The expandable guide below walks through it. You can skip connecting and still use the local calendar.</p><CalendarSetup /></>}
          {step === 'skills' && <>
            <details className="setup-help"><summary>Install and sign in to your agent</summary><p><strong>Codex:</strong> use the install and login directions in the AI step. You can use skills without selecting Codex as Aplyd’s built-in AI provider.</p><p><strong>Claude Code:</strong> follow the <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer">official installation guide</a>, then run <code>claude auth status</code>. If signed out, run <code>claude auth login</code> and complete sign-in in your browser.</p><p>Install <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">Python 3.10 or newer</a> for Aplyd’s skill tools. On Windows, select the installer option to add Python to PATH.</p></details>
            <SkillsSetup />
            <h2>Try an email pass</h2><p>After installing, restart or refresh your agent so it can find the skills. Copy this into your own agent session:</p>
            {dataDirectory ? <CopyText label="Copy email-pass prompt" text={`Use aplyd-email-pass with community data directory "${dataDirectory}". Check doctor first. Use Aplyd's connected Gmail sync or my separately authorized mail connector. Report unresolved matches and failures.`} /> : <p role="status">{directoryError || 'Reading your data folder…'}</p>}
            <details className="setup-help"><summary>What the three skills do</summary><ul><li><code>aplyd-daily-applications</code>: a resumable job application workflow in your agent.</li><li><code>aplyd-email-pass</code>: review mail and reconcile application updates.</li><li><code>aplyd-application-update</code>: record a confirmed application or update.</li></ul><p>Always supply this workspace’s data folder. Skills need their own browser or mail access for external actions; installation does not grant access or submit applications.</p></details>
          </>}
          {step === 'ready' && <>
            <ul className="setup-review">{(['profile', 'ai', 'email', 'calendar', 'skills'] as const).map(item => <li key={item}><span><strong>{labels[item]}</strong><small>{progress.choices[item] === 'reviewed' ? 'Reviewed by you' : progress.choices[item] === 'skipped' ? 'Skipped for now' : 'Not reviewed yet'}</small></span><button className="btn btn-ghost" onClick={() => onChange({ ...progress, step: item })}>Review</button><button className="btn btn-ghost" onClick={() => onOpenSettings(item)}>Settings</button></li>)}</ul>
            <p className="setup-note">This list records your progress through the guide. Connection results appear in each setup form; reviewing a step does not verify a connection.</p>
            <div className="setup-start"><h2>Your first job</h2><p>Add an application you have already submitted. Record the company and role, then add a note for your next step.</p><button className="btn btn-accent" onClick={() => onFinish(true)}>Add an application</button><button className="btn btn-ghost" onClick={() => onFinish(false)}>Open my workspace</button></div>
          </>}
        </div>
        <footer className="setup-footer">
          <button className="btn btn-ghost" disabled={index === 0} onClick={() => onChange({ ...progress, step: SETUP_STEPS[index - 1] })}>Back</button>
          <div>{step !== 'welcome' && step !== 'ready' && <button className="btn btn-ghost" onClick={() => onChange(advanceSetup(progress, 'skipped'))}>Skip for now</button>}{step !== 'ready' && <button className="btn btn-accent" onClick={() => onChange(advanceSetup(progress, 'reviewed'))}>{step === 'welcome' ? 'Set up my workspace' : 'Continue'}</button>}</div>
        </footer>
      </main>
    </div>
  </div>;
}
