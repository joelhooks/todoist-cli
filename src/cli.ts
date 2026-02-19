#!/usr/bin/env bun
/**
 * todoist-cli — Agent-first Todoist CLI
 *
 * HATEOAS JSON responses. Bearer token auth via agent-secrets.
 * Wraps @doist/todoist-api-typescript v6 (official SDK).
 *
 * Ref resolution inspired by Doist/todoist-cli (MIT) — refs.ts pattern.
 * Supports: name, URL, id:xxx prefix, raw ID, fuzzy substring match.
 *
 * Usage: todoist-cli <command> [options]
 */

import { TodoistApi } from "@doist/todoist-api-typescript";
import { execSync } from "node:child_process";

// ── Types ───────────────────────────────────────────────────────────

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

type Comment = {
  id: string;
  content: string;
  postedAt: string;
  taskId?: string;
  projectId?: string;
  fileAttachment?: { fileName?: string; fileUrl?: string; fileType?: string } | null;
};

// ── Auth ────────────────────────────────────────────────────────────

function getToken(): string {
  const env = process.env.TODOIST_API_TOKEN;
  if (env) return env;

  try {
    const token = execSync("secrets lease todoist_api_token --ttl 1h 2>/dev/null", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (token) return token;
  } catch { /* agent-secrets not available */ }

  fatal(
    "No TODOIST_API_TOKEN found. Set it via:\n" +
    "  export TODOIST_API_TOKEN=<token>          # env var\n" +
    "  secrets add todoist_api_token              # agent-secrets\n" +
    "Get your token at: https://app.todoist.com/app/settings/integrations/developer"
  );
}

function getApi(): TodoistApi {
  return new TodoistApi(getToken());
}

// ── Output (HATEOAS) ────────────────────────────────────────────────

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

// ── Ref Resolution ──────────────────────────────────────────────────
// Credit: Doist/todoist-cli refs.ts pattern (MIT license)
// Resolves human-friendly refs: name, Todoist URL, id:xxx, raw ID, fuzzy match

const TODOIST_URL_PATTERN = /^https?:\/\/app\.todoist\.com\/app\/(task|project|label|filter)\/([^?#]+)/;

function parseTodoistUrl(url: string): { type: string; id: string } | null {
  const match = url.match(TODOIST_URL_PATTERN);
  if (!match) return null;
  const slugAndId = match[2];
  const lastHyphen = slugAndId.lastIndexOf("-");
  const id = lastHyphen === -1 ? slugAndId : slugAndId.slice(lastHyphen + 1);
  return { type: match[1], id };
}

function isIdRef(ref: string): boolean { return ref.startsWith("id:"); }
function extractId(ref: string): string { return ref.slice(3); }
function looksLikeRawId(ref: string): boolean {
  if (ref.includes(" ")) return false;
  return /^\d+$/.test(ref) || (/[a-zA-Z]/.test(ref) && /\d/.test(ref));
}

async function resolveTaskRef(api: TodoistApi, ref: string): Promise<Task> {
  if (!ref.trim()) fatal("Task reference cannot be empty.");

  // URL
  const parsed = parseTodoistUrl(ref);
  if (parsed) {
    if (parsed.type !== "task") fatal(`Expected a task URL, got ${parsed.type} URL.`);
    return api.getTask(parsed.id) as Promise<Task>;
  }

  // id: prefix
  if (isIdRef(ref)) return api.getTask(extractId(ref)) as Promise<Task>;

  // Search by name (uses Todoist filter search)
  try {
    const { results } = await api.getTasksByFilter({ query: `search: ${ref}`, limit: 10 });
    const lower = ref.toLowerCase();

    // Exact match
    const exact = results.filter(t => t.content.toLowerCase() === lower);
    if (exact.length === 1) return exact[0] as Task;

    // Substring match
    const partial = results.filter(t => t.content.toLowerCase().includes(lower));
    if (partial.length === 1) return partial[0] as Task;
    if (partial.length > 1) {
      fatal(`Ambiguous task "${ref}". Matches:\n` +
        partial.slice(0, 5).map(t => `  "${t.content}" (id:${t.id})`).join("\n"));
    }
  } catch { /* search failed, try raw ID */ }

  // Raw ID fallback
  if (looksLikeRawId(ref)) {
    try { return await api.getTask(ref) as Task; } catch { /* not found */ }
  }

  fatal(`Task "${ref}" not found. Use a name, URL, or id:xxx.`);
}

async function resolveProjectRef(api: TodoistApi, ref: string): Promise<any> {
  if (!ref.trim()) fatal("Project reference cannot be empty.");

  const parsed = parseTodoistUrl(ref);
  if (parsed) {
    if (parsed.type !== "project") fatal(`Expected a project URL, got ${parsed.type} URL.`);
    return api.getProject(parsed.id);
  }

  if (isIdRef(ref)) return api.getProject(extractId(ref));

  const { results: projects } = await api.getProjects();
  const lower = ref.toLowerCase();

  const exact = projects.filter(p => p.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];

  const partial = projects.filter(p => p.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    fatal(`Ambiguous project "${ref}". Matches:\n` +
      partial.slice(0, 5).map(p => `  "${p.name}" (id:${p.id})`).join("\n"));
  }

  if (looksLikeRawId(ref)) {
    try { return await api.getProject(ref); } catch { /* not found */ }
  }

  fatal(`Project "${ref}" not found. Use a name, URL, or id:xxx.`);
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

function formatComment(c: Comment) {
  return {
    id: c.id,
    content: c.content,
    postedAt: c.postedAt,
    taskId: c.taskId ?? undefined,
    projectId: c.projectId ?? undefined,
    hasAttachment: !!c.fileAttachment,
    attachmentName: c.fileAttachment?.fileName ?? undefined,
  };
}

// ── Task Commands ───────────────────────────────────────────────────

async function cmdToday() {
  const api = getApi();
  const { results: tasks } = await api.getTasksByFilter({ query: "today" });
  ok("today", {
    count: tasks.length,
    tasks: tasks.map(t => formatTask(t as Task)),
  }, [
    { command: "todoist-cli inbox", description: "Check inbox" },
    { command: "todoist-cli complete <ref>", description: "Complete a task" },
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
    tasks: tasks.map(t => formatTask(t as Task)),
  }, [
    { command: "todoist-cli add 'Task title'", description: "Add to inbox" },
    { command: "todoist-cli complete <ref>", description: "Complete a task" },
  ]);
}

async function cmdSearch(query: string) {
  const api = getApi();
  const { results: tasks } = await api.getTasksByFilter({ query: `search: ${query}`, limit: 20 });
  ok("search", {
    query,
    count: tasks.length,
    tasks: tasks.map(t => formatTask(t as Task)),
  }, [
    { command: "todoist-cli show <ref>", description: "Show task details + comments" },
    { command: "todoist-cli complete <ref>", description: "Complete a task" },
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
  } else if (opts.project) {
    // Resolve project by name or ID
    const project = await resolveProjectRef(api, opts.project);
    const resp = await api.getTasks({ projectId: project.id });
    tasks = resp.results as Task[];
    label = `project: ${project.name}`;
  } else {
    const args: any = {};
    if (opts.label) args.label = opts.label;
    const resp = await api.getTasks(args);
    tasks = resp.results as Task[];
    if (opts.label) label = `label: ${opts.label}`;
  }

  ok("list", {
    filter: label,
    count: tasks.length,
    tasks: tasks.map(formatTask),
  });
}

async function cmdShow(ref: string) {
  const api = getApi();
  const task = await resolveTaskRef(api, ref);
  const { results: comments } = await api.getComments({ taskId: task.id });
  ok("show", {
    ...formatTask(task),
    description: task.description || undefined,
    comments: comments.map(c => formatComment(c as Comment)),
  }, [
    { command: `todoist-cli comment-add ${task.id} --content 'text'`, description: "Add a comment" },
    { command: `todoist-cli complete ${task.id}`, description: "Complete this task" },
  ]);
}

async function cmdAdd(content: string, opts: AddOpts) {
  const api = getApi();
  const args: any = { content };
  if (opts.description) args.description = opts.description;
  if (opts.due) args.dueString = opts.due;
  if (opts.deadline) args.deadlineDate = opts.deadline;
  if (opts.priority) args.priority = parseInt(opts.priority);
  if (opts.labels) args.labels = opts.labels.split(",").map((l: string) => l.trim());
  if (opts.parent) args.parentId = opts.parent;

  // Resolve project/section by name
  if (opts.project) {
    const project = await resolveProjectRef(api, opts.project);
    args.projectId = project.id;
  }
  if (opts.section) {
    args.sectionId = opts.section; // sections still by ID for now
  }

  const task = await api.addTask(args);
  ok("add", formatTask(task as Task), [
    { command: `todoist-cli complete ${task.id}`, description: "Complete this task" },
    { command: "todoist-cli today", description: "View today's tasks" },
  ]);
}

async function cmdComplete(ref: string) {
  const api = getApi();
  const task = await resolveTaskRef(api, ref);
  await api.closeTask(task.id);
  ok("complete", {
    completed: formatTask(task),
  }, [
    { command: "todoist-cli today", description: "View remaining today tasks" },
  ]);
}

async function cmdReopen(ref: string) {
  const api = getApi();
  const task = await resolveTaskRef(api, ref);
  await api.reopenTask(task.id);
  ok("reopen", { task: formatTask(task) });
}

async function cmdDelete(ref: string) {
  const api = getApi();
  const task = await resolveTaskRef(api, ref);
  await api.deleteTask(task.id);
  ok("delete", {
    deleted: { id: task.id, content: task.content },
  });
}

async function cmdUpdate(ref: string, opts: UpdateOpts) {
  const api = getApi();
  const task = await resolveTaskRef(api, ref);
  const args: any = {};
  if (opts.content) args.content = opts.content;
  if (opts.description) args.description = opts.description;
  if (opts.due) args.dueString = opts.due;
  if (opts.deadline) args.deadlineDate = opts.deadline;
  if (opts.priority) args.priority = parseInt(opts.priority);
  if (opts.labels) args.labels = opts.labels.split(",").map((l: string) => l.trim());

  const updated = await api.updateTask(task.id, args);
  ok("update", formatTask(updated as Task));
}

async function cmdMove(ref: string, opts: { project?: string; section?: string; parent?: string }) {
  const api = getApi();
  const task = await resolveTaskRef(api, ref);
  const args: any = {};

  if (opts.project) {
    const project = await resolveProjectRef(api, opts.project);
    args.projectId = project.id;
  }
  if (opts.section) args.sectionId = opts.section;
  if (opts.parent) args.parentId = opts.parent;

  const moved = await api.moveTask(task.id, args);
  ok("move", formatTask(moved as Task));
}

// ── Comment Commands ────────────────────────────────────────────────

async function cmdComments(ref: string) {
  const api = getApi();
  const task = await resolveTaskRef(api, ref);
  const { results: comments } = await api.getComments({ taskId: task.id });
  ok("comments", {
    taskId: task.id,
    taskContent: task.content,
    count: comments.length,
    comments: comments.map(c => formatComment(c as Comment)),
  }, [
    { command: `todoist-cli comment-add ${task.id} --content 'text'`, description: "Add a comment" },
  ]);
}

async function cmdCommentAdd(ref: string, opts: { content: string }) {
  const api = getApi();
  const task = await resolveTaskRef(api, ref);
  const comment = await api.addComment({ taskId: task.id, content: opts.content });
  ok("comment-add", {
    task: { id: task.id, content: task.content },
    comment: formatComment(comment as Comment),
  }, [
    { command: `todoist-cli comments ${task.id}`, description: "View all comments on this task" },
  ]);
}

async function cmdCommentDelete(commentId: string) {
  const api = getApi();
  const id = isIdRef(commentId) ? extractId(commentId) : commentId;
  const comment = await api.getComment(id);
  await api.deleteComment(id);
  ok("comment-delete", {
    deleted: { id: comment.id, content: (comment as Comment).content.slice(0, 80) },
  });
}

async function cmdCommentUpdate(commentId: string, opts: { content: string }) {
  const api = getApi();
  const id = isIdRef(commentId) ? extractId(commentId) : commentId;
  await api.updateComment(id, { content: opts.content });
  const updated = await api.getComment(id);
  ok("comment-update", { comment: formatComment(updated as Comment) });
}

// ── Reminder Commands ───────────────────────────────────────────────
// Note: The Todoist REST v2 API reminders endpoints are available on Pro/Business

async function cmdReminderAdd(ref: string, opts: { before?: string; at?: string }) {
  if (!opts.before && !opts.at) fatal("Must specify --before <duration> or --at <datetime>");

  const api = getApi();
  const task = await resolveTaskRef(api, ref);

  const args: any = { itemId: task.id };

  if (opts.before) {
    // Parse duration: "30m", "1h", "2h30m", "15min"
    const minutes = parseDuration(opts.before);
    if (minutes === null) fatal(`Invalid duration "${opts.before}". Examples: 30m, 1h, 2h30m`);

    if (!task.due) fatal("Cannot use --before: task has no due date. Use --at instead.");
    args.minuteOffset = minutes;
  }

  if (opts.at) {
    // ISO datetime or date
    args.due = { date: opts.at };
  }

  // Use Sync API for reminders (REST v2 doesn't have them)
  const token = getToken();
  const resp = await fetch("https://api.todoist.com/sync/v9/sync", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      commands: [{
        type: "reminder_add",
        uuid: crypto.randomUUID(),
        temp_id: crypto.randomUUID(),
        args: {
          item_id: task.id,
          ...(args.minuteOffset !== undefined ? { minute_offset: args.minuteOffset } : {}),
          ...(args.due ? { due: args.due } : {}),
        },
      }],
    }),
  });

  if (!resp.ok) fatal(`Reminder API error: ${resp.status}`);

  ok("reminder-add", {
    task: { id: task.id, content: task.content },
    reminder: opts.before ? `${opts.before} before due` : `at ${opts.at}`,
  }, [
    { command: `todoist-cli reminders ${task.id}`, description: "List reminders for this task" },
  ]);
}

async function cmdReminders(ref: string) {
  const api = getApi();
  const task = await resolveTaskRef(api, ref);

  const token = getToken();
  const resp = await fetch("https://api.todoist.com/sync/v9/sync", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sync_token: "*",
      resource_types: ["reminders"],
    }),
  });

  if (!resp.ok) fatal(`Sync API error: ${resp.status}`);
  const data = await resp.json() as any;
  const reminders = (data.reminders || []).filter((r: any) => r.item_id === task.id && !r.is_deleted);

  ok("reminders", {
    task: { id: task.id, content: task.content },
    count: reminders.length,
    reminders: reminders.map((r: any) => ({
      id: r.id,
      minuteOffset: r.minute_offset ?? null,
      due: r.due ?? null,
    })),
  });
}

