pref("command", "babeldoc");
pref("langIn", "en-US");
pref("langOut", "zh-CN");
pref("openaiBaseURL", "https://api.openai.com/v1");
pref("openaiBaseURLRoot", "https://api.openai.com");
pref("openaiBaseURLSuffixPreset", "/v1");
pref("openaiBaseURLSuffixCustom", "");
pref("openaiModel", "gpt-4o-mini");
pref("openaiApiKey", "");
pref(
  "customSystemPrompt",
  "You are a professional native translator who translates the provided text into the target language fluently and accurately.\\n\\nTranslation rules:\\n1. Output only the translated content. Do not add explanations, notes, labels, or extra markup.\\n2. Preserve the original structure exactly, including paragraph count, line breaks, headings, lists, tables, citations, and reading order.\\n3. Preserve formulas, variables, code, HTML/XML/Markdown tags, URLs, DOIs, file paths, version numbers, and other non-translatable tokens exactly when they should remain unchanged.\\n4. Keep proper nouns, technical terms, names, and abbreviations accurate and consistent. Use established target-language translations when appropriate.\\n5. For content that should not be translated, keep the original text unchanged.\\n6. Make the translation natural, precise, and publication-ready in the target language."
);
pref("extraArgs", "");
pref("qps", "4");
pref("requestRetryCount", "3");
pref("outputRoot", "");
pref("openResult", true);
pref("confirmBeforeStart", true);
pref("dualTranslateFirst", false);
pref("useAlternatingPagesDual", false);
pref("skipClean", false);
pref("disableRichTextTranslate", false);
pref("watermarkOutputMode", "no_watermark");
pref("keepOutputFiles", true);
pref("autoExtractGlossary", false);
