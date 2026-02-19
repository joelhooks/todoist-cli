---
name: todoist
description: "Manage Todoist tasks, projects, comments, reminders, and activity via the todoist-cli agent CLI. Use when: 'add a task', 'what's due today', 'check my inbox', 'complete a task', 'todoist', 'todo', 'task list', 'what did I finish', 'add a comment', 'set a reminder', 'daily review', 'search tasks', 'move task to project', 'what's overdue', or any task management request. All output is HATEOAS JSON with next_actions — parse result.tasks, result.comments, etc."
---

# Todoist CLI (todoist-cli)

Agent-first Todoist CLI. All output is structured JSON with `next_actions` hints.

## Auth

Token resolves automatically: `TODOIST_API_TOKEN` env var → `secrets lease todoist_api_token` (agent-secrets).

## Ref Resolution

All `<ref>` args accept: **task name** (fuzzy matched), **Todoist URL**, **`id:xxx`**, or **raw ID**.
Project args (`--project`) also resolve by name.

```bash
todoist-cli complete "Buy milk"                                    # by name
todoist-cli show https://app.todoist.com/app/task/buy-milk-8abc    # by URL
todoist-cli show id:6g3VHV5HJGvJmPhw                              # by id: prefix
```

Ambiguous matches return an error listing candidates with IDs.

## Priority Mapping

p1 (highest) = API value 4, p2 = 3, p3 = 2, p4 (default) = 1.

## Commands

### Daily Workflow

```bash
todoist-cli today                         # tasks due today + overdue
todoist-cli inbox                         # inbox tasks needing triage
todoist-cli review                        # full dashboard: today, inbox, overdue, floating, project breakdown
```

### Search & Browse

```bash
todoist-cli search "deploy"               # full-text search
todoist-cli list --filter "priority 1 & today"
todoist-cli list --project "Agent Work"   # by project name
todoist-cli list --label "urgent"
todoist-cli show <ref>                    # task detail + comments
```

### Task CRUD

```bash
todoist-cli add "Ship media pipeline" --due tomorrow --project "Agent Work" --priority 2
todoist-cli add "Buy groceries" --due "every saturday" --labels "errands,home"
todoist-cli add "Sub-task" --parent <taskId>
todoist-cli complete <ref>
todoist-cli reopen <ref>
todoist-cli update <ref> --content "New title" --due "next monday" --priority 3
todoist-cli move <ref> --project "Done"
todoist-cli delete <ref>
```

Add flags: `--due`, `--deadline YYYY-MM-DD`, `--project NAME`, `--section ID`, `--parent ID`, `--priority 1-4`, `--labels a,b`, `--description`.

### Comments (Async Conversations)

Critical for agent ↔ human async threads on tasks.

```bash
todoist-cli comments <ref>                              # list comments on a task
todoist-cli comment-add <ref> --content "Started work"  # add a comment
todoist-cli comment-update <commentId> --content "Done" # update
todoist-cli comment-delete <commentId>                  # delete
```

### Reminders

```bash
todoist-cli reminders <ref>                             # list reminders
todoist-cli reminder-add <ref> --before 30m             # 30 min before due
todoist-cli reminder-add <ref> --at 2026-02-20T10:00    # specific time
todoist-cli reminder-delete <reminderId>
```

Duration format: `30m`, `1h`, `2h30m`.

### Activity & History

```bash
todoist-cli activity                                    # recent activity
todoist-cli activity --since 2026-02-18 --event completed
todoist-cli activity --project "Agent Work" --type task --limit 20
todoist-cli completed                                   # completed today
todoist-cli completed --since 2026-02-17 --project "Agent Work"
```

Activity filters: `--since`, `--until`, `--type` (task|comment|project), `--event` (added|completed|updated|deleted), `--project NAME`, `--limit N`.

### Organization

```bash
todoist-cli projects                                    # list all projects
todoist-cli sections --project "Agent Work"             # sections by project name
todoist-cli labels                                      # list all labels
todoist-cli add-project "New Project" --color blue --parent "Parent"
todoist-cli add-section "Backlog" --project "Agent Work"
```

## Output Format

Every response:

```json
{
  "ok": true,
  "command": "todoist-cli <cmd>",
  "result": { ... },
  "next_actions": [
    { "command": "todoist-cli ...", "description": "..." }
  ]
}
```

Errors: `{ "ok": false, "error": "message" }`.

Parse `result.tasks[].id` for IDs, `result.count` for totals, `next_actions` for what to do next.

## Common Agent Patterns

### Morning Review
```bash
todoist-cli review    # get full dashboard, triage inbox, check overdue
```

### Capture from Conversation
When user mentions something actionable:
```bash
todoist-cli add "Deploy the media pipeline" --due tomorrow --project "Agent Work" --priority 2
```

### Async Agent Thread
Agent leaves a question as a comment, user replies later:
```bash
todoist-cli comment-add "Deploy pipeline" --content "Should I deploy to staging first, or straight to prod?"
# ... later ...
todoist-cli comments "Deploy pipeline"   # check for user's reply
```

### Weekly Retrospective
```bash
todoist-cli completed --since 2026-02-12 --until 2026-02-19
todoist-cli activity --since 2026-02-12 --event completed --limit 50
```