async function cmdReminderDelete(reminderId: string) {
  const token = getToken();
  const id = isIdRef(reminderId) ? extractId(reminderId) : reminderId;

  const resp = await fetch("https://api.todoist.com/sync/v9/sync", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      commands: [{
        type: "reminder_delete",
        uuid: crypto.randomUUID(),
        args: { id },
      }],
    }),
  });

  if (!resp.ok) fatal(`Sync API error: ${resp.status}`);
  ok("reminder-delete", { deleted: { id } });
}

// ── Activity / Completed ────────────────────────────────────────────

async function cmdActivity(opts: { since?: string; until?: string; limit?: string; type?: string; event?: string; project?: string }) {
  const api = getApi();

  const args: any = {};
  if (opts.since) args.since = new Date(opts.since);
  if (opts.until) args.until = new Date(opts.until);
  if (opts.type) args.objectType = opts.type;
  if (opts.event) args.eventType = opts.event;
  if (opts.limit) args.limit = parseInt(opts.limit);

  if (opts.project) {
    const project = await resolveProjectRef(api, opts.project);
    args.parentProjectId = project.id;
  }

  const { results: events } = await api.getActivityLogs(args);

  ok("activity", {
    count: events.length,
    events: events.map((e: any) => ({
      id: e.id,
      eventType: e.eventType,
      objectType: e.objectType,
      objectId: e.objectId,
      content: e.extraData?.content ?? e.extraData?.name ?? `id:${e.objectId}`,
      date: e.eventDate,
      parentProjectId: e.parentProjectId ?? undefined,
    })),
  }, [
    { command: "todoist-cli activity --event completed --since 2026-02-01", description: "Filter activity" },
    { command: "todoist-cli completed", description: "View completed tasks" },
  ]);
}

