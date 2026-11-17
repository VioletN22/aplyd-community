# Aplyd Community

Your job search, in one local workspace. Track applications, keep the resume you sent, prepare for interviews and reconcile responses from your inbox.

Aplyd Community is open source. It starts empty, keeps everything in its own local data folder and ships no personal applications, resumes, inbox contents or credentials.

**Early community release.** macOS (Apple Silicon and Intel), Windows x64 and Linux x64 have build targets and CI checks. See [the test record](docs/verification.md) for what is tested automatically and what has been tried with live accounts.

## Get started

1. Download the build for your computer from [Releases](https://github.com/VioletN22/aplyd-community/releases). Prerelease builds have no verified publisher signature or macOS notarization; source builds are available below.
2. Open **Aplyd Community**. You should now see the first-run guide. Follow it to add your profile and resume, or open **Settings** later.
3. Start tracking manually, or connect any optional integrations you want.

**Settings** is the icon button at the bottom of the sidebar, next to **New job**. The icon shows two slider lines with round knobs, and its tooltip says Settings.

No Aplyd account or server is required. AI provider usage limits and charges still apply.

Installers include the desktop runtime; Node.js and Git are only needed for source builds.

| Computer | Recommended download |
|---|---|
| Mac with an Apple M-series chip | [Apple Silicon DMG](https://github.com/VioletN22/aplyd-community/releases/download/v0.3.0/Aplyd-Community-0.3.0-mac-arm64.dmg) |
| Mac with an Intel chip | [Intel DMG](https://github.com/VioletN22/aplyd-community/releases/download/v0.3.0/Aplyd-Community-0.3.0-mac-x64.dmg) |
| Windows x64 | [Windows installer](https://github.com/VioletN22/aplyd-community/releases/download/v0.3.0/Aplyd-Community-0.3.0-win-x64.exe) |
| Debian/Ubuntu x64 | [DEB installer](https://github.com/VioletN22/aplyd-community/releases/download/v0.3.0/Aplyd-Community-0.3.0-linux-amd64.deb) |
| Other Linux x64 | [AppImage](https://github.com/VioletN22/aplyd-community/releases/download/v0.3.0/Aplyd-Community-0.3.0-linux-x86_64.AppImage) |

The Mac builds need macOS 13 or newer. To see which chip your Mac has, open the Apple menu and choose **About This Mac**. The **Chip** line names an Apple M-series chip; a **Processor** line that names Intel means an Intel Mac.

A Linux tar.gz archive is also on the release page. Extract it and run the `aplyd-community` program inside the folder.

Portable ZIP builds, checksums and verification reports are on the [release page](https://github.com/VioletN22/aplyd-community/releases/tag/v0.3.0).

0.3.0 is marked **Pre-release**, so GitHub's **Latest** badge does not point to it. Open the [v0.3.0 release](https://github.com/VioletN22/aplyd-community/releases/tag/v0.3.0) directly.

## First launch

These builds are not signed by a verified publisher and macOS is not notarized. The first time you open the app, your operating system shows a warning. You only need these steps once.

**macOS**

1. Open the DMG and drag **Aplyd Community** to **Applications**.
2. Open the app. macOS says "Apple could not verify 'Aplyd Community' is free of malware" and offers only **Done** or **Move to Trash**. Right-click **Open** does not clear this message anymore.
3. Click **Done**.
4. Open **System Settings > Privacy & Security**.
5. Scroll down. Find the line that says Aplyd Community was blocked, then click **Open Anyway**.
6. Enter your Mac password to confirm.

You should now see the app open to its first-run guide.

**Windows**

1. Run the EXE installer. Windows SmartScreen may say "Windows protected your PC".
2. Click **More info**.
3. Click **Run anyway**. The publisher shows as Unknown.
4. The installer is not one-click. It asks whether to install for you only or for everyone on the computer, and lets you choose the folder. Then it installs.
5. After it finishes, open **Aplyd Community** from the Start menu.

You should now see the first-run guide.

**Linux**

1. Make the AppImage executable: `chmod +x Aplyd-Community-0.3.0-linux-x86_64.AppImage`, then run it.
2. On Ubuntu 22.04 or newer, if it will not start, install FUSE: `sudo apt install libfuse2`.
3. For the DEB package, install it with `sudo apt install ./Aplyd-Community-0.3.0-linux-amd64.deb`. Then open **Aplyd Community** from your applications menu, or run `aplyd-community` in a terminal.

You should now see the first-run guide.

**Check the download (optional)**

Compare the checksum of your file with the values in **SHA256SUMS** on the release page:

- macOS or Linux: `shasum -a 256 <file>`
- Windows (PowerShell): `Get-FileHash <file>`

## Optional connections

| Connection | How it works |
|---|---|
| Codex | Uses your own installed Codex CLI and its existing login, in a restricted temporary workspace. Reviewed version: 0.169.0. |
| Claude in the app | Your own Anthropic API key, stored using OS-protected encryption. API billing is separate from a Claude subscription. |
| Claude Code / Codex skills | Install the included skills from Settings; run them in your own agent session. Python 3.10+ is required for their local helper. |
| Gmail | Optional read-only IMAP with an app password; candidate messages can be sent to your chosen AI provider for classification. |
| Google Calendar | Optional desktop OAuth with your own Google Cloud credentials; Aplyd writes only to its own calendar. |

Start with the [complete first-time walkthrough](docs/setup.md): installation, profile/resume, CLI logins, email passes, calendar, skills and a tour of the app. If an AI assistant is installing it for you, point it to [docs/agent-setup.md](docs/agent-setup.md).

See [privacy](docs/privacy.md) and [the skill reference](skills/README.md) for data boundaries and helper commands. AI login does not grant email or calendar access.

## Included

- Applications, stage history, notes, search, filters, dashboards and outcome statistics.
- Profile, reusable answers, resume/document locker, writing preferences and cover-letter versions/PDFs.
- Job-link capture, company research, fit scoring, application assistant and interview preparation.
- Gmail synchronization, evidence-backed status updates, ambiguous-message review and action items.
- Calendar, configurable timezone/recurring commitments, leads and outreach approval history.
- Portable email-pass, application-update and daily-application skills, with previews, evidence, duplicate protection, resumable queues and immutable document snapshots.

Skills assist with applications; they do not guarantee job-site compatibility or successful submission. An application is recorded as submitted only after an observed receipt. See [feature boundaries](docs/features.md).

## Your first 10 minutes

You do not need to connect anything to start. Here is a short tour.

1. Open the app and finish the first-run guide, or choose **Start tracking manually** to skip ahead.
2. Add your name and resume in the guide's **Profile** step. If you chose **Start tracking manually**, add them later in **Settings → Profile**. You can type the facts yourself without AI.
3. Choose **New job**, then **Just company + role**, and add one application you have already sent. This records it locally. It does not submit anything to an employer.
4. Open that job's detail page. Add the posting text, set the stage, and note your next step.
5. If you connected an AI provider, the app can draft a cover letter on the detail page under **Cover letter**. Review and edit it. Nothing is sent.
6. Open **Today** to see what needs attention.
7. When you are ready, connect **Gmail** or **Google Calendar** from **Settings**. Both are optional.

See [the full walkthrough](docs/setup.md) for each step in detail.

## Using Aplyd

Guides for each part of the app:

- [Today](docs/guide/today.md)
- [Jobs](docs/guide/jobs.md)
- [Application detail](docs/guide/application.md)
- [Calendar](docs/guide/calendar.md)
- [Outreach](docs/guide/outreach.md)
- [Stats](docs/guide/stats.md)
- [Settings](docs/guide/settings.md)

Reference and help:

- [Keyboard shortcuts](docs/shortcuts.md)
- [Your data and backups](docs/data.md)
- [Email](docs/email.md)
- [AI providers and costs](docs/ai-providers.md)
- [Updating](docs/updating.md)
- [Uninstalling](docs/uninstall.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Limitations](docs/limitations.md)
- [FAQ](docs/faq.md)

## Run from source

Install Node.js and Git. Node.js 24 (tested). Node 22.13 or newer should work; newer major versions are untested. Python 3.10+ is needed only for agent skills and the full test suite. Deprecation warnings during `npm` install and build are expected and do not mean the build failed. The same goes for a notice from Vite during the build that the config uses features unsupported by `configLoader: 'native'`.

```sh
git clone https://github.com/VioletN22/aplyd-community.git
cd aplyd-community
npm ci
npm start
```

```sh
npm test
python3 -m unittest discover -s tools/tests -v
npm run build
npm run privacy:check
npm run dist:mac   # on macOS
npm run dist:win   # on Windows
npm run dist:linux # on Linux
```

On Windows, use `py -3` instead of `python3`. Platform installers are built on their matching OS. A source build uses the same local data folder as the installed app.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [ISC license](LICENSE)
