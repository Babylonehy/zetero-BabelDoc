import { config } from "../../package.json";
import { createTaskOutputDir, findNewestPdf } from "./files";
import { ensureConfigured, getSettings } from "./prefs";
import { cancelRunningTask, runCommand } from "./process";
import {
  joinPath,
  makeDirectory,
  OS,
  pathExists,
  readFileTail,
  readTextFile,
  writeTextFile
} from "../utils/os";
import {
  createTask,
  getNextQueuedTask,
  getTask,
  hasActiveTaskForAttachment,
  saveTasksToDisk,
  updateTask,
  type TaskRecord,
  type TaskStageProgress,
  type TaskStageStatus
} from "./tasks";
import {
  collectPdfAttachments,
  importResultAttachment,
  openAttachment,
  resolvePdfAttachmentByID
} from "./zoteroItems";

export async function translateSelectedFromWindow(win: any) {
  const items = win?.ZoteroPane?.getSelectedItems?.() || [];
  return translateItems(items, win);
}

export async function translateItems(items: any[], win: any) {
  if (!(await ensureConfigured(win))) {
    return 0;
  }

  const attachments = await collectPdfAttachments(items);
  if (!attachments.length) {
    Services.prompt.alert(
      win || null,
      config.addonName,
      "没有找到可翻译的 PDF 附件。请先选中 PDF 或包含 PDF 附件的条目。"
    );
    return 0;
  }

  const settings = getSettings();
  if (settings.confirmBeforeStart) {
    const confirmed = confirmTranslation(attachments, settings, win);
    if (!confirmed) {
      return 0;
    }
  }

  let enqueued = 0;
  for (const attachment of attachments) {
    if (hasActiveTaskForAttachment(attachment.attachment.id)) {
      continue;
    }

    createTask({
      sourceAttachmentID: attachment.attachment.id,
      sourceTitle: attachment.parentTitle,
      sourcePath: attachment.sourcePath
    });
    enqueued += 1;
  }
  await saveTasksToDisk();

  if (enqueued === 0) {
    Services.prompt.alert(
      win || null,
      config.addonName,
      "所选 PDF 已经在任务队列中，未重复创建任务。"
    );
    return 0;
  }

  if (enqueued > 0) {
    void startTaskRunner(win);
  }

  return enqueued;
}

export async function startTaskRunner(win: any = Zotero.getMainWindow()) {
  if (addon.data.taskRunnerActive) {
    return;
  }
  if (!isRunnable()) {
    return;
  }

  addon.data.taskRunnerActive = true;
  try {
    while (addon.data.alive) {
      const task = getNextQueuedTask();
      if (!task) {
        break;
      }

      const source = await resolvePdfAttachmentByID(task.sourceAttachmentID);
      if (!source) {
        updateTask(task.id, {
          status: "failed",
          message: "Source PDF attachment is no longer available."
        });
        await saveTasksToDisk();
        continue;
      }

      await runTask(task.id, source, win);
    }
  } finally {
    addon.data.taskRunnerActive = false;
  }
}

function isRunnable() {
  return addon.data.alive && ensureCurrentSettingsRunnable();
}

function ensureCurrentSettingsRunnable() {
  try {
    return Boolean(getSettings().command && getSettings().openaiModel);
  } catch (error) {
    return false;
  }
}

