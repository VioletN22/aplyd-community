# Agent skills

In the desktop app, open **Settings**, click **Agent skills**, choose the agents under **Install for**, click **Preview destinations**, then click **Install skills**. Python 3.10+ is required. No provider credentials are copied. The same three skills work in the user's own Claude Code or Codex session:

- `aplyd-email-pass`: reconcile mail through the app's connected Gmail sync or an already connected agent mailbox tool.
- `aplyd-application-update`: preview and apply evidenced application corrections.
- `aplyd-daily-applications`: prepare, submit, resume and hand off applications with local receipt tracking.

From this source checkout, the equivalent commands are:

```sh
python3 scripts/install-skills.py --target both --dry-run
python3 scripts/install-skills.py --target both
```

On Windows use `python` or `py -3`. Choose `--target codex` or `--target claude` to install one. The default `auto` detects agent directories/executables. `--home <dir>` installs under another home folder instead of yours (the default is your home folder), which is useful for a test run. Destinations are `~/.agents/skills` for Codex and `~/.claude/skills` for Claude Code, following their [Codex](https://developers.openai.com/codex/skills) and [Claude Code](https://code.claude.com/docs/en/skills) skill documentation. Restart/refresh skill discovery after installation. Invoke by name in Codex or as `/aplyd-daily-applications`, `/aplyd-email-pass`, `/aplyd-application-update` in Claude Code.

To update after installing a new release of the app:

1. Open **Settings** and click **Agent skills**.
2. Under **Install for**, choose the same agents as before.
3. Tick **Update an existing managed installation**.
4. Click **Preview destinations**, check the folders, then click **Update skills**.

From a source checkout, run the same commands with `--update` instead.

The installer records version and SHA-256 hashes, stages the entire change, and rolls back write failures. If the installer is killed part way, the next run finishes or undoes it: its lock goes stale once the process is gone (or after ten minutes), and the previous copy is restored from `.aplyd-rollback-<skill>-*`. It refuses folders it did not install, edited managed files and symlinks. Personal profile/preferences live in the app data directory, independently of skill updates.

If you edited an installed skill, an update stops with "Your copy of … differs from the installed version" and changes nothing. To update anyway:

1. Move that skill's folder (for example `~/.claude/skills/aplyd-email-pass`) out of the skills folder. This keeps your edits.
2. Install again (with or without `--update`).
3. Copy back any edits you still want into the new folder. The next update will stop again on those files.

## Uninstall

The app has no uninstall button for skills. Use the installer's `--uninstall` from a source checkout, or remove the folders by hand as described below.

```sh
python3 scripts/install-skills.py --target both --uninstall --dry-run
python3 scripts/install-skills.py --target both --uninstall
```

This removes only files the installer put there and you have not edited. A file you added stays (the dry run lists it under `kept`), and an edited file stops the uninstall with nothing removed. To remove the skills by hand instead, delete the `aplyd-application-update`, `aplyd-daily-applications` and `aplyd-email-pass` folders from `~/.claude/skills` (Claude Code) and `~/.agents/skills` (Codex); on Windows `~` is `%USERPROFILE%`. Uninstalling never touches the app or its data directory.

Each installed skill includes its own Python helper, so it keeps working after the source checkout moves. It requires an explicit community data directory with the app's identity marker. It never guesses a database path. See each skill's `references/interface.md` for commands and the evidence format.

The helper performs local bookkeeping. A human-authorized running agent still needs browser access to apply and a separate mail connection to read email. It cannot verify a receipt independently of the observation supplied by the agent. The app's own Gmail pass creates its email action items; the helper only updates application records, and does not send mail or create calendar events. CLI changes require refreshing the app view and do not trigger the app's in-memory AI preparation hooks. Browser submissions, live mailbox access and Windows/Linux GUI installation still need release smoke testing.

## Two versions

`skills/VERSION` is `0.1.0`. This is the version of the skills bundle, recorded by the installer. It is separate from the app version, which is `0.3.0` in `package.json`. The two move independently: a new app release does not always ship new skills, and the skills can update without an app update.

## Command reference

Every command uses the same shape. From this source checkout:

```sh
python3 tools/aplyd.py <action> --data-dir <absolute-community-data-dir> [--input <file.json> | --input -]
```

- `<action>` is one of the actions below.
- `--data-dir` is required. It must be the absolute community data directory, with the `.aplyd-community.json` marker. Defaults: macOS `~/Library/Application Support/aplyd-community`, Windows `%APPDATA%\aplyd-community`, Linux `~/.config/aplyd-community`. Settings → Local data → **Copy data directory** copies the exact path.
- `--input` is a path to a JSON file, or `-` to read JSON from standard input. Omit it for actions that take no fields.
- On Windows use `python` or `py -3`. Each installed skill carries its own helper and can be invoked the same way; see each skill's `references/interface.md`.

Output is JSON on standard output. Errors print `{"error": ...}` on standard error and exit non-zero.

### Evidence object

Every write to an application needs an `evidence` object with three string fields, all required:

- `source_id`: a stable ID for the observation (reused evidence is treated as a duplicate).
- `text`: what was observed.
- `observed_at`: an ISO timestamp that includes a timezone.

### Read and record actions

| Action | JSON fields | What it does |
| --- | --- | --- |
| `doctor` | none | Checks the data directory and prints the data dir, database path and Python version. |
| `applications` | `query` (string, optional), `limit` (int 1 to 1000, default 100) | Lists applications whose company or title matches `query`, newest first. |
| `application` | `application_id` (required) | Returns the full record for one application. |
| `email-events` | `application_id` (optional) | Lists up to 200 recent email events, for one application or all. |
| `application-update` | `application_id`, `changes`, `evidence`, `expected_stage`, `apply` | Updates an application. See below. |
| `application-record` | `company`, `title`, `url`, `location`, `posting`, `stage`, `evidence`, `apply` | Records a new application observed by the agent. See below. |

For `application-update`: `changes` is an object with any of `current_stage`, `notes`, `interview_at`, `prep_notes`, all strings. `interview_at` must be an ISO local date/time. When `current_stage` changes you must also send `expected_stage` (the stage you last read) so a stale change is refused. Set `apply` to `true` to write; otherwise the command returns a preview. `current_stage` and `expected_stage` must be one of: `applied`, `assessment`, `assessed`, `take_home`, `phone_screen`, `interview`, `offer`, `rejected`, `withdrawn`.

For `application-record`: `company` and `title` are required. `url` must be a public HTTP(S) job URL. `stage` defaults to `applied` and uses the same stage list. Set `apply` to `true` to write; otherwise the command returns a preview. The command refuses an apparent duplicate of an existing application.

### Daily application queue actions

These actions drive the shared run queue used by `aplyd-daily-applications`. Most need both `run_id` and `owner`, the tokens returned by `start` or `resume`. Only one run may be active at a time.

| Action | JSON fields | What it does |
| --- | --- | --- |
| `context` | none | Returns the saved profile, documents, answer bank, portfolio, letter examples, counts and outstanding jobs. |
| `status` | none | Returns all runs and jobs. |
| `report` | `run_id` (optional) | Writes `dashboard.html` and the run report, and returns its path and counts. |
| `start` | `target` (int, default 1), `agent` (`codex` or `claude`, default `codex`) | Starts a run and returns its `run_id` and `owner`. |
| `resume` | `run_id`, `takeover` (bool), `agent` | Resumes a paused or interrupted run and returns a new `owner`. Use `takeover: true` only after confirming the other agent stopped. |
| `pause` | `run_id`, `owner`, `reason` | Pauses the run. |
| `finish` | `run_id`, `owner`, `reason` | Completes the run. |
| `job` | `job_id` | Returns one queued job. |
| `enqueue` | `run_id`, `owner`, `url`, `company`, `title`, `posting`, `location`, `source` (default `Other`), `requisition_id` | Adds a job to the queue and flags possible duplicates. |
| `adopt` | `run_id`, `owner`, `job_id` | Moves a job to the current run. |
| `register-resume` | `run_id`, `owner`, `resume_path`, `resume_focus`, `resume_label`, `tags` | Archives a resume version. `resume_path` must be an existing PDF or DOCX; a new resume needs `resume_focus`. |
| `prepare` | `run_id`, `owner`, `job_id`, `resume_path`, `resume_focus`, `posting`, `cover_letter_text`, `cover_letter_path`, `answers`, `duplicate_check`, `reason` | Builds the submission folder, resume snapshot and manifest. `duplicate_check` is required when the job was flagged as a review candidate. |
| `begin-submit` | `run_id`, `owner`, `job_id` | Marks a prepared job as submitting after re-verifying its file manifest. |
| `confirm` | `run_id`, `owner`, `job_id`, `evidence_text`, `evidence_url`, `reference`, `evidence_path` | Records observed proof that the application was submitted. |
| `sync` | `run_id`, `owner`, `job_id` | Writes a confirmed submission into the Aplyd database. |
| `reconcile` | `run_id`, `owner`, `job_id`, `evidence_text`, `verified_not_submitted` | Returns an uncertain job to prepared. `verified_not_submitted` must be `true` with evidence it was not submitted. |
| `hold` | `run_id`, `owner`, `job_id`, `reason` | Marks a job as needing your attention. |
| `skip` | `run_id`, `owner`, `job_id`, `reason` | Skips a job. |

### Example

```sh
python3 tools/aplyd.py applications --data-dir /absolute/path/to/community --input - <<'JSON'
{"query": "Example Org", "limit": 20}
JSON
```
