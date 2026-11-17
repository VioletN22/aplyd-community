# Settings

Settings is where you connect the optional pieces: AI, your inbox, your calendar, the quick-add shortcut and the agent skills. Start with your profile. Everything else is optional and can be connected on its own.

Use the jump buttons near the top (Profile, AI, Email, Calendar, Agent skills) to move between sections. "Open setup guide" walks you through the connections one at a time.

## Profile

The **Profile** section holds the facts Aplyd uses about you. Fill this in first.

## AI

The **AI** section has two cards.

### Optional AI provider

Applications, notes and stages work without AI. AI requests send the relevant job, profile, resume or email text to the provider you choose, and the provider's usage limits and charges apply.

1. Pick a **Provider**: None, Claude (an Anthropic API key), or Codex (your existing CLI login).
2. For Claude, paste your **Anthropic API key**. For Codex, sign in once with `codex login` in a terminal.
3. Optionally set a **Model ID**.
4. Click **Save provider**.
5. Click **Test connection (uses AI)** to check it works. This sends a real request. Save your changes before testing.

You should now see a status line confirming the provider, or an error telling you what to fix.

For what needs AI, which actions call a model, and a cost note, see [docs/ai-providers.md](../ai-providers.md).

### Local data

Inside the AI section, the **Local data** card shows your data directory. The optional Aplyd agent skills use this path. Click **Copy data directory** to copy it.

For what is in that folder, backups and restoring, see [docs/data.md](../data.md).

## Email

The **Email** section connects Gmail so Aplyd moves applications to the right stage when a company writes back. It only reads. You can connect more than one inbox with **Add another inbox**. Full steps are in [docs/email.md](../email.md).

## Calendar

The **Calendar** section holds your local calendar preferences (timezone and weekly commitments) and the optional Google Calendar connection. See [Calendar](calendar.md) for the local side and [docs/setup.md](../setup.md) for Google.

## Quick add

The **Quick add** card sets a global shortcut. Copy a job ad or link anywhere, then press the shortcut to add it to Aplyd.

- The default is `Control+Command+J` on macOS and `Control+Alt+J` on other systems.
- Click **Change** to set a different shortcut, then **Save**.
- An empty shortcut switches quick add off.

If the shortcut is already used by another app, Aplyd tells you and quick add stays off until you pick another.

See [Keyboard shortcuts](../shortcuts.md).

## Agent skills

The **Agent skills** section installs the optional skills that let your agent (Codex or Claude Code) work with Aplyd's data from your own session. See [Install and use the optional agent skills](../setup.md#7-install-and-use-the-optional-agent-skills).

## Related

- [AI providers](../ai-providers.md)
- [Data and backups](../data.md)
- [Email](../email.md)
- [Keyboard shortcuts](../shortcuts.md)
