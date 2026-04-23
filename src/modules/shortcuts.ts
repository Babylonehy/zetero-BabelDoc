import { openTaskManager } from "./taskManager";
import { translateSelectedFromWindow } from "./translator";

export type KeyboardCallback = (
  event: KeyboardEvent,
  options: {
    keyboard?: any;
    type: "keydown" | "keyup";
  }
) => void;

export function registerShortcuts() {
  unregisterShortcuts();

  const callback: KeyboardCallback = async (event, options) => {
    if (options.type !== "keydown") {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (!event.shiftKey) {
      return;
    }

    const key = event.key.toUpperCase();
    if (key === "A") {
      event.preventDefault();
      event.stopPropagation();
      const count = await translateSelectedFromWindow(Zotero.getMainWindow());
      if (count > 0) {
        openTaskManager(Zotero.getMainWindow());
      }
    } else if (key === "T") {
      event.preventDefault();
      event.stopPropagation();
      openTaskManager(Zotero.getMainWindow());
    }
  };

  addon.data.shortcutCallback = callback;
  addon.data.ztoolkit.Keyboard.register(callback);
}

export function unregisterShortcuts() {
  if (addon.data.shortcutCallback) {
    addon.data.ztoolkit.Keyboard.unregister(addon.data.shortcutCallback);
    addon.data.shortcutCallback = null;
  }
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }

  const tagName = (element.tagName || "").toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    (element as HTMLElement).isContentEditable
  );
}
