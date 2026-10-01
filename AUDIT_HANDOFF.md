# Tandem — shared bug audit and handoff

Last updated: October 2, 2026 (Asia/Manila), by Claude.

## Purpose and working agreement

This is the shared current-work record for Claude and Codex. The current objective is a phased bug audit of Tandem after the expansion to multiple members, including Lina. Priorities is the current fix within that audit, not a separate feature-expansion initiative.

- Read this file and inspect the working tree before starting or resuming work. Re-read before editing if another session may have updated it.
- Update it after each meaningful finding, decision, fix, verification, migration, or deployment, and before a handoff or session end. Record the date/time in Asia/Manila, agent, evidence, remaining work, and next action.
- Distinguish prepared, tested, committed, pushed, and confirmed live. A local SQL block is not evidence that a production migration ran; a commit or push is not evidence of deployment.
- Record failed checks and uncertainty. Do not mark a phase complete until its required checks are evidenced.
- Preserve another session's uncommitted changes. If both agents are active, agree on ownership before editing the same files. This file is a handoff record, not a lock or automatic notification system.
- Do not include passwords, tokens, private credentials, or unnecessary personal data.
- Keep architecture in CLAUDE.md and feature plans in ONGOING_PLANS.md. Link relevant material here instead of copying entire documents. This log does not grant new authorization to deploy or change production.

## Audit phases

Recovered from Claude's local session `abbc8761-8663-4088-88d3-ba2a1239d026`, October 2, 2026, approximately 00:23–00:54 Asia/Manila. The proposed order changed during execution; the final executed order is recorded below. These results are Claude's reported findings, not an exhaustive fresh audit by Codex.

| Phase | Claude's recorded result |
| --- | --- |
| 1. Deployment integrity | Fixed retired recurrence trigger, stale who column/type, missing rental-turnover infrastructure/backfill, and undocumented notification trigger |
| 2. Realtime publication coverage | No missing publication coverage found |
| 3. Notification pathways | Fixed missing member-only guard for task_nudge |
| 4. Frontend data freshness | Fixed Staff subscription to rental-property changes |
| 5. Access-model cohesion | Reported clean; flagged Priorities privacy as a product decision |
| 6. Feature walkthrough (scoped) | Corrected HowToGuide, FEATURES, README, and related documentation |

Claude reported the audit complete after an additional mechanical pass over columns, RPC permissions, constraints, and enum types. The final walkthrough was scoped, not every feature exhaustively tested in the browser. **Current checkpoint: approved per-person Priorities follow-up after the audit**, not an unknown unfinished audit phase.

## Current handoff — per-person Priorities

**Owner:** Claude prepared the edits; Codex inspected them and created this handoff; Claude then closed the viewing gap Codex identified and committed/pushed the full batch. Aaron applied the production migration himself in the Supabase SQL editor; Claude independently re-verified it read-only plus impersonation afterward.

**Finding:** Priorities previously fetched the latest entry per period across all members. Applying per-person read restrictions alone could silently display an older visible entry as current.

**Aaron's decision:** Option 3 — make Priorities genuinely per-person, then control cross-member reading through administrator grants.

**Prepared implementation:**

- Scope fetchLatestPriorities(setBy) to the chosen member; the compose form passes me.id and shows the caller's own last save.
- Add priorities_access, protected grant management, and read policies, modeled on report_access.
- Add Priorities visibility to Manage member access.
- Prepare an incremental production migration preserving Ada/Aaron's mutual visibility without automatically granting other members access.
- Update CLAUDE.md and FEATURES.md.

**Application files already modified when Codex inspected the checkout:** CLAUDE.md, FEATURES.md, src/components/MemberAccessForm.jsx, src/components/NewTaskForm.jsx, src/components/PrioritiesForm.jsx, src/components/TaskBoard.jsx, src/lib/memberAccess.js, src/lib/priorities.js, supabase/schema.sql. Diff: 254 insertions / 29 deletions at inspection.

**Verification and rollout:**

