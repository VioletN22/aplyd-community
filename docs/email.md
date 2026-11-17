# Email

Connecting your inbox lets Aplyd move applications to the right stage when a company writes back. This page explains what Aplyd needs and what it does with your mail.

## Gmail only

Aplyd connects to Gmail only. Other email providers are not supported.

To connect, Gmail needs:

1. **2-Step Verification** turned on for your Google account.
2. An **app password** named for Aplyd. An app password is a 16-letter code Google gives you for one app, instead of your real password.

## Connecting an inbox

1. Open **Settings**, then the **Email** section.
2. Under step 1, click **Open Google app passwords**. In Google, make sure 2-Step Verification is on, then create an app password named Aplyd Community.
3. Under step 2, enter your **Gmail address** and paste the **App password**. Spaces in the password are fine.
4. Under step 3, click **Connect**.

You should now see your inbox listed with "Connected. Reading your job emails now."

## What Aplyd does and does not do

Aplyd reads your mail only. It never marks a message as read, moves it, deletes it, or sends anything from your account.

- Aplyd uses AI to classify which emails relate to your applications and what they mean (for example, an interview invite or a rejection). This needs an AI provider set in Settings. See [docs/ai-providers.md](ai-providers.md).
- When no AI provider is available, read emails wait. Nothing is lost. The next sync reads them and updates stages by itself.

## More than one inbox

You can connect more than one Gmail inbox. Click **Add another inbox** in the Email section. Each inbox needs its own app password, created while you are signed in to that account in Google.

## Removing an inbox

Click **Remove** on an inbox. Aplyd stops reading it and forgets its app password. Stages it already moved stay as they are.

## Related

- [Settings](guide/settings.md)
- [AI providers](ai-providers.md)
- [Limitations](limitations.md)
- [Troubleshooting](troubleshooting.md)
