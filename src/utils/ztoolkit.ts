import { ZoteroToolkit } from "zotero-plugin-toolkit";
import { config } from "../../package.json";

export function createZToolkit() {
  const toolkit = new ZoteroToolkit();
  toolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  toolkit.basicOptions.log.disableConsole = __env__ === "production";
  toolkit.basicOptions.api.pluginID = config.addonID;
  return toolkit;
}
