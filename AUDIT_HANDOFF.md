# Tandem — shared bug audit and handoff

Last updated: October 2, 2026 (Asia/Manila), by Codex.

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

**Owner:** Claude prepared the edits; Codex inspected them and created this handoff. No application edits made by Codex in this handoff session.

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
- Lint/build: recovered Claude tool output at October 2, 01:03 Asia/Manila shows seven Fast Refresh lint warnings and a successful Vite build with a chunk-size warning. Not independently rerun by Codex; Claude's command piped output through tail, so its shell exit status alone is not proof of both checks' exit codes.
- Permission/migration checks: not yet confirmed.
- Production migration: Codex's live read-only schema check confirmed priorities_access absent, both access functions absent, and the old members-can-read-all-priorities policy still active. Migration not applied at that check.
- Commit/push: these nine files were uncommitted at inspection.
- Production frontend and browser behavior: not yet confirmed.

**Open implementation gap:** the only caller of fetchLatestPriorities passes me.id. Administrator read grants exist in the prepared UI/backend, but there is no interface to view another member's priorities. Review the intended viewing experience before treating the approved per-person feature as complete.

**Next action:** review the viewing gap and migration/permission behavior, then finish the approved Priorities follow-up within the user's authorization. No further audit phase should be invented; any broader new audit scope requires an explicit task.

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

### Entry template

- Date/time and agent:
- Audit phase / finding:
- Decision or change:
- Evidence and check results:
- Commit / migration / deployment status:
- Remaining uncertainty or blocker:
- Next action and owner:
