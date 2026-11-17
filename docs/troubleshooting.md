# Troubleshooting

Common problems and how to fix them.

## The app will not open on first launch

The first time you open Aplyd, your operating system may block it because the build is not notarized (macOS) or has an unknown publisher (Windows).

Follow the **First launch** box in the [README](../README.md) and in [docs/setup.md](setup.md). On macOS, click **Done**, open **System Settings**, then **Privacy & Security**, find the blocked-app line, and click **Open Anyway**. This is needed once.

## An AI button does nothing

If a cover letter, fit score, interview prep or the Assistant does nothing, you probably have no AI provider set. These features need AI.

1. Open **Settings**, then the **AI** section.
2. Pick a **Provider** and enter its key or sign in.
3. Click **Save provider**, then **Test connection (uses AI)**.

See [docs/ai-providers.md](ai-providers.md). Tracking applications, notes and stages work with no provider.

## Email is not syncing

Email needs Gmail with 2-Step Verification on and an app password.

1. Check that **2-Step Verification** is on for your Google account.
2. Create a fresh **app password** named Aplyd Community, while signed in to the inbox you are connecting.
3. In **Settings**, in the **Email** section, re-enter the Gmail address and paste the app password. Spaces are fine.

If a password does not look like 16 letters, copy it again from Google. See [docs/email.md](email.md).

## Google Calendar stops after about 7 days

If calendar sync works at first and then stops after roughly a week, your Google project is still in Testing. Testing refresh tokens expire after about seven days.

Fix it by publishing the project to **Production** in the Google Cloud Console (Audience). The full steps are in [docs/setup.md](setup.md).

## Where is the log file?

Aplyd writes a log named `aplyd-community-main.log` into your system temporary folder. If Aplyd refuses to start, its message also points to your `backups/` folder and how to restore a copy. See [docs/data.md](data.md).

## Related

- [Setup guide](setup.md)
- [Email](email.md)
- [AI providers](ai-providers.md)
- [Data and backups](data.md)
- [Limitations](limitations.md)
