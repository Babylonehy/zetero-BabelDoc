import { config } from "../../package.json";

const CUSTOM_SUFFIX_PRESET = "__custom__";
const DEFAULT_OPENAI_BASE_URL_ROOT = "https://api.openai.com";
const DEFAULT_OPENAI_BASE_URL_SUFFIX = "/v1";
const DEFAULT_OPENAI_BASE_URL = `${DEFAULT_OPENAI_BASE_URL_ROOT}${DEFAULT_OPENAI_BASE_URL_SUFFIX}`;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_REQUEST_RETRY_COUNT = 3;
const API_TEST_MAX_RETRIES = 3;
const MODEL_DISCOVERY_MAX_CONCURRENCY = 3;
const MODEL_DISCOVERY_TIMEOUT_MS = 15000;
const BASE_URL_SUFFIX_OPTIONS = [
  { value: DEFAULT_OPENAI_BASE_URL_SUFFIX, label: "/v1" },
  { value: "/openai/v1", label: "/openai/v1" },
  { value: "/api/openai/v1", label: "/api/openai/v1" },
  { value: "", label: "无后缀" },
  { value: CUSTOM_SUFFIX_PRESET, label: "自定义" }
];
const DEFAULT_SYSTEM_PROMPT = [
  "You are a professional native translator who translates the provided text into the target language fluently and accurately.",
  "",
  "Translation rules:",
  "1. Output only the translated content. Do not add explanations, notes, labels, or extra markup.",
  "2. Preserve the original structure exactly, including paragraph count, line breaks, headings, lists, tables, citations, and reading order.",
  "3. Preserve formulas, variables, code, HTML/XML/Markdown tags, URLs, DOIs, file paths, version numbers, and other non-translatable tokens exactly when they should remain unchanged.",
  "4. Keep proper nouns, technical terms, names, and abbreviations accurate and consistent. Use established target-language translations when appropriate.",
  "5. For content that should not be translated, keep the original text unchanged.",
  "6. Make the translation natural, precise, and publication-ready in the target language."
].join("\n");
const API_TEST_PROMPT = "Reply with OK only.";
const MODEL_DISCOVERY_PROMPT =
  "Translate to Simplified Chinese: Published as a conference paper at ICLR 2026";

type ModelProbeStatus =
  | "available"
  | "compatible"
  | "unsupported"
  | "unavailable";

interface ModelCatalogEntry {
  id: string;
}

interface ModelProbeResult {
  id: string;
  status: ModelProbeStatus;
  summary: string;
}

export interface BabelDocSettings {
  command: string;
  langIn: string;
  langOut: string;
  openaiBaseURL: string;
  openaiBaseURLRoot: string;
  openaiBaseURLSuffix: string;
  openaiModel: string;
  openaiApiKey: string;
  customSystemPrompt: string;
  extraArgs: string;
  qps: number;
  openaiTimeoutSeconds: number;
  outputRoot: string;
  openResult: boolean;
  confirmBeforeStart: boolean;
  dualTranslateFirst: boolean;
  useAlternatingPagesDual: boolean;
  skipClean: boolean;
  disableRichTextTranslate: boolean;
  watermarkOutputMode: string;
  keepOutputFiles: boolean;
  autoExtractGlossary: boolean;
  requestRetryCount: number;
}

function getBranch() {
  return Services.prefs.getBranch(`${config.prefsPrefix}.`);
}

function hasUserPref(key: string) {
  try {
    return getBranch().prefHasUserValue(key);
  } catch (_error) {
    return false;
  }
}

function getStringPref(key: string, fallback = "") {
  try {
    return getBranch().getStringPref(key);
  } catch (_error) {
    return fallback;
  }
}

function getGlobalStringPref(key: string, fallback = "") {
  try {
    return Services.prefs.getStringPref(key);
  } catch (_error) {
    return fallback;
  }
}

function firstNonEmpty(values: Array<string | undefined>) {
  for (const value of values) {
    if (value && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function getBoolPref(key: string, fallback = false) {
  try {
    return getBranch().getBoolPref(key);
  } catch (_error) {
    return fallback;
  }
}

function setStringPref(key: string, value: string) {
  getBranch().setStringPref(key, value);
}

function setBoolPref(key: string, value: boolean) {
  getBranch().setBoolPref(key, value);
}

export function getSettings(): BabelDocSettings {
  const fallbackBaseURL = firstNonEmpty([
    getGlobalStringPref("extensions.zotero.aiButler.openaiCompatApiUrl", ""),
    getGlobalStringPref("extensions.zotero.aiButler.openaiApiUrl", ""),
    getGlobalStringPref("extensions.zotero.zoterogpt.api", "")
  ]);
  const fallbackModel = firstNonEmpty([
    getGlobalStringPref("extensions.zotero.aiButler.openaiCompatApiModel", ""),
    getGlobalStringPref("extensions.zotero.aiButler.openaiApiModel", ""),
    getGlobalStringPref("extensions.zotero.zoterogpt.model", "")
  ]);
  const fallbackApiKey = firstNonEmpty([
    getGlobalStringPref("extensions.zotero.aiButler.openaiCompatApiKey", ""),
    getGlobalStringPref("extensions.zotero.aiButler.openaiApiKey", "")
  ]);

  const hasBaseURLParts = [
    "openaiBaseURLRoot",
    "openaiBaseURLSuffixPreset",
    "openaiBaseURLSuffixCustom"
  ].some(hasUserPref);
  const derivedFallback = splitConfiguredBaseURL(
    fallbackBaseURL || DEFAULT_OPENAI_BASE_URL
  );

  let openaiBaseURL = "";
  if (hasBaseURLParts) {
    openaiBaseURL = buildOpenAIBaseURL(
      getStringPref("openaiBaseURLRoot", ""),
      getEffectiveConfiguredSuffix(
        getStringPref("openaiBaseURLSuffixPreset", DEFAULT_OPENAI_BASE_URL_SUFFIX),
        getStringPref("openaiBaseURLSuffixCustom", "")
      )
    );
  } else if (hasUserPref("openaiBaseURL")) {
    openaiBaseURL = normalizeBaseURL(getStringPref("openaiBaseURL", ""));
  } else {
    openaiBaseURL = normalizeBaseURL(fallbackBaseURL || DEFAULT_OPENAI_BASE_URL);
  }
  openaiBaseURL = openaiBaseURL || DEFAULT_OPENAI_BASE_URL;

  const derivedBaseURL = splitConfiguredBaseURL(openaiBaseURL);
  const openaiModel = firstNonEmpty([
    hasUserPref("openaiModel") ? getStringPref("openaiModel", "") : "",
    fallbackModel,
    DEFAULT_OPENAI_MODEL
  ]);
  const openaiApiKey = firstNonEmpty([
    hasUserPref("openaiApiKey") ? getStringPref("openaiApiKey", "") : "",
    fallbackApiKey
  ]);

  const localOllama = isLikelyLocalOllama(openaiBaseURL);
  const qpsFallback = localOllama ? "1" : "4";
  const timeoutFallback = localOllama ? "300" : "60";

  return {
    command: getStringPref("command", "babeldoc").trim(),
    langIn: getStringPref("langIn", "en-US").trim() || "en-US",
    langOut: getStringPref("langOut", "zh-CN").trim() || "zh-CN",
    openaiBaseURL,
    openaiBaseURLRoot:
      (hasBaseURLParts
        ? normalizeBaseURLRoot(getStringPref("openaiBaseURLRoot", ""))
        : derivedBaseURL.root) ||
      derivedFallback.root ||
      DEFAULT_OPENAI_BASE_URL_ROOT,
    openaiBaseURLSuffix:
      normalizeBaseURLSuffix(
        hasBaseURLParts
          ? getEffectiveConfiguredSuffix(
              getStringPref(
                "openaiBaseURLSuffixPreset",
                derivedBaseURL.preset || DEFAULT_OPENAI_BASE_URL_SUFFIX
              ),
              getStringPref("openaiBaseURLSuffixCustom", "")
            )
          : getEffectiveConfiguredSuffix(derivedBaseURL.preset, derivedBaseURL.custom)
      ),
    openaiModel: openaiModel || DEFAULT_OPENAI_MODEL,
    openaiApiKey,
    customSystemPrompt: hasUserPref("customSystemPrompt")
      ? getStringPref("customSystemPrompt", DEFAULT_SYSTEM_PROMPT)
      : DEFAULT_SYSTEM_PROMPT,
    extraArgs: getStringPref("extraArgs", ""),
    qps:
      Number.parseInt(getStringPref("qps", qpsFallback), 10) ||
      Number.parseInt(qpsFallback, 10),
    openaiTimeoutSeconds: clampOpenAITimeout(
      getStringPref("openaiTimeoutSeconds", timeoutFallback)
    ),
    outputRoot: getStringPref("outputRoot", "").trim(),
    openResult: getBoolPref("openResult", true),
    confirmBeforeStart: getBoolPref("confirmBeforeStart", true),
    dualTranslateFirst: getBoolPref("dualTranslateFirst", false),
    useAlternatingPagesDual: getBoolPref("useAlternatingPagesDual", false),
    skipClean: getBoolPref("skipClean", false),
    disableRichTextTranslate: getBoolPref("disableRichTextTranslate", false),
    watermarkOutputMode:
      getStringPref("watermarkOutputMode", "no_watermark").trim() || "no_watermark",
    keepOutputFiles: getBoolPref("keepOutputFiles", true),
    autoExtractGlossary: getBoolPref("autoExtractGlossary", false),
    requestRetryCount: clampRetryCount(getStringPref("requestRetryCount", "3"))
  };
}

function isLikelyLocalOllama(baseURL: string) {
  const normalized = String(baseURL || "").trim().toLowerCase();
  return (
    normalized.startsWith("http://localhost:11434") ||
    normalized.startsWith("http://127.0.0.1:11434")
  );
}

export function isConfigured(settings = getSettings()) {
  return Boolean(settings.command && settings.openaiModel);
}

export async function ensureConfigured(win?: Window) {
  if (isConfigured()) {
    return true;
  }

  return configureSettingsInteractively(win);
}

export async function configureSettingsInteractively(win?: Window) {
  try {
    const current = getSettings();
    const storedSuffix = deriveStoredSuffix(current.openaiBaseURLSuffix);
    const dialogData: Record<string, any> = {
      ...current,
      openaiBaseURLSuffixPreset: storedSuffix.preset,
      openaiBaseURLSuffixCustom: storedSuffix.custom,
      apiTestStatus: "尚未测试。",
      modelDiscoveryStatus: "尚未获取模型列表。",
      detectedModel: current.openaiModel || "",
      modelOptions: buildModelPickerOptions([], current.openaiModel)
    };
    const dialog = new ztoolkit.Dialog(1, 1);

    dialogData.beforeUnloadCallback = () => {
      syncDialogDataFromDocument(dialogData, dialog.window?.document);
    };
    dialogData.loadCallback = () => {
      attachDerivedFieldListeners(dialog);
      refreshDerivedApiFields(dialog);
    };

    dialog
    .addCell(0, 0, {
      tag: "div",
      namespace: "html",
      styles: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "12px",
        minWidth: "760px",
        color: "#1f2937",
        background: "#f8fafc",
        fontFamily:
          "'SF Pro Text', 'PingFang SC', 'Helvetica Neue', Helvetica, Arial, sans-serif"
      },
      children: [
        {
          tag: "div",
          namespace: "html",
          properties: {
            textContent:
              "插件直接使用本机 BabelDOC 和 OpenAI 兼容接口。Base URL 由主地址和后缀拼装，测试按钮会直接请求 chat/completions。"
          },
          styles: {
            fontSize: "13px",
            lineHeight: "1.5",
            color: "#475569"
          }
        },
        {
          tag: "div",
          namespace: "html",
          styles: {
            display: "grid",
            gridTemplateColumns: "170px 1fr",
            gap: "10px 12px",
            alignItems: "center"
          },
          children: [
            ...makeTextField("BabelDOC 命令", "command", {
              id: `${config.addonRef}-command`,
              placeholder: "babeldoc 或 uvx --from BabelDOC babeldoc",
              value: current.command
            }),
            ...makeTextField("源语言", "langIn", {
              id: `${config.addonRef}-lang-in`,
              value: current.langIn
            }),
            ...makeTextField("目标语言", "langOut", {
              id: `${config.addonRef}-lang-out`,
              value: current.langOut
            }),
            ...makeTextField("Base URL 主体", "openaiBaseURLRoot", {
              id: `${config.addonRef}-base-url-root`,
              placeholder: "https://api.openai.com",
              value: current.openaiBaseURLRoot
            }),
            ...makeSelectField("Base URL 后缀预设", "openaiBaseURLSuffixPreset", {
              id: `${config.addonRef}-base-url-suffix-preset`,
              value: dialogData.openaiBaseURLSuffixPreset,
              options: BASE_URL_SUFFIX_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label
              }))
            }),
            ...makeTextField("自定义 Base URL 后缀", "openaiBaseURLSuffixCustom", {
              id: `${config.addonRef}-base-url-suffix-custom`,
              placeholder: "如 /v1beta、/compatible-mode/v1",
              value: dialogData.openaiBaseURLSuffixCustom
            }),
            ...makeTextField("完整 Base URL", "openaiBaseURL", {
              id: `${config.addonRef}-base-url-full`,
              value: current.openaiBaseURL,
              readOnly: true
            }),
            ...makeTextField("模型名", "openaiModel", {
              id: `${config.addonRef}-openai-model`,
              value: current.openaiModel
            }),
            ...makeSelectField("可选模型", "detectedModel", {
              id: `${config.addonRef}-model-candidate-select`,
              value: dialogData.detectedModel,
              options: dialogData.modelOptions
            }),
            ...makePasswordField("API Key", "openaiApiKey", current.openaiApiKey, {
              id: `${config.addonRef}-openai-api-key`
            }),
            ...makeTextField("API 测试重试次数", "requestRetryCount", {
              id: `${config.addonRef}-request-retry-count`,
              placeholder: "1-3",
              value: String(current.requestRetryCount)
            }),
            ...makeTextField("QPS", "qps", {
              id: `${config.addonRef}-qps`,
              value: String(current.qps)
            }),
            ...makeTextField("请求超时(秒)", "openaiTimeoutSeconds", {
              id: `${config.addonRef}-openai-timeout-seconds`,
              placeholder: "60-3600，本地 Ollama 建议 300+",
              value: String(current.openaiTimeoutSeconds)
            }),
            ...makeTextField("输出目录", "outputRoot", {
              id: `${config.addonRef}-output-root`,
              placeholder: "留空则写入 Zotero 数据目录",
              value: current.outputRoot
            }),
            ...makeTextAreaField("自定义 System Prompt", "customSystemPrompt", {
              id: `${config.addonRef}-custom-system-prompt`,
              rows: 7,
              value: current.customSystemPrompt
            }),
            ...makeTextAreaField("API 测试命令", "apiTestCommand", {
              id: `${config.addonRef}-api-test-command`,
              rows: 5,
              value: buildApiTestCommand(current),
              readOnly: true
            }),
            ...makeTextAreaField("附加 BabelDOC 参数", "extraArgs", {
              id: `${config.addonRef}-extra-args`,
              rows: 3,
              placeholder: "--translate-table-text --max-pages-per-part 50",
              value: current.extraArgs
            })
          ]
        },
        {
          tag: "div",
          namespace: "html",
          attributes: {
            id: `${config.addonRef}-model-discovery-status`
          },
          properties: {
            textContent: dialogData.modelDiscoveryStatus
          },
          styles: {
            border: "1px solid #dbe4ee",
            borderRadius: "10px",
            background: "#ffffff",
            padding: "10px 12px",
            fontSize: "13px",
            lineHeight: "1.5",
            color: "#334155"
          }
        },
        {
          tag: "div",
          namespace: "html",
          attributes: {
            id: `${config.addonRef}-api-test-status`
          },
          properties: {
            textContent: dialogData.apiTestStatus
          },
          styles: {
            border: "1px solid #dbe4ee",
            borderRadius: "10px",
            background: "#ffffff",
            padding: "10px 12px",
            fontSize: "13px",
            lineHeight: "1.5",
            color: "#334155"
          }
        },
        {
          tag: "div",
          namespace: "html",
          styles: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px 16px",
            marginTop: "4px"
          },
          children: [
            makeCheckboxField(
              "翻译前弹确认框",
              "confirmBeforeStart",
              current.confirmBeforeStart
            ),
            makeCheckboxField("完成后自动打开结果", "openResult", current.openResult),
            makeCheckboxField(
              "翻译页放在前面",
              "dualTranslateFirst",
              current.dualTranslateFirst
            ),
            makeCheckboxField(
              "交替页双语模式",
              "useAlternatingPagesDual",
              current.useAlternatingPagesDual
            ),
            makeCheckboxField("跳过 clean", "skipClean", current.skipClean),
            makeCheckboxField(
              "禁用 rich text translate",
              "disableRichTextTranslate",
              current.disableRichTextTranslate
            ),
            makeCheckboxField(
              "启用自动术语提取",
              "autoExtractGlossary",
              current.autoExtractGlossary
            )
          ]
        }
      ]
    })
    .setDialogData(dialogData)
    .addButton("获取模型列表", "fetch-models", {
      noClose: true,
      callback() {
        void fetchModelsFromDialog(dialog, win);
      }
    })
    .addButton("检测可用模型", "detect-models", {
      noClose: true,
      callback() {
        void detectModelsFromDialog(dialog, win);
      }
    })
    .addButton("测试 API", "test-api", {
      noClose: true,
      callback() {
        void testApiFromDialog(dialog, win);
      }
    })
    .addButton("恢复默认提示词", "reset-prompt", {
      noClose: true,
      callback() {
        restoreDefaultPrompt(dialog);
      }
    })
    .addButton("保存", "save")
    .addButton("取消", "cancel")
      .open("BabelDOC 设置", {
        width: 920,
        height: 860,
        fitContent: false,
        resizable: true,
        noDialogMode: true,
        centerscreen: true
      });

    await dialog.dialogData.unloadLock?.promise;
    if (dialog.dialogData._lastButtonId !== "save") {
      return false;
    }

    syncDialogDataFromDocument(dialog.dialogData, dialog.window?.document);
    persistDialogSettings(dialog.dialogData);

    Services.prompt.alert(
      win || null,
      "BabelDOC 设置",
      "设置已保存。之后翻译会直接按当前命令、完整 Base URL 和模型配置执行。"
    );
    return true;
  } catch (error: any) {
    const message = error?.message || String(error || "unknown error");
    Zotero.debug(`[${config.addonRef}] configureSettingsInteractively failed: ${message}`);
    Services.prompt.alert(
      win || null,
      "BabelDOC 设置",
      `打开设置失败：${message}`
    );
    return false;
  }
}

