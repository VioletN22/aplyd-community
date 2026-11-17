# Portable local interface

Requires Python 3.10+: `python3` on macOS and Linux, `py -3` (or `python`) on Windows. All actions return JSON on standard output; an error is a JSON object `{"error": ...}` on standard error with a non-zero exit code. No network calls, arbitrary SQL, provider authentication, browser automation or mailbox access exist in this helper.

## Where things are

The installer places `scripts/aplyd.py`, `scripts/local_store.py` and `scripts/runner.py` beside this skill, in `~/.claude/skills/<skill-name>/` for Claude Code and `~/.agents/skills/<skill-name>/` for Codex (on Windows `~` is `%USERPROFILE%`). Resolve paths relative to the loaded skill, independent of the shell working directory. From a source checkout, run `tools/aplyd.py` instead.

The community data directory holds the app's `job-tracker.db`. Its default location is:

- macOS: `~/Library/Application Support/aplyd-community`
- Windows: `%APPDATA%\aplyd-community`
- Linux: `~/.config/aplyd-community` (or `$XDG_CONFIG_HOME/aplyd-community`)

Confirm it rather than assuming: in the app, Settings → Optional AI provider → Local data → **Copy data directory** copies the exact path, and Settings → Claude Code and Codex skills shows it too. Ask the user for that path when you cannot read it yourself, then run `doctor`, which validates it. Use the real directory in place of the example placeholders:

```text
python3 "<loaded-skill-directory>/scripts/aplyd.py" doctor --data-dir "<community-data-directory>"
python3 "<loaded-skill-directory>/scripts/aplyd.py" context --data-dir "<community-data-directory>"
python3 "<loaded-skill-directory>/scripts/aplyd.py" application-update --data-dir "<community-data-directory>" --input "<request.json>"
py -3 "<loaded-skill-directory>\scripts\aplyd.py" doctor --data-dir "<community-data-directory>"
```

Write JSON with a file tool, not shell interpolation. `--input -` reads stdin. Never include credentials. The directory must already contain the app-created `.aplyd-community.json` identity marker and `job-tracker.db`; a missing marker or unsupported schema is a stop, not permission to create a marker or point at some other database. Copying another database into a folder with a marker is not setup. If the database is busy (the app is saving), wait a moment and run the same command again.

## Inspect and update

| Action | JSON input |
|---|---|
| `doctor` | None. Validate directory and schema. |
| `context` | None. Profile, answer bank, locker documents, writing preferences, examples and outstanding runs. |
| `applications` | Optional `query` (company/title text), `limit` (1 to 1000, default 100). |
| `application` | `application_id`. |
| `email-events` | Optional `application_id`; latest 200 local events with evidence, no complete pending mail bodies. |
| `application-update` | `application_id`, `changes`, `evidence`; `expected_stage` for a stage change; `apply:true` to write after checking preview. |
| `application-record` | `company`, `title`, real vacancy `url`, `evidence`; optional `location`, `posting`, `stage` (default applied); `apply:true` after preview. Only evidenced existing applications. |

`changes` supports `current_stage`, `notes`, `interview_at` (ISO local datetime or empty), `prep_notes`. Notes replace existing notes: read and preserve existing text before appending evidence. Stages: `applied`, `assessment`, `assessed`, `take_home`, `phone_screen`, `interview`, `offer`, `rejected`, `withdrawn`.

Example preview request using fictional data:

```json
{
  "application_id": "<ID returned by applications>",
  "expected_stage": "applied",
  "changes": {"current_stage": "interview"},
  "evidence": {
    "source_id": "mail:example-account:message-42",
    "text": "Example Org invited the candidate to interview for the named role.",
    "observed_at": "2026-11-16T09:00:00+11:00"
  }
}
```

Source IDs must identify real observations. Use the same ID/request on retries. The evidence ledger lives in the selected app database; a conflicting reuse is refused. Before a new applied write, a SQLite backup is saved under `agent-backups`. Do not share backups, requests, reports or queue files: they contain personal data. Refresh the app view after CLI changes.

## Application queue

`start`/`resume` return `run_id` and `owner`; include both for every mutating action except `start`/`resume`. Use the returned snapshot file for uploads. `job`/`status`/`report` never disclose owner tokens. The shared queue, resume archive, submitted copies and reports live in `<community-data-directory>/agent-workflows`.

| Action | Additional JSON input |
|---|---|
| `start` | `agent` (`codex`/`claude`), `target` (positive integer; default 1). Refuses another active run. |
| `resume` | `run_id`, `agent`; `takeover:true` only when a crashed previous controller is known to have stopped. Rotates the owner token. |
| `status` / `report` | None; `report` optionally takes `run_id`. |
| `job` | `job_id`. |
| `enqueue` | `url`, `company`, `title`, full `posting`; optional `location`, `source`, `requisition_id`, `summary`, `required_skills`, `key_responsibilities`, `nice_to_have_skills`. |
| `adopt` | `job_id` from an inactive run; uncertain states are preserved. |
| `register-resume` | `resume_path`, `resume_focus`; optional `resume_label`, `tags`. |
| `prepare` | `job_id`, `resume_path`; `resume_focus` required for a new document; optional `posting`, `cover_letter_text`, `cover_letter_path`, `answers` object, `reason`, `duplicate_check`. |
| `begin-submit` | `job_id`; only after final form review, immediately before the submit action. |
| `confirm` | `job_id`, observed `evidence_text`, `evidence_url`; optional `reference`, `evidence_path` to a local screenshot/receipt. |
| `sync` | `job_id`; confirmed only, safe to repeat after a crash. |
| `hold` / `skip` | `job_id`, `reason`. Uncertain submissions cannot be skipped. |
| `reconcile` | `job_id`, `verified_not_submitted:true`, `evidence_text` establishing a retry is safe. |
| `pause` / `finish` | Optional `reason`. In-flight attempts become uncertain. |

`prepare` archives hash-checked resume versions and exact submission snapshots, saves the complete posting and answers, and records resume focus in the locker. Re-prepare before submission if answers/files change. `begin-submit` checks snapshot hashes and duplicates. URL tracking parameters are stripped while vacancy IDs are retained; company/title matches require review rather than automatic merging.

A confirmed receipt is saved before app synchronization. `sync` uses deterministic IDs to recover from interruption without creating another application, and registers submitted letters/attachments. `confirmed` means observed submission but sync pending; `submitted` means also saved to Aplyd. A report is bookkeeping evidence, not independent proof that a browser submission succeeded.
