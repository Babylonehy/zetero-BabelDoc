import { config } from "../package.json";
import { registerMenus, unregisterMenus } from "./modules/menu";
import { getSettings } from "./modules/prefs";
import { registerShortcuts, unregisterShortcuts } from "./modules/shortcuts";
import {
  loadTasksFromDisk,
  markInterruptedTasks,
  saveTasksToDisk
} from "./modules/tasks";
import { startTaskRunner } from "./modules/translator";
import { createZToolkit } from "./utils/ztoolkit";
import { initLocale } from "./utils/locale";
import { debugLog, debugLogError } from "./utils/debug";

async function onStartup() {
  try {
    await debugLog("onStartup begin");
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise
    ]);
    await debugLog("startup promises resolved");

    initLocale();
    await debugLog("locale initialized");
    await loadTasksFromDisk();
    await debugLog(`tasks loaded: ${addon.data.tasks.length}`);
    markInterruptedTasks();

    await Promise.all(
      Zotero.getMainWindows().map((win: _ZoteroTypes.MainWindow) =>
        onMainWindowLoad(win)
      )
    );
    await debugLog("main windows loaded");

    registerShortcuts();
    await debugLog("shortcuts registered");

    if (getSettings().command && getSettings().openaiModel) {
      void startTaskRunner(Zotero.getMainWindow());
      await debugLog("task runner scheduled");
    } else {
      await debugLog("task runner skipped due to settings");
    }
    addon.data.initialized = true;
    await debugLog("onStartup completed");
  } catch (error) {
    await debugLogError("onStartup failed", error);
    throw error;
  }
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow) {
  try {
    addon.data.ztoolkit = createZToolkit();
    win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-addon.ftl`);
    registerMenus();
    await debugLog(`onMainWindowLoad ok: ${win.location?.href || "unknown-window"}`);
  } catch (error) {
    await debugLogError("onMainWindowLoad failed", error);
    throw error;
  }
}

async function onMainWindowUnload(win: Window) {}

async function onShutdown() {
  await debugLog("onShutdown begin");
  unregisterMenus();
  unregisterShortcuts();
  await saveTasksToDisk();
  addon.data.alive = false;
  delete Zotero[addon.data.config.addonInstance];
  await debugLog("onShutdown completed");
}

export default {
  onStartup,
  onMainWindowLoad,
  onMainWindowUnload,
  onShutdown
};
