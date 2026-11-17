# Releasing Aplyd Community

This is the procedure for publishing a new release. The project has no auto-publish step. CI builds the installers; a person creates the GitHub release by hand.

## What CI does

The **Desktop checks** workflow (`.github/workflows/ci.yml`) runs on pushes to `main`, on pull requests, and on manual **Run workflow** dispatch. It runs on four runners:

1. macOS Apple Silicon (`arm64`)
2. macOS Intel (`x64`)
3. Windows (`x64`)
4. Linux (`x64`)

On each runner it installs dependencies, runs the privacy check, the TypeScript tests, the Python tests, the build, and the core smoke script. It then runs `electron-builder` for that target with `--publish never`, so nothing is uploaded to GitHub automatically.

The build output is uploaded as a workflow artifact per runner (`aplyd-<target>-<arch>`). Each artifact holds the installers from `release.noindex`: DMG and ZIP on macOS, the NSIS `.exe` and ZIP on Windows, and the AppImage, DEB and tar.gz on Linux, plus the smoke report JSON.

## Signing

The macOS build is ad-hoc signed only. In `electron-builder.config.js` the macOS `identity` is `-`, and CI sets `CSC_IDENTITY_AUTO_DISCOVERY` to `false`. The build is **not** notarized. On first launch macOS shows an unsigned-app warning. The Windows build has no verified publisher. Say this in the release notes.

## Release steps

1. Set the new version in `package.json`. The artifact names use `${version}`.
2. Get the build green on `main`, or trigger the workflow with **Run workflow**. Wait for all four runners to finish.
3. Download the build artifacts from that workflow run, and unzip each one into its own folder named after the artifact.
4. Combine the smoke reports into one `VERIFICATION.json`. From the folder that holds the artifact folders, run:

   ```sh
   node -e "const fs=require('fs');const out={};for(const f of process.argv.slice(1))out[f]=JSON.parse(fs.readFileSync(f,'utf8'));fs.writeFileSync('VERIFICATION.json',JSON.stringify(out,null,2)+'\n')" */native-smoke*.json
   ```

   Each report is keyed by its path, so you can see which runner wrote it. Check that every report says `"ok": true`.
5. Put the installers and archives in one folder, without the smoke reports. In that folder, compute checksums and write a `SHA256SUMS` file:
   - macOS and Linux: `shasum -a 256 * > SHA256SUMS`
   - Windows (PowerShell): `Get-ChildItem -File -Exclude SHA256SUMS | Get-FileHash -Algorithm SHA256 | ForEach-Object { "$($_.Hash.ToLower())  $($_.Name)" } | Set-Content -Encoding ascii SHA256SUMS`

   Both commands write one line per file, the hash then two spaces then the file name, so `shasum -a 256 -c SHA256SUMS` can check the result.
6. Create a git tag for the version, such as `v0.3.0`.
7. Create a GitHub release for that tag. Mark it as a **Pre-release** while the builds are unsigned.
8. Attach the installers, `VERIFICATION.json` and the `SHA256SUMS` file to the release.
9. In the release notes, include the first-launch warning for each operating system and the checksum verification commands.

## Verifying a download

Users compare a file against `SHA256SUMS`:

- macOS and Linux: `shasum -a 256 <file>`
- Windows: `Get-FileHash <file>`
