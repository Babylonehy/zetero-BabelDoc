import { config } from "../../package.json";
import { joinPath, pathExists, readTextFile, writeTextFile } from "../utils/os";
import { ensureDirectory } from "./files";

export type TaskStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "interrupted";

export type TaskStageStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface TaskStageProgress {
  key: string;
  label: string;
  progress: number;
  status: TaskStageStatus;
  current?: number;
  total?: number;
  detail?: string;
}

export interface TaskRecord {
  id: string;
  sourceAttachmentID: number;
  sourceTitle: string;
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
  status: TaskStatus;
  commandLine?: string;
  outputPath?: string;
  outputAttachmentID?: number;
  logPath?: string;
  openaiModel?: string;
  openaiBaseURL?: string;
  progress?: number;
  message?: string;
  stageProgresses?: TaskStageProgress[];
}

async function getTaskFilePath() {
  const dir = joinPath(Zotero.DataDirectory.dir, config.addonRef);
  await ensureDirectory(dir);
  return joinPath(dir, "tasks.json");
}

export async function loadTasksFromDisk() {
  const taskFile = await getTaskFilePath();
  if (!(await pathExists(taskFile))) {
    addon.data.tasks = [];
    return;
  }

  try {
    const raw = await readTextFile(taskFile);
    addon.data.tasks = JSON.parse(raw) || [];
  } catch (error) {
    addon.data.tasks = [];
  }
}

export async function saveTasksToDisk() {
  const taskFile = await getTaskFilePath();
  await writeTextFile(
    taskFile,
    JSON.stringify(addon.data.tasks.slice(0, 100), null, 2)
  );
}

export function markInterruptedTasks() {
  let changed = false;
  for (const task of addon.data.tasks) {
    if (task.status === "queued" || task.status === "running") {
      task.status = "queued";
      task.updatedAt = new Date().toISOString();
      task.message = "Recovered after Zotero restart.";
      changed = true;
    }
  }
  if (changed) {
    void saveTasksToDisk();
  }
}

export function createTask(input: {
  sourceAttachmentID: number;
  sourceTitle: string;
  sourcePath: string;
}) {
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    sourceAttachmentID: input.sourceAttachmentID,
    sourceTitle: input.sourceTitle,
    sourcePath: input.sourcePath,
    createdAt: now,
    updatedAt: now,
    status: "queued"
  };
  addon.data.tasks.unshift(task);
  addon.data.tasks = addon.data.tasks.slice(0, 100);
  return task;
}

export function updateTask(taskID: string, patch: Partial<TaskRecord>) {
  const task = getTask(taskID);
  if (!task) {
    return null;
  }

  Object.assign(task, patch, {
    updatedAt: new Date().toISOString()
  });
  return task;
}

export function getTask(taskID: string) {
  return addon.data.tasks.find((item) => item.id === taskID) || null;
}

export function getNextQueuedTask() {
  return addon.data.tasks.find((task) => task.status === "queued") || null;
}

export function hasActiveTaskForAttachment(attachmentID: number) {
  return addon.data.tasks.some((task) => {
    return (
      task.sourceAttachmentID === attachmentID &&
      (task.status === "queued" || task.status === "running")
    );
  });
}

export function canCancelTask(task: TaskRecord | null | undefined) {
  return Boolean(task && (task.status === "queued" || task.status === "running"));
}

export function canRetryTask(task: TaskRecord | null | undefined) {
  return Boolean(
    task &&
      (task.status === "failed" ||
        task.status === "cancelled" ||
        task.status === "interrupted")
  );
}

export function canOpenTaskResult(task: TaskRecord | null | undefined) {
  return Boolean(task?.status === "done" && task.outputAttachmentID);
}

export function cancelTask(taskID: string, message = "Cancelled by user.") {
  const task = getTask(taskID);
  if (!canCancelTask(task)) {
    return null;
  }

  return updateTask(taskID, {
    status: "cancelled",
    message
  });
}

export function retryTask(taskID: string) {
  const task = getTask(taskID);
  if (!task) {
    return null;
  }

  return updateTask(taskID, {
    status: "queued",
    message: "Queued for retry.",
    outputPath: undefined,
    outputAttachmentID: undefined
  });
}

export function getRecentTasksSummary(limit = 10) {
  const recent = addon.data.tasks.slice(0, limit);
  if (!recent.length) {
    return "当前没有任务记录。";
  }

  return recent
    .map((task) => {
      return [
        `[${task.status}] ${task.sourceTitle}`,
        `时间: ${task.updatedAt}`,
        task.message ? `说明: ${task.message}` : null,
        task.outputPath ? `结果: ${task.outputPath}` : null
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
