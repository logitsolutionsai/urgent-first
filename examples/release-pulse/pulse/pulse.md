# Release Pulse: acme/widget

Older snapshot `sha256:a7dccfa6611a` (12 items, latest release v3.1.0) · newer snapshot `sha256:6bce84705149` (16 items, latest release v3.2.0) · status complete

> **Public export.** Public projection of synthetic data: titles and short quotes only, no item bodies, security reports withheld.

Latest release from the GitHub API: **v3.2.0**, published 2026-11-10T00:00:00Z (the older snapshot saw v3.1.0). 5 report(s) in the newer snapshot were filed after it. Reported after release is an order of timestamps, not a cause.

New since the previous snapshot: 5 · not in the newer snapshot: 1 · tier changes: 1 · resolved: 0

## 1. Newly Flagged T1 And T2 (5)

- **T1** #712 [Settings page crashes on startup after the typo fix](https://github.com/acme/widget/issues/712)
  - STARTUP-CRASH: "crashes on startup" — body[201:219] · ev:#712:1 · snapshot 6bce84705149; title[14:32] · ev:#712:2 · snapshot 6bce84705149
  - CRASH-OR-HANG: "crashes" — body[201:208] · ev:#712:3 · snapshot 6bce84705149; title[14:21] · ev:#712:4 · snapshot 6bce84705149
- **T1** #713 [Installer fails with EACCES on macOS](https://github.com/acme/widget/issues/713) · new since the previous snapshot · reported after release v3.2.0
  - BUILD-OR-INSTALL-BROKEN: "installer fails" — body[166:181] · ev:#713:1 · snapshot 6bce84705149; body[281:296] · ev:#713:2 · snapshot 6bce84705149
  - BUILD-OR-INSTALL-BROKEN: "cannot install" — body[314:328] · ev:#713:3 · snapshot 6bce84705149
  - BUILD-OR-INSTALL-BROKEN: "Installer fails" — title[0:15] · ev:#713:4 · snapshot 6bce84705149
  - BROKEN-NO-WORKAROUND: "fails with" — title[10:20] · ev:#713:5 · snapshot 6bce84705149
- **T1** #714 [3.2.0 installer fails: EACCES permission denied](https://github.com/acme/widget/issues/714) · new since the previous snapshot · reported after release v3.2.0
  - BUILD-OR-INSTALL-BROKEN: "unable to install" — body[264:281] · ev:#714:1 · snapshot 6bce84705149
  - BUILD-OR-INSTALL-BROKEN: "installer fails" — body[183:198] · ev:#714:2 · snapshot 6bce84705149; title[6:21] · ev:#714:3 · snapshot 6bce84705149
  - BROKEN-NO-WORKAROUND: "fails with" — body[193:203] · ev:#714:4 · snapshot 6bce84705149
  - BROKEN-NO-WORKAROUND: "fails:" — title[16:22] · ev:#714:5 · snapshot 6bce84705149
- **T1** #715 [Unable to install 3.2.0, installer exits with EACCES](https://github.com/acme/widget/issues/715) · new since the previous snapshot · reported after release v3.2.0
  - BUILD-OR-INSTALL-BROKEN: "Unable to install" — title[0:17] · ev:#715:1 · snapshot 6bce84705149
  - BUILD-OR-INSTALL-BROKEN: "Installer fails" — body[156:171] · ev:#715:2 · snapshot 6bce84705149
- **T1** #716 [Fix installer permission check on macOS](https://github.com/acme/widget/pull/716) · new since the previous snapshot · reported after release v3.2.0
  - PR-FIXES-URGENT: "Fixes #713" — body[0:10] · ev:#716:1 · snapshot 6bce84705149

## 2. Changed Tier (1)

