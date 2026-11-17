# Data and backups

Where Aplyd keeps your data, how backups work, how to restore one, and what moves to another computer.

## The data folder

Aplyd keeps everything in one folder per computer:

- macOS: `~/Library/Application Support/aplyd-community`
- Windows: `%APPDATA%\aplyd-community`
- Linux: `~/.config/aplyd-community`

You can copy the exact path from **Settings**, in the **Local data** card, with **Copy data directory**.

## What is in it

- `job-tracker.db`: the SQLite database with your applications, leads, emails and notes.
- `job-tracker.db-wal` and `job-tracker.db-shm`: working files the database uses while Aplyd is open. They are folded back into `job-tracker.db` when Aplyd quits.
- `.aplyd-community.json`: a small marker file Aplyd uses to recognise its own folder.
- `backups/`: database backups made by the app. See [Backups](#backups).
- `secrets/`: your saved credentials (Gmail app password, API key, calendar tokens) as encrypted `.enc` files. The encryption key is kept by your operating system: the keychain on macOS, your Windows user account on Windows, or the desktop keyring on Linux.
- `exports/cover-letters/`: the PDFs written when you save a cover letter version. This is the default PDF folder; you can point it elsewhere from the application page.
- `interview-prep/`: prep sheet files you or an agent save there, one folder per company (for example `interview-prep/Example Org/`). PDF, HTML, Markdown, Word and text files in a company's folder show on that company's applications.
- `agent-backups/`: copies of the database the agent helper saves before each change it writes, named `before-<date and time>-<code>.sqlite`. It appears only after you use the agent skills.
- `agent-workflows/`: the daily applications skill's own files. It holds the run queue (`pipeline.sqlite`), a `dashboard.html` summary, one folder per run with its report and a folder per job (resume copy, cover letter, posting, answers and manifest), archived resume versions under `library/`, and a daily database copy under `backups/`. It appears only after you use that skill.

The log file is written to your system temporary folder as `aplyd-community-main.log` (inside the folder your operating system uses for temporary files).

## Backups

- On each day you open Aplyd, it saves a copy of the database into the `backups/` folder, named `job-tracker-YYYY-MM-DD.db`. The date is the UTC date, so near midnight it can differ from your local date. Aplyd keeps the newest 7 of these and deletes older ones.
- Before an outreach CSV import, Aplyd writes an extra copy named `job-tracker-before-lead-import-<number>.db`, so you can go back if an import is not what you wanted. These copies are never deleted automatically; delete them yourself when you no longer need them.
- The agent skills keep their own copies in `agent-backups/` and `agent-workflows/backups/`. Aplyd does not delete those either.

## Restoring a backup

To restore from a backup:

1. Quit Aplyd. Closing the window is not enough on macOS: choose **Quit** from the menu.
2. In the data folder, delete `job-tracker.db-wal` and `job-tracker.db-shm` if they exist.
3. Replace `job-tracker.db` with a backup copy from the `backups/` folder (rename the backup to `job-tracker.db`).
4. Open Aplyd again.

You should now see the data from the backup you restored. Anything added after that backup's date is gone.

If Aplyd says the data was created by a newer version, install the newest version of Aplyd Community first. Restoring an older backup also works, but you lose everything added since that backup's date.

## Exporting

Aplyd does not have a general export. The only files you can take out are the SQLite database (`job-tracker.db`) and the cover-letter PDFs in `exports/cover-letters/`. There is no built-in CSV or report export.

## Copying or sharing the data folder

**Warning:** a copy of the data folder includes the `secrets/` folder with your encrypted credentials: your Gmail app password, any API key and your calendar tokens. They cannot be decrypted on another computer or user account, but treat any copy (a backup drive, a zip you send for help) as sensitive. Delete `secrets/` from a copy you share with someone else.

## Moving to another computer

You can copy the data folder to another computer to bring your applications and letters across. Quit Aplyd before you copy it.

After moving, reconnect your email and calendar and re-enter any API key on the new computer. The encrypted credentials in `secrets/` come along in the copy, but they cannot be decrypted there, because the key stays behind with the old computer's operating system. See [docs/email.md](email.md) and [docs/setup.md](setup.md).

## Related

- [Settings](guide/settings.md)
- [Limitations](limitations.md)
- [Troubleshooting](troubleshooting.md)
