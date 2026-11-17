import React, { useEffect } from 'react';
import { SkillsSetup } from '../components/SkillsSetup';
import { AIProviderSection } from '../components/AIProviderSection';
import { CalendarSetup } from '../components/CalendarSetup';
import { EmailSection } from '../components/EmailSetup';
import { ProfileSection } from '../components/ProfileSection';
import { QuickAddSetting } from '../components/QuickAddSetting';
import type { SettingsSection } from '../lib/setupProgress';
import '../styles/setup.css';

export const SettingsPage: React.FC<{
  onOpenSetup?: () => void;
  initialSection?: SettingsSection;
  sectionRequest?: number;
}> = ({ onOpenSetup, initialSection, sectionRequest }) => {
  const openSection = (section: SettingsSection) => {
    const target = document.getElementById(`settings-section-${section}`);
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  };
  useEffect(() => { if (initialSection) openSection(initialSection); }, [initialSection, sectionRequest]);
  return (
    <div className="settings-shell">
      <div className="page-title" style={{ marginBottom: 28 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="#6e747d" /><path d="M7 9h6 M16 9h1 M7 15h2 M12 15h5" stroke="#fff" strokeWidth={2} strokeLinecap="round" /><circle cx="14.5" cy="9" r="1.6" fill="none" stroke="#fff" strokeWidth={1.6} /><circle cx="10.5" cy="15" r="1.6" fill="none" stroke="#fff" strokeWidth={1.6} /></svg>
        <h1>Settings</h1>
      </div>

      <p style={{marginBottom:24,color:'var(--muted)'}}>Start with your profile. AI, inbox, calendar and agent skills are optional and can be connected independently.</p>
      <div className="settings-setup-entry">
        <div><strong>Set up at your own pace</strong><p>Walk through each connection, or pick a section below.</p></div>
        {onOpenSetup && <button className="btn" onClick={onOpenSetup}>Open setup guide</button>}
      </div>
      <nav className="settings-jump" aria-label="Settings sections">
        {(['profile', 'ai', 'email', 'calendar', 'skills'] as const).map(section => <button className="btn btn-ghost" key={section} onClick={() => openSection(section)}>{({ profile: 'Profile', ai: 'AI', email: 'Email', calendar: 'Calendar', skills: 'Agent skills' })[section]}</button>)}
      </nav>
      <section id="settings-section-profile" tabIndex={-1} aria-label="Profile settings"><ProfileSection /></section>
      <section id="settings-section-ai" tabIndex={-1} aria-label="AI settings"><AIProviderSection /></section>
      <section id="settings-section-email" tabIndex={-1} aria-label="Email settings"><EmailSection /></section>
      <section id="settings-section-calendar" tabIndex={-1} aria-label="Calendar settings"><CalendarSetup /></section>
      <QuickAddSetting />
      <section id="settings-section-skills" tabIndex={-1} aria-label="Agent skill settings"><SkillsSetup /></section>
    </div>
  );
};
