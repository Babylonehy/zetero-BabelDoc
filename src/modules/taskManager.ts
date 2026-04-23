import { config } from "../../package.json";
import { cancelRunningTask } from "./process";
import {
  canCancelTask,
  canOpenTaskResult,
  canRetryTask,
  cancelTask,
  getTask,
  retryTask,
  saveTasksToDisk
} from "./tasks";
import { startTaskRunner } from "./translator";
import { openAttachment } from "./zoteroItems";

export function openTaskManager(win: Window = Zotero.getMainWindow()) {
  if (addon.data.taskManagerWindow && !addon.data.taskManagerWindow.closed) {
    addon.data.taskManagerWindow.focus();
    return;
  }

  let refreshTimer = 0;
  const dialogData: Record<string, any> = {
    selectedTaskId: addon.data.taskManagerSelectedTaskID || ""
  };
  let dialog: any;

  dialog = new ztoolkit.Dialog(1, 1)
    .addCell(0, 0, {
      tag: "div",
      namespace: "html",
      attributes: {
        id: `${config.addonRef}-task-manager`
      },
      styles: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        height: "100%",
        padding: "12px",
        background: "#f8fafc",
        color: "#0f172a",
        fontFamily:
          "'SF Pro Text', 'PingFang SC', 'Helvetica Neue', Helvetica, Arial, sans-serif"
      },
      children: [
        {
          tag: "div",
          namespace: "html",
          properties: {
            textContent: "任务状态会自动刷新。支持取消、复制任务 ID、重试失败任务和打开结果。"
          },
          styles: {
            fontSize: "13px",
            color: "#475569"
          }
        },
        {
          tag: "div",
          namespace: "html",
          attributes: {
            id: `${config.addonRef}-task-table-wrapper`
          },
          styles: {
            flex: "1",
            minHeight: "360px",
            overflow: "auto",
            border: "1px solid #dbe4ee",
            borderRadius: "12px",
            background: "#ffffff"
          }
        },
        {
          tag: "div",
          namespace: "html",
          attributes: {
            id: `${config.addonRef}-task-details`
          },
          styles: {
            minHeight: "180px",
            overflow: "auto",
            border: "1px solid #dbe4ee",
            borderRadius: "12px",
            background: "#ffffff",
            padding: "12px",
            whiteSpace: "pre-wrap",
            fontSize: "13px",
            lineHeight: "1.5"
          }
        }
      ]
    })
    .setDialogData({
      ...dialogData,
      loadCallback() {
        renderTaskManager(dialog);
        refreshTimer = dialog.window.setInterval(() => {
          if (!dialog.window.closed) {
            renderTaskManager(dialog);
          }
        }, 1000);
      },
      unloadCallback() {
        if (refreshTimer) {
          dialog.window.clearInterval(refreshTimer);
        }
        addon.data.taskManagerWindow = null;
      }
    })
    .addButton("刷新", "refresh", {
      noClose: true,
      callback() {
        renderTaskManager(dialog);
      }
    })
    .addButton("取消任务", "cancel-task", {
      noClose: true,
      callback() {
        void cancelSelectedTask(dialog);
      }
    })
    .addButton("重试任务", "retry-task", {
      noClose: true,
      callback() {
        void retrySelectedTask(dialog);
      }
    })
    .addButton("复制任务 ID", "copy-task-id", {
      noClose: true,
      callback() {
        copySelectedTaskID(dialog);
      }
    })
    .addButton("查看结果", "open-result", {
      noClose: true,
      callback() {
        void openSelectedTaskResult(dialog);
      }
    })
    .addButton("关闭", "close")
    .open("BabelDOC 任务管理", {
      width: 1040,
      height: 760,
      fitContent: false,
      resizable: true,
      noDialogMode: true,
      centerscreen: true
    });

  addon.data.taskManagerWindow = dialog.window;
}