async function runTask(taskID: string, source: any, win: any) {
  const settings = getSettings();
  const task = getTask(taskID);
  if (!task || task.status === "cancelled") {
    return;
  }

  const progress = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: -1
  })
    .createLine({
      text: `等待执行: ${source.parentTitle}`,
      type: "default",
      progress: 5
    })
    .show();
  let stopWatchingLogs: (() => void) | null = null;

  try {
    const outputDir = await createTaskOutputDir(source);
    const logPath = joinPath(outputDir, "babeldoc.log");
    await initializeTaskLog(logPath, settings, source.parentTitle);

    updateTask(taskID, {
      status: "running",
      outputPath: outputDir,
      logPath,
      openaiModel: settings.openaiModel,
      openaiBaseURL: summarizeApiBaseURL(settings.openaiBaseURL),
      progress: 12,
      message: buildStartupMessage(settings),
      stageProgresses: buildTaskStages("prepare")
    });
    await saveTasksToDisk();

    progress.changeLine({
      text: `运行 BabelDOC: ${source.parentTitle} · ${settings.openaiModel}`,
      progress: 18
    });

    const args = buildBabeldocArgs(settings, source.sourcePath, outputDir);
    const runtimeEnv = await buildBabeldocRuntimeEnv(settings, outputDir);
    stopWatchingLogs = startTaskLogWatcher(taskID, logPath, progress, source.parentTitle, win);
    const result = await runCommand(settings.command, args, taskID, {
      logPath,
      env: runtimeEnv
    });
    const latestTask = getTask(taskID);

    updateTask(taskID, {
      commandLine: result.commandLine,
      progress: 88,
      message: "BabelDOC 已完成，正在导入生成的 PDF。",
      stageProgresses: buildTaskStages("import")
    });
    await saveTasksToDisk();

    if (latestTask?.status === "cancelled") {
      progress.changeLine({
        text: `已取消: ${source.parentTitle}`,
        progress: 100
      });
      progress.win.startCloseTimer(3000);
      await saveTasksToDisk();
      return;
    }

    if (result.exitCode !== 0) {
      const logTail = await readLogTail(logPath);
      throw new Error(
        `BabelDOC exited with code ${result.exitCode}.${logTail ? `\n\n--- BabelDOC 日志 ---\n${logTail}` : ""}`
      );
    }

    progress.changeLine({
      text: `导入结果: ${source.parentTitle}`,
      progress: 75
    });

    const pdfPath = await findNewestPdf(outputDir);
    if (!pdfPath) {
      throw new Error("No translated PDF was found in the output directory.");
    }

    if (getTask(taskID)?.status === "cancelled") {
      await saveTasksToDisk();
      return;
    }

    const importedItem = await importResultAttachment(
      source,
      pdfPath,
      settings.langOut
    );

    updateTask(taskID, {
      status: "done",
      outputPath: pdfPath,
      outputAttachmentID: importedItem?.id,
      progress: 100,
      message: "Translation completed.",
      stageProgresses: buildTaskStages("done")
    });
    await saveTasksToDisk();

    progress.changeLine({
      text: `完成: ${source.parentTitle}`,
      progress: 100
    });
    progress.win.startCloseTimer(5000);

    if (settings.openResult && importedItem) {
      await openAttachment(win, importedItem);
    }
  } catch (error: any) {
    if (getTask(taskID)?.status === "cancelled") {
      updateTask(taskID, {
        status: "cancelled",
        progress: 100,
        message: "Cancelled by user.",
        stageProgresses: buildTaskStages("cancelled")
      });
      await saveTasksToDisk();
      progress.changeLine({
        text: `已取消: ${source.parentTitle}`,
        progress: 100
      });
      progress.win.startCloseTimer(3000);
      return;
    }

    updateTask(taskID, {
      status: "failed",
      progress: 100,
      message: error?.message || String(error),
      stageProgresses: buildTaskStages("failed")
    });
    await saveTasksToDisk();

    progress.changeLine({
      text: `失败: ${source.parentTitle}`,
      progress: 100
    });
    progress.win.startCloseTimer(8000);

    Services.prompt.alert(
      win || null,
      config.addonName,
      `翻译失败：${source.parentTitle}\n\n${error?.message || error}`
    );
  } finally {
    stopWatchingLogs?.();
  }
}

export function cancelTaskExecution(taskID: string) {
  return cancelRunningTask(taskID);
}