function persistDialogSettings(dialogData: Record<string, any>) {
  const openaiBaseURLRoot = normalizeBaseURLRoot(String(dialogData.openaiBaseURLRoot || ""));
  const openaiBaseURLSuffixPreset = normalizeSuffixPreset(
    String(dialogData.openaiBaseURLSuffixPreset || DEFAULT_OPENAI_BASE_URL_SUFFIX)
  );
  const openaiBaseURLSuffixCustom = normalizeBaseURLSuffix(
    String(dialogData.openaiBaseURLSuffixCustom || "")
  );
  const openaiBaseURLSuffix = getEffectiveConfiguredSuffix(
    openaiBaseURLSuffixPreset,
    openaiBaseURLSuffixCustom
  );
  const openaiBaseURL = buildOpenAIBaseURL(openaiBaseURLRoot, openaiBaseURLSuffix);
  const storedSuffix = deriveStoredSuffix(openaiBaseURLSuffix);

  setStringPref("command", String(dialogData.command || "").trim());
  setStringPref("langIn", String(dialogData.langIn || "").trim());
  setStringPref("langOut", String(dialogData.langOut || "").trim());
  setStringPref("openaiBaseURLRoot", openaiBaseURLRoot);
  setStringPref("openaiBaseURLSuffixPreset", storedSuffix.preset);
  setStringPref("openaiBaseURLSuffixCustom", storedSuffix.custom);
  setStringPref("openaiBaseURL", openaiBaseURL);
  setStringPref("openaiModel", String(dialogData.openaiModel || "").trim());
  setStringPref("openaiApiKey", String(dialogData.openaiApiKey || "").trim());
  setStringPref("customSystemPrompt", String(dialogData.customSystemPrompt || ""));
  setStringPref("extraArgs", String(dialogData.extraArgs || ""));
  setStringPref("qps", String(dialogData.qps || "4").trim());
  setStringPref(
    "openaiTimeoutSeconds",
    String(clampOpenAITimeout(String(dialogData.openaiTimeoutSeconds || "60")))
  );
  setStringPref(
    "requestRetryCount",
    String(clampRetryCount(String(dialogData.requestRetryCount || "3")))
  );
  setStringPref("outputRoot", String(dialogData.outputRoot || "").trim());
  setBoolPref("confirmBeforeStart", Boolean(dialogData.confirmBeforeStart));
  setBoolPref("openResult", Boolean(dialogData.openResult));
  setBoolPref("dualTranslateFirst", Boolean(dialogData.dualTranslateFirst));
  setBoolPref(
    "useAlternatingPagesDual",
    Boolean(dialogData.useAlternatingPagesDual)
  );
  setBoolPref("skipClean", Boolean(dialogData.skipClean));
  setBoolPref(
    "disableRichTextTranslate",
    Boolean(dialogData.disableRichTextTranslate)
  );
  setBoolPref("autoExtractGlossary", Boolean(dialogData.autoExtractGlossary));
}

