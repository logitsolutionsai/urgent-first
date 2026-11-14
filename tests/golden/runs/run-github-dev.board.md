# Discuss First: GitHub maintainer

Pack `github-maintainer` 0.1.0 · Input: `dev.jsonl` · Items: 60 · As of: 2026-11-14 09:00 UTC · Engine: urgent-first 0.1.0

**Discuss First: 32** (T1 Discuss now: 20 · T2 Today: 12) · **No rule matched: 28**

## Discuss First (32)

### T1 · Discuss now (20)

1. **gh-a-136** · [widget restore --project overwrote ALL my projects with old backup](https://github.com/acme/widget/issues/592) · raised from T3 to T1 · waiting 98 d 14 h
   - DATA-LOSS (T1) Data lost, overwritten or corrupted ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "nothing newer than" [body], "project is gone" [body], "overwrote" [title]
2. **gh-a-042** · [install.sh fails: 404 on 3.2.0 asset](https://github.com/acme/widget/issues/686) · raised from T3 to T1 · waiting 65 d 14 h
   - BUILD-OR-INSTALL-BROKEN (T1) Build or install broken ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "404 on 3.2.0 asset" [title], "download failed" [body], "install failed" [body]
   - Also matched: BROKEN-NO-WORKAROUND (T2) "fails:" [title]
3. **gh-a-016** · [Windows installer download is 0 KB](https://github.com/acme/widget/issues/690) · raised from T3 to T1 · waiting 65 d 13 h
   - BUILD-OR-INSTALL-BROKEN (T1) Build or install broken ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "could not be opened" [body], "0 KB" [body], "0 Bytes" [body]
4. **gh-a-070** · [3.2.0 .deb can't be installed: depends on libwidgetcore3 which doesn't exist](https://github.com/acme/widget/issues/697) · raised from T3 to T1 · waiting 65 d 10 h
   - BUILD-OR-INSTALL-BROKEN (T1) Build or install broken ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "unmet dependencies" [body], "not installable" [body], "broken packages" [body], "can't be installed" [title]
5. **gh-a-089** · [3.2.0 linux tarball checksum doesn't match SHA256SUMS](https://github.com/acme/widget/issues/698) · raised from T3 to T1 · waiting 65 d 2 h
   - SECURITY (T1) Possible security vulnerability ([source](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)): "doesn't match SHA256SUMS" [title], "checksum doesn't match" [title]
6. **gh-a-001** · [Sync fails with 401 Unauthorized after updating to 3.2.0 (worked on 3.1.5)](https://github.com/acme/widget/issues/701) · raised from T3 to T1 · waiting 65 d 1 h
   - REGRESSION-LATEST (T1) Regression in the latest release with no workaround ([source](https://semver.org/spec/v2.0.0.html)): "Can't downgrade" [body], "After updating" [body], "3.2.0" [body], "every" [body], "fails" [body], "ERROR" [body], "failed" [body], "error" [body], "Update to" [body], "after updating" [title], "worked on" [title]
   - Also matched: REGRESSION (T2) "After updating" [body], "after updating" [title]; BROKEN-NO-WORKAROUND (T2) "fails with" [body], "fails:" [body]
7. **gh-a-098** · [Windows portable zip is missing share/widget/templates, \`widget init\` fails](https://github.com/acme/widget/issues/710) · raised from T3 to T1 · waiting 64 d 20 h
   - BUILD-OR-INSTALL-BROKEN (T1) Build or install broken ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "can't create projects" [body], "zip\` doesn't contain" [body], "zip is missing" [title]
8. **gh-a-107** · [packaging: include templates in the Windows portable zip](https://github.com/acme/widget/pull/720) · raised from T3 to T1 · waiting 64 d 1 h
   - PR-FIXES-URGENT (T1) Pull request that fixes a flagged issue ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "Fixes #710" [body] (gh-a-098 is T1 by BUILD-OR-INSTALL-BROKEN)
9. **gh-a-146** · [Login loop on desktop after 3.2.0](https://github.com/acme/widget/issues/725) · raised from T3 to T1 · waiting 63 d 23 h
   - REGRESSION-LATEST (T1) Regression in the latest release with no workaround ([source](https://semver.org/spec/v2.0.0.html)): "After updating" [body], "3.2.0" [body], "Forever" [body], "can't" [body], "all" [body], "Worked fine" [body]
   - Also matched: REGRESSION (T2) "After updating" [body], "Worked fine" [body]
10. **gh-a-078** · [All keyboard shortcuts stopped working on macOS](https://github.com/acme/widget/issues/734) · raised from T2 to T1 · waiting 62 d 13 h
   - REGRESSION-LATEST (T1) Regression in the latest release with no workaround ([source](https://semver.org/spec/v2.0.0.html)): "stopped working" [title], "3.2.0" [body], "none of" [body], "was fine" [body], "all" [body], "unusable" [body], "every" [body], "can't" [body], "All" [title]
   - Also matched: REGRESSION (T2) "stopped working" [title], "was fine" [body]; BROKEN-NO-WORKAROUND (T2) "unusable" [body]
   - Floor: label "regression" sets T2
11. **gh-a-061** · [Segfault on every command on aarch64 linux](https://github.com/acme/widget/issues/736) · raised from T3 to T1 · waiting 62 d 4 h
   - STARTUP-CRASH (T1) Crashes or will not start ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "Segfault on every" [title], "on every command" [title]
   - Also matched: CRASH-OR-HANG (T2) "Segmentation fault" [body], "core dumped" [body]
12. **gh-a-062** · [Version history only goes back to today after update](https://github.com/acme/widget/issues/739) · raised from T3 to T1 · waiting 61 d 22 h
   - DATA-LOSS (T1) Data lost, overwritten or corrupted ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "get the old history back" (suspected) [body], "versions are gone" [body]
   - REGRESSION-LATEST (T1) Regression in the latest release with no workaround ([source](https://semver.org/spec/v2.0.0.html)): "After installing" [body], "v3.2.0" [body], "every" [body], "All" [body], "upgraded from" [body], "after update" [title]
13. **gh-a-067** · [Cannot open any project with ä/ö/ü or japanese name since 3.2](https://github.com/acme/widget/issues/747) · raised from T3 to T1 · waiting 60 d 19 h
   - SECURITY (T1) Possible security vulnerability ([source](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)): "open any project" [body]
   - REGRESSION-LATEST (T1) Regression in the latest release with no workaround ([source](https://semver.org/spec/v2.0.0.html)): "nothing works" [body], "Since update" [body], "update to" [body], "3.2" [body], "cannot" [body], "Error" [body], "everybody" [body], "not possible" [body], "3.2.0" [body], "Cannot" [title], "since 3.2" [title]
   - Also matched: BROKEN-NO-WORKAROUND (T2) "not possible" [body]
14. **gh-a-003** · [Clicking the icon does nothing on Ubuntu 24.04](https://github.com/acme/widget/issues/759) · raised from T3 to T1 · waiting 58 d 14 h
   - REGRESSION-LATEST (T1) Regression in the latest release with no workaround ([source](https://semver.org/spec/v2.0.0.html)): "After upgrading" [body], "3.2.0" [body], "does nothing" [body], "all" [body]
   - STARTUP-CRASH (T1) Crashes or will not start ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "icon does nothing" [body]
   - Also matched: REGRESSION (T2) "After upgrading" [body]
15. **gh-a-043** · [Same as #754 but you can also EDIT through the share link](https://github.com/acme/widget/issues/763) · raised from T3 to T1 · waiting 57 d 22 h
   - SECURITY (T1) Possible security vulnerability ([source](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)): "any project that was ever shared with edit" [body], "anyone can" [body], "modify any project" [body]
16. **gh-a-059** · [Theme colors look washed out in 3.2](https://github.com/acme/widget/issues/785) · raised from T3 to T1 · waiting 54 d 21 h
   - DATA-LOSS (T1) Data lost, overwritten or corrupted ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "not on disk" [body]
   - REGRESSION-LATEST (T1) Regression in the latest release with no workaround ([source](https://semver.org/spec/v2.0.0.html)): "since 3.2.0" [body], "3.2" [body], "do nothing" [body], "3.2.0" [body]
17. **gh-a-013** · [Renaming a project to change only capital letters made it vanish](https://github.com/acme/widget/issues/839) · raised from T3 to T1 · waiting 43 d 18 h
   - DATA-LOSS (T1) Data lost, overwritten or corrupted ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "project vanished" [body]
18. **gh-a-114** · [widget:// link from a website started another program on my PC](https://github.com/acme/widget/issues/848) · raised from T3 to T1 · waiting 41 d 11 h
   - SECURITY (T1) Possible security vulnerability ([source](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)): "any page on the internet" [body], "start programs" [body], "started another program" [title]
19. **gh-a-095** · [Scanner reports a CVE in the bundled zip library (confirmed false positive)](https://github.com/acme/widget/issues/858) · raised from T3 to T1 · waiting 38 d 17 h
   - SECURITY (T1) Possible security vulnerability ([source](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)): "CVE" [body]
20. **gh-a-094** · [main doesn't build since #857](https://github.com/acme/widget/issues/864) · raised from T3 to T1 · waiting 36 d 23 h
   - BUILD-OR-INSTALL-BROKEN (T1) Build or install broken ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "nightly didn't publish" [body], "red since" [body], "doesn't build" [title]

### T2 · Today (12)

21. **gh-a-133** · [Importing a Markdown folder drops all images and front matter](https://github.com/acme/widget/issues/551) · raised from T3 to T2 · waiting 119 d 18 h
   - BROKEN-NO-WORKAROUND (T2) Feature broken with no workaround ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "is dropped" [body], "drops all" [title]
22. **gh-a-077** · [crash when i paste emoji in project title](https://github.com/acme/widget/issues/616) · raised from T3 to T2 · waiting 91 d
   - CRASH-OR-HANG (T2) Crash, hang or freeze in a specific situation ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "close itself" [body], "crash" [title]
23. **gh-a-081** · [Search returns nothing for projects on a network drive](https://github.com/acme/widget/issues/663) · raised from T3 to T2 · waiting 71 d 18 h
   - BROKEN-NO-WORKAROUND (T2) Feature broken with no workaround ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "never returns" [body], "0 files" [body]
24. **gh-a-008** · [+1 same here](https://github.com/acme/widget/issues/730) · raised from T3 to T2 · waiting 62 d 22 h
   - REGRESSION (T2) Regression ([source](https://semver.org/spec/v2.0.0.html)): "after updating" [body]
25. **gh-a-035** · [Project invite links say "expired" right away](https://github.com/acme/widget/issues/834) · raised from T3 to T2 · waiting 45 d
   - BROKEN-NO-WORKAROUND (T2) Feature broken with no workaround ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "has expired" [body], "only I can" [body]
26. **gh-a-023** · [App freezes when dragging an image into a table cell](https://github.com/acme/widget/issues/847) · raised from T3 to T2 · waiting 42 d 17 h
   - CRASH-OR-HANG (T2) Crash, hang or freeze in a specific situation ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "Not Responding" [body], "hang" [body], "freezes" [title]
27. **gh-a-111** · [\`widget login\` rejects valid 2FA codes](https://github.com/acme/widget/issues/861) · raised from T3 to T2 · waiting 38 d
   - BROKEN-NO-WORKAROUND (T2) Feature broken with no workaround ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "can't use the CLI at all" [body], "always says" [body], "rejects" [title]
28. **gh-a-148** · [Segfault opening Settings with external 4K monitor](https://github.com/acme/widget/issues/884) · raised from T3 to T2 · waiting 32 d 13 h
   - CRASH-OR-HANG (T2) Crash, hang or freeze in a specific situation ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "segfault" [body], "crashes" [body], "Segfault" [title]
29. **gh-a-072** · [Selective sync exclusions are ignored](https://github.com/acme/widget/issues/887) · raised from T3 to T2 · waiting 31 d 22 h
   - BROKEN-NO-WORKAROUND (T2) Feature broken with no workaround ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "still uploads" [body], "are ignored" [title]
30. **gh-a-149** · [When will Windows ARM builds be available?](https://github.com/acme/widget/issues/902) · waiting 30 d
   - Floor: label "high-priority" sets T2
31. **gh-a-033** · [Replace All in project search does nothing on Linux](https://github.com/acme/widget/issues/904) · raised from T3 to T2 · waiting 29 d 16 h
   - BROKEN-NO-WORKAROUND (T2) Feature broken with no workaround ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "isn't really an option" [body], "nothing changes" [body]
32. **gh-a-007** · [Restoring an older version from History fails: "version not found"](https://github.com/acme/widget/issues/915) · raised from T3 to T2 · waiting 25 d 20 h
   - BROKEN-NO-WORKAROUND (T2) Feature broken with no workaround ([source](https://github.com/logitsolutionsai/urgent-first/tree/main/packs/github-maintainer#rules)): "only option" [body], "fails:" [title]

## No rule matched (28)

This does not mean not urgent. Items are listed in their original order.

33. gh-a-005 · [Export to EPUB](https://github.com/acme/widget/issues/553) · waiting 117 d 19 h
34. gh-a-026 · [feat(cli): add --json output to \`widget status\`](https://github.com/acme/widget/pull/627) · waiting 83 d 14 h
35. gh-a-027 · ["database locked" warning on startup (no crash, no corruption)](https://github.com/acme/widget/issues/935) · waiting 18 d 23 h · did not count: "crash" (negated), "crash" (negated), "corruption" (negated)
36. gh-a-029 · [sync: never replace non-empty remote content with a zero-length file](https://github.com/acme/widget/pull/814) · waiting 48 d 23 h · did not count: "emptied" (historical), "zero-length" (historical)
37. gh-a-030 · [Does widget work offline?](https://github.com/acme/widget/issues/515) · waiting 145 d 1 h
38. gh-a-041 · [Login dialog doesn't work with password managers (not a security issue)](https://github.com/acme/widget/issues/605) · waiting 93 d 19 h · did not count: "security issue" (negated), "security issue" (negated)
39. gh-a-045 · [refactor(sync): split engine.rs into plan, apply and transport modules](https://github.com/acme/widget/pull/857) · waiting 38 d 19 h
40. gh-a-060 · [Word count in status bar counts a URL as several words](https://github.com/acme/widget/issues/922) · waiting 23 d 14 h
41. gh-a-066 · [Sync conflict dialog shows up twice (no data was lost)](https://github.com/acme/widget/issues/806) · waiting 50 d 20 h · did not count: "data was lost" (negated), "data was lost" (negated)
42. gh-a-069 · [net: redact Authorization and cookie headers in verbose logs](https://github.com/acme/widget/pull/798) · waiting 51 d 19 h
43. gh-a-071 · [Tooltip on the sync button is cut off](https://github.com/acme/widget/issues/522) · waiting 138 d 22 h
44. gh-a-076 · [Add a \`widget check\` command to verify a project folder](https://github.com/acme/widget/issues/923) · waiting 22 d 23 h
45. gh-a-079 · [Token count in the word-count plugin](https://github.com/acme/widget/issues/838) · waiting 43 d 22 h
46. gh-a-080 · [EPUB export?](https://github.com/acme/widget/issues/918) · waiting 24 d 15 h
47. gh-a-082 · [BLOCKER for our release: add --quiet to the CLI](https://github.com/acme/widget/issues/876) · waiting 35 d 17 h
48. gh-a-088 · [i18n: add brazilian portuguese translation](https://github.com/acme/widget/pull/545) · waiting 121 d 11 h
49. gh-a-090 · [ci: cache build artefacts between jobs](https://github.com/acme/widget/pull/635) · waiting 80 d 23 h
50. gh-a-097 · [Broken link in CONTRIBUTING.md](https://github.com/acme/widget/issues/610) · waiting 92 d 21 h
51. gh-a-103 · [Drag to reorder tags sometimes jumps back](https://github.com/acme/widget/issues/651) · waiting 75 d 17 h
52. gh-a-104 · [ASAP: typo on welcome screen](https://github.com/acme/widget/issues/657) · waiting 73 d 22 h
53. gh-a-108 · [Difference between \`widget push\` and \`widget sync\`?](https://github.com/acme/widget/issues/619) · waiting 87 d 17 h
54. gh-a-116 · [Dark theme: selected text is barely visible](https://github.com/acme/widget/issues/549) · waiting 120 d 11 h
55. gh-a-117 · [Links to files in other projects open the wrong file since 3.2.0](https://github.com/acme/widget/issues/787) · waiting 53 d 20 h
56. gh-a-121 · [Installation page still says the latest version is 3.1.4](https://github.com/acme/widget/issues/776) · waiting 56 d 14 h
57. gh-a-123 · [Pin projects to the top of the sidebar](https://github.com/acme/widget/issues/595) · waiting 96 d 16 h
58. gh-a-124 · [docs: fix typos in the sync guide](https://github.com/acme/widget/pull/674) · waiting 67 d 22 h
59. gh-a-143 · [Can I self-host the sync server?](https://github.com/acme/widget/issues/658) · waiting 72 d 22 h
60. gh-a-144 · [Typo in README: "syncronise"](https://github.com/acme/widget/issues/510) · waiting 153 d

---

Every flag quotes the exact words that matched. No item is placed below the tier its own priority field implies; rules and annotations can only raise.
