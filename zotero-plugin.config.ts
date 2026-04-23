import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: "dist",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: "https://raw.githubusercontent.com/Babylonehy/zetero-BabelDoc/main/update.json",
  xpiDownloadLink: "https://github.com/Babylonehy/zetero-BabelDoc/releases/download/v{{version}}/babel-doc-side-by-side.xpi",
  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}"
    },
    prefs: {
      prefix: pkg.config.prefsPrefix
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV || "production"}"`
        },
        bundle: true,
        target: "firefox140",
        outfile: `dist/addon/content/scripts/${pkg.config.addonRef}.js`
      }
    ]
  },
  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`
  }
});