function renderTaskManager(dialog: any) {
  const doc = dialog.window.document;
  const tasks = addon.data.tasks.slice();
  const selectedTask =
    getTask(dialog.dialogData.selectedTaskId) || tasks[0] || null;

  if (selectedTask) {
    dialog.dialogData.selectedTaskId = selectedTask.id;
    addon.data.taskManagerSelectedTaskID = selectedTask.id;
  } else {
    dialog.dialogData.selectedTaskId = "";
    addon.data.taskManagerSelectedTaskID = "";
  }

  const wrapper = doc.getElementById(`${config.addonRef}-task-table-wrapper`);
  const details = doc.getElementById(`${config.addonRef}-task-details`);
  if (!wrapper || !details) {
    return;
  }

  wrapper.replaceChildren(buildTaskTable(doc, tasks, dialog));
  details.replaceChildren(
    selectedTask ? buildTaskDetails(doc, selectedTask) : doc.createTextNode("当前没有任务。")
  );
  updateButtons(dialog, selectedTask);
}

function buildTaskTable(doc: Document, tasks: any[], dialog: any) {
  const table = doc.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "13px";

  const thead = doc.createElement("thead");
  const headerRow = doc.createElement("tr");
  for (const title of ["状态", "文档", "更新时间", "说明"]) {
    const cell = doc.createElement("th");
    cell.textContent = title;
    cell.style.textAlign = "left";
    cell.style.padding = "10px 12px";
    cell.style.borderBottom = "1px solid #e2e8f0";
    cell.style.background = "#f8fafc";
    cell.style.position = "sticky";
    cell.style.top = "0";
    headerRow.appendChild(cell);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = doc.createElement("tbody");
  for (const task of tasks) {
    const row = doc.createElement("tr");
    const selected = task.id === dialog.dialogData.selectedTaskId;
    row.style.background = selected ? "#dbeafe" : "#ffffff";
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      dialog.dialogData.selectedTaskId = task.id;
      addon.data.taskManagerSelectedTaskID = task.id;
      renderTaskManager(dialog);
    });

    appendCell(doc, row, task.status, getStatusStyle(task.status));
    appendCell(doc, row, task.sourceTitle);
    appendCell(doc, row, formatDateTime(task.updatedAt));
    appendCell(doc, row, task.message || "");
    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  return table;
}

function appendCell(
  doc: Document,
  row: HTMLTableRowElement,
  text: string,
  styles: Record<string, string> = {}
) {
  const cell = doc.createElement("td");
  cell.textContent = text;
  cell.style.padding = "10px 12px";
  cell.style.borderBottom = "1px solid #eef2f7";
  Object.assign(cell.style, styles);
  row.appendChild(cell);
}

function getStatusStyle(status: string) {
  switch (status) {
    case "running":
      return { color: "#0f766e", fontWeight: "700" };
    case "done":
      return { color: "#166534", fontWeight: "700" };
    case "failed":
      return { color: "#b91c1c", fontWeight: "700" };
    case "cancelled":
      return { color: "#92400e", fontWeight: "700" };
    default:
      return { color: "#334155", fontWeight: "700" };
  }
}

