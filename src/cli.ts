#!/usr/bin/env bun
/**
 * todoist-cli — Agent-first Todoist CLI
 *
 * HATEOAS JSON responses. Bearer token auth via agent-secrets.
 * Wraps @doist/todoist-api-typescript v6 (official SDK).
 *
 * Usage: todoist-cli <command> [options]
 */

import { TodoistApi } from "@doist/todoist-api-typescript";
import { execSync } from "node:child_process";

// ── Types (from SDK) ────────────────────────────────────────────────

type Task = {
  id: string;
  content: string;
  description: string;
  priority: number;
  due: { date: string; datetime?: string | null; string: string; isRecurring: boolean } | null;
  deadline: { date: string } | null;
  labels: string[];
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  url: string;
  isCompleted?: boolean;
};

// ── Auth ────────────────────────────────────────────────────────────

function getToken(): string {
  // 1. Env var (works everywhere)
  const env = process.env.TODOIST_API_TOKEN;
  if (env) return env;

  // 2. agent-secrets (optional — only if `secrets` CLI is available)
  try {
    const token = execSync("secrets lease todoist_api_token --ttl 1h 2>/dev/null", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (token) return token;
  } catch {
    // agent-secrets not installed or not configured — that's fine
  }

  fatal(
    "No TODOIST_API_TOKEN found. Set it via:\n" +
    "  export TODOIST_API_TOKEN=<token>          # env var\n" +
    "  secrets add todoist_api_token              # agent-secrets (optional)\n" +
    "Get your token at: https://app.todoist.com/app/settings/integrations/developer"
  );
}

function getApi(): TodoistApi {
  return new TodoistApi(getToken());
}

// ── Output ──────────────────────────────────────────────────────────

function ok(command: string, result: unknown, nextActions?: { command: string; description: string }[]) {
  console.log(JSON.stringify({
    ok: true,
    command: `todoist-cli ${command}`,
    result,
    ...(nextActions ? { next_actions: nextActions } : {}),
  }, null, 2));
}

function fatal(message: string): never {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

// ── Commands ────────────────────────────────────────────────────────

async function cmdToday() {
  const api = getApi();
  const { results: tasks } = await api.getTasksByFilter({ query: "today" });
  ok("today", {
    count: tasks.length,
    tasks: tasks.map(formatTask),
  }, [
    { command: "todoist-cli inbox", description: "Check inbox" },
    { command: "todoist-cli complete <id>", description: "Complete a task" },
  ]);
}

async function cmdInbox() {
  const api = getApi();
  const { results: projects } = await api.getProjects();
  const inbox = projects.find((p: any) => p.isInboxProject);
  if (!inbox) return fatal("No inbox project found");

  const { results: tasks } = await api.getTasks({ projectId: inbox.id });
  ok("inbox", {
    count: tasks.length,
    projectId: inbox.id,
    tasks: tasks.map(formatTask),
  }, [
    { command: "todoist-cli add 'Task title'", description: "Add to inbox" },
    { command: "todoist-cli complete <id>", description: "Complete a task" },
  ]);
}

async function cmdList(opts: { filter?: string; project?: string; label?: string }) {
  const api = getApi();
  let tasks: Task[];
  let label = "all";

  if (opts.filter) {
    const resp = await api.getTasksByFilter({ query: opts.filter });
    tasks = resp.results as Task[];
    label = `filter: ${opts.filter}`;
  } else {
    const args: any = {};
    if (opts.project) args.projectId = opts.project;
    if (opts.label) args.label = opts.label;
    const resp = await api.getTasks(args);
    tasks = resp.results as Task[];
    if (opts.project) label = `project: ${opts.project}`;
    if (opts.label) label = `label: ${opts.label}`;
  }

  ok("list", {
    filter: label,
    count: tasks.length,
    tasks: tasks.map(formatTask),
  });
}

async function cmdProjects() {
  const api = getApi();
  const { results: projects } = await api.getProjects();
  ok("projects", {
    count: projects.length,
    projects: projects.map((p: any) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isInbox: p.isInboxProject ?? false,
      isFavorite: p.isFavorite,
      url: p.url,
    })),
  }, [
    { command: "todoist-cli list --project <id>", description: "List tasks in a project" },
  ]);
}

async function cmdSections(projectId?: string) {
  const api = getApi();
  const { results: sections } = await api.getSections(projectId ? { projectId } : undefined);
  ok("sections", {
    count: sections.length,
    sections: sections.map((s: any) => ({
      id: s.id,
      name: s.name,
      projectId: s.projectId,
      order: s.order ?? s.childOrder,
    })),
  });
}

async function cmdLabels() {
  const api = getApi();
  const { results: labels } = await api.getLabels();
  ok("labels", {
    count: labels.length,
    labels: labels.map((l: any) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      isFavorite: l.isFavorite,
    })),
  });
}

