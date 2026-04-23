import { configureSettingsInteractively } from "./prefs";
import { openTaskManager } from "./taskManager";
import { translateSelectedFromWindow } from "./translator";
import { debugLog } from "../utils/debug";
const ITEM_MENU_ID = "babeldocsidebyside-itemmenu-translate";
const TOOLS_MENU_ID = "babeldocsidebyside-toolsmenu";
const TOOLS_POPUP_ID = "babeldocsidebyside-toolsmenu-popup";
const VIEW_SEPARATOR_ID = "babeldocsidebyside-viewmenu-separator";
const VIEW_TASKS_ID = "babeldocsidebyside-viewmenu-tasks";

function getLabels() {
  const isChinese = String(Zotero.locale || "").toLowerCase().startsWith("zh");
  return isChinese
    ? {
        submenu: "BabelDOC 翻译",
        translate: "使用 BabelDOC 翻译 PDF",
        settings: "BabelDOC 设置",
        tasks: "查看 BabelDOC 任务"
      }
    : {
        submenu: "BabelDOC Translate",
        translate: "Translate PDF with BabelDOC",
        settings: "BabelDOC Settings",
        tasks: "View BabelDOC Tasks"
      };
}

function createXULElement(doc: Document, tag: string) {
  return (doc as any).createXULElement
    ? (doc as any).createXULElement(tag)
    : doc.createElement(tag);
}

async function translateCurrentSelection() {
  const count = await translateSelectedFromWindow(Zotero.getMainWindow());
  if (count > 0) {
    openTaskManager(Zotero.getMainWindow());
  }
}

export function registerMenus(win: _ZoteroTypes.MainWindow = Zotero.getMainWindow()) {
  unregisterMenus();
  void debugLog("registerMenus invoked via direct DOM injection");

  const doc = win.document;
  const labels = getLabels();

  registerItemMenu(doc, labels);
  registerToolsMenu(doc, labels);
  registerViewMenu(doc, labels);

  addon.data.menuIDs = [
    ITEM_MENU_ID,
    TOOLS_MENU_ID,
    VIEW_SEPARATOR_ID,
    VIEW_TASKS_ID
  ];
}

function registerItemMenu(doc: Document, labels: ReturnType<typeof getLabels>) {
  const popup = doc.getElementById("zotero-itemmenu");
  if (!popup || doc.getElementById(ITEM_MENU_ID)) {
    return;
  }

  const menuitem = createXULElement(doc, "menuitem");
  menuitem.id = ITEM_MENU_ID;
  menuitem.setAttribute("label", labels.translate);
  menuitem.addEventListener("command", () => {
    void translateCurrentSelection();
  });
  popup.appendChild(menuitem);
}

function registerToolsMenu(doc: Document, labels: ReturnType<typeof getLabels>) {
  const popup = doc.getElementById("menu_ToolsPopup");
  if (!popup || doc.getElementById(TOOLS_MENU_ID)) {
    return;
  }

  const menu = createXULElement(doc, "menu");
  menu.id = TOOLS_MENU_ID;
  menu.setAttribute("label", labels.submenu);

  const submenuPopup = createXULElement(doc, "menupopup");
  submenuPopup.id = TOOLS_POPUP_ID;

  const translateItem = createXULElement(doc, "menuitem");
  translateItem.id = `${TOOLS_MENU_ID}-translate`;
  translateItem.setAttribute("label", labels.translate);
  translateItem.addEventListener("command", () => {
    void translateCurrentSelection();
  });

  const settingsItem = createXULElement(doc, "menuitem");
  settingsItem.id = `${TOOLS_MENU_ID}-settings`;
  settingsItem.setAttribute("label", labels.settings);
  settingsItem.addEventListener("command", () => {
    void configureSettingsInteractively(Zotero.getMainWindow());
  });

  const tasksItem = createXULElement(doc, "menuitem");
  tasksItem.id = `${TOOLS_MENU_ID}-tasks`;
  tasksItem.setAttribute("label", labels.tasks);
  tasksItem.addEventListener("command", () => {
    openTaskManager(Zotero.getMainWindow());
  });

  submenuPopup.appendChild(translateItem);
  submenuPopup.appendChild(settingsItem);
  submenuPopup.appendChild(tasksItem);
  menu.appendChild(submenuPopup);
  popup.appendChild(menu);
}

function registerViewMenu(doc: Document, labels: ReturnType<typeof getLabels>) {
  const popup = doc.getElementById("menu_viewPopup");
  if (!popup || doc.getElementById(VIEW_TASKS_ID)) {
    return;
  }

  const separator = createXULElement(doc, "menuseparator");
  separator.id = VIEW_SEPARATOR_ID;

  const menuitem = createXULElement(doc, "menuitem");
  menuitem.id = VIEW_TASKS_ID;
  menuitem.setAttribute("label", labels.tasks);
  menuitem.addEventListener("command", () => {
    openTaskManager(Zotero.getMainWindow());
  });

  popup.appendChild(separator);
  popup.appendChild(menuitem);
}

export function unregisterMenus() {
  for (const win of Zotero.getMainWindows()) {
    const doc = win.document;
    doc.getElementById(ITEM_MENU_ID)?.remove();
    doc.getElementById(TOOLS_MENU_ID)?.remove();
    doc.getElementById(VIEW_SEPARATOR_ID)?.remove();
    doc.getElementById(VIEW_TASKS_ID)?.remove();
  }
  addon.data.menuIDs = [];
}
