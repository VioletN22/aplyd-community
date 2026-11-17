# Installing Aplyd for a user

This page is for an AI assistant that a user has asked to install or set up Aplyd Community on their computer. The user-facing walkthrough is [setup.md](setup.md); follow it, and use this page for what to check and what never to do.

## Before changing anything

- Find the operating system and processor (`uname -s` and `uname -m` on macOS and Linux; **Settings → System → About** on Windows).
- Check whether Aplyd Community is already installed. If it is, use that install and note its version.
- Check which optional tools exist and whether they are signed in, using only their status commands: `codex --version`, `codex login status`, `claude --version`, `claude auth status`, `python3 --version`.
- Ask the user which integrations they want. If they do not say, get manual tracking working and offer the rest.

## Install

- For ordinary use, download the installer for the user's OS and processor from [the releases page](https://github.com/VioletN22/aplyd-community/releases) and compare its checksum with `SHA256SUMS`. A checksum match does not mean the build is signed.
- The builds are unsigned. Explain the first-launch warning (see [the README](../README.md#first-launch)) and let the user decide whether to open the app. Never disable Gatekeeper, SmartScreen or the Electron sandbox.
- Build from source only when the user wants that or no installer fits. The commands are in [the README](../README.md#run-from-source). Do not change dependency versions or delete the lockfile to make an install pass.

## The user's logins and data

- Never ask for a password, API key, app password or login code in chat. The user types these into Aplyd or the provider's own sign-in page.
- Never read, copy or print credential files such as Codex's `auth.json` or Claude Code's login data.
- Keep existing logins. Do not sign the user out, switch accounts, or replace or downgrade a CLI they already use. Aplyd's Codex adapter supports `0.169.0` only; if the user has another version, explain the options in [ai-providers.md](ai-providers.md) and let them choose.
- Use the exact folder shown in **Settings → Local data**. Never guess a database path, create the `.aplyd-community.json` marker by hand, point Aplyd at another installation's database or overwrite an existing one.
- Leave profile fields the user has not given you blank. Do not invent work rights, salary, dates or qualifications.
- Do not add demo applications to a real profile. Use the user's own first application to check that saving works, or leave that check for them.
- Do not send email, submit job applications, create calendar events or change Google Cloud settings unless the user asks for that specific action.

## Optional integrations

Each one is set up separately, and a login in one does not connect another.

| Integration | Where | Checked when |
|---|---|---|
| AI in the app | Settings → AI provider ([ai-providers.md](ai-providers.md)) | **Test connection (uses AI)** succeeds. Tell the user it sends a small real request that counts against their provider usage. |
| Gmail | Settings → Email ([setup.md](setup.md#route-a-aplyds-gmail-connection)) | The inbox shows connected with a last-sync time. The user creates the app password. |
| Google Calendar | Settings → Calendar ([setup.md](setup.md#6-set-your-calendar-and-optionally-connect-google)) | Connected status and a successful **Sync now**. The user creates the OAuth client and gives consent. |
| Skills | Settings → Claude Code and Codex skills ([skills/README.md](../skills/README.md)) | The agent lists the three `aplyd-*` skills and the helper's `doctor` command passes against the Local data folder. |

If the skill installer refuses to overwrite a folder, it has found local edits. Keep them; do not delete the folder to force the install.

## Report back

For each part, say whether it was **tested successfully**, **configured but untested**, **skipped** or **blocked**, with the next step for anything blocked. A finished setup wizard is not proof that a connection works. Point the user to [setup.md](setup.md) so they can carry on without you.
