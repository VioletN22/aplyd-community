# Changelog

All notable changes to Aplyd Community are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-11-17

### Added

- **Help** menu: the first item shows the app version (**Aplyd Community** and the version number) on every system. **Check for updates** opens the releases page in your browser, and **Report an issue** opens the issue tracker.
- Escape now closes a confirm dialog, the same as **Cancel**.
- The outreach import accepts **Group A** to **Group D** or the letters A to D, in any case. Older spreadsheets that use `clubs`, `local`, `ai` and `3d` still import. A row with an unknown segment is named in the import notice, with the values that work.

### Changed

- Outreach data uses neutral internal names. Existing data is converted automatically the first time the new version starts. After that, an older version of the app cannot open the data folder.
- When the AI model field is blank, the Anthropic provider uses `claude-sonnet-5-5`.
- Dates and numbers follow your system's regional format. On Windows this can differ from the display language.
- Calendar times in 24-hour locales show in full, for example 22:00 instead of 22.
- Salary text saved from a job page uses one number format whatever your locale.
- If a calendar, inbox, prep or quick add service fails to start, Aplyd logs it and opens anyway. Only a problem with the database or the data folder stops it.

### Fixed

- Fetching a job or portfolio page checks the address it actually connects to, on every redirect, so a link cannot reach this computer or your local network.
- The database is closed cleanly on every way of quitting.
- A database from a newer version is refused before anything is written to it. The message says to install the newest version, and that restoring an older backup loses what was added since.
- An interrupted first launch no longer leaves an empty marker file that blocks every later launch. Other data folder errors name the folder and say what to do.
- The restore steps in the error message and in the data guide now include deleting `job-tracker.db-wal` and `job-tracker.db-shm`.
- Codex starts with the newest installed Node instead of an older one.
- Docs: saved credentials are encrypted files in the data folder's `secrets/` folder, with only the key in your system keychain, so a copy of the data folder includes them. The guides now say so and warn before you copy or share the folder.

## [0.2.0] - 2026-11-16

First preview build. It was a pre-release build. It is ad-hoc signed on macOS and is not notarized, and the Windows build has no verified publisher, so each system shows a first-launch warning.

### Added

- Local job application tracker that runs in manual mode with no account.
- Optional AI providers, chosen in Settings: Anthropic API key, or an existing Codex CLI login.
- Optional AI features: job extraction, fit scoring, cover letter drafting and refining, interview prep sheets, and email classification.
- Gmail email sync that reads the inbox to match messages to applications. It never sends, moves, deletes or marks mail.
- Optional Google Calendar connection and a local calendar with weekly commitments.
- Outreach page for leads, with CSV import.
- Stats, Today and Upcoming views.
- Quick Add from the current browser tab using a keyboard shortcut.
- Agent skills for Claude Code and Codex, with a bundled installer and the `tools/aplyd.py` command-line helper.
- Credentials stored in the operating system's encrypted storage, with no plaintext fallback.
- Builds for macOS (Apple Silicon and Intel), Windows and Linux.

[0.3.0]: https://github.com/VioletN22/aplyd-community/releases/tag/v0.3.0