function buildBabeldocArgs(
  settings: ReturnType<typeof getSettings>,
  sourcePath: string,
  outputDir: string
) {
  const args = [
    "--files",
    sourcePath,
    "--output",
    outputDir,
    "--lang-in",
    settings.langIn,
    "--lang-out",
    settings.langOut,
    "--openai",
    "--openai-model",
    settings.openaiModel,
    "--qps",
    String(settings.qps),
    ...(settings.autoExtractGlossary ? [] : ["--no-auto-extract-glossary"]),
    "--no-mono",
    "--watermark-output-mode",
    settings.watermarkOutputMode
  ];

  if (settings.openaiBaseURL) {
    args.push("--openai-base-url", settings.openaiBaseURL);
  }
  if (settings.openaiApiKey) {
    args.push("--openai-api-key", settings.openaiApiKey);
  }
  if (settings.customSystemPrompt) {
    args.push("--custom-system-prompt", settings.customSystemPrompt);
  }
  if (settings.dualTranslateFirst) {
    args.push("--dual-translate-first");
  }
  if (settings.useAlternatingPagesDual) {
    args.push("--use-alternating-pages-dual");
  }
  if (settings.skipClean) {
    args.push("--skip-clean");
  }
  if (settings.disableRichTextTranslate) {
    args.push("--disable-rich-text-translate");
  }
  if (settings.extraArgs.trim()) {
    args.push(...splitExtraArgs(settings.extraArgs));
  }

  return args;
}

async function buildBabeldocRuntimeEnv(
  settings: ReturnType<typeof getSettings>,
  outputDir: string
) {
  const timeout = Math.max(60, Math.trunc(settings.openaiTimeoutSeconds || 60));
  const patchDir = joinPath(outputDir, ".babeldoc-runtime");
  const progressLogPath = joinPath(outputDir, "babeldoc-progress.jsonl");
  await makeDirectory(patchDir, { createAncestors: true });

  const sitecustomizePath = joinPath(patchDir, "sitecustomize.py");
  const sitecustomize = [
    "import os",
    "import json",
    "timeout_value = os.environ.get('BABELDOC_OPENAI_TIMEOUT_SECONDS', '').strip()",
    "progress_log_path = os.environ.get('BABELDOC_PROGRESS_LOG_PATH', '').strip()",
    "def _append_progress_event(payload):",
    "    if not progress_log_path:",
    "        return",
    "    try:",
    "        with open(progress_log_path, 'a', encoding='utf-8') as fh:",
    "            fh.write(json.dumps(payload, ensure_ascii=False) + '\\n')",
    "    except Exception:",
    "        pass",
    "try:",
    "    import babeldoc.progress_monitor as _bd_progress_monitor",
    "    _orig_pm_init = _bd_progress_monitor.ProgressMonitor.__init__",
    "    def _patched_pm_init(self, *args, **kwargs):",
    "        original_callback = kwargs.get('progress_change_callback')",
    "        if original_callback is not None:",
    "            def _wrapped_progress_callback(**event):",
    "                _append_progress_event(event)",
    "                return original_callback(**event)",
    "            kwargs['progress_change_callback'] = _wrapped_progress_callback",
    "        return _orig_pm_init(self, *args, **kwargs)",
    "    _bd_progress_monitor.ProgressMonitor.__init__ = _patched_pm_init",
    "except Exception:",
    "    pass",
    "if timeout_value:",
    "    try:",
    "        requested_timeout = max(60, int(timeout_value))",
    "    except Exception:",
    "        requested_timeout = None",
    "    if requested_timeout:",
    "        import httpx",
    "        _orig_client_init = httpx.Client.__init__",
    "        def _patched_client_init(self, *args, **kwargs):",
    "            timeout = kwargs.get('timeout')",
    "            if timeout == 60 or timeout is None:",
    "                kwargs['timeout'] = requested_timeout",
    "            return _orig_client_init(self, *args, **kwargs)",
    "        httpx.Client.__init__ = _patched_client_init",
    "        try:",
    "            import openai",
    "            _orig_openai_init = openai.OpenAI.__init__",
    "            def _patched_openai_init(self, *args, **kwargs):",
    "                result = _orig_openai_init(self, *args, **kwargs)",
    "                try:",
    "                    if getattr(self, '_client', None) is not None:",
    "                        self._client.timeout = httpx.Timeout(requested_timeout)",
    "                except Exception:",
    "                    pass",
    "                return result",
    "            openai.OpenAI.__init__ = _patched_openai_init",
    "            _orig_create = openai.resources.chat.completions.Completions.create",
    "            def _patched_create(self, *args, **kwargs):",
    "                if kwargs.get('timeout') in (None, 60):",
    "                    kwargs['timeout'] = requested_timeout",
    "                return _orig_create(self, *args, **kwargs)",
    "            openai.resources.chat.completions.Completions.create = _patched_create",
    "        except Exception:",
    "            pass"
  ].join("\n");
  await writeTextFile(sitecustomizePath, sitecustomize);

  return {
    BABELDOC_OPENAI_TIMEOUT_SECONDS: String(timeout),
    BABELDOC_PROGRESS_LOG_PATH: progressLogPath,
    PYTHONPATH: patchDir
  };
}

