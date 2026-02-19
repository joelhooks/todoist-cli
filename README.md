# todoist-cli

Agent-first Todoist CLI. HATEOAS JSON responses, `agent-secrets` auth, ref resolution by name/URL/ID.

## Why This Exists (vs the official Doist CLI)

Todoist ships an [official CLI](https://github.com/Doist/todoist-cli) (`td`) — it's excellent for humans at a terminal. Colored output, interactive prompts, shell completions, markdown rendering.

This CLI is for **agents**. Every response is structured JSON with `next_actions` hints (HATEOAS), so an LLM knows what it can do next without reading a man page. Auth flows through `agent-secrets` with TTL-scoped leases. No chalk, no spinners, no prompts — just parseable output.

| | `td` (Doist/todoist-cli) | `todoist-cli` (this) |
|---|---|---|
| **Audience** | Humans in a terminal | AI agents, gateway daemons, tool calls |
| **Output** | Colored text, markdown | HATEOAS JSON with `next_actions` |
| **Auth** | OAuth PKCE browser flow | `TODOIST_API_TOKEN` env var or `agent-secrets` lease |
| **Ref resolution** | ✅ Name, URL, `id:`, fuzzy | ✅ Same (ported from Doist CLI, MIT) |
| **Comments** | ✅ Full CRUD | ✅ Full CRUD |
| **Reminders** | ✅ via REST API | ✅ via Sync API |
| **Activity** | ✅ | ✅ |
| **Shell completions** | ✅ bash/zsh/fish | ❌ (agents don't tab-complete) |
| **Skill installer** | ✅ `td skill install claude-code` | ❌ (agents read the JSON help output) |
| **Workspaces** | ✅ | ❌ (single-user) |
| **Dependencies** | Commander, chalk, ora, tabtab | Just `@doist/todoist-api-typescript` |
| **Runtime** | Node.js | Bun |

**Use the official CLI** if you're a human typing in a terminal.  
**Use this CLI** if you're an agent calling tools in a pipeline.

Ref resolution pattern credit: [Doist/todoist-cli](https://github.com/Doist/todoist-cli) `src/lib/refs.ts` (MIT license).

## Install

**One-liner** (downloads prebuilt binary from GitHub Releases):

```bash
curl -fsSL https://raw.githubusercontent.com/joelhooks/todoist-cli/main/install.sh | bash
```

Detects OS/arch, installs to `/usr/local/bin`. Override with `TODOIST_CLI_DIR`:

```bash
curl -fsSL https://raw.githubusercontent.com/joelhooks/todoist-cli/main/install.sh | TODOIST_CLI_DIR=~/.local/bin bash
```

**From source** (requires [Bun](https://bun.sh)):

```bash
git clone https://github.com/joelhooks/todoist-cli.git
cd todoist-cli
bun install
bun link
```

**Build standalone binary**:

```bash
bun build --compile src/cli.ts --outfile todoist-cli
```

## Auth

```bash
# Option 1: env var
export TODOIST_API_TOKEN="your-token"

# Option 2: agent-secrets (auto-leased with TTL)
secrets add todoist_api_token

# Get your token: https://app.todoist.com/app/settings/integrations/developer
```

## Usage

All `<ref>` args accept: **task name**, **Todoist URL**, **`id:xxx`**, or **raw ID**.

```bash
# Tasks
todoist-cli today                                     # due today + overdue
todoist-cli inbox                                     # inbox (needs triage)
todoist-cli search "deploy pipeline"                  # full-text search
todoist-cli list --project "Agent Work"               # tasks in project (by name!)
todoist-cli list --filter "priority 1 & today"        # Todoist filter query
todoist-cli show "Qdrant upsert"                      # task detail + comments
todoist-cli add "Ship the media pipeline" --due tomorrow --project "Agent Work" --priority 2
todoist-cli complete "Ship the media pipeline"        # by name
todoist-cli update "Ship the media pipeline" --due "next monday"
todoist-cli move "Ship the media pipeline" --project "Joel's Tasks"
todoist-cli delete "Ship the media pipeline"
todoist-cli reopen <ref>

# Comments (critical for async agent conversations — ADR-0047)
todoist-cli comments "Qdrant upsert"                  # list comments on task
todoist-cli comment-add "Qdrant upsert" --content "Started implementation"
todoist-cli comment-update <commentId> --content "Updated note"
todoist-cli comment-delete <commentId>

# Reminders
todoist-cli reminders "Deploy pipeline"               # list reminders
todoist-cli reminder-add "Deploy pipeline" --before 30m
todoist-cli reminder-add "Deploy pipeline" --at 2026-02-20T10:00
todoist-cli reminder-delete <reminderId>

# Activity
todoist-cli activity --since 2026-02-18 --event completed
todoist-cli activity --project "Agent Work" --limit 10
todoist-cli completed --since 2026-02-17              # completed tasks

# Organization
todoist-cli review                                    # daily dashboard
todoist-cli projects                                  # list all projects
todoist-cli sections --project "Agent Work"           # sections by project name
todoist-cli labels
todoist-cli add-project "New Project" --color blue
todoist-cli add-section "Backlog" --project "Agent Work"
```

## Output Format

Every response is JSON:

```json
{
  "ok": true,
  "command": "todoist-cli complete",
  "result": {
    "completed": {
      "id": "6g3VHV5HJGvJmPhw",
      "content": "Ship the media pipeline",
      "priority": 2
    }
  },
  "next_actions": [
    { "command": "todoist-cli today", "description": "View remaining today tasks" }
  ]
}
```

Errors:

```json
{
  "ok": false,
  "error": "Ambiguous task \"deploy\". Matches:\n  \"Deploy pipeline\" (id:abc)\n  \"Deploy worker\" (id:def)"
}
```
