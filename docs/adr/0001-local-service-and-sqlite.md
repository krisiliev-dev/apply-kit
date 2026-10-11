# Local service and SQLite, not a hosted or desktop app

apply-kit runs as a single Node service on the user's Mac (started by launchd) with the UI in a browser tab and all data in one SQLite file in Application Support, symlinked into the repo as `data/`. It is a single-user personal tool: this keeps personal data local, gives background checks a long-running process, and avoids hosting, accounts and desktop installers.

## Considered options

- Hosted web app: rejected, personal data would leave the machine and need auth for one user.
- Electron or Tauri desktop app: rejected, installers and updates add work with no benefit over a browser tab.
- Database inside the repo as a real folder: rejected, `git clean -fdx` would delete it and code searches would surface personal data; the symlink keeps it visible from the repo without those risks.
