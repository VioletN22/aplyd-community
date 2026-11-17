# Uninstalling Aplyd Community

Removing Aplyd has three parts: the app, the agent skills, and your data. Do them in the order below. Removing the app alone leaves your data and saved credentials in place.

## 1. Remove the app

### macOS

1. Quit Aplyd Community.
2. Open **Applications**.
3. Drag **Aplyd Community** to the Trash.
4. Empty the Trash.

### Windows

1. Quit Aplyd Community.
2. Open **Settings**, then **Apps**, then **Installed apps**.
3. Find **Aplyd Community** and choose **Uninstall**.
4. Follow the uninstaller.

If you used the portable ZIP instead of the installer, just delete the folder you unzipped.

### Linux

For the AppImage, delete the `.AppImage` file you downloaded.

For the DEB package, run:

```sh
sudo apt remove aplyd-community
```

## 2. Remove the agent skills

If you installed the Claude Code or Codex skills, remove the installed skill folders. The three skills are `aplyd-email-pass`, `aplyd-application-update` and `aplyd-daily-applications`.

1. For Codex, delete the Aplyd skill folders under `~/.agents/skills`.
2. For Claude Code, delete the Aplyd skill folders under `~/.claude/skills`.

On Windows, `~` is your user folder, `%USERPROFILE%`. The folders are `%USERPROFILE%\.agents\skills` and `%USERPROFILE%\.claude\skills`.

Folders whose names start with a dot are hidden. In the macOS Finder, press Cmd+Shift+. (period) to show them, and press it again to hide them. In Windows 11 File Explorer, open **View**, then **Show**, then tick **Hidden items**. On Windows 10, tick **Hidden items** on the **View** tab. In most Linux file managers, press Ctrl+H.

From a source checkout, the installer can remove them for you. It removes only files it installed that you have not edited:

```sh
python3 scripts/install-skills.py --target both --uninstall --dry-run
python3 scripts/install-skills.py --target both --uninstall
```

The first command lists what would be removed. See [skills/README.md](../skills/README.md#uninstall) for details.

Removing these folders does not change your Codex or Claude Code login. The installer never copies provider credentials.

## 3. Remove your data

Your applications, settings, letters, backups and saved credentials live in the data folder, separate from the app. Saved credentials are the encrypted `.enc` files in its `secrets/` folder. Deleting the data folder removes all local Aplyd data, including those credentials, and cannot be undone. See [docs/data.md](data.md) for the exact folder for your operating system.

1. Quit Aplyd Community first.
2. If you want to keep a copy, copy the data folder somewhere safe before deleting.
3. Delete the data folder.

## 4. Revoke email and calendar access

Deleting the data folder removes Aplyd's copy of your credentials, but it does not revoke them. The app password and calendar access still work until you revoke them in your Google account. The encryption key Aplyd used stays with your operating system. It is harmless without the deleted files. On macOS and Linux it is an entry in the keychain or keyring, and you can remove that entry if you want.

1. Revoke the Gmail app password you created for Aplyd. In your Google Account, open **Security**, then **App passwords**, and delete the Aplyd entry.
2. If you connected Google Calendar, remove Aplyd's access. In your Google Account, open **Security**, then **Third-party apps and services** (or your own OAuth project if you created one), and remove the access you granted.