async function cmdAdd(content: string, opts: AddOpts) {
  const api = getApi();
  const args: any = { content };
  if (opts.description) args.description = opts.description;
  if (opts.project) args.projectId = opts.project;
  if (opts.section) args.sectionId = opts.section;
  if (opts.due) args.dueString = opts.due;
  if (opts.deadline) args.deadlineDate = opts.deadline;
  if (opts.priority) args.priority = parseInt(opts.priority);
  if (opts.labels) args.labels = opts.labels.split(",").map((l: string) => l.trim());
  if (opts.parent) args.parentId = opts.parent;

  const task = await api.addTask(args);
  ok("add", formatTask(task as Task), [
    { command: `todoist-cli complete ${task.id}`, description: "Complete this task" },
    { command: "todoist-cli today", description: "View today's tasks" },
  ]);
}

async function cmdComplete(id: string) {
  const api = getApi();
  const task = await api.getTask(id);
  await api.closeTask(id);
  ok("complete", {
    completed: formatTask(task as Task),
  }, [
    { command: "todoist-cli today", description: "View remaining today tasks" },
  ]);
}

async function cmdReopen(id: string) {
  const api = getApi();
  await api.reopenTask(id);
  const task = await api.getTask(id);
  ok("reopen", { task: formatTask(task as Task) });
}

async function cmdDelete(id: string) {
  const api = getApi();
  const task = await api.getTask(id);
  await api.deleteTask(id);
  ok("delete", {
    deleted: { id: task.id, content: task.content },
  });
}

async function cmdUpdate(id: string, opts: UpdateOpts) {
  const api = getApi();
  const args: any = {};
  if (opts.content) args.content = opts.content;
  if (opts.description) args.description = opts.description;
  if (opts.due) args.dueString = opts.due;
  if (opts.deadline) args.deadlineDate = opts.deadline;
  if (opts.priority) args.priority = parseInt(opts.priority);
  if (opts.labels) args.labels = opts.labels.split(",").map((l: string) => l.trim());

  const task = await api.updateTask(id, args);
  ok("update", formatTask(task as Task));
}

async function cmdMove(id: string, opts: { project?: string; section?: string; parent?: string }) {
  const api = getApi();
  const args: any = {};
  if (opts.project) args.projectId = opts.project;
  if (opts.section) args.sectionId = opts.section;
  if (opts.parent) args.parentId = opts.parent;

  const task = await api.moveTask(id, args);
  ok("move", formatTask(task as Task));
}

async function cmdShow(id: string) {
  const api = getApi();
  const task = await api.getTask(id);
  const { results: comments } = await api.getComments({ taskId: id });
  ok("show", {
    ...formatTask(task as Task),
    description: task.description || undefined,
    comments: comments.map((c: any) => ({
      id: c.id,
      content: c.content,
      postedAt: c.postedAt,
    })),
  });
}

async function cmdAddProject(name: string, opts: { color?: string; favorite?: boolean; parent?: string }) {
  const api = getApi();
  const args: any = { name };
  if (opts.color) args.color = opts.color;
  if (opts.favorite) args.isFavorite = true;
  if (opts.parent) args.parentId = opts.parent;

  const project = await api.addProject(args);
  ok("add-project", {
    id: project.id,
    name: project.name,
    color: project.color,
    url: (project as any).url,
  });
}

async function cmdAddSection(name: string, projectId: string, opts: { order?: string }) {
  const api = getApi();
  const section = await api.addSection({
    name,
    projectId,
    order: opts.order ? parseInt(opts.order) : undefined,
  });
  ok("add-section", {
    id: section.id,
    name: section.name,
    projectId: section.projectId,
  });
}

async function cmdReview() {
  const api = getApi();

  const [todayResp, allResp, projResp] = await Promise.all([
    api.getTasksByFilter({ query: "today" }),
    api.getTasks(),
    api.getProjects(),
  ]);

  const todayTasks = todayResp.results as Task[];
  const allTasks = allResp.results as Task[];
  const projects = projResp.results;

  // Inbox
  const inbox = projects.find((p: any) => p.isInboxProject);
  const inboxTasks = inbox ? allTasks.filter(t => t.projectId === inbox.id) : [];

  // Overdue
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = allTasks.filter(t => {
    if (!t.due?.date) return false;
    return new Date(t.due.date) < today;
  });

  // No due date
  const noDue = allTasks.filter(t => !t.due);

  ok("review", {
    today: { count: todayTasks.length, tasks: todayTasks.map(formatTask) },
    inbox: { count: inboxTasks.length, tasks: inboxTasks.map(formatTask) },
    overdue: { count: overdue.length, tasks: overdue.map(formatTask) },
    floating: { count: noDue.length },
    projects: projects.filter((p: any) => !p.isInboxProject).map((p: any) => ({
      id: p.id,
      name: p.name,
      taskCount: allTasks.filter(t => t.projectId === p.id).length,
    })),
    total: allTasks.length,
  }, [
    { command: "todoist-cli inbox", description: "Process inbox to zero" },
    { command: "todoist-cli complete <id>", description: "Complete a task" },
    { command: "todoist-cli add 'task' --due today", description: "Add a task for today" },
  ]);
}

// ── Formatting ──────────────────────────────────────────────────────

