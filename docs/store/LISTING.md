# Nottli: Store listing text (paste into Partner Center)

## Product name
Nottli

## Category
Productivity

## Short description (one line)
An animated desktop companion that makes capturing a thought feel immediate.

## Description
Nottli lives on your desktop as a small animated companion. Click it, or press your shortcut, and a fresh note is ready before the thought slips away.

- Quick notes: capture ideas instantly and find them again later.
- Sticky notes: pin notes to your screen so they stay in sight.
- Command palette: do things from the keyboard without hunting through menus.
- Optional clipboard history: off by default. Turn it on if you want it.
- Start with Windows: optional, from the tray menu.
- Private by design: everything is stored locally on your PC. Nottli has no account, no cloud sync and no analytics.

## Release notes (first version)
First release of Nottli.

## Search terms (up to 7)
notes, sticky notes, quick notes, clipboard history, desktop companion, productivity, notepad

## Privacy policy URL
https://github.com/aliiftikhar1/Nottli/blob/main/docs/store/PRIVACY.md

## Age rating questionnaire
No violence, sexual content, gambling, user-generated content sharing, or online interaction. Expect the lowest rating (Everyone / 3+). Answer the live questionnaire honestly, since it may differ from this note.

## Restricted capability justification (runFullTrust)
Nottli is a classic Windows desktop app (Tauri/WebView2). It needs full trust to: show a transparent always-on-top companion window and a system tray icon, register a global keyboard shortcut to open notes from any app, optionally read the clipboard to provide the user's opt-in clipboard history, and store notes in a local SQLite database. It does not access the network or collect any user data.

## Notes for certification
- Test steps: launch, click the companion or tray icon to open Notes, create a note and a sticky note, close and reopen to see them persist. Tray menu > "Start with Windows" toggles the optional startup task.
- Clipboard history is off by default and only reads the clipboard after the user enables it.
- No sign-in is required.

## Screenshots to take (3+ at 1366x768 or larger)
1. The companion on the desktop beside the open Notes panel.
2. A sticky note pinned over another app.
3. The command palette.
4. Clipboard history (after enabling it), with harmless sample text only.