function formatTaskDetails(task: any) {
  return [
    `任务 ID: ${task.id}`,
    `状态: ${task.status}`,
    typeof task.progress === "number" ? `进度: ${task.progress}%` : null,
    `文档: ${task.sourceTitle}`,
    `创建时间: ${formatDateTime(task.createdAt)}`,
    `更新时间: ${formatDateTime(task.updatedAt)}`,
    task.openaiModel ? `模型: ${task.openaiModel}` : null,
    task.openaiBaseURL ? `API: ${task.openaiBaseURL}` : null,
    `源 PDF: ${task.sourcePath}`,
    task.outputPath ? `结果 PDF: ${task.outputPath}` : null,
    task.logPath ? `日志: ${task.logPath}` : null,
    task.commandLine ? `命令: ${task.commandLine}` : null,
    task.message ? `说明: ${task.message}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTaskDetails(doc: Document, task: any) {
  const container = doc.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "14px";

  const stages = buildStageProgressPanel(doc, task);
  if (stages) {
    container.appendChild(stages);
  }

  const text = doc.createElement("div");
  text.textContent = formatTaskDetails(task);
  text.style.whiteSpace = "pre-wrap";
  text.style.fontSize = "13px";
  text.style.lineHeight = "1.5";
  container.appendChild(text);
  return container;
}

function buildStageProgressPanel(doc: Document, task: any) {
  const stages = Array.isArray(task?.stageProgresses) ? task.stageProgresses : [];
  if (!stages.length) {
    return null;
  }

  const panel = doc.createElement("div");
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.gap = "10px";
  panel.style.padding = "12px";
  panel.style.border = "1px solid #dbe4ee";
  panel.style.borderRadius = "12px";
  panel.style.background = "#f8fafc";

  const title = doc.createElement("div");
  title.textContent = "阶段进度";
  title.style.fontSize = "13px";
  title.style.fontWeight = "700";
  title.style.color = "#334155";
  panel.appendChild(title);

  for (const stage of stages) {
    const row = doc.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "180px 1fr 56px";
    row.style.alignItems = "center";
    row.style.gap = "10px";

    const label = doc.createElement("div");
    label.textContent = stage.label;
    label.style.fontSize = "12px";
    label.style.color = "#334155";

    const bar = doc.createElement("div");
    bar.style.height = "8px";
    bar.style.borderRadius = "999px";
    bar.style.background = "#e5e7eb";
    bar.style.overflow = "hidden";

    const fill = doc.createElement("div");
    fill.style.height = "100%";
    fill.style.width = `${Math.max(0, Math.min(100, Number(stage.progress || 0)))}%`;
    fill.style.borderRadius = "999px";
    fill.style.background = getStageBarColor(stage.status);
    bar.appendChild(fill);

    const percent = doc.createElement("div");
    percent.textContent =
      typeof stage.current === "number" && typeof stage.total === "number" && stage.total > 0
        ? `${stage.current}/${stage.total}`
        : `${Math.max(0, Math.min(100, Number(stage.progress || 0)))}%`;
    percent.style.fontSize = "12px";
    percent.style.fontVariantNumeric = "tabular-nums";
    percent.style.color = "#475569";
    percent.style.textAlign = "right";

    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(percent);
    panel.appendChild(row);

    if (stage.detail) {
      const detail = doc.createElement("div");
      detail.textContent = stage.detail;
      detail.style.fontSize = "11px";
      detail.style.color = "#64748b";
      detail.style.marginTop = "-4px";
      detail.style.marginLeft = "190px";
      panel.appendChild(detail);
    }
  }

  return panel;
}

function getStageBarColor(status: string) {
  switch (status) {
    case "done":
      return "#65a30d";
    case "running":
      return "#ec4899";
    case "failed":
      return "#dc2626";
    case "cancelled":
      return "#d97706";
    default:
      return "#cbd5e1";
  }
}

function updateButtons(dialog: any, task: any) {
  const doc = dialog.window.document;
  setDisabled(doc, "cancel-task", !canCancelTask(task));
  setDisabled(doc, "retry-task", !canRetryTask(task));
  setDisabled(doc, "copy-task-id", !task);
  setDisabled(doc, "open-result", !canOpenTaskResult(task));
}

function setDisabled(doc: Document, id: string, disabled: boolean) {
  const button = doc.getElementById(id) as HTMLButtonElement | null;
  if (button) {
    button.disabled = disabled;
  }
}

async function cancelSelectedTask(dialog: any) {
  const task = getTask(dialog.dialogData.selectedTaskId);
  if (!task) {
    return;
  }

  cancelTask(task.id);
  if (task.status === "running") {
    cancelRunningTask(task.id);
  }
  await saveTasksToDisk();
  renderTaskManager(dialog);
}

async function retrySelectedTask(dialog: any) {
  const task = getTask(dialog.dialogData.selectedTaskId);
  if (!canRetryTask(task)) {
    return;
  }

  retryTask(task!.id);
  await saveTasksToDisk();
  renderTaskManager(dialog);
  void startTaskRunner(Zotero.getMainWindow());
}

function copySelectedTaskID(dialog: any) {
  const task = getTask(dialog.dialogData.selectedTaskId);
  if (!task) {
    return;
  }

  Components.classes["@mozilla.org/widget/clipboardhelper;1"]
    .getService(Components.interfaces.nsIClipboardHelper)
    .copyString(task.id);
}

async function openSelectedTaskResult(dialog: any) {
  const task = getTask(dialog.dialogData.selectedTaskId);
  if (!canOpenTaskResult(task)) {
    return;
  }

  const item = Zotero.Items.get(task!.outputAttachmentID!);
  if (item) {
    await openAttachment(Zotero.getMainWindow(), item);
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
