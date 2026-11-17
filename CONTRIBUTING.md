# Contributing

## Setup and checks

Use Node.js 24 LTS (the minimum is 22.13) and Python 3.10+. Install with `npm ci`, then run these before proposing a change:

```sh
npm test
python3 -m unittest discover -s tools/tests -v
npm run build
npm run privacy:check
```

On Windows use `py -3` or `python` for the Python tests. Run `npm run privacy:check` after staging the files you intend to commit. Native installers are built on the matching OS in CI. `npm run dev` starts Vite and Electron; it uses the same data folder as the installed app, so do not point it at a real profile you care about.

Run `npm audit` before releases. The manifest overrides the build tooling's minimatch 9 and 10 dependencies to patched 11.x; verify packaging on all four CI targets when changing these overrides. Electron stays on the 45.x major, with the N-API SQLite driver to avoid per-runtime ABI mismatches.

## Native core smoke

`scripts/smoke-core.cjs` is a headless native check: it has no window and no live accounts. It opens a throwaway data folder in your temp directory, migrates a fresh database, creates and re-reads one fictional application, takes a backup, runs an integrity check, then exercises encrypted secret storage, and finally deletes the temp folder. Run it after `npm run build`:

```
node scripts/smoke-core.cjs --report native-smoke.json
```

The result is one JSON document (also written to the `--report` file). `ok` is true only when every step passed. On a headless machine with no desktop keyring session (for example over SSH), the credential step may not get an answer from the OS keychain. When that happens the report sets `credentials.unverified` to true and prints `UNVERIFIED: keychain did not respond` to stderr, so a database-only pass is never mistaken for a verified secure round trip. Record that as unverified rather than treating it as a failure.

CI adds credential expectations: pass `--require-secure-storage` to require a real encrypted round trip (exits non-zero if the keychain did not respond), and on Linux `--password-store=basic --require-insecure-rejection` to confirm the app refuses an insecure fallback. Linux runs go under `xvfb-run` with a disposable D-Bus and keyring session.

## Rules for changes

- Use fictional applications and temporary data folders. Never add real resumes, inbox exports, screenshots with personal records, credentials or absolute home-directory paths.
- The packaged app must not depend on a developer's paths, shell aliases, accounts or browser sessions. Keep platform-specific behaviour explicit.
- Keep credentials in the OS-protected store; never add a plaintext fallback.
- Keep the Codex adapter's version and isolation checks. Do not loosen them to make an unsupported CLI version pass.
- Treat job postings, email bodies and web pages as untrusted input. They must never run commands, change accounts, submit applications or send messages.
- Mark an application as submitted only on an observed receipt. Keep uncertain outcomes for the user to review. A drafted or approved outreach message is not a sent one.
- Keep manual tracking usable when integrations fail. Add regression tests for evidence, replay, migration and failure behaviour when changing those paths. Do not adopt another installation's database or calendar.
- Preserve third-party license notices, including the bundled font notice. Refresh `THIRD_PARTY_NOTICES.txt` when updating the renderer's bundled libraries; their original license files are in the installed packages. Packaging includes these notices and the Figtree license in the app's resources.

For UI changes, check the whole flow with empty and populated fictional data. In the pull request, say which operating systems and live services you tested. A green unit suite does not replace a real consent-flow test.
