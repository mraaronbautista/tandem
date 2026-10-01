---
name: shared-handoff
description: Reconcile and maintain Tandem's shared work record when resuming Claude or Codex work, switching agents, checking progress, finishing a work checkpoint, or preparing a session handoff.
---

# Shared work handoff

Maintain `AUDIT_HANDOFF.md` at the repository root as the current checkpoint and concise journey log. This skill records work; it does not authorize application changes, commits, production migrations, deployments, or messages to another agent.

## Reconcile on resume

Read the shared log, current working-tree status/diff, and relevant plan or conversation evidence. Inspect recent commits where needed. Do not scan unrelated private histories or expose credentials. Recover the actual agreed phases; distinguish a bug-audit checklist from a feature-delivery plan. If the phase cannot be established, record the uncertainty rather than inventing one.

Use current user decisions to establish intended behavior, code to establish prepared implementation, check results to establish verification, and live read-only evidence to establish production state. A historical assertion that something is live remains **reported live** until independently confirmed; code present in a checkout is not proof of deployment. Preserve discrepancies instead of smoothing them into a confident recap.

If the user requested alignment or inspection first, return the checkpoint before implementation. Otherwise continue only within the already-authorized scope; do not add a new approval gate for ordinary work.

## Maintain after meaningful work

Update after a finding, product decision, fix, verification result, migration, or deployment, and before ending or handing off. Capture checkpoints while working rather than relying on a final write after a session limit.

Keep the top-level checkpoint short:
- Objective and actual phase, or follow-up after completed phases.
- Latest approved decisions and why they matter.
- Current owner and files/work in progress.
- Separate statuses: prepared, checks passed/failed/not run, committed, pushed, confirmed live or unconfirmed.
- Open findings, limitations, and next concrete action.

Append a concise dated entry with agent, change/decision, evidence, outstanding work, and next action. Use Asia/Manila dates and times. Include commit IDs, file paths, relevant check summaries, and migration/deployment identifiers when available; never passwords or tokens. Keep architecture details in CLAUDE.md and feature plans in ONGOING_PLANS.md rather than duplicating them here.

Before writing, re-read the log and working-tree status. Merge new information without overwriting another agent's edits or attributing their work to yourself. If simultaneous changes conflict, establish ownership before editing the same files. This document is not a lock or automatic synchronization channel.

## Evidence examples

Good: “Frontend prepared; lint passed with existing warnings. Live schema query found the access table absent. Migration pending.”

Bad: “Feature done,” based only on edited files or a successful build.

Good: “Claude reported the six audit phases complete, with a scoped final walkthrough. A separate approved Priorities follow-up remains unfinished.”

Bad: treating all features as exhaustively browser-tested because a mechanical audit finished.

## Finish

Report the current checkpoint, changes to the log, unverified items, and next action. Do not mark unknown work complete, redo migrations without checking live state, or silently broaden the task to resolve every historical issue.
