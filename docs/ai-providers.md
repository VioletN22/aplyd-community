# Optional AI connections

The tracker starts in manual mode. Add applications, notes and stages without an AI account. Choose a provider in Settings when you want extraction, letters, fit scores, email classification or interview preparation.

AI requests send the relevant job, profile, resume, application or email text to the selected provider. Aplyd does not claim subscription use is free or unlimited. Opening Settings checks local configuration without generating a model response. **Test connection (uses AI)** explicitly sends a small request and can consume provider usage.

## What needs AI and what does not

You can run the whole tracker in manual mode with no provider.

| Works without AI | Needs a provider |
| --- | --- |
| Add an application by hand | Extract a job from pasted text or a URL |
| Edit company, role, stage, notes | Fit score and rescore |
| Move an application through stages | Cover letter draft and refine |
| Record outreach leads and history | Interview prep sheet |
| Email sync (connect, fetch, match) | Email classification during sync |
| Calendar, stats, cover-letter PDFs, backups | The **Assistant** panel |

## Actions that call a model automatically

Some features run a model on their own once a provider is set. Each still sends only the related text to that provider.

1. After you add an application, Aplyd computes a fit score and a working cover letter draft in the background.
2. When an application reaches the **Phone screen** or **Interview** stage, Aplyd prepares an interview prep sheet.
3. During email sync, Aplyd classifies each new message to match it to an application.

With no provider chosen, these steps are skipped. Manual tracking is not affected.

## Cost

Aplyd does not charge for AI. The provider you choose bills you for its own usage.

1. The Anthropic API bills per request, by the number of input and output tokens. See your Anthropic account for rates and usage.
2. A Codex CLI login uses your own Codex plan or account.
3. Manual tracking sends no requests, so it has no provider cost.

## Anthropic API

Choose **Claude: Anthropic API key**, paste an API key and save. API billing is separate from a Claude subscription. Keys go to Electron's OS-backed encrypted storage, never the settings database. An unavailable OS keyring is an error; there is no plaintext fallback. If you leave the model field blank, Aplyd uses `claude-sonnet-5-5`. Enter another model ID if your account needs one.

The adapter calls Anthropic's Messages API directly, with no tools. It supports text streaming, structured JSON, usage metadata and cancellation. Structured responses are validated locally, including constraints the API schema dialect cannot enforce. Failed, truncated or malformed responses are errors, not valid application updates. No automated provider retry can silently multiply charges.

Claude Code remains a separate, user-run skill workflow. Aplyd never borrows Claude Code subscription credentials for in-app inference.

## Codex CLI login

Install the native Codex CLI and run `codex login`. Select **Codex: existing CLI login** in Settings. Aplyd asks the CLI to use its supported login; Aplyd does not read, copy or parse Codex credential files. On Windows, standard `npm install -g @openai/codex@0.169.0` installations are detected from PATH prefixes and the usual npm directory. Aplyd resolves the official package's native executable directly; shell `.cmd` wrappers are deliberately not launched. The model field may stay blank to use Codex's default.

This release supports Codex `0.169.0` (including its prereleases). Other versions fail closed pending an isolation review. The CLI must support `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--strict-config`, `--output-schema` and `--json`.

Each call uses a new temporary workspace and a named permission profile: filesystem root denied, minimal OS runtime paths readable, temporary workspace readable, no writes granted, command networking disabled, and no approval escalation. The invocation skips user configuration/rules and project instructions; disables shell, browser, computer use, plugins, hooks, apps, agent spawning and skill discovery; and replaces the MCP server configuration. Prompts go through stdin with `shell:false`, including on Windows. Untrusted input never becomes shell code. Temporary schema files are removed after completion.

This is a restricted agent sandbox, not a claim that the CLI has a universal no-tools switch. The underlying model can still advertise native tools such as patching; filesystem writes are denied, and observed tool-operation events fail the request. System-managed configuration is refused where detected because legacy sandbox settings can override named profiles. Organization-managed installations require a separate effective-policy review.

Codex JSONL produces completed message chunks rather than Anthropic's token deltas. The UI receives the completed message when it is available. Interrupted/failed turns and schema mismatches are rejected.

## Bounds and cancellation

At most two AI calls run concurrently, with up to 20 waiting. Deadlines include queue time and are capped at five minutes. Inputs are limited to 1 MiB and provider output to 2 MiB. Settings offers **Cancel AI requests**, which cancels active and queued requests; app shutdown also cancels them. Credentials and arbitrary provider error bodies are not displayed in errors.

## Testing

Both adapters are covered by mocked tests, and the Codex adapter was tried against a real CLI login with synthetic data. Live Anthropic API use and Windows or Linux CLI behaviour have not been tested; see [the test record](verification.md).

References: [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Codex permission profiles](https://learn.chatgpt.com/docs/permissions), [Codex CLI source](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs), [Codex tool policy](https://github.com/openai/codex/blob/main/codex-rs/ext/extension-api/src/tool_policy.rs).