async function initializeTaskLog(
  logPath: string,
  settings: ReturnType<typeof getSettings>,
  title: string
) {
  const lines = [
    `Title: ${title}`,
    `Model: ${settings.openaiModel}`,
    `API: ${summarizeApiBaseURL(settings.openaiBaseURL)}`,
    `Started: ${new Date().toISOString()}`,
    ""
  ];
  await writeTextFile(logPath, lines.join("\n"));
}

function buildStartupMessage(settings: ReturnType<typeof getSettings>) {
  return [
    "Launching BabelDOC...",
    `模型: ${settings.openaiModel}`,
    `API: ${summarizeApiBaseURL(settings.openaiBaseURL)}`
  ].join(" · ");
}

function startTaskLogWatcher(
  taskID: string,
  logPath: string,
  progressWin: any,
  title: string,
  win: any
) {
  const timerWindow = win || Zotero.getMainWindow();
  let reading = false;
  let lastLine = "";

  const timer = timerWindow.setInterval(async () => {
    if (reading) {
      return;
    }

    const task = getTask(taskID);
    if (!task || task.status !== "running") {
      timerWindow.clearInterval(timer);
      return;
    }

    reading = true;
    try {
      const runtime = await readTaskRuntime(logPath);
      if (!runtime.lastLine || runtime.lastLine === lastLine) {
        return;
      }

      lastLine = runtime.lastLine;
      updateTask(taskID, {
        message: runtime.message,
        progress: runtime.progress,
        stageProgresses: runtime.stageProgresses
      });
      void saveTasksToDisk();

      progressWin.changeLine({
        text: `运行 BabelDOC: ${title}\n${runtime.message}`,
        progress: runtime.progress
      });
    } catch (_error) {
      // Ignore transient file-read races while BabelDOC is still writing.
    } finally {
      reading = false;
    }
  }, 1000);

  return () => timerWindow.clearInterval(timer);
}

async function readTaskRuntime(logPath: string) {
  const progressLogPath = joinPath(OS.Path.dirname(logPath), "babeldoc-progress.jsonl");
  const progressRuntime = await readStructuredProgress(progressLogPath);
  if (progressRuntime) {
    return progressRuntime;
  }

  if (!(await pathExists(logPath))) {
    return {
      lastLine: "",
      message: "Launching BabelDOC...",
      progress: 18,
      stageProgresses: buildTaskStages("prepare")
    };
  }

  const raw = await readFileTail(logPath, 4096);
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const runtimeLines = lines.filter((line) => !/^(Title|Model|API|Started):/.test(line));
  const tailLines = runtimeLines.slice(-8);
  const lastLine = tailLines.join(" ");

  return {
    lastLine,
    ...describeRuntimeLine(lastLine, tailLines)
  };
}