function syncDialogDataFromDocument(dialogData: Record<string, any>, doc?: Document | null) {
  if (!doc) {
    return;
  }

  doc.querySelectorAll("*[data-bind]").forEach((elem: any) => {
    const key = elem.getAttribute("data-bind");
    if (!key) {
      return;
    }
    const prop = elem.getAttribute("data-prop");
    if (prop) {
      dialogData[key] = elem[prop];
    } else if (elem.tagName === "INPUT" && elem.type === "checkbox") {
      dialogData[key] = elem.checked;
    } else {
      dialogData[key] = elem.value;
    }
  });
}

function attachDerivedFieldListeners(dialog: any) {
  const doc = dialog.window?.document;
  if (!doc) {
    return;
  }

  const ids = [
    `${config.addonRef}-base-url-root`,
    `${config.addonRef}-base-url-suffix-preset`,
    `${config.addonRef}-base-url-suffix-custom`,
    `${config.addonRef}-openai-model`,
    `${config.addonRef}-model-candidate-select`,
    `${config.addonRef}-openai-api-key`,
    `${config.addonRef}-request-retry-count`
  ];
  for (const id of ids) {
    const elem = doc.getElementById(id);
    if (!elem) {
      continue;
    }
    const eventName = elem.tagName === "SELECT" ? "change" : "input";
    elem.addEventListener(eventName, () => refreshDerivedApiFields(dialog));
    if (eventName !== "input") {
      elem.addEventListener("input", () => refreshDerivedApiFields(dialog));
    }
  }

  const modelSelect = doc.getElementById(
    `${config.addonRef}-model-candidate-select`
  ) as HTMLSelectElement | null;
  const modelInput = doc.getElementById(
    `${config.addonRef}-openai-model`
  ) as HTMLInputElement | null;
  modelSelect?.addEventListener("change", () => {
    const value = modelSelect.value;
    if (!value || !modelInput) {
      return;
    }
    modelInput.value = value;
    dialog.dialogData.openaiModel = value;
    dialog.dialogData.detectedModel = value;
    refreshDerivedApiFields(dialog);
  });
  modelInput?.addEventListener("input", () => {
    dialog.dialogData.detectedModel = modelInput.value.trim();
    syncModelPickerSelection(dialog, modelInput.value.trim());
  });
}

function refreshDerivedApiFields(dialog: any) {
  const doc = dialog.window?.document;
  if (!doc) {
    return;
  }

  syncDialogDataFromDocument(dialog.dialogData, doc);
  const settings = buildPreviewSettings(dialog.dialogData);
  dialog.dialogData.openaiBaseURL = settings.openaiBaseURL;
  dialog.dialogData.openaiBaseURLSuffix = settings.openaiBaseURLSuffix;
  dialog.dialogData.requestRetryCount = settings.requestRetryCount;
  const customSuffixInput = doc.getElementById(
    `${config.addonRef}-base-url-suffix-custom`
  ) as HTMLInputElement | null;
  const fullBaseURLInput = doc.getElementById(
    `${config.addonRef}-base-url-full`
  ) as HTMLInputElement | null;
  const apiTestCommand = doc.getElementById(
    `${config.addonRef}-api-test-command`
  ) as HTMLTextAreaElement | null;

  if (customSuffixInput) {
    const usingCustomSuffix =
      normalizeSuffixPreset(String(dialog.dialogData.openaiBaseURLSuffixPreset || "")) ===
      CUSTOM_SUFFIX_PRESET;
    customSuffixInput.disabled = !usingCustomSuffix;
    customSuffixInput.readOnly = !usingCustomSuffix;
    customSuffixInput.style.background = usingCustomSuffix ? "#ffffff" : "#f8fafc";
    customSuffixInput.style.opacity = usingCustomSuffix ? "1" : "0.65";
  }
  if (fullBaseURLInput) {
    fullBaseURLInput.value = settings.openaiBaseURL;
  }
  if (apiTestCommand) {
    apiTestCommand.value = buildApiTestCommand(settings);
  }
  syncModelPickerSelection(dialog, settings.openaiModel);
}

async function testApiFromDialog(dialog: any, win?: Window) {
  const doc = dialog.window?.document;
  if (!doc) {
    return;
  }

  syncDialogDataFromDocument(dialog.dialogData, doc);
  const settings = buildPreviewSettings(dialog.dialogData);
  refreshDerivedApiFields(dialog);

  if (!settings.openaiBaseURLRoot) {
    const message = "请先填写 Base URL 主体。";
    setApiTestStatus(dialog, message, "danger");
    Services.prompt.alert(win || null, "BabelDOC 设置", message);
    return;
  }
  if (!settings.openaiModel) {
    const message = "请先填写模型名。";
    setApiTestStatus(dialog, message, "danger");
    Services.prompt.alert(win || null, "BabelDOC 设置", message);
    return;
  }

  try {
    const result = await runApiTest(settings, (status) => {
      setApiTestStatus(dialog, status, "info");
    });
    const successMessage = `测试成功。${result}`;
    setApiTestStatus(dialog, successMessage, "success");
    Services.prompt.alert(win || null, "BabelDOC 设置", successMessage);
  } catch (error: any) {
    const failureMessage = `测试失败。${formatApiTestError(error)}`;
    setApiTestStatus(dialog, failureMessage, "danger");
    Services.prompt.alert(win || null, "BabelDOC 设置", failureMessage);
  }
}

