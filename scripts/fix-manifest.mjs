import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const srcManifest = join(root, "addon", "manifest.json");
const src = JSON.parse(readFileSync(srcManifest, "utf-8"));

const xpiGlob = join(root, "build", "*.xpi");
const xpiFiles = execSync(`ls ${xpiGlob} 2>/dev/null`, { encoding: "utf-8" }).trim().split("\n").filter(Boolean);

const patches = {
  version: pkg.version,
  author: pkg.author,
  description: pkg.description,
  homepage_url: pkg.homepage,
  "applications.zotero.strict_min_version": src.applications?.zotero?.strict_min_version,
  "applications.zotero.strict_max_version": src.applications?.zotero?.strict_max_version,
  "applications.zotero.update_url": src.applications?.zotero?.update_url,
};

for (const xpi of xpiFiles) {
  const tmp = execSync("mktemp -d", { encoding: "utf-8" }).trim();
  execSync(`unzip -o "${xpi}" -d "${tmp}" > /dev/null`);
  const mPath = join(tmp, "manifest.json");
  const manifest = JSON.parse(readFileSync(mPath, "utf-8"));
  let changed = false;

  for (const [key, value] of Object.entries(patches)) {
    if (!value) continue;
    const parts = key.split(".");
    let target = manifest;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!target[parts[i]]) target[parts[i]] = {};
      target = target[parts[i]];
    }
    const field = parts[parts.length - 1];
    if (target[field] !== value) {
      target[field] = value;
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(mPath, JSON.stringify(manifest, null, 2));
    execSync(`cd "${tmp}" && zip -r "${xpi}" . > /dev/null`);
    console.log(`Fixed manifest in ${xpi}`);
  }
  execSync(`rm -rf "${tmp}"`);
}