async function cmdCompleted(opts: { since?: string; until?: string; project?: string; limit?: string }) {
  const api = getApi();

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  const args: any = {
    since: opts.since ?? todayStr,
    until: opts.until ?? tomorrowStr,
  };
  if (opts.limit) args.limit = parseInt(opts.limit);

  if (opts.project) {
    const project = await resolveProjectRef(api, opts.project);
    args.projectId = project.id;
  }

  const { items: tasks } = await api.getCompletedTasksByCompletionDate(args) as any;

  ok("completed", {
    period: { since: args.since, until: args.until },
    count: tasks?.length ?? 0,
    tasks: (tasks ?? []).map((t: any) => ({
      id: t.id ?? t.taskId,
      content: t.content,
      completedAt: t.completedAt ?? t.completedDate,
      projectId: t.projectId,
    })),
  }, [
    { command: "todoist-cli completed --since 2026-02-17", description: "Completed since date" },
    { command: "todoist-cli activity", description: "Full activity log" },
  ]);
}

// ── Organization Commands ───────────────────────────────────────────

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
    { command: "todoist-cli list --project <name>", description: "List tasks in a project" },
  ]);
}

async function cmdSections(projectRef?: string) {
  const api = getApi();
  let projectId: string | undefined;
  if (projectRef) {
    const project = await resolveProjectRef(api, projectRef);
    projectId = project.id;
  }
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

async function cmdAddProject(name: string, opts: { color?: string; favorite?: boolean; parent?: string }) {
  const api = getApi();
  const args: any = { name };
  if (opts.color) args.color = opts.color;
  if (opts.favorite) args.isFavorite = true;
  if (opts.parent) {
    const parent = await resolveProjectRef(api, opts.parent);
    args.parentId = parent.id;
  }

  const project = await api.addProject(args);
  ok("add-project", {
    id: project.id,
    name: project.name,
    color: project.color,
    url: (project as any).url,
  });
}

async function cmdAddSection(name: string, projectRef: string, opts: { order?: string }) {
  const api = getApi();
  const project = await resolveProjectRef(api, projectRef);
  const section = await api.addSection({
    name,
    projectId: project.id,
    order: opts.order ? parseInt(opts.order) : undefined,
  });
  ok("add-section", {
    id: section.id,
    name: section.name,
    projectId: section.projectId,
  });
}

// ── Review (Daily Dashboard) ────────────────────────────────────────

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

  const inbox = projects.find((p: any) => p.isInboxProject);
  const inboxTasks = inbox ? allTasks.filter(t => t.projectId === inbox.id) : [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = allTasks.filter(t => {
    if (!t.due?.date) return false;
    return new Date(t.due.date) < today;
  });

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
    { command: "todoist-cli complete <ref>", description: "Complete a task" },
    { command: "todoist-cli add 'task' --due today", description: "Add a task for today" },
  ]);
}