async function runApiTest(
  settings: BabelDocSettings,
  onProgress: (message: string) => void
) {
  const endpoint = `${settings.openaiBaseURL}/chat/completions`;
  const retries = Math.min(API_TEST_MAX_RETRIES, settings.requestRetryCount || 1);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    onProgress(`第 ${attempt}/${retries} 次测试: POST ${endpoint}`);
    try {
      const xhr = await Zotero.HTTP.request("POST", endpoint, {
        body: JSON.stringify({
          model: settings.openaiModel,
          messages: [
            { role: "system", content: API_TEST_PROMPT },
            { role: "user", content: "Connection test" }
          ],
          max_tokens: 8,
          temperature: 0
        }),
        headers: buildApiTestHeaders(settings.openaiApiKey),
        responseType: "text",
        successCodes: false,
        timeout: 30000,
        errorDelayIntervals: [],
        errorDelayMax: 0,
        debug: false,
        logBodyLength: 0
      });

      if (xhr.status < 200 || xhr.status >= 300) {
        throw {
          status: xhr.status,
          responseText: xhr.responseText,
          message: `HTTP ${xhr.status}`
        };
      }

      const payload = parseJsonSafely(xhr.responseText);
      const returnedModel =
        payload?.model || payload?.choices?.[0]?.message?.content?.trim() || "OK";
      return `已连通 ${settings.openaiBaseURL}，模型响应: ${returnedModel}`;
    } catch (error) {
      lastError = error;
      onProgress(
        `第 ${attempt}/${retries} 次失败: ${formatApiTestError(error)}${
          attempt < retries ? "，准备重试。" : ""
        }`
      );
    }
  }

  throw lastError || new Error("API test failed.");
}

async function fetchModelsFromDialog(dialog: any, win?: Window) {
  const doc = dialog.window?.document;
  if (!doc) {
    return;
  }

  syncDialogDataFromDocument(dialog.dialogData, doc);
  const settings = buildPreviewSettings(dialog.dialogData);
  refreshDerivedApiFields(dialog);

  if (!settings.openaiBaseURLRoot) {
    const message = "请先填写 Base URL 主体。";
    setModelDiscoveryStatus(dialog, message, "danger");
    Services.prompt.alert(win || null, "BabelDOC 设置", message);
    return;
  }

  try {
    const models = await fetchModelCatalog(settings, (status) => {
      setModelDiscoveryStatus(dialog, status, "info");
    });
    updateModelPickerOptions(
      dialog,
      buildModelPickerOptions(
        models.map((item) => ({
          value: item.id,
          label: item.id
        })),
        settings.openaiModel
      ),
      settings.openaiModel
    );
    const message = `已获取 ${models.length} 个模型。可继续点“检测可用模型”筛出更适合 PDF 翻译的模型。`;
    setModelDiscoveryStatus(dialog, message, "success");
  } catch (error: any) {
    const message = `获取模型列表失败。${formatApiTestError(error)}`;
    setModelDiscoveryStatus(dialog, message, "danger");
    Services.prompt.alert(win || null, "BabelDOC 设置", message);
  }
}

async function detectModelsFromDialog(dialog: any, win?: Window) {
  const doc = dialog.window?.document;
  if (!doc) {
    return;
  }

  syncDialogDataFromDocument(dialog.dialogData, doc);
  const settings = buildPreviewSettings(dialog.dialogData);
  refreshDerivedApiFields(dialog);

  if (!settings.openaiBaseURLRoot) {
    const message = "请先填写 Base URL 主体。";
    setModelDiscoveryStatus(dialog, message, "danger");
    Services.prompt.alert(win || null, "BabelDOC 设置", message);
    return;
  }

  try {
    const models = await fetchModelCatalog(settings, (status) => {
      setModelDiscoveryStatus(dialog, status, "info");
    });
    const modelIDs = models.map((item) => item.id);
    const results = await probeModelCatalog(settings, modelIDs, (status) => {
      setModelDiscoveryStatus(dialog, status, "info");
    });
    const options = buildDetectedModelOptions(results, settings.openaiModel);
    updateModelPickerOptions(dialog, options, settings.openaiModel);
    const availableOptions = results.filter((item) => item.status === "available");
    const compatibleOptions = results.filter((item) => item.status === "compatible");
    const message = [
      `检测完成，共 ${results.length} 个模型。`,
      `可直接用于翻译: ${availableOptions.length} 个`,
      compatibleOptions.length
        ? `可响应但不建议直接做纯翻译: ${compatibleOptions.length} 个`
        : "",
      availableOptions.length
        ? `优先推荐: ${availableOptions.slice(0, 5).map((item) => item.id).join("、")}`
        : ""
    ]
      .filter(Boolean)
      .join("\n");
    setModelDiscoveryStatus(dialog, message, availableOptions.length ? "success" : "info");
  } catch (error: any) {
    const message = `检测模型失败。${formatApiTestError(error)}`;
    setModelDiscoveryStatus(dialog, message, "danger");
    Services.prompt.alert(win || null, "BabelDOC 设置", message);
  }
}

async function fetchModelCatalog(
  settings: BabelDocSettings,
  onProgress: (message: string) => void
) {
  const endpoint = `${settings.openaiBaseURL}/models`;
  onProgress(`正在获取模型列表: GET ${endpoint}`);

  const xhr = await Zotero.HTTP.request("GET", endpoint, {
    headers: buildApiTestHeaders(settings.openaiApiKey),
    responseType: "text",
    successCodes: false,
    timeout: 30000,
    errorDelayIntervals: [],
    errorDelayMax: 0,
    debug: false,
    logBodyLength: 0
  });

  if (xhr.status < 200 || xhr.status >= 300) {
    throw {
      status: xhr.status,
      responseText: xhr.responseText,
      message: `HTTP ${xhr.status}`
    };
  }

  const payload = parseJsonSafely(xhr.responseText);
  const models = Array.isArray(payload?.data)
    ? payload.data
        .map((item: any) => String(item?.id || "").trim())
        .filter(Boolean)
        .map((id: string) => ({ id }))
    : [];

  if (!models.length) {
    throw new Error("接口没有返回任何模型。");
  }

  return models as ModelCatalogEntry[];
}

