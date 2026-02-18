# 📋 todoist-cli

Agent-first CLI for [Todoist](https://todoist.com). HATEOAS JSON output, zero config, built for AI agents that manage tasks.

Built on the [official Todoist TypeScript SDK](https://github.com/Doist/todoist-api-typescript) (v6). No reverse-engineered APIs, no fragile sync protocols.

## Install

**One-liner** (macOS / Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/joelhooks/todoist-cli/main/install.sh | bash
```

Detects OS and architecture automatically. Installs to `/usr/local/bin` by default.

Install somewhere else:

```bash
TODOIST_CLI_DIR=~/bin curl -fsSL https://raw.githubusercontent.com/joelhooks/todoist-cli/main/install.sh | bash
```

**From source** (requires [Bun](https://bun.sh)):

```bash
git clone https://github.com/joelhooks/todoist-cli.git
cd todoist-cli
bun install
ln -s "$(pwd)/src/cli.ts" ~/bin/todoist-cli
```

**Prebuilt binaries**: [GitHub Releases](https://github.com/joelhooks/todoist-cli/releases) — darwin-arm64, darwin-x64, linux-x64, linux-arm64.

## Auth

Set `TODOIST_API_TOKEN` env var, or store in [agent-secrets](https://github.com/joelhooks/agent-secrets):

```bash
secrets add todoist_api_token
# Paste your token from https://app.todoist.com/app/settings/integrations/developer
```

The CLI leases the token automatically via `secrets lease todoist_api_token`.

## Usage

Every command returns JSON. No plain text, no tables, no `--json` flag. Agents parse JSON; humans pipe through `jq`.

```bash
todoist-cli                    # Self-documenting command tree
todoist-cli today              # Today's tasks
todoist-cli inbox              # Inbox (needs triage)
todoist-cli review             # Daily review: today, inbox, overdue, project breakdown
todoist-cli list               # All active tasks
todoist-cli list --filter "p1" # Todoist filter query
todoist-cli list --project ID  # Tasks in a project
todoist-cli list --label X     # Tasks with label

todoist-cli add "Buy groceries" --due tomorrow --project ID --description "Milk, eggs, bread"
todoist-cli complete ID        # Complete a task
todoist-cli update ID --content "New title" --due "next monday"
todoist-cli move ID --project ID
todoist-cli delete ID          # Permanent delete
todoist-cli reopen ID          # Reopen completed task
todoist-cli show ID            # Task detail + comments

todoist-cli projects           # List all projects
todoist-cli sections --project ID
todoist-cli labels
todoist-cli add-project "Name" --color blue
todoist-cli add-section "Name" --project ID
```

## Response Format

Every response follows the HATEOAS envelope:

```json
{
  "ok": true,
  "command": "todoist-cli today",
  "result": {
    "count": 3,
    "tasks": [
      {
        "id": "abc123",
        "content": "Ship the feature",
        "description": "ADR-0046. Wire the CLI.",
        "priority": 1,
        "due": "2026-02-18",
        "dueString": "today",
        "labels": ["agent"],
        "projectId": "xyz789",
        "url": "https://app.todoist.com/app/task/..."
      }
    ]
  },
  "next_actions": [
    { "command": "todoist-cli inbox", "description": "Check inbox" },
    { "command": "todoist-cli complete abc123", "description": "Complete a task" }
  ]
}
```

Errors include a fix suggestion:

```json
{
  "ok": false,
  "error": "No TODOIST_API_TOKEN env var and secrets lease failed. Run: secrets add todoist_api_token"
}
```

## Why This Exists

[Things 3](https://culturedcode.com/things/) is a beautiful app with a reverse-engineered, event-sourced sync protocol that corrupts when you write unicode em-dashes in task descriptions. The iOS client crashes and history is immutable — there's no delete API for sync events.

Todoist has an official, documented REST API. Markdown in descriptions works. No crashes. This CLI wraps it for agent consumption.

## Design Principles

From the [cli-design skill](https://github.com/joelhooks/joelclaw):

1. **JSON always** — no plain text, no tables, no ANSI
2. **HATEOAS** — every response includes `next_actions`
3. **Self-documenting** — root command returns the full command tree
4. **Context-protecting** — terse output, auto-truncation for large lists
5. **Errors suggest fixes** — never just "something went wrong"

## Stack

- [Bun](https://bun.sh) runtime
- [@doist/todoist-api-typescript](https://github.com/Doist/todoist-api-typescript) v6 (official SDK)
- [agent-secrets](https://github.com/joelhooks/agent-secrets) for credential management

## License

MIT

## Credits

- [Todoist](https://todoist.com) and [Doist](https://doist.com) for the API and SDK
- Things 3 by [Cultured Code](https://culturedcode.com) for the lesson in fragile sync protocols
