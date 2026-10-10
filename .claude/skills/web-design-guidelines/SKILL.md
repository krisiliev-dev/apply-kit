---
name: web-design-guidelines
description: Audit UI code against Vercel's Web Interface Guidelines (accessibility, focus, forms, motion, typography, performance) and report findings as file:line. Use when asked to review UI, check accessibility or UX in code, or audit a page/component against best practices.
argument-hint: <file-or-pattern>
---

# Web Interface Guidelines audit

Read `command.md` in this skill's folder: it holds the rules and the output format. Apply them to the files or pattern given as the argument (or ask which files if none was given), and report in that format.

`command.md` is a pinned copy of https://github.com/vercel-labs/web-interface-guidelines (MIT, see `LICENSE`), vendored on 2026-10-11 so the rules never change underneath us without review. Do not fetch a newer copy at runtime; to update, re-vendor it deliberately and review the diff.