async function readStructuredProgress(progressLogPath: string) {
  if (!(await pathExists(progressLogPath))) {
    return null;
  }

  const raw = await readFileTail(progressLogPath, 32768);
  const events = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);

  if (!events.length) {
    return null;
  }

  const stageMeta = new Map<string, { key: string; label: string; percent?: number }>();
  const stages = new Map<
    string,
    { key: string; label: string; current: number; total: number; status: string; percent?: number }
  >();

  for (const event of events) {
    if (event.type === "stage_summary" && Array.isArray(event.stages)) {
      for (const stage of event.stages) {
        const key = normalizeStageKey(stage.name);
        stageMeta.set(String(stage.name), {
          key,
          label: String(stage.name),
          percent: Number(stage.percent || 0)
        });
      }
      continue;
    }

    const label = String(event.stage || "").trim();
    if (!label) {
      continue;
    }
    const meta = stageMeta.get(label) || {
      key: normalizeStageKey(label),
      label
    };
    stages.set(meta.key, {
      key: meta.key,
      label: meta.label,
      current: Number(event.stage_current || 0),
      total: Number(event.stage_total || 0),
      status:
        event.type === "progress_end"
          ? "done"
          : event.type === "progress_start" || event.type === "progress_update"
            ? "running"
            : "pending",
      percent: meta.percent
    });
  }

  if (!stages.size) {
    return null;
  }

  const ordered = Array.from(stages.values()).sort(
    (a, b) => stageOrder(a.key) - stageOrder(b.key)
  );
  const active = [...ordered].reverse().find((stage) => stage.status === "running");
  const activeProgress = ordered.map((stage) => ({
    key: stage.key,
    label: stage.label,
    progress:
      stage.total > 0
        ? Math.max(0, Math.min(100, Math.round((stage.current * 100) / stage.total)))
        : stage.status === "done"
          ? 100
          : 0,
    status: (stage.status === "running" ? "running" : stage.status === "done" ? "done" : "pending") as TaskStageStatus,
    current: stage.current,
    total: stage.total,
    detail:
      stage.status === "running" && stage.total > 0
        ? `${stage.current}/${stage.total}`
        : undefined
  }));

  return {
    lastLine: JSON.stringify(events[events.length - 1]),
    message: active
      ? `${active.label} (${active.current}/${active.total || "?"})`
      : "BabelDOC 正在处理。",
    progress: Math.max(
      1,
      Math.min(
        99,
        Math.round(
          Number(events[events.length - 1].overall_progress || inferOverallProgress(activeProgress))
        )
      )
    ),
    stageProgresses: activeProgress
  };
}

function inferOverallProgress(stages: Array<{ progress: number; status: string }>) {
  if (!stages.length) {
    return 0;
  }
  const total = stages.reduce((sum, stage) => sum + stage.progress, 0);
  return total / stages.length;
}

function normalizeStageKey(label: string) {
  const value = label.toLowerCase();
  if (value.includes("parse pdf")) return "parse_pdf";
  if (value.includes("detectscannedfile")) return "detect_scanned";
  if (value.includes("page layout")) return "layout";
  if (value.includes("parse table")) return "table";
  if (value.includes("parse paragraphs")) return "paragraphs";
  if (value.includes("formulas")) return "formulas";
  if (value.includes("extract terms")) return "terms";
  if (value.includes("translate paragraphs")) return "translate";
  if (value.includes("typesetting")) return "typesetting";
  if (value.includes("add fonts")) return "fonts";
  if (value.includes("generate drawing")) return "draw";
  if (value.includes("subset font")) return "subset_font";
  if (value.includes("save pdf")) return "save_pdf";
  return value.replace(/[^a-z0-9]+/g, "_");
}

function stageOrder(key: string) {
  const ordered = [
    "parse_pdf",
    "detect_scanned",
    "layout",
    "table",
    "paragraphs",
    "formulas",
    "terms",
    "translate",
    "typesetting",
    "fonts",
    "draw",
    "subset_font",
    "save_pdf"
  ];
  const index = ordered.indexOf(key);
  return index === -1 ? 999 : index;
}

