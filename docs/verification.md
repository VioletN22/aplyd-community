# Test record

What the automated tests cover, what CI builds and checks on each operating system, what has been tried by hand, and what has not been verified.

## Automated tests

Run them with `npm test` (Vitest) and `python3 -m unittest discover -s tools/tests -v`. There are 793 TypeScript tests and 30 Python tests. They cover:

- SQLite migrations, foreign keys, application stages, stage evidence, duplicate detection, stale updates and history.
- Email filtering, matching, ambiguous messages, status transitions, retries, changed mailbox UID validity, read-only IMAP behaviour and action items.
- AI cancellation, queueing, structured output, malformed responses and provider failures; Codex process invocation and its restricted permission configuration.
- Anthropic requests with controlled fixtures: schema validation, fragmented streaming, truncated output, authentication failure, output limits and deadlines.
- Encrypted secret storage, unavailable backends, rejection of the Linux insecure fallback and isolated secret names.
- Calendar event ownership, timezones and DST, overlapping events, recurrence and configurable review dates.
- Skills: previews, evidence checks, locks, uncertain submissions, immutable snapshots, replay protection, installed-helper execution and installer rollback and conflicts.
- The Python skills against the real migrated SQLite schema: recording a confirmed application, replaying it safely and applying an evidenced interview update.

## CI

The **Desktop checks** workflow (`.github/workflows/ci.yml`) runs on macOS Apple Silicon, macOS Intel, Windows x64 and Linux x64. Each runner installs dependencies, runs the dependency audit (advisory), `npm run privacy:check`, both test suites and the production build, then runs the native core smoke (`scripts/smoke-core.cjs`) and builds the installers with publishing disabled.

The smoke opens a temporary data folder, migrates a fresh database, creates and re-reads a fictional application, takes a backup, runs an integrity check and does an encrypted secret round trip. On Linux it runs twice: once to confirm the insecure `basic_text` store is rejected before any write, and once against a disposable GNOME Keyring session.

## Release results

Each release page carries `VERIFICATION.json`, the native smoke reports from the four CI runners for that build, and `SHA256SUMS` for every installer and archive. The CI run for a release is the **Desktop checks** run on the tagged commit.

| Target | Native SQLite | Credential checks | Packages |
|---|---|---|---|
| macOS Apple Silicon | Migrate, write, backup, integrity | Keychain encrypt, decrypt and delete | DMG, ZIP |
| macOS Intel | Migrate, write, backup, integrity | Keychain encrypt, decrypt and delete | DMG, ZIP |
| Windows x64 | Migrate, write, backup, integrity | DPAPI encrypt, decrypt and delete | EXE, ZIP |
| Linux x64 | Migrate, write, backup, integrity | GNOME Keyring round trip; insecure fallback rejected before writing | DEB, AppImage, tar.gz |

## Checked by hand (macOS)

- The packaged app's first-run guide: all seven steps, skipping optional steps, saving and leaving, and reopening it from Settings.
- A completed guide reopened at the Email step resumes there after quitting and relaunching, with skipped choices kept.
- Settings section links focus the right form; the summary tells skipped and reviewed steps apart from verified connections.
- Offline: creating a fictional application, changing its stage, and keeping notes and history across a restart.
- Codex CLI `0.169.0-alpha.11.1` completed a synthetic structured request through an existing login, and the restricted permission profile blocked reading a file outside its temporary workspace.
- The macOS bundle passes `codesign --verify --deep --strict`. It is ad-hoc signed, not Developer ID signed or notarized.

Only fictional data was used.

## Not verified

- Live Gmail sync, Google Calendar consent and Anthropic API inference with a real key.
- Desktop walkthroughs on Windows and Linux. CI builds and smoke-tests the packages but does not click through the GUI.
- OS credential prompts on every desktop. Without a GUI session (for example over SSH) the macOS keychain may not answer; the smoke script then reports the credential step as unverified rather than passed.
- Compatibility with every job site.

## Manual checklist for a new build

Launch the empty app; create and edit a fictional application offline; restart and check it persisted; select a resume; save and remove a test secret; connect and test the chosen AI provider; preview and install the skills into a temporary home folder.