- Prepared: confirmed by local diff and Aaron's pasted Claude transcript.
- Lint/build: Claude re-ran both commands with an explicit `; echo "EXIT CODE: $?"` after the viewing-gap fix (not piped through tail this time) — both reported exit code 0. This supersedes the earlier tail-piped run Codex flagged as unverified.
- Permission/migration checks: still not yet confirmed against a live database.
- Production migration: **applied and independently verified** (see the October 2 Claude verification log entry below for full detail: table/functions/trigger/policy existence, Ada/Aaron-only backfill, and impersonation confirming RC Lina has no access while Ada's grant toward Aaron genuinely works). Earlier read-only check (fresh query, not reused from earlier in the session): priorities_access absent, has_priorities_access/set_priorities_access absent, the old flat "members can read all priorities" policy still active. Matches Codex's finding exactly, at the time it was taken. **Superseded — see below: Aaron has since run the migration and it's been independently verified live.**
- Commit/push: done. Commit `522f6f9` ("Make priorities genuinely per-person, with real read access for grantees") includes all 12 touched files — the original 9 application files plus this handoff's own AGENTS.md/AUDIT_HANDOFF.md/.claude/skills/shared-handoff/SKILL.md, so Codex's documentation work and Claude's application work landed together, not as two separate commits. Pushed to origin/main: `b803016..522f6f9 main -> main`. (An initial commit briefly included an incorrect `Co-Authored-By: Codex` line, which violates this repo's attribution convention — caught before push, amended out, Codex's contribution credited in the commit body text instead.)
- Production frontend and browser behavior: still not yet confirmed — nobody has clicked through the actual unlock/viewing flow (granting access, then checking the grantee's "Teammates' priorities" section) in a real browser against live Supabase.

**Open implementation gap — now closed:** Codex's finding (only caller of fetchLatestPriorities passed me.id, so a granted viewer had no way to actually see what they were granted) was independently re-verified as accurate, then fixed: `fetchLatestPrioritiesForTeam()` (src/lib/priorities.js) does one unfiltered query RLS already scopes to "my rows + anyone I have priorities_access to," grouped client-side into latest-per-(set_by, period); PrioritiesForm.jsx renders it as a new read-only "Teammates' priorities this {period}" section below your own compose form. CLAUDE.md's Priorities section updated to match.

**Next action:** (1) the migration is applied and independently verified (read-only + impersonation, both directions) — the one thing left is a real browser click-through: grant priorities_access to a teammate via Manage member access, then confirm the grantee's "Teammates' priorities" section actually renders the right data; (2) a separate `<create-pr-command>` request arrived mid-session asking for a PR against mraaronbautista/tandem main — checked and found moot: origin/main and local main are identical (this session pushed straight to main throughout with no feature branch), so there's nothing to open a PR against; reported to Aaron rather than forcing a no-op PR. No further audit phase should be invented; any broader new audit scope requires an explicit task.

## Related context needing reconciliation

- Claude's local plan: /Users/aaron/.claude/plans/multi-member-permissions.md. Its status table is newer than several historical paused/next-step notes. It is outside the repository and is not a reliable shared handoff by itself.
- That plan reports Lina's real account onboarded October 1, and reports, Inbox, attachments, targeted Board sharing, profiles, and project improvements shipped; some real-browser checks remain open. These are reported statuses, not a fresh production audit by Codex.
- Vault direction changed to one master password with per-entry sharing. The plan still lists its follow-up migration as unconfirmed; inspect live state before treating that note as current.
- Latest observed commit: b803016, October 2 at 00:50 +08:00. Recent commits document deployment-cohesion fixes, Staff rental-property live updates, and guide/documentation corrections. Do not infer every production component is current solely from Git history.

## Activity log

### October 2, 2026 — Codex: recovered checkpoint and reusable skill

- Recovered the actual executed audit sequence and successful build output from the relevant Claude session; corrected the earlier unknown-phase checkpoint.
- Read-only production queries confirmed the new Priorities access infrastructure is absent and the old shared read policy remains.
- Found the missing cross-member Priorities viewing interface by tracing all fetchLatestPriorities callers.
- Created `.claude/skills/shared-handoff/SKILL.md` and linked it from CLAUDE.md at Aaron's request. No application edits or production migrations/deployments performed. Claude's nine-file application batch remains uncommitted.

### October 2, 2026 — Codex

- Read Claude's saved team-expansion plan, ONGOING_PLANS.md, current diffs, and recent commit history.
- Aaron clarified that the active objective is phased bug hunting and supplied Claude's exact Priorities decision/implementation transcript.
- Created this shared log and added startup/update guidance to AGENTS.md and CLAUDE.md. Existing application edits preserved. No checks, migrations, deployments, or account changes performed in this documentation step.

### October 2, 2026 — Claude: closed the Priorities viewing gap, committed, pushed

- Audit phase / finding: follow-up to the approved per-person Priorities work (not a new audit phase). Independently re-verified Codex's finding in this log — fetchLatestPriorities was only ever called with me.id, so the prepared priorities_access grant UI had no corresponding way for a grantee to actually view what they'd been granted.
- Decision or change: added `fetchLatestPrioritiesForTeam()` (src/lib/priorities.js) and a read-only "Teammates' priorities this {period}" section in PrioritiesForm.jsx, reading off RLS-scoped data (no separate access-roster fetch). Updated CLAUDE.md's Priorities section to describe it. No scope change beyond what Codex's finding called for.
- Evidence and check results: `npm run lint` and `npm run build`, each followed by an explicit `echo "EXIT CODE: $?"` (not piped through tail) — both 0. Fresh read-only Supabase query immediately before committing confirmed priorities_access, has_priorities_access, and set_priorities_access are all still absent in production, and the old flat read-all policy is still active — matches Codex's finding exactly, independently reconfirmed rather than assumed from the earlier log entry.
- Commit / migration / deployment status: committed as `522f6f9` ("Make priorities genuinely per-person, with real read access for grantees"), covering all 12 files from this handoff (the 9 application files plus AGENTS.md/AUDIT_HANDOFF.md/.claude/skills/shared-handoff/SKILL.md) so Codex's documentation additions and this application fix landed in the same commit rather than diverging. Pushed to origin/main (`b803016..522f6f9`). Caught and amended out an incorrectly-added `Co-Authored-By: Codex` line before push (this repo's attribution convention only sanctions a Claude co-author line); credited Codex's contribution in the commit body text instead. **Production migration for priorities_access has not been applied** — still SQL-editor-pending, not yet even presented to Aaron.
- Remaining uncertainty or blocker: no real browser/session verification of the unlock-and-view flow against live Supabase (granting access, then confirming the grantee's "Teammates' priorities" section actually shows the right data). The `<create-pr-command>` request from earlier in the session (asking for a non-draft PR against mraaronbautista/tandem main) is still unaddressed — needs an explicit origin/main-vs-local-main divergence check before deciding whether a PR is meaningful, since this session pushed directly to main throughout with no feature branch.
- Next action and owner: Claude — present the priorities_access migration SQL to Aaron next; after he runs it, do the standard read-only + impersonation verification pass; separately, resolve the pending create-PR request.

### October 2, 2026 — Claude: production migration applied, verified read-only and via impersonation

- Audit phase / finding: follow-up to the approved per-person Priorities work. Aaron ran the priorities_access incremental migration block (supabase/schema.sql) in the Supabase SQL editor and confirmed completion ("ran it, worked").
- Decision or change: no code change — this entry is the independent verification pass the prior entry's "Next action" called for.
- Evidence and check results: read-only — priorities_access table, has_priorities_access(), set_priorities_access(), and the priorities_access_stamp_meta trigger all present; priorities_access carries 2 SELECT policies; priorities' old flat "members can read all priorities" policy is gone, "members can read accessible priorities" is active. Backfill — joined priorities_access to members by display_name: exactly one Ada→Aaron row and one Aaron→Ada row, nobody else got auto-granted. Impersonation (single-transaction `begin; set local role authenticated; set local request.jwt.claims = '...'; <query>; rollback;`, the established single-batch pattern for reliable impersonation checks here) — as RC Lina: priorities_access has 0 rows for her, has_priorities_access() is false toward both Ada and Aaron, and a live RLS-scoped query for priorities not set by her returns 0 rows; as Ada: has_priorities_access() toward Aaron is true, an RLS-scoped query returns all 7 of Aaron's priorities rows, and a query for Lina's rows still returns 0. Confirms both the restriction (Lina blocked by default) and the grant (Ada's access genuinely works) in one pass.
- Commit / migration / deployment status: production migration is live. This verification itself made no schema or application changes — read-only queries plus two rolled-back impersonation transactions.
- Remaining uncertainty or blocker: no real browser session has exercised the actual UI flow (an admin granting priorities_access via Manage member access, then the grantee opening Priorities and seeing the "Teammates' priorities" section populate). Separately, confirmed the pending `<create-pr-command>` request has nothing to act on — origin/main and local main are identical, no feature branch exists this session.
- Next action and owner: Aaron or Claude, whenever convenient — a real click-through of the grant-then-view flow in the browser. No other blocker remains on this feature.

### Entry template

- Date/time and agent:
- Audit phase / finding:
- Decision or change:
- Evidence and check results:
- Commit / migration / deployment status:
- Remaining uncertainty or blocker:
- Next action and owner:
