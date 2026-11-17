# Feature boundaries

What each part of Aplyd Community does and what it needs. Optional integrations have their own prerequisites.

| Capability | Included path | Boundary |
|---|---|---|
| Tracking, stages, notes, dashboard | Desktop app | No AI account needed |
| Profile, answers, resume locker, writing preferences | Settings | User supplies facts/files |
| Letter drafts, assistant, fit, interview prep | Selected AI provider | Relevant text leaves the device |
| Job capture/research | Paste/link/Quick Add | Sites can block automated reads; pasted text remains available |
| Email pass | Gmail IMAP + classification/review | App password and AI connection; agent connector is an alternative |
| Calendar | Google desktop OAuth + local calendar | User supplies OAuth client; timezone/recurrences configurable |
| Leads and approval history | Outreach | No built-in email sending; conflict flags are user-controlled |
| Agent updates | Included application-update skill | Preview, evidence, local backup and idempotency |
| Assisted applications | Included daily-applications skill | Requires the user's agent/browser tools; receipts required for confirmed status |
| Agent skill install/update | Settings or included installer | Python 3.10+; edited managed files cause a conflict, not silent overwrite |

There is no browser extension. Help with filling in applications comes from the daily-applications skill, run in your own agent with its browser tools.

Outlook OAuth, a shared verified Google OAuth client, signed/notarized distribution and automatic app updates are not included. Downloading a newer build is the app-update path; skill updates have their own installer. No tool guarantees compatibility with every job site or replaces the user's factual review.
