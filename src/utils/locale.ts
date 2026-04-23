import { config } from "../../package.json";

export interface LocalizationLike {
  current: any;
}

export function initLocale() {
  const LocalizationCtor =
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization;
  const l10n = new LocalizationCtor([`${config.addonRef}-addon.ftl`], true);
  addon.data.locale = {
    current: l10n
  };
}

export function getString(id: string, args?: Record<string, any>) {
  return addon.data.locale?.current?.formatValueSync
    ? addon.data.locale.current.formatValueSync(id, args)
    : id;
}
