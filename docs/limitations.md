# Limitations

What Aplyd Community does not do, so you know before you rely on it.

## Email is Gmail only

Aplyd connects to Gmail only. Other providers are not supported. Aplyd reads mail only; it never marks read, moves, deletes or sends. See [docs/email.md](email.md).

## Some features need AI

Tracking applications, notes and stages work with no AI provider. These features do need one:

- Drafting and refining cover letters.
- Fit scoring and **Rescore**.
- Interview prep sheets.
- The Assistant.
- Reading a pasted posting or URL into an application.
- Classifying synced email.

See [docs/ai-providers.md](ai-providers.md) for what needs AI, which actions call a model, and a cost note.

## No built-in sender

Aplyd does not send email. It writes drafts and records your approval. Your agent (Codex or Claude Code, running the Aplyd skills in your own session) sends approved drafts from your own account on its next run. See [Today](guide/today.md) and [the skill guide](../skills/README.md).

## macOS build is not notarized

The macOS build is ad-hoc signed, not notarized. On first launch macOS warns that it cannot verify the app. See the first-launch box in [docs/setup.md](setup.md) and the README for how to open it. This is needed once.

## No auto-update

Aplyd does not update itself. There is no automatic download of new versions. To update, install a newer release by hand.

## Data is local only

Your data stays on this computer. Nothing syncs to a server. Credentials (email app passwords, API keys, calendar tokens) are saved as encrypted files in the data folder's `secrets/` folder. Only the encryption key is kept by your operating system, so the files cannot be decrypted on another computer or user account. If you move to another computer, reconnect email and calendar and re-enter any API key there. See [docs/data.md](data.md).

## Related

- [Email](email.md)
- [AI providers](ai-providers.md)
- [Data and backups](data.md)
- [Troubleshooting](troubleshooting.md)