- **T1** #712 [Settings page crashes on startup after the typo fix](https://github.com/acme/widget/issues/712) · T3 -> T1 · because the item text changed; rules now matching: STARTUP-CRASH, CRASH-OR-HANG
  - STARTUP-CRASH: "crashes on startup" — body[201:219] · ev:#712:1 · snapshot 6bce84705149; title[14:32] · ev:#712:2 · snapshot 6bce84705149
  - CRASH-OR-HANG: "crashes" — body[201:208] · ev:#712:3 · snapshot 6bce84705149; title[14:21] · ev:#712:4 · snapshot 6bce84705149

## 3. Still Open From Before (2)

- **T1** #702 [Sync conflict deleted my notes](https://github.com/acme/widget/issues/702) · flagged T1 in the older snapshot
  - DATA-LOSS: "folder was gone and the trash is empty" — body[236:274] · ev:#702:1 · snapshot 6bce84705149
  - DATA-LOSS: "lost my notes" — body[278:291] · ev:#702:2 · snapshot 6bce84705149
  - DATA-LOSS: "deleted my notes" — title[14:30] · ev:#702:3 · snapshot 6bce84705149
- **T2** #704 [Crash when opening a project with an emoji in its name](https://github.com/acme/widget/issues/704) · flagged T2 in the older snapshot
  - CRASH-OR-HANG: "crashes" — body[164:171] · ev:#704:1 · snapshot 6bce84705149
  - CRASH-OR-HANG: "Crash" — title[0:5] · ev:#704:2 · snapshot 6bce84705149

## 4. Related Reports With New Members (1)

Candidates only: they may describe the same problem. Every member keeps its own tier and place on the board. Scores rank candidates; they are not probabilities.

- **T1** #714 [3.2.0 installer fails: EACCES permission denied](https://github.com/acme/widget/issues/714) · reported after release v3.2.0 · cluster anchor
  - BUILD-OR-INSTALL-BROKEN: "unable to install" — body[264:281] · ev:#714:1 · snapshot 6bce84705149
  - BUILD-OR-INSTALL-BROKEN: "installer fails" — body[183:198] · ev:#714:2 · snapshot 6bce84705149; title[6:21] · ev:#714:3 · snapshot 6bce84705149
  - BROKEN-NO-WORKAROUND: "fails with" — body[193:203] · ev:#714:4 · snapshot 6bce84705149
  - BROKEN-NO-WORKAROUND: "fails:" — title[16:22] · ev:#714:5 · snapshot 6bce84705149
- **T1** #713 [Installer fails with EACCES on macOS](https://github.com/acme/widget/issues/713) · reported after release v3.2.0 · may describe the same problem as #714 · score 0.5014 · shared: EACCES, 3.2.0, fails, install, installer, macos
  - BUILD-OR-INSTALL-BROKEN: "installer fails" — body[166:181] · ev:#713:1 · snapshot 6bce84705149; body[281:296] · ev:#713:2 · snapshot 6bce84705149
  - BUILD-OR-INSTALL-BROKEN: "cannot install" — body[314:328] · ev:#713:3 · snapshot 6bce84705149
  - BUILD-OR-INSTALL-BROKEN: "Installer fails" — title[0:15] · ev:#713:4 · snapshot 6bce84705149
  - BROKEN-NO-WORKAROUND: "fails with" — title[10:20] · ev:#713:5 · snapshot 6bce84705149
- **T1** #715 [Unable to install 3.2.0, installer exits with EACCES](https://github.com/acme/widget/issues/715) · reported after release v3.2.0 · same error signature as #714 · score 0.4278 · shared: EACCES, 3.2.0, copies, denied, fails, install, installer, permission
  - BUILD-OR-INSTALL-BROKEN: "Unable to install" — title[0:17] · ev:#715:1 · snapshot 6bce84705149
  - BUILD-OR-INSTALL-BROKEN: "Installer fails" — body[156:171] · ev:#715:2 · snapshot 6bce84705149

## 5. Misses Against Labels

No labelled evaluation set was given, so no misses are counted.

Pulse sha256:d39d177a2207c856e5cea769446f7809c9ac5fa36d90edf3db4effb8997fbe09. Generated by urgent-first 0.1.0. Read-only: nothing was changed on GitHub.