async function probeModelCatalog(
  settings: BabelDocSettings,
  modelIDs: string[],
  onProgress: (message: string) => void
) {
  const results: ModelProbeResult[] = new Array(modelIDs.length);
  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.max(
    1,
    Math.min(MODEL_DISCOVERY_MAX_CONCURRENCY, modelIDs.length)
  );

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= modelIDs.length) {
        return;
      }

      const modelID = modelIDs[currentIndex];
      onProgress(`正在检测模型 ${currentIndex + 1}/${modelIDs.length}: ${modelID}`);
      const result = await probeSingleModel(settings, modelID);
      results[currentIndex] = result;
      completed += 1;
      onProgress(
        `已检测 ${completed}/${modelIDs.length}: ${modelID} · ${formatModelProbeSummary(result)}`
      );
    }
  });

  await Promise.all(workers);
  return results;
}

async function probeSingleModel(settings: BabelDocSettings, modelID: string) {
  const endpoint = `${settings.openaiBaseURL}/chat/completions`;
  try {
    const xhr = await Zotero.HTTP.request("POST", endpoint, {
      body: JSON.stringify({
        model: modelID,
        messages: [
          { role: "system", content: API_TEST_PROMPT },
          { role: "user", content: MODEL_DISCOVERY_PROMPT }
        ],
        max_tokens: 48
      }),
      headers: buildApiTestHeaders(settings.openaiApiKey),
      responseType: "text",
      successCodes: false,
      timeout: MODEL_DISCOVERY_TIMEOUT_MS,
      errorDelayIntervals: [],
      errorDelayMax: 0,
      debug: false,
      logBodyLength: 0
    });

    const payload = parseJsonSafely(xhr.responseText);
    if (xhr.status < 200 || xhr.status >= 300) {
      return {
        id: modelID,
        status: classifyUnavailableModel(payload, xhr.status),
        summary: summarizeModelProbeError(xhr.status, xhr.responseText)
      } satisfies ModelProbeResult;
    }

    const content = String(payload?.choices?.[0]?.message?.content || "").trim();
    return {
      id: modelID,
      status: looksLikeDirectTranslation(content) ? "available" : "compatible",
      summary: content || "返回成功，但没有正文内容。"
    } satisfies ModelProbeResult;
  } catch (error: any) {
    const message = error?.message || error?.toString?.() || "请求失败";
    return {
      id: modelID,
      status: "unavailable",
      summary: message
    } satisfies ModelProbeResult;
  }
}

function buildApiTestHeaders(apiKey: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

function classifyUnavailableModel(payload: any, status: number) {
  const message = String(payload?.error?.message || "").toLowerCase();
  if (status === 401 || status === 403) {
    return "unsupported";
  }
  if (message.includes("no available channels")) {
    return "unavailable";
  }
  if (status === 503 || status === 504) {
    return "unavailable";
  }
  return "unsupported";
}

function summarizeModelProbeError(status: number, responseText: string) {
  const summary = summarizeResponseBody(responseText);
  return [status ? `HTTP ${status}` : "", summary].filter(Boolean).join(" · ");
}

function looksLikeDirectTranslation(content: string) {
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    return false;
  }
  if (!/[\u3400-\u9fff]/.test(trimmed)) {
    return false;
  }
  return !/(the user wants|let's break down|i need to|translation:|analysis:)/i.test(
    trimmed
  );
}

function formatModelProbeSummary(result: ModelProbeResult) {
  const prefix =
    result.status === "available"
      ? "可用"
      : result.status === "compatible"
        ? "可响应"
        : result.status === "unsupported"
          ? "受限"
          : "不可用";
  return `${prefix} · ${result.summary.replace(/\s+/g, " ").slice(0, 60)}`;
}

function buildModelPickerOptions(
  options: Array<{ value: string; label: string }>,
  currentModel: string
) {
  const unique = new Map<string, string>();
  unique.set("", "手动输入或选择下方模型");
  if (currentModel && !options.some((option) => option.value === currentModel)) {
    unique.set(currentModel, `当前模型: ${currentModel}`);
  }
  for (const option of options) {
    if (!option.value) {
      continue;
    }
    unique.set(option.value, option.label);
  }
  return Array.from(unique.entries()).map(([value, label]) => ({ value, label }));
}

function buildDetectedModelOptions(results: ModelProbeResult[], currentModel: string) {
  const available = results
    .filter((item) => item.status === "available")
    .map((item) => ({
      value: item.id,
      label: `可用 | ${item.id} | ${item.summary.replace(/\s+/g, " ").slice(0, 36)}`
    }));
  const compatible = results
    .filter((item) => item.status === "compatible")
    .map((item) => ({
      value: item.id,
      label: `可响应 | ${item.id} | ${item.summary.replace(/\s+/g, " ").slice(0, 36)}`
    }));
  return buildModelPickerOptions([...available, ...compatible], currentModel);
}

function updateModelPickerOptions(
  dialog: any,
  options: Array<{ value: string; label: string }>,
  selectedValue: string
) {
  dialog.dialogData.modelOptions = options;
  dialog.dialogData.detectedModel = selectedValue || "";
  const doc = dialog.window?.document;
  const select = doc?.getElementById(
    `${config.addonRef}-model-candidate-select`
  ) as HTMLSelectElement | null;
  if (!select) {
    return;
  }

  select.replaceChildren(
    ...options.map((option) => {
      const elem = doc!.createElement("option");
      elem.value = option.value;
      elem.textContent = option.label;
      elem.selected = option.value === (selectedValue || "");
      return elem;
    })
  );
  select.value = options.some((option) => option.value === selectedValue) ? selectedValue : "";
}

function syncModelPickerSelection(dialog: any, selectedValue: string) {
  const doc = dialog.window?.document;
  const select = doc?.getElementById(
    `${config.addonRef}-model-candidate-select`
  ) as HTMLSelectElement | null;
  if (!select) {
    return;
  }
  const optionValues = Array.from({ length: select.options.length }, (_unused, index) =>
    select.options.item(index)?.value || ""
  );
  if (optionValues.includes(selectedValue)) {
    select.value = selectedValue;
  } else {
    select.value = "";
  }
}

function formatApiTestError(error: any) {
  const status = error?.status || error?.xmlhttp?.status;
  const responseText =
    error?.responseText || error?.xmlhttp?.responseText || error?.response || "";
  const message = error?.message || "";
  const responseSummary = summarizeResponseBody(responseText);

  return [status ? `HTTP ${status}` : "", message, responseSummary]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 320);
}

