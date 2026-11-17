# FAQ

Short answers to common questions. See the other docs for detail.

## Is my data private?

Yes. Aplyd stores everything on your computer. Your applications, notes, letters and backups live in a local data folder. See [docs/data.md](data.md) for where that is. Nothing is sent anywhere unless you choose an AI provider or connect email, and even then only the related text goes to the service you picked.

## Do I need an AI account?

No. The tracker starts in manual mode. You can add applications, notes and stages with no provider. AI is optional and only powers extras like extraction, fit scores, cover letters, interview prep and email classification. See [docs/ai-providers.md](ai-providers.md).

## Does Aplyd send email for me?

No. Aplyd never sends mail. A running agent you have set up sends drafts after you approve them. The app shows: "Aplyd never sends. Your agent sends approved drafts."

## Is email read-only?

Yes. Email sync reads your inbox to match messages to applications. It does not mark messages read, move them, delete them, or send anything.

## Which email providers are supported?

Gmail only. Connect it with a Gmail app password. Other providers are not supported.

## Why does the app warn on first launch?

The build is not signed by a verified publisher and is not notarized on macOS, so each system flags it the first time. This is expected for a community prerelease. The README has a **First launch** section with the exact steps for macOS, Windows and Linux.

## How do I back up or move to a new computer?

Your data is in the local data folder. Copy that folder to back it up or to move it to another computer. See [docs/data.md](data.md) for the folder location and the restore steps. Saved credentials (the Gmail app password, any API key and calendar tokens) are encrypted files in the data folder, so a copy of the folder includes them. They only decrypt on the computer and user account that saved them, because the encryption key stays in that system's keychain. Reconnect email and calendar and re-enter any key on the new computer.