function formatTask(t: Task) {
  return {
    id: t.id,
    content: t.content,
    description: t.description || undefined,
    priority: t.priority,
    due: t.due?.date ?? t.due?.datetime ?? null,
    dueString: t.due?.string ?? null,
    isRecurring: t.due?.isRecurring ?? false,
    deadline: t.deadline?.date ?? null,
    labels: t.labels?.length ? t.labels : undefined,
    projectId: t.projectId,
    sectionId: t.sectionId ?? undefined,
    parentId: t.parentId ?? undefined,
    url: t.url,
  };
}

// ── CLI Parser ──────────────────────────────────────────────────────

interface AddOpts {
  description?: string;
  project?: string;
  section?: string;
  parent?: string;
  due?: string;
  deadline?: string;
  priority?: string;
  labels?: string;
}

interface UpdateOpts {
  content?: string;
  description?: string;
  due?: string;
  deadline?: string;
  priority?: string;
  labels?: string;
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

function getNonFlagArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      // Skip flag + its value
      const next = args[i + 1];
      if (next && !next.startsWith("--")) i++;
      continue;
    }
    result.push(args[i]);
  }
  return result;
}

function usage(): never {
  ok("help", {
    version: "0.1.0",
    auth: "TODOIST_API_TOKEN env var or 'secrets lease todoist_api_token'",
    commands: {
      "today": "Show today's tasks",
      "inbox": "Show inbox (needs triage)",
      "list [--filter X] [--project ID] [--label X]": "List tasks with optional filters",
      "review": "Daily review: today, inbox, overdue, project breakdown",
      "show <id>": "Show task detail + comments",
      "add 'content' [--due X] [--deadline YYYY-MM-DD] [--project ID] [--section ID] [--parent ID] [--priority 1-4] [--labels a,b] [--description X]": "Create a task",
      "complete <id>": "Complete a task",
      "reopen <id>": "Reopen a completed task",
      "update <id> [--content X] [--due X] [--priority 1-4] [--labels a,b] [--description X]": "Update a task",
      "move <id> --project ID | --section ID | --parent ID": "Move a task",
      "delete <id>": "Delete a task permanently",
      "projects": "List all projects",
      "sections [--project ID]": "List sections",
      "labels": "List all labels",
      "add-project 'name' [--color X] [--favorite] [--parent ID]": "Create a project",
      "add-section 'name' --project ID [--order N]": "Create a section in a project",
    },
  });
  process.exit(0);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const cmd = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest);
  const pos = getNonFlagArgs(rest);

  try {
    switch (cmd) {
      case "today":
        return await cmdToday();
      case "inbox":
        return await cmdInbox();
      case "list":
        return await cmdList({ filter: flags.filter, project: flags.project, label: flags.label });
      case "review":
        return await cmdReview();
      case "show":
        if (!pos[0]) fatal("Usage: todoist-cli show <id>");
        return await cmdShow(pos[0]);
      case "add":
        if (!pos[0]) fatal("Usage: todoist-cli add 'content' [--due X] [--project ID] ...");
        return await cmdAdd(pos[0], {
          description: flags.description,
          project: flags.project,
          section: flags.section,
          parent: flags.parent,
          due: flags.due,
          deadline: flags.deadline,
          priority: flags.priority,
          labels: flags.labels,
        });
      case "complete":
        if (!pos[0]) fatal("Usage: todoist-cli complete <id>");
        return await cmdComplete(pos[0]);
      case "reopen":
        if (!pos[0]) fatal("Usage: todoist-cli reopen <id>");
        return await cmdReopen(pos[0]);
      case "update":
        if (!pos[0]) fatal("Usage: todoist-cli update <id> [--content X] ...");
        return await cmdUpdate(pos[0], {
          content: flags.content,
          description: flags.description,
          due: flags.due,
          deadline: flags.deadline,
          priority: flags.priority,
          labels: flags.labels,
        });
      case "move":
        if (!pos[0]) fatal("Usage: todoist-cli move <id> --project ID | --section ID | --parent ID");
        return await cmdMove(pos[0], { project: flags.project, section: flags.section, parent: flags.parent });
      case "delete":
        if (!pos[0]) fatal("Usage: todoist-cli delete <id>");
        return await cmdDelete(pos[0]);
      case "projects":
        return await cmdProjects();
      case "sections":
        return await cmdSections(flags.project);
      case "labels":
        return await cmdLabels();
      case "add-project":
        if (!pos[0]) fatal("Usage: todoist-cli add-project 'name' [--color X]");
        return await cmdAddProject(pos[0], {
          color: flags.color,
          favorite: flags.favorite === "true",
          parent: flags.parent,
        });
      case "add-section":
        if (!pos[0] || !flags.project) fatal("Usage: todoist-cli add-section 'name' --project ID");
        return await cmdAddSection(pos[0], flags.project, { order: flags.order });
      case "help":
      case "--help":
      case "-h":
        return usage();
      default:
        fatal(`Unknown command: ${cmd}. Run 'todoist-cli help' for usage.`);
    }
  } catch (err: any) {
    fatal(`${cmd} failed: ${err.message ?? String(err)}`);
  }
}

main();
// TEMP: not reached via main() yet