function summarizeResponseBody(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  if (/^\s*</.test(trimmed)) {
    const titleMatch = trimmed.match(/<title>(.*?)<\/title>/i);
    return titleMatch
      ? `返回了 HTML 错误页: ${titleMatch[1].replace(/\s+/g, " ").trim()}`
      : "返回了 HTML 错误页";
  }

  try {
    const json = JSON.parse(trimmed);
    if (json?.error?.message) {
      return String(json.error.message);
    }
  } catch (_error) {
    // Ignore JSON parse errors.
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 180);
}

function parseJsonSafely(value: string) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function restoreDefaultPrompt(dialog: any) {
  const doc = dialog.window?.document;
  if (!doc) {
    return;
  }

  const promptInput = doc.getElementById(
    `${config.addonRef}-custom-system-prompt`
  ) as HTMLTextAreaElement | null;
  if (!promptInput) {
    return;
  }

  promptInput.value = DEFAULT_SYSTEM_PROMPT;
  dialog.dialogData.customSystemPrompt = DEFAULT_SYSTEM_PROMPT;
}

function setApiTestStatus(dialog: any, text: string, tone: "info" | "success" | "danger") {
  setStatusBox(dialog, `${config.addonRef}-api-test-status`, "apiTestStatus", text, tone);
}

function setModelDiscoveryStatus(
  dialog: any,
  text: string,
  tone: "info" | "success" | "danger"
) {
  setStatusBox(
    dialog,
    `${config.addonRef}-model-discovery-status`,
    "modelDiscoveryStatus",
    text,
    tone
  );
}

function setStatusBox(
  dialog: any,
  elementID: string,
  dialogKey: string,
  text: string,
  tone: "info" | "success" | "danger"
) {
  const doc = dialog.window?.document;
  const box = doc?.getElementById(elementID) as HTMLDivElement | null;
  if (!box) {
    return;
  }

  dialog.dialogData[dialogKey] = text;
  box.textContent = text;
  box.style.color =
    tone === "success" ? "#166534" : tone === "danger" ? "#b91c1c" : "#334155";
  box.style.borderColor =
    tone === "success" ? "#86efac" : tone === "danger" ? "#fca5a5" : "#dbe4ee";
  box.style.background =
    tone === "success" ? "#f0fdf4" : tone === "danger" ? "#fef2f2" : "#ffffff";
}

function buildPreviewSettings(dialogData: Record<string, any>): BabelDocSettings {
  const openaiBaseURLRoot = normalizeBaseURLRoot(
    String(dialogData.openaiBaseURLRoot || "")
  );
  const openaiBaseURLSuffixPreset = normalizeSuffixPreset(
    String(dialogData.openaiBaseURLSuffixPreset || DEFAULT_OPENAI_BASE_URL_SUFFIX)
  );
  const openaiBaseURLSuffixCustom = normalizeBaseURLSuffix(
    String(dialogData.openaiBaseURLSuffixCustom || "")
  );
  const openaiBaseURLSuffix = getEffectiveConfiguredSuffix(
    openaiBaseURLSuffixPreset,
    openaiBaseURLSuffixCustom
  );

  return {
    command: String(dialogData.command || "").trim(),
    langIn: String(dialogData.langIn || "en-US").trim() || "en-US",
    langOut: String(dialogData.langOut || "zh-CN").trim() || "zh-CN",
    openaiBaseURL: buildOpenAIBaseURL(
      openaiBaseURLRoot,
      openaiBaseURLSuffix
    ),
    openaiBaseURLRoot,
    openaiBaseURLSuffix,
    openaiModel: String(dialogData.openaiModel || "").trim(),
    openaiApiKey: String(dialogData.openaiApiKey || "").trim(),
    customSystemPrompt: String(dialogData.customSystemPrompt || ""),
    extraArgs: String(dialogData.extraArgs || ""),
    qps: Number.parseInt(String(dialogData.qps || "4"), 10) || 4,
    openaiTimeoutSeconds: clampOpenAITimeout(
      String(dialogData.openaiTimeoutSeconds || "60")
    ),
    outputRoot: String(dialogData.outputRoot || "").trim(),
    openResult: Boolean(dialogData.openResult),
    confirmBeforeStart: Boolean(dialogData.confirmBeforeStart),
    dualTranslateFirst: Boolean(dialogData.dualTranslateFirst),
    useAlternatingPagesDual: Boolean(dialogData.useAlternatingPagesDual),
    skipClean: Boolean(dialogData.skipClean),
    disableRichTextTranslate: Boolean(dialogData.disableRichTextTranslate),
    watermarkOutputMode: String(dialogData.watermarkOutputMode || "no_watermark"),
    keepOutputFiles: Boolean(dialogData.keepOutputFiles),
    autoExtractGlossary: Boolean(dialogData.autoExtractGlossary),
    requestRetryCount: clampRetryCount(String(dialogData.requestRetryCount || "3"))
  };
}

function buildOpenAIBaseURL(baseURLRoot: string, suffix: string) {
  const normalizedRoot = normalizeBaseURLRoot(baseURLRoot);
  const normalizedSuffix = normalizeBaseURLSuffix(suffix);

  if (!normalizedRoot) {
    return normalizedSuffix;
  }
  if (!normalizedSuffix) {
    return normalizedRoot;
  }
  return `${normalizedRoot}${normalizedSuffix}`;
}

function splitConfiguredBaseURL(fullBaseURL: string) {
  const normalized = normalizeBaseURL(fullBaseURL);
  if (!normalized) {
    return {
      root: DEFAULT_OPENAI_BASE_URL_ROOT,
      preset: DEFAULT_OPENAI_BASE_URL_SUFFIX,
      custom: ""
    };
  }

  const matched = [...BASE_URL_SUFFIX_OPTIONS]
    .filter((option) => option.value && option.value !== CUSTOM_SUFFIX_PRESET)
    .sort((a, b) => b.value.length - a.value.length)
    .find((option) => normalized.toLowerCase().endsWith(option.value.toLowerCase()));

  if (matched) {
    const root = normalized.slice(0, -matched.value.length) || DEFAULT_OPENAI_BASE_URL_ROOT;
    return {
      root: normalizeBaseURLRoot(root),
      preset: matched.value,
      custom: ""
    };
  }

  try {
    const parsed = new URL(normalized);
    const suffix = normalizeBaseURLSuffix(parsed.pathname);
    return {
      root: normalizeBaseURLRoot(parsed.origin),
      preset: suffix ? CUSTOM_SUFFIX_PRESET : "",
      custom: suffix
    };
  } catch (_error) {
    return {
      root: normalized,
      preset: "",
      custom: ""
    };
  }
}

function getEffectiveConfiguredSuffix(preset: string, custom: string) {
  return normalizeSuffixPreset(preset) === CUSTOM_SUFFIX_PRESET
    ? normalizeBaseURLSuffix(custom)
    : normalizeBaseURLSuffix(normalizeSuffixPreset(preset));
}