// ── Duration Parser ─────────────────────────────────────────────────

function parseDuration(s: string): number | null {
  let total = 0;
  let matched = false;
  const patterns: [RegExp, number][] = [
    [/(\d+)\s*h(?:ours?)?/i, 60],
    [/(\d+)\s*m(?:in(?:utes?)?)?/i, 1],
  ];
  for (const [re, mult] of patterns) {
    const m = s.match(re);
    if (m) { total += parseInt(m[1]) * mult; matched = true; }
  }
  if (!matched && /^\d+$/.test(s.trim())) { total = parseInt(s.trim()); matched = true; }
  return matched ? total : null;
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
    version: "0.2.0",
    auth: "TODOIST_API_TOKEN env var or 'secrets lease todoist_api_token'",
    notes: [
      "All <ref> args accept: task name, Todoist URL, id:xxx, or raw ID",
      "Project args (--project) also accept project names",
      "Credit: Ref resolution pattern from Doist/todoist-cli (MIT)",
    ],
    commands: {
      // Tasks
      "today": "Tasks due today + overdue",
      "inbox": "Inbox tasks (needs triage)",
      "search <query>": "Search tasks by text",
      "list [--filter X] [--project NAME] [--label X]": "List tasks with filters",
      "show <ref>": "Task detail + comments",
      "add 'content' [--due X] [--deadline YYYY-MM-DD] [--project NAME] [--section ID] [--parent ID] [--priority 1-4] [--labels a,b] [--description X]": "Create a task",
      "complete <ref>": "Complete a task",
      "reopen <ref>": "Reopen a completed task",
      "update <ref> [--content X] [--due X] [--priority 1-4] [--labels a,b] [--description X]": "Update a task",
      "move <ref> --project NAME | --section ID | --parent ID": "Move a task",
      "delete <ref>": "Delete a task permanently",
      // Comments
      "comments <ref>": "List comments on a task",
      "comment-add <ref> --content 'text'": "Add a comment to a task",
      "comment-update <commentId> --content 'text'": "Update a comment",
      "comment-delete <commentId>": "Delete a comment",
      // Reminders
      "reminders <ref>": "List reminders for a task",
      "reminder-add <ref> --before 30m | --at 2026-02-20T10:00": "Add a reminder",
      "reminder-delete <reminderId>": "Delete a reminder",
      // Activity
      "activity [--since X] [--until X] [--type task|comment|project] [--event added|completed|updated|deleted] [--project NAME] [--limit N]": "Activity log",
      "completed [--since X] [--until X] [--project NAME] [--limit N]": "Completed tasks",
      // Organization
      "review": "Daily review dashboard (today, inbox, overdue, projects)",
      "projects": "List all projects",
      "sections [--project NAME]": "List sections",
      "labels": "List all labels",
      "add-project 'name' [--color X] [--favorite] [--parent NAME]": "Create a project",
      "add-section 'name' --project NAME [--order N]": "Create a section",
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
      // Tasks
      case "today":
        return await cmdToday();
      case "inbox":
        return await cmdInbox();
      case "search":
        if (!pos[0]) fatal("Usage: todoist-cli search <query>");
        return await cmdSearch(pos[0]);
      case "list":
        return await cmdList({ filter: flags.filter, project: flags.project, label: flags.label });
      case "review":
        return await cmdReview();
      case "show":
        if (!pos[0]) fatal("Usage: todoist-cli show <ref>");
        return await cmdShow(pos[0]);
      case "add":
        if (!pos[0]) fatal("Usage: todoist-cli add 'content' [--due X] [--project NAME] ...");
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
        if (!pos[0]) fatal("Usage: todoist-cli complete <ref>");
        return await cmdComplete(pos[0]);
      case "reopen":
        if (!pos[0]) fatal("Usage: todoist-cli reopen <ref>");
        return await cmdReopen(pos[0]);
      case "update":
        if (!pos[0]) fatal("Usage: todoist-cli update <ref> [--content X] ...");
        return await cmdUpdate(pos[0], {
          content: flags.content,
          description: flags.description,
          due: flags.due,
          deadline: flags.deadline,
          priority: flags.priority,
          labels: flags.labels,
        });
      case "move":
        if (!pos[0]) fatal("Usage: todoist-cli move <ref> --project NAME | --section ID | --parent ID");
        return await cmdMove(pos[0], { project: flags.project, section: flags.section, parent: flags.parent });
      case "delete":
        if (!pos[0]) fatal("Usage: todoist-cli delete <ref>");
        return await cmdDelete(pos[0]);

      // Comments
      case "comments":
        if (!pos[0]) fatal("Usage: todoist-cli comments <ref>");
        return await cmdComments(pos[0]);
      case "comment-add":
        if (!pos[0] || !flags.content) fatal("Usage: todoist-cli comment-add <ref> --content 'text'");
        return await cmdCommentAdd(pos[0], { content: flags.content });
      case "comment-update":
        if (!pos[0] || !flags.content) fatal("Usage: todoist-cli comment-update <commentId> --content 'text'");
        return await cmdCommentUpdate(pos[0], { content: flags.content });
      case "comment-delete":
        if (!pos[0]) fatal("Usage: todoist-cli comment-delete <commentId>");
        return await cmdCommentDelete(pos[0]);

      // Reminders
      case "reminders":
        if (!pos[0]) fatal("Usage: todoist-cli reminders <ref>");
        return await cmdReminders(pos[0]);
      case "reminder-add":
        if (!pos[0]) fatal("Usage: todoist-cli reminder-add <ref> --before 30m | --at 2026-02-20T10:00");
        return await cmdReminderAdd(pos[0], { before: flags.before, at: flags.at });
      case "reminder-delete":
        if (!pos[0]) fatal("Usage: todoist-cli reminder-delete <reminderId>");
        return await cmdReminderDelete(pos[0]);

      // Activity
      case "activity":
        return await cmdActivity({
          since: flags.since, until: flags.until, limit: flags.limit,
          type: flags.type, event: flags.event, project: flags.project,
        });
      case "completed":
        return await cmdCompleted({
          since: flags.since, until: flags.until,
          project: flags.project, limit: flags.limit,
        });

      // Organization
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
        if (!pos[0] || !flags.project) fatal("Usage: todoist-cli add-section 'name' --project NAME");
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
