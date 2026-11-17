# Updating Aplyd Community

Aplyd Community has no in-app auto-update. It does not download new versions on its own. You check for and install updates yourself.

## Check for a new version

1. In the app menu, open **Help** and choose **Check for updates**. This opens the Releases page in your browser. Aplyd never downloads or installs an update by itself.
2. Or open the [Releases page](https://github.com/VioletN22/aplyd-community/releases) directly.
3. Compare the newest version there with the version in the app. Open the **Help** menu: the first item shows the version, for example **Aplyd Community 0.3.0**. On macOS, **About** in the app menu shows it too.
4. Version 0.3.0 is marked as a **Pre-release**. GitHub may not show it under the **Latest** badge, so look through the full release list, not only the latest entry.

## Your data is safe during an update

Your applications, settings, letters and backups live in the data folder, not inside the app. Replacing the app does not touch that folder. See [docs/data.md](data.md) for the exact location on each operating system. You do not need to export anything before updating.

Saved credentials (the Gmail app password, any API key and calendar tokens) are encrypted files in the data folder's `secrets/` folder. Only the key that unlocks them is held by your operating system: the keychain on macOS, your Windows user account on Windows, or the desktop keyring on Linux. Updating the app does not touch either, so your credentials keep working on the same computer.

## Update on macOS

1. Quit Aplyd Community.
2. Download the new DMG for your chip from the [Releases page](https://github.com/VioletN22/aplyd-community/releases). Use the Apple Silicon DMG for an M-series Mac or the Intel DMG for an Intel Mac.
3. Open the DMG and drag **Aplyd Community** into **Applications**. Choose **Replace** when asked.
4. The first launch of the new build may show the unsigned-app warning again. Follow the **First launch** steps in the README to allow it.

## Update on Windows

1. Quit Aplyd Community.
2. Download the new Windows installer (`.exe`) from the [Releases page](https://github.com/VioletN22/aplyd-community/releases).
3. Run the installer. It replaces the installed version in place.
4. If Windows shows **Windows protected your PC**, click **More info**, then **Run anyway**.

## Update on Linux

For the AppImage:

1. Quit Aplyd Community.
2. Download the new AppImage from the [Releases page](https://github.com/VioletN22/aplyd-community/releases).
3. Make it executable: `chmod +x Aplyd-Community-<version>-linux-x86_64.AppImage`.
4. Delete or replace the old AppImage file. Run the new one.

For the DEB package:

1. Quit Aplyd Community.
2. Download the new DEB from the [Releases page](https://github.com/VioletN22/aplyd-community/releases).
3. Install over the old version: `sudo apt install ./Aplyd-Community-<version>-linux-amd64.deb`.

## After updating

1. Open the app and confirm your applications are present.
2. If you use the agent skills, update them too:
   1. Open **Settings** and click **Agent skills**.
   2. In **Claude Code and Codex skills**, choose the agents under **Install for**.
   3. Tick **Update an existing managed installation**.
   4. Click **Preview destinations**, check the list of folders, then click **Update skills**.

   You should now see a message that the skills are installed. Refresh skill discovery or restart your agent.

   From a source checkout, run the installer with `--update` instead. See [skills/README.md](../skills/README.md).
