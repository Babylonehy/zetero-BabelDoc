declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  addon: typeof addon;
  ztoolkit: ZToolkit;
  Services: any;
  Components: any;
  ChromeUtils: any;
  IOUtils: any;
  PathUtils: any;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const rootURI: string;
declare const addon: import("../src/addon").default;
declare const ztoolkit: ZToolkit;
declare const Services: any;
declare const Components: any;
declare const ChromeUtils: any;
declare const IOUtils: any;
declare const PathUtils: any;
declare const __env__: "production" | "development";