function deriveStoredSuffix(suffix: string) {
  const normalizedSuffix = normalizeBaseURLSuffix(suffix);
  if (!normalizedSuffix) {
    return {
      preset: "",
      custom: ""
    };
  }

  const preset = BASE_URL_SUFFIX_OPTIONS.find((option) => option.value === normalizedSuffix);
  if (preset && preset.value !== CUSTOM_SUFFIX_PRESET) {
    return {
      preset: preset.value,
      custom: ""
    };
  }

  return {
    preset: CUSTOM_SUFFIX_PRESET,
    custom: normalizedSuffix
  };
}

function normalizeBaseURL(value: string) {
  return normalizeBaseURLRoot(value);
}

function normalizeBaseURLRoot(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeBaseURLSuffix(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "");
}

function normalizeSuffixPreset(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === CUSTOM_SUFFIX_PRESET) {
    return CUSTOM_SUFFIX_PRESET;
  }
  if (BASE_URL_SUFFIX_OPTIONS.some((option) => option.value === trimmed)) {
    return trimmed;
  }
  return CUSTOM_SUFFIX_PRESET;
}

function clampRetryCount(value: string | number) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REQUEST_RETRY_COUNT;
  }
  return Math.max(1, Math.min(API_TEST_MAX_RETRIES, Math.trunc(parsed)));
}

function clampOpenAITimeout(value: string | number) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60;
  }
  return Math.max(60, Math.min(3600, Math.trunc(parsed)));
}

function buildApiTestCommand(settings: Partial<BabelDocSettings>) {
  const openaiBaseURL = buildOpenAIBaseURL(
    String(settings.openaiBaseURLRoot || ""),
    String(settings.openaiBaseURLSuffix || "")
  );
  const endpoint = `${openaiBaseURL || DEFAULT_OPENAI_BASE_URL}/chat/completions`;
  const model = String(settings.openaiModel || DEFAULT_OPENAI_MODEL);
  const payload = JSON.stringify({
    model,
    messages: [
      { role: "system", content: API_TEST_PROMPT },
      { role: "user", content: "Connection test" }
    ],
    max_tokens: 8,
    temperature: 0
  });

  const headers = [
    "-H",
    shellQuote("Content-Type: application/json"),
    ...(String(settings.openaiApiKey || "").trim()
      ? ["-H", shellQuote("Authorization: Bearer <redacted>")]
      : [])
  ].join(" ");

  return [
    "curl -sS",
    shellQuote(endpoint),
    headers,
    "--data",
    shellQuote(payload)
  ].join(" ");
}

function shellQuote(value: string) {
  if (!value) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function makeTextField(
  label: string,
  bindKey: string,
  options: {
    id?: string;
    placeholder?: string;
    value?: string;
    readOnly?: boolean;
  } = {}
) {
  const attributes: Record<string, string> = {
    type: "text",
    "data-bind": bindKey,
    "data-prop": "value"
  };
  if (options.id) {
    attributes.id = options.id;
  }
  if (options.placeholder) {
    attributes.placeholder = options.placeholder;
  }
  if (options.readOnly) {
    attributes.readonly = "true";
  }

  return [
    makeLabel(label),
    {
      tag: "input",
      namespace: "html",
      attributes,
      properties: {
        value: options.value || "",
        readOnly: Boolean(options.readOnly)
      },
      styles: {
        ...makeInputStyles(),
        background: options.readOnly ? "#f8fafc" : "#ffffff"
      }
    }
  ];
}

function makePasswordField(
  label: string,
  bindKey: string,
  value = "",
  options: { id?: string } = {}
) {
  const attributes: Record<string, string> = {
    type: "password",
    "data-bind": bindKey,
    "data-prop": "value"
  };
  if (options.id) {
    attributes.id = options.id;
  }

  return [
    makeLabel(label),
    {
      tag: "input",
      namespace: "html",
      attributes,
      properties: {
        value
      },
      styles: makeInputStyles()
    }
  ];
}

function makeTextAreaField(
  label: string,
  bindKey: string,
  options: {
    id?: string;
    rows?: number;
    placeholder?: string;
    value?: string;
    readOnly?: boolean;
  } = {}
) {
  const attributes: Record<string, string> = {
    rows: String(options.rows || 3),
    "data-bind": bindKey,
    "data-prop": "value"
  };
  if (options.id) {
    attributes.id = options.id;
  }
  if (options.placeholder) {
    attributes.placeholder = options.placeholder;
  }
  if (options.readOnly) {
    attributes.readonly = "true";
  }

  return [
    makeLabel(label),
    {
      tag: "textarea",
      namespace: "html",
      attributes,
      properties: {
        value: options.value || "",
        readOnly: Boolean(options.readOnly)
      },
      styles: {
        ...makeInputStyles(),
        minHeight: `${(options.rows || 3) * 24 + 18}px`,
        resize: "vertical",
        background: options.readOnly ? "#f8fafc" : "#ffffff"
      }
    }
  ];
}

function makeSelectField(
  label: string,
  bindKey: string,
  options: {
    id?: string;
    value?: string;
    options: Array<{ value: string; label: string }>;
  }
) {
  const attributes: Record<string, string> = {
    "data-bind": bindKey,
    "data-prop": "value"
  };
  if (options.id) {
    attributes.id = options.id;
  }

  return [
    makeLabel(label),
    {
      tag: "select",
      namespace: "html",
      attributes,
      children: options.options.map((option) => ({
        tag: "option",
        namespace: "html",
        attributes: {
          value: option.value
        },
        properties: {
          textContent: option.label,
          selected: option.value === (options.value || "")
        }
      })),
      properties: {
        value: options.value || ""
      },
      styles: makeInputStyles()
    }
  ];
}

function makeCheckboxField(label: string, bindKey: string, checked = false) {
  return {
    tag: "label",
    namespace: "html",
    styles: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "13px",
      color: "#0f172a"
    },
    children: [
      {
        tag: "input",
        namespace: "html",
        attributes: {
          type: "checkbox",
          "data-bind": bindKey,
          "data-prop": "checked"
        },
        properties: {
          checked
        }
      },
      {
        tag: "span",
        namespace: "html",
        properties: {
          textContent: label
        }
      }
    ]
  };
}

function makeLabel(text: string) {
  return {
    tag: "label",
    namespace: "html",
    properties: {
      textContent: text
    },
    styles: {
      fontSize: "13px",
      fontWeight: "600",
      color: "#0f172a",
      alignSelf: "start",
      paddingTop: "8px"
    }
  };
}

function makeInputStyles() {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: "13px"
  };
}