function describeRuntimeLine(line: string, recentLines: string[] = []) {
  const compact = line.replace(/\s+/g, " ").trim();
  if (!compact) {
    return {
      message: "BabelDOC 已启动，等待输出日志。",
      progress: 20,
      stageProgresses: buildTaskStages("prepare")
    };
  }

  if (/loading onnx model/i.test(compact)) {
    return {
      message: "正在加载版面分析模型。",
      progress: 20,
      stageProgresses: buildTaskStages("analyze")
    };
  }

  if (/using coremlexecutionprovider/i.test(compact)) {
    return {
      message: "正在初始化文档版面分析。",
      progress: 24,
      stageProgresses: buildTaskStages("analyze")
    };
  }

  if (/start to translate:/i.test(compact)) {
    return {
      message: "已开始翻译 PDF 内容。",
      progress: 36,
      stageProgresses: buildTaskStages("translate", undefined, "刚完成文档解析")
    };
  }

  if (/automatic term extraction/i.test(compact) && /starting/i.test(compact)) {
    return {
      message: "正在提取自动术语。",
      progress: 42,
      stageProgresses: buildTaskStages("translate", undefined, "正在提取自动术语")
    };
  }

  if (/automatic terms extract/i.test(compact) && /403|forbidden/i.test(compact)) {
    return {
      message: "自动术语提取被远端拒绝，正在切换回退路径。",
      progress: 45,
      stageProgresses: buildTaskStages("translate", undefined, "术语提取受限，回退中")
    };
  }

  if (/request timed out/i.test(compact) && /try fallback/i.test(compact)) {
    return {
      message: "本地兼容接口请求超时，BabelDOC 正在回退重试。",
      progress: 48,
      stageProgresses: buildTaskStages("translate", undefined, "接口超时，重试中")
    };
  }

  if (/try fallback/i.test(compact)) {
    return {
      message: "BabelDOC 正在回退重试。",
      progress: 48,
      stageProgresses: buildTaskStages("translate", undefined, "回退重试中")
    };
  }

  if (/found (title|first title) paragraph/i.test(compact)) {
    return {
      message: "正在翻译正文段落。",
      progress: 46,
      stageProgresses: buildTaskStages("translate", undefined, "正在处理正文")
    };
  }

  const percentMatch = compact.match(/(\d{1,3})\s*%/);
  if (percentMatch) {
    const value = Math.max(1, Math.min(99, Number(percentMatch[1])));
    return {
      message: compact,
      progress: value,
      stageProgresses: buildTaskStages(
        /render|write|merge|save|typeset|generate/i.test(compact) ? "import" : "translate",
        value
      )
    };
  }

  const lowered = compact.toLowerCase();
  let progress = 28;
  if (/parse|analy|layout|ocr|extract/.test(lowered)) {
    progress = 35;
  } else if (/translate|translat/.test(lowered)) {
    progress = 60;
  } else if (/render|write|merge|save|typeset|generate/.test(lowered)) {
    progress = 82;
  } else if (/done|complete|finished|success/.test(lowered)) {
    progress = 95;
  }

  return {
    message: compact,
    progress,
    stageProgresses: inferStagesFromRuntime(compact, recentLines, progress)
  };
}

function inferStagesFromRuntime(compact: string, recentLines: string[], progress: number) {
  const joined = [compact, ...recentLines].join(" ").toLowerCase();
  if (/loading onnx model|coremlexecutionprovider|doclayout|layout/.test(joined)) {
    return buildTaskStages("analyze");
  }
  if (/start to translate|split points determined|only one part/.test(joined)) {
    return buildTaskStages("translate", progress, "文档已解析，开始翻译");
  }
  if (/found title paragraph|found first title paragraph|translate|fallback|timed out/.test(joined)) {
    return buildTaskStages("translate", progress);
  }
  if (/render|write|merge|save|typeset|generate/.test(joined)) {
    return buildTaskStages("import");
  }
  return buildTaskStages("prepare");
}

