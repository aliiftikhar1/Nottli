# Nottli: Microsoft Store launch to-do (MSIX route, no certificate needed)

The Store signs MSIX packages itself, so no code-signing certificate is required. The older EXE/NSIS route (needs a paid certificate) is described in [SUBMISSION.md](SUBMISSION.md) and is not used.

## Done

- [x] Offline WebView2 in the NSIS installer (not used by the Store build, kept for direct downloads)
- [x] Startup registry value renamed to `Nottli` (legacy value cleaned up)
- [x] Installer bitmaps match the yellow "N" logo
- [x] NSIS rebuild works
- [x] MSIX manifest template (`packaging/msix/AppxManifest.template.xml`) and build script (`scripts/build-msix.ps1`, `pnpm build:msix`)
- [x] "Start with Windows" uses the MSIX StartupTask when packaged, the registry Run key otherwise
- [x] Test package builds and signs locally (`pnpm build:msix -TestSign`)

## Test the MSIX locally

- [x] Admin PowerShell: `Import-Certificate -FilePath dist-msix\NottliTest.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople`
- [x] Double-click `dist-msix\Nottli_0.1.0.0_x64.msix` to install
- [x] App launches, notes and sticky notes work, data persists after restart
- [x] Tray > "Start with Windows" on, sign out and in: app starts (also visible in Settings > Apps > Startup)
- [x] Clipboard history is OFF on a fresh install
- [x] Global shortcut and single-instance still work
- [x] Uninstall from Settings > Apps works
- [ ] Ideally repeat on a clean Windows 10 VM (WebView2 must be present; it is on Windows 11 and updated Windows 10)

## Hosting

- [x] Repo is public; privacy policy URL (returns 200): https://github.com/aliiftikhar1/Nottli/blob/main/docs/store/PRIVACY.md
- [x] Listing text, runFullTrust justification and certification notes drafted in [LISTING.md](LISTING.md)
- [ ] No installer hosting needed: you upload the `.msix` directly in Partner Center

## Partner Center (progress: account, name, identity, package and pricing done)

Product: Nottli, Store ID 9N6WF6BWCWL6, submission 1 (draft). Identity: `AliIftikhar.Nottli`, `CN=53EF73C7-E7A9-4E9D-A3EC-E73EEB2D8876`, publisher display name `Ali Iftikhar`.

- [x] Developer account created (individual, free) and identity verified
- [x] Name "Nottli" reserved (must submit within 3 months of 2026-11-25)
- [x] Store package built with the real identity, unsigned: `dist-msix\Nottli_0.1.0.0_x64.msix` (rebuild after any code change; do NOT upload the `-TestSign` build)
- [x] Pricing and availability: free, all markets, public
- [x] Properties: Productivity, personal info = Yes, privacy policy URL set (support contact fields left blank on purpose)
- [ ] Age ratings: questionnaire answered (All other app types, all No), rating preview is lowest everywhere. Still needs YOU to tick the IARC Terms checkbox and click Save
- [x] Age ratings saved (Complete)
- [x] Packages: `.msix` uploaded and Validated (Complete)
- [x] Submission options: runFullTrust justification entered (Complete)
- [x] Store listings: description, release notes, short description, 5 keywords, copyright, developer name entered and saved
- [x] Store listings: 6 screenshots uploaded and captioned (Complete). ALL six sections now Complete
- [x] Submitted for certification on 2026-11-25 (status: In certification; usually hours, up to ~3 business days). Store ID 9N6WF6BWCWL6, link will be https://apps.microsoft.com/detail/9N6WF6BWCWL6
- [ ] After it passes: send the Store link, update trailer end card ("Coming soon" -> live), upload trailer + thumbnail, add Store link to README
- [ ] If it fails: read the certification report email/page, fix, rebuild with `pnpm build:msix -IdentityName "AliIftikhar.Nottli" -Publisher "CN=53EF73C7-E7A9-4E9D-A3EC-E73EEB2D8876" -PublisherDisplayName "Ali Iftikhar"` (bump version, last part must stay 0), resubmit

Original checklist:

- [ ] Create the developer account (individual). Check the current fee on the sign-up page
- [ ] Reserve the name "Nottli" (Apps and games > New product > MSIX or PWA app)
- [ ] Copy Product identity (Package/Identity/Name, Publisher, Publisher display name) from Product management > Product identity
- [ ] Build the Store package with those values (leave it unsigned):
      `pnpm build:msix -IdentityName "<Name>" -Publisher "<CN=...>" -PublisherDisplayName "<name>"`
- [ ] Prepare 3+ screenshots (1366x768 or larger), description, category (Productivity), age rating
- [ ] Upload `dist-msix\Nottli_0.1.0.0_x64.msix`, enter the privacy policy URL
- [ ] Declare the `runFullTrust` capability justification (a desktop app with a tray icon, global shortcut and clipboard access)
- [ ] Check the live submission form for any requirement that differs from these notes
- [ ] Submit and wait for certification (up to ~3 business days)

## Optional

- [ ] Have the terms (`src-tauri/installer/terms.txt`) and privacy policy reviewed by a lawyer
- [ ] Add a Wide310x150 / Square310x310 tile logo for a nicer Start menu tile
- [ ] Add the Store link to the README Install section once live
- [ ] Delete `D:\Personal Project\DesktopApp-archive` once you no longer need the moved files
