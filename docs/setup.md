# Set up Aplyd Community

Aplyd keeps your job search in a local desktop app. You can start with manual tracking and add AI, email, calendar or agent skills later. There is no Aplyd account to create.

If an AI assistant is doing the installation for you, give it [the guide for installing assistants](agent-setup.md). It lists what to check and which steps you must do yourself, such as signing in.

## Words you will see

- **App password**: a one-time 16-character password Google gives you for a single app, so you never share your main Google password. You create it in your Google account.
- **2-Step Verification**: Google's second sign-in check (a code or prompt). You usually must turn it on before Google will let you create an app password.
- **OAuth client**: an app identity you register with Google so your copy of Aplyd can ask for calendar access. It has a client ID and a client secret.
- **Consent screen**: the Google page where you choose what your app can access and who can use it.
- **Test user**: an account you add to a Google project that is not published, so that account is allowed to sign in during testing.

## 1. Install and open the app

Download from [the official releases](https://github.com/VioletN22/aplyd-community/releases). Match both your operating system and processor:

| Your computer | Download and open |
|---|---|
| Mac with an Apple M-series chip | The mac-arm64 DMG. Open it and drag Aplyd Community to Applications. |
| Mac with an Intel processor | The mac-x64 DMG. Open it and drag Aplyd Community to Applications. |
| Windows x64 | Run the win-x64 EXE installer. The ZIP is an alternative portable copy; extract it before launching. |
| Debian/Ubuntu x64 | Install the linux-amd64 DEB using your software installer. |
| Other Linux x64 | Use the AppImage, or the tar.gz archive: extract it and run the `aplyd-community` program inside the folder. Give the AppImage permission to execute in file properties; your distribution may also need FUSE support. |

On a Mac, open the Apple menu and choose **About This Mac**. A **Chip** line names an Apple M-series chip; a **Processor** line that names Intel means an Intel Mac. The Mac builds need macOS 13 or newer. Windows lists its system type under **Settings → System → About**. Builds for Windows ARM and Linux ARM are not currently provided by the release.

Installers include the desktop runtime. You do not need Git, Node.js or Python just to track applications. Early builds have no verified publisher signature or macOS notarization; check the repository and release checksums before deciding whether to open a system warning. Do not disable your system's protections globally. Building from source is another option: see [the README](../README.md#run-from-source).

0.3.0 is marked **Pre-release** on GitHub, so the **Latest** badge does not point to it. Open the v0.3.0 release page directly.

### First launch warning

Because these builds are not signed by a verified publisher, your operating system warns you the first time you open the app. You only need these steps once.

**macOS** (requires macOS 13.0 or newer):

1. Open the DMG and drag **Aplyd Community** to **Applications**.
2. Open the app. macOS says "Apple could not verify 'Aplyd Community' is free of malware" and offers only **Done** or **Move to Trash**. Right-click **Open** no longer clears this message.
3. Click **Done**.
4. Open **System Settings → Privacy & Security**.
5. Scroll down, find the line that says Aplyd Community was blocked, and click **Open Anyway**.
6. Enter your Mac password to confirm.

You should now see the app open to its first-run guide.

**Windows**:

1. Run the EXE installer. Windows may say "Windows protected your PC".
2. Click **More info**, then **Run anyway**. The publisher shows as Unknown.
3. The installer is not one-click. It asks whether to install for you only or for everyone on the computer, and lets you choose the folder. Then it installs.
4. After it finishes, open **Aplyd Community** from the Start menu.

You should now see the first-run guide.

**Linux**:

1. Make the AppImage executable, then run it: `chmod +x Aplyd-Community-0.3.0-linux-x86_64.AppImage`.
2. On Ubuntu 22.04 or newer, if it will not start, install FUSE: `sudo apt install libfuse2`.
3. For the DEB package: `sudo apt install ./Aplyd-Community-0.3.0-linux-amd64.deb`. Then open **Aplyd Community** from your applications menu, or run `aplyd-community` in a terminal.

You should now see the first-run guide.

**Check your download (optional)**: compare the checksum against **SHA256SUMS** on the release page. On macOS or Linux run `shasum -a 256 <file>`. On Windows run `Get-FileHash <file>`.

The first-run guide walks through **Welcome → Profile → AI → Email → Calendar → Agent skills → Ready**. Choose **Set up my workspace** to begin, **Skip for now** for an optional connection, or **Save and leave setup** to come back later. Reopen it with **Settings → Open setup guide**. **Settings** is the icon button at the bottom of the sidebar, next to **New job**: two slider lines with round knobs, with the tooltip Settings. At the end, **Add an application** starts your first record and **Open my workspace** takes you into the app. The sections below explain what each step does.

## 2. Add your profile and resume

Add these in the guide's **Profile** step. If you chose **Start tracking manually**, open **Settings → Profile** instead:

1. Enter the name, email, phone and other facts you want used in applications. Leave unanswered questions blank. Do not guess dates, qualifications, work rights, salary expectations or availability.
2. Under **Resume document**, choose **Choose file** and select your resume. Check the filename. The first resume becomes the default; use **Set default** when you add another version you want used as the fallback.
3. If you have connected AI, **Fill from resume** can extract profile facts. Review the result. You can type the facts yourself without connecting AI.
4. Add **Voice notes** for writing preferences, such as keeping letters brief. These are text instructions about your writing style. Add **Portfolio links** you actually want used.
5. Use **Add field** for additional reusable answers that are true and useful. Never put an API key, account password or other secret in a profile field.

Resume documents ground letters, fit scores and the application assistant. Your default is a fallback, not a guarantee that every application used that file. Check the resume recorded against each job and keep original documents in a reliable location.

**Local data** is its own card in **Settings**, just below the AI provider card. It shows the exact community data directory, with a **Copy data directory** button. Save this path privately if you will use agent skills. Aplyd Community uses its own `aplyd-community` folder and does not automatically import another Aplyd installation. Do not replace its database with one copied from another installation.

## 3. Track your first application without AI

Choose **New job**, then **Just company + role**. Enter a real application you want to track. Open its detail page to add the posting, source, location and notes, and set the stage to what has actually happened. Adding a record does not submit an application to an employer.

Use **Jobs** for the full list, search and filters. **Waiting** helps find applications waiting for a response. Stage history records movement through the process; review it when correcting an outcome. Avoid creating a second record for the same vacancy simply because a second email arrives.

After installation, manual records, existing notes/documents and the local calendar remain available offline. AI requests, job-page fetching, Gmail and Google sync need a network connection. An agent helper can inspect/update local records offline, but its agent may still need an online model and browser/mail service for the larger workflow.

When AI is connected, pasting a job URL or posting can extract details. A blocked website is not the end of the workflow: paste the posting text instead. **Quick Add** uses copied job text/URLs and a configurable global shortcut. On macOS, frontmost-browser-tab capture can request Automation permission; clipboard capture remains available without that enhancement.

## 4. Choose an optional AI route

These are separate connections. An agent login does not give Aplyd access to your mailbox or calendar.

| What you want | What to set up |
|---|---|
| Manual tracker, notes, stages and local calendar | Nothing else required |
| AI inside Aplyd using your Codex login | A supported local Codex CLI, then select Codex in Aplyd |
| AI inside Aplyd using Claude | Your own Anthropic API key; API billing is separate |
| An agent to run the included skills | Your own Codex or Claude Code session, Python and installed skills |

AI features send relevant profile, resume, job or email content to your chosen provider. **Save provider** saves your choice, and **Test connection (uses AI)** makes a small model request and can consume usage. See [privacy](privacy.md) and [provider details](ai-providers.md).

### Codex inside Aplyd

Open Terminal on macOS/Linux or PowerShell on Windows. First check whether Codex is already installed and logged in:

```sh
codex --version
codex login status
```

If the existing login works, keep it. Aplyd's current adapter reviews **0.169.0, including prereleases of that version**. Other versions are refused until their isolation behavior is reviewed. Do not automatically replace a newer CLI you already use; you can use manual tracking, the Anthropic API route or user-run skills while deciding whether to change versions.

For a new npm installation, install Node.js first using [the official Node.js download](https://nodejs.org/en/download). Node.js 24 (tested). Node 22.13 or newer should work; newer major versions are untested. Deprecation warnings during install are expected. Then run:

```sh
npm install -g @openai/codex@0.169.0
codex --version
codex login
```

Complete the sign-in in your browser, then run `codex login status` again. If the normal browser callback cannot work, `codex login --device-auth` is an official alternative where your account permits it. Never share login codes or credential files with an assistant. See the [Codex CLI documentation](https://developers.openai.com/codex/cli).

Restart Aplyd after installation. In Settings, select **Codex: existing CLI login**, choose **Save provider**, then choose **Test connection (uses AI)**. Leave the model blank initially. A local login check establishes that a login exists; the successful in-app test establishes that this app can make a request. You should now see a success message under the buttons. If it fails, see troubleshooting below.

Use a native Windows Codex installation for the native Windows app. A CLI available only inside WSL is a separate environment. If your terminal finds Codex but Aplyd does not, see troubleshooting below.

### Claude inside Aplyd: Anthropic API

Create or use your own API key in [Anthropic Console](https://platform.claude.com/), with API access/billing available. In Aplyd Settings, choose **Claude: Anthropic API key**, enter the key in its credential field and choose **Save provider**. Choose **Test connection (uses AI)** and confirm success. You should now see a success message under the buttons. You may leave the model at its default.

Aplyd encrypts the saved key using the operating system's protected storage. It does not save the key in the application database or borrow Claude Code's subscription credentials. Removing the key removes the saved copy. A Claude subscription and Anthropic API billing are distinct; see [the provider explanation](ai-providers.md#anthropic-api).

### Claude Code or Codex for agent skills

This path runs workflows in your own agent session. It does not connect the app's built-in Claude features.

If Claude Code already works, retain its login. Otherwise use [Anthropic's official installer](https://code.claude.com/docs/en/setup). Its native install commands are:

macOS/Linux:

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
```

These commands download and execute the official installer. Open a new terminal afterward, then check and sign in only if needed:

```sh
claude --version
claude auth status
claude auth login
```

You complete the browser login yourself. Launch `claude` to start an interactive session; first launch can also guide authentication. Use your eligible account and follow any organization restrictions. See [authentication](https://code.claude.com/docs/en/authentication) and [command reference](https://code.claude.com/docs/en/cli-reference). For Codex, use its installation/login instructions above and start a session with `codex`.

## 5. Connect Gmail and run your first email pass

An **email pass** checks recruiting messages, matches them to tracked applications, and updates or flags records based on what the messages say. It is not an email-sending feature.

### Route A: Aplyd's Gmail connection

1. Connect and test an AI provider first if you want automatic classification.
2. Open **Settings → Email → Open Google app passwords**. In Google, select the Gmail account you intend to connect. Enable 2-Step Verification if needed, then create an app password named for Aplyd.
3. Back in Aplyd, enter that account's Gmail address and the app password in their fields. Use the Google-generated app password, not your normal Google password. Spaces in the generated password are accepted.
4. Choose **Connect**. Connection starts reading job emails; wait for the result. You should now see a connected inbox with a last-sync time. Later, use **Sync now** to request another pass.
5. Check the last-sync time and any errors or messages still waiting for classification. Review uncertain matches in the app and open the related application to check its email evidence, stage and action items.

Google may not offer app passwords on managed accounts, Advanced Protection accounts or some 2-Step Verification configurations. Do not turn off account protections to force this integration. [Google's app-password help](https://support.google.com/accounts/answer/185833) describes eligibility and revocation. If unavailable, use a separately authorized agent mail connector or keep tracking manually.

The reader opens mailboxes read-only and does not change read flags, send, move, delete or archive messages. Candidate message content and application context can go to your chosen AI provider. Sync also runs periodically while the app is open; closing the app stops its background work. A connected mailbox with failed classification does not mean there are no new job emails. Resolve the provider error and retry; stored message identities help avoid duplicate updates.

You can add another inbox, using that inbox's own app password. Removing an inbox stops access and forgets its saved app password; existing application updates remain. Google can revoke an app password separately.

### Route B: Your agent's mail connector

Install `aplyd-email-pass` as described below. Your agent must have its own authorized mailbox connector, or a UI tool capable of using the app's connected Gmail workflow. Signing into Codex/Claude Code and installing a skill do not create a mail connector.

After copying the real path from **Settings → Local data**, a useful request is:

```text
Use aplyd-email-pass with the community data directory "<paste the copied path here>".
Check the local helper first. Use Aplyd's connected Gmail sync, or my already
connected mailbox tool. Reconcile job-application messages and show unresolved
matches, action deadlines and any connection failures. Do not send messages.
```

Replace the placeholder before using the request. The agent should report which account/route and date range it checked. If no route works, it should say so rather than claim the inbox is clear. You can provide a selected email excerpt for manual review; that does not constitute a complete mailbox pass. The app does not provide Outlook/Microsoft OAuth.

## 6. Set your calendar and optionally connect Google

Your local calendar works without Google. In **Settings → Calendar**, check the timezone and add your own recurring commitments. It starts with your computer's timezone and no recurring schedule. Enter the intended timezone rather than assuming the recruiter's timezone equals yours.

Google sync is advanced and takes about 20 minutes. It requires a Google Cloud project and your own **Desktop app** OAuth client. There is no shared one-click community OAuth client:

1. Open [Google Cloud Console](https://console.cloud.google.com/), create/select your project and enable **Google Calendar API**.
2. Open Google Auth Platform's consent settings. Choose **External**, enter the app name and your contact email, and add your intended Google account as a test user.
3. In Audience, publish the app to **Production**. This matches the in-app guide. An external project left in Testing gives refresh tokens that expire after about 7 days, which forces you to reconnect every week. A personal unverified app may still show a warning when you sign in; that is expected.
4. Under Clients/Credentials, create an OAuth client with application type **Desktop app**. A Web application client is not the same thing.
5. Enter its client ID and client secret directly in Aplyd's **Desktop OAuth client ID** and **Client secret** fields.
6. Choose **Connect**, select the intended account in Google's browser, inspect the requested permissions and complete consent yourself.
7. Confirm Aplyd shows a connected status, then use **Sync now** and check its result. Check an intended event in the dedicated **Aplyd Community** calendar before relying on it.

You should now see a connected status and a last-sync time in **Settings → Calendar**.

Google's console labels can change; its [Calendar quickstart](https://developers.google.com/workspace/calendar/api/quickstart/nodejs) and [desktop OAuth instructions](https://developers.google.com/identity/protocols/oauth2/native-app) explain the setup. You do not need to run Google's sample application. Publishing to Production avoids the 7-day Testing token expiry; verification requirements belong to your Google project and organization.

Aplyd reads calendar information and writes its interviews, deadlines, lead calls and follow-ups to its dedicated calendar. It does not adopt an existing calendar just because its title matches. Disconnect removes local credentials and stops the connection; it leaves Google calendar data in place. The app's calendar connection does not authorize an agent to book meetings or send invitations independently.

## 7. Install and use the optional agent skills

Skills are small instruction packs you install into your own Codex or Claude Code session, so your agent can help update Aplyd's records and run application workflows. Installing them does not start a job search or grant any access.

Install [Python 3.10 or newer](https://www.python.org/downloads/) if it is missing. Check `python3 --version` on macOS/Linux; on Windows use `py -3 --version` or `python --version`. Restart Aplyd after changing installations/PATH.

In **Settings → Claude Code and Codex skills**:

1. Choose Codex, Claude Code or both to match the sessions you actually use.
2. Choose **Preview destinations** and inspect the folders.
3. Choose **Install skills**. For a previously managed install, select **Update an existing managed installation**, preview, then update.
4. Restart or refresh your agent session's skill discovery.
5. Copy the community data directory from Settings and supply it when invoking a skill. Have the agent run the helper's `doctor` command before it writes.

| Skill | First use |
|---|---|
| `aplyd-email-pass` | Reconcile messages using a connected app or authorized agent mailbox, with unresolved matches reported. |
| `aplyd-application-update` | Correct a specified application using actual evidence. Inspect the proposed changes before writing. |
| `aplyd-daily-applications` | Prepare and run an authorized application workflow using the agent's browser tools, with resumable records and receipt evidence. |

For example: "Use aplyd-application-update with community data directory `"<copied path>"`. Preview the correction to this application using this interview invitation." In Claude Code the corresponding slash command is `/aplyd-application-update`; use the skill name in Codex. Give the actual evidence and exact path, not the placeholder.

Daily applications require your own job criteria, factual profile/resume and working agent browser tools. An interrupted submission must be reconciled before retrying; clicking a submit button alone is not confirmation. The workflow saves exact document snapshots and only records confirmed submissions after observing a receipt. Skills cannot guarantee compatibility with every job site.

Skill updates protect local edits instead of silently overwriting them. The installed helper is self-contained and does not need the original checkout. See [the skill guide](../skills/README.md) for terminal installation, conflict recovery and the precise helper interface. Helper changes may require refreshing the app view and do not trigger the app's in-memory AI preparation hooks.

## 8. Find your way around

| Area | What to do there |
|---|---|
| Today | Review what needs attention, email action items and current work. A request to complete an assessment still requires you to do the actual assessment. |
| Upcoming | Review approaching interviews, calls, follow-ups and other recorded commitments. Check dates and timezone. |
| Jobs / Waiting | Search/filter applications, open a job, read notes and inspect stage history. Keep distinct vacancies separate. |
| Application detail | Preserve the full posting and source, record the resume sent, update the stage, review email evidence and use the assistant if AI is connected. |
| Cover letter | On the application detail page, draft from the actual posting/profile, edit the text, then use **Save version + PDF** to keep a version and export it. **Copy letter** copies the text; **PDF folder** opens the saved PDFs. Review facts and the selected document before sending. Saving a letter does not send it. |
| Interview prep | On the application detail page at phone-screen/interview stages, review available preparation, correct any assumptions and keep/export useful notes. AI preparation requires the selected provider; scheduling and notes can still be maintained manually. |
| Outreach | Track organizations/contacts, lead stages, next steps and due dates. Review drafts and approval history. Aplyd has no built-in email sender: it drafts messages, and your own agent sends approved drafts through the skills. An approved draft is not a sent message until your agent sends it. |
| Calendar | See local events and commitments; optionally sync the app's dedicated Google calendar. |
| Stats | Choose **Review from** and **Through** dates to inspect recorded outcomes. Statistics reflect your tracked data, so missing or incorrect stages affect the results. |
| Settings | Maintain your profile, resume locker, writing preferences, optional integrations, Quick Add shortcut and skill installation. |

## Troubleshooting

| Symptom | Check and next step |
|---|---|
| Codex command not found | Install the official CLI in the same OS/user environment as Aplyd, reopen the terminal and restart Aplyd. Check `codex --version`. |
| Codex works in a terminal but not Aplyd | A desktop app may have a different PATH or `CODEX_HOME`. Check which installation the terminal uses; use a native Windows install rather than WSL for the Windows app. Do not copy auth files or add shell wrappers to bypass detection. |
| Codex version/isolation rejected | The adapter only reviews 0.169.0 and its prereleases. Keep protections intact; use another route until a reviewed adapter/version is available. System-managed Codex configuration also needs a separate isolation review. |
| Login detected, AI test fails | Check account quota, model access, network and organization restrictions. A saved login is not a successful inference test. Leave the model blank/default first. |
| AI is taking too long | Use **Cancel AI requests** in Settings. Resolve the error before retrying; repeated tests can consume usage. |
| Credential save fails | Unlock/authorize your OS keyring and retry. Linux needs a secret service such as GNOME Keyring or KWallet. Aplyd refuses insecure plaintext fallback. Manual tracking remains available. |
| Gmail authentication fails | Check the account address and its app password. Google-password changes may revoke app passwords; create a replacement in Google and reconnect. |
| Emails remain waiting | Restore the AI connection and run **Sync now**. Check errors and ambiguous matches before concluding nothing changed. |
| Google consent fails | Check Desktop client type, enabled Calendar API, selected Google account, consent permissions and test-user enrollment. Keep using the local calendar while resolving it. |
| Skill installer cannot find Python | Install Python 3.10+, confirm its command works, then restart the app. Terminal installation is documented in the skill guide. |
| Skill update reports local changes | Preserve/merge the edits or move the affected skill folder aside before a fresh install. Never force-delete unrelated agent configuration. |
| Helper rejects the data folder | Open the app first and copy its exact Local data path. Do not make a fake marker or point it at another installation's database. |
| Linux portable build reports sandbox errors | Prefer the DEB on supported distributions. Do not launch with `--no-sandbox` or disable OS sandbox protections. |
| A job link cannot be read | Paste the full posting text; manual company/role entry also works. |

## Updates, backups and completion

Download a newer build with the same community identity to update the app; automatic app updates are not included. Database migrations and startup backups support upgrades, but keep your own private backups of important documents. For a complete data-folder copy, quit the app and any agent helpers first so the database is not being written. Keep backups private: they can contain resumes, emails and personal application history. Encrypted credentials may need reconnection on another machine.

An ordinary first setup is successful when the app opens, your profile/resume is present, and you can save and reopen an application. Optional integrations should each be described accurately: **skipped**, **configured but untested**, **tested successfully**, or **blocked with a specific next step**. You do not need to connect everything to start using the app.

For a public bug report, provide the app version, OS, failed action and redacted error. Do not attach your database, resume, inbox body, credential, OAuth token or full personal logs. See [the test record](verification.md) for what has and has not been tested with live accounts.
