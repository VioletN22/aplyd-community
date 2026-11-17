# Privacy and data boundaries

Aplyd Community stores application records, profile fields, notes, message evidence and settings in a local SQLite database. Imported resumes remain local files; the locker records their locations. Agent workflows make per-application document snapshots and local backups. The app does not require an Aplyd cloud account and has no telemetry integration.

Local storage does not mean all features are offline. Explicit AI operations send relevant profile, resume, job, research or email text to the selected provider. Company research fetches public pages. Gmail and Google Calendar contact their services after connection. Provider terms and retention policies apply to data sent to them.

API keys, app passwords and calendar credentials are encrypted with Electron's OS-backed encryption and saved as `.enc` files in the data folder's `secrets/` folder. Only the encryption key lives in the operating system's keychain or keyring. On Linux, insecure `basic_text` fallback is rejected.

**Copying or sharing the data folder copies these encrypted credentials.** They cannot be decrypted on another computer or user account, so they must be re-entered after a move, but treat any copy of the folder as sensitive and remove `secrets/` before sharing one. The SQLite database, document snapshots and ordinary backups are **not application-encrypted**; protect your computer and backups appropriately.

Codex uses its official login mechanism and restricted temporary workspace. The adapter does not copy authentication files. Claude Code skills run in the user's own session, with that session's permissions. Skills do not gain email or browser access merely by being installed.

Email synchronization reads messages without marking them read and does not send or delete mail. Calendar integration can create/update its own events after the user connects it. Agent workflow tools make evidenced local updates; sending messages and submitting applications require the user's instruction and the agent/browser's own permissions.

The repository contains no personal data: tests and examples use fictional sample data, and test identities are examples, not real accounts. `npm run privacy:check` scans tracked files for secrets, personal paths and unexpected email addresses; it supplements review and cannot prove the absence of every personal detail.

To remove local data, quit the app and remove the community data folder shown in Settings, plus any document snapshots/exported files you saved elsewhere. Disconnect accounts first if possible, and revoke provider access in the provider's own account settings when desired. Deleting local data does not delete the source Gmail messages or remote Google calendar.
