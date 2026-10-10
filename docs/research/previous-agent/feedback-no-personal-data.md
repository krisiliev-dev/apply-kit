---
name: feedback-no-personal-data
description: "Never commit the user's real CV/personal info — repo may go public on GitHub"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 24c9f673-f290-4f2b-9f82-33c3ee4e31bc
---

Never hardcode the user's real CV or personal information anywhere in the repo. Keep only the fictional "Ines Valverde" demo persona (`content/profile.ts`, `content/cvs/*.ts`) committed.

**Why:** The user may publish this repo on GitHub. Personal data in a committed file would leak.

**How to apply:** The user's real base CV + profile live in **localStorage** (keys `cv-maker:base-profile`, `cv-maker:base-cv`), written via Settings → Data. The resolver `lib/profile/base.ts` (`getBaseProfile()` / `getBaseCv()`) prefers localStorage, falls back to the demo. `.gitignore` also reserves `content/profile.local.ts`, `content/cvs/personal/`, `.backups/` for any on-disk personal overrides — but localStorage is the chosen path (strongest no-leak guarantee). When adding a feature that needs the candidate's identity, route through the resolver; for server routes (no localStorage), have the client pass the profile in the request body. See [[project-icloud-tmp-build]].
