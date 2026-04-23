import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();

if (!basicTool.getGlobal("Zotero")[config.addonInstance]) {
  _globalThis.addon = new Addon();

  defineGlobal("Zotero");
  defineGlobal("window");
  defineGlobal("document");
  defineGlobal("ZoteroPane");
  defineGlobal("Zotero_Tabs");
  defineGlobal("ztoolkit", () => _globalThis.addon.data.ztoolkit);

  Zotero[config.addonInstance] = addon;
}

function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    configurable: true,
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    }
  });
}
