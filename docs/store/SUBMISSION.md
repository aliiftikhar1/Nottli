# Microsoft Store submission checklist (Nottli)

Route: **EXE/MSI app** (the NSIS installer as-is). Microsoft hosts the listing; you host the installer file.

## 0. Legal text

Publisher, email and country are filled in (`src-tauri/installer/terms.txt`, `src-tauri/tauri.conf.json`, `docs/store/PRIVACY.md`). Have the terms and privacy policy reviewed by a lawyer before launch. They are drafts.

## 1. Decide before you ship (cannot change cheaply later)

- **App identifier** is `com.nottli.app` (changed from the old `com.deskt-doodle.companion`). It also names the data folders. Do not change it again after release, or users' notes are orphaned.
- Other old-brand leftovers: crate `desktop-doodle-companion`, `doodle.db`, `doodle://` events. Invisible to users; safe to leave.

## 2. Accounts and assets

1. Partner Center developer account: https://partner.microsoft.com/dashboard (individual ~US$19 one-time).
2. Reserve the name **Nottli** (Apps and games > New product > EXE or MSI app).
3. Code-sign the installer with a certificate from a CA trusted by Windows (Azure Trusted Signing, or an OV/EV cert). Unsigned EXEs are rejected.
4. Host the signed installer at a **versioned, public HTTPS URL** that does not redirect to a landing page (GitHub Releases or your own storage). Never change the file at that URL after submitting; use a new URL per version.
5. Host the privacy policy (`docs/store/PRIVACY.md`) at a public URL.
6. Store listing: 1-2 min description, 3+ screenshots (1366x768 or larger), Store logo (see `src-tauri/icons/StoreLogo.png`), category (Productivity), age rating questionnaire, support contact.

## 3. Submission form values

- Package URL: your hosted signed installer.
- Architecture: x64. Installer type: NSIS. Silent switch: `/S`.
- Install scope: per-user (`installMode: currentUser`).
- Privacy policy URL: required (the app reads the clipboard when enabled).
- Declare that the app can start with Windows (optional setting).

## 4. Build

```
pnpm build:windows
```

Output: `D:\DevCache\cargo-target\release\bundle\nsis\Nottli_<version>_x64-setup.exe`. Bump `version` in `tauri.conf.json`, `package.json` and `Cargo.toml` for each submission.

## 5. Test before submitting

- Install on a clean Windows 10/11 VM: terms page appears, Cancel aborts, I Agree installs.
- Silent install `Nottli_x64-setup.exe /S` works and launches without prompts.
- Uninstall from Settings > Apps works.
- Clipboard history is off on a fresh install.

Certification usually takes a few business days.