function buildTaskStages(
  current:
    | "prepare"
    | "analyze"
    | "translate"
    | "import"
    | "done"
    | "failed"
    | "cancelled",
  translateProgress?: number,
  detail?: string
): TaskStageProgress[] {
  const stages: TaskStageProgress[] = [
    { key: "prepare", label: "准备环境", progress: 0, status: "pending" },
    { key: "analyze", label: "解析版面与段落", progress: 0, status: "pending" },
    { key: "translate", label: "翻译正文", progress: 0, status: "pending" },
    { key: "import", label: "导入结果", progress: 0, status: "pending" }
  ];
  const order = stages.map((stage) => stage.key);
  const currentIndex = current === "done" ? stages.length : order.indexOf(current);

  for (let i = 0; i < stages.length; i++) {
    if (current === "failed") {
      stages[i].status = i < 2 ? "done" : i === 2 ? "failed" : "pending";
      stages[i].progress = i < 2 ? 100 : i === 2 ? Math.max(1, Math.min(99, translateProgress || 60)) : 0;
      continue;
    }
    if (current === "cancelled") {
      stages[i].status = i < 2 ? "done" : i === 2 ? "cancelled" : "pending";
      stages[i].progress = i < 2 ? 100 : i === 2 ? Math.max(1, Math.min(99, translateProgress || 60)) : 0;
      continue;
    }
    if (current === "done" || (currentIndex >= 0 && i < currentIndex)) {
      stages[i].status = "done";
      stages[i].progress = 100;
    } else if (currentIndex >= 0 && i === currentIndex) {
      stages[i].status = "running";
      stages[i].progress =
        stages[i].key === "prepare"
          ? 30
          : stages[i].key === "analyze"
            ? 55
            : stages[i].key === "translate"
              ? Math.max(8, Math.min(99, translateProgress || 55))
              : 35;
    }
  }

  if (current === "done") {
    stages.forEach((stage) => {
      stage.status = "done";
      stage.progress = 100;
    });
  }
  if (detail) {
    const activeStage = stages.find((stage) => stage.status === "running");
    if (activeStage) {
      activeStage.detail = detail;
    }
  }
  return stages;
}

function summarizeApiBaseURL(value: string) {
  return value.trim().replace(/\/+$/, "") || "(default)";
}

function splitExtraArgs(input: string) {
  const result: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && i + 1 < input.length) {
        current += input[++i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }
    if (char === "\\" && i + 1 < input.length) {
      current += input[++i];
      continue;
    }
    current += char;
  }

  if (current) {
    result.push(current);
  }
  return result;
}

function confirmTranslation(attachments: any[], settings: ReturnType<typeof getSettings>, win: any) {
  const previewList = attachments
    .slice(0, 8)
    .map((item: any, index: number) => `${index + 1}. ${item.parentTitle}`)
    .join("\n");
  const moreCount = attachments.length > 8 ? `\n… 另外 ${attachments.length - 8} 个任务` : "";
  const message = [
    `将创建 ${attachments.length} 个 BabelDOC 翻译任务。`,
    "",
    `目标语言: ${settings.langOut}`,
    `模型: ${settings.openaiModel}`,
    `双语模式: ${settings.useAlternatingPagesDual ? "交替页" : "同页 side-by-side"}`,
    "",
    previewList + moreCount
  ].join("\n");

  const flags =
    Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING +
    Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING;

  const index = Services.prompt.confirmEx(
    win || null,
    "开始 BabelDOC 翻译",
    message,
    flags,
    "开始翻译",
    "取消",
    null,
    null,
    {}
  );

  return index === 0;
}

async function readLogTail(logPath: string, lineCount = 20) {
  try {
    if (!(await pathExists(logPath))) {
      return "";
    }
    const raw = await readFileTail(logPath, 8192);
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(-lineCount).join("\n");
  } catch (_error) {
    return "";
  }
}
