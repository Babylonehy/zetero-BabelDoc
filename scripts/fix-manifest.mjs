import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcManifest = join(root, "addon", "manifest.json");
const src = JSON.parse(readFileSync(srcManifest, "utf-8"));
const minVersion = src.applications?.zotero?.strict_min_version;
const maxVersion = src.applications?.zotero?.strict_max_version;

if (!minVersion && !maxVersion) process.exit(0);

const xpiGlob = join(root, "build", "*.xpi");
const xpiFiles = execSync(`ls ${xpiGlob} 2>/dev/null`, { encoding: "utf-8" }).trim().split("\n").filter(Boolean);

for (const xpi of xpiFiles) {
  const tmp = execSync("mktemp -d", { encoding: "utf-8" }).trim();
  execSync(`unzip -o "${xpi}" -d "${tmp}" > /dev/null`);
  const mPath = join(tmp, "manifest.json");
  const manifest = JSON.parse(readFileSync(mPath, "utf-8"));
  let changed = false;
  if (minVersion && manifest.applications?.zotero?.strict_min_version !== minVersion) {
    manifest.applications.zotero.strict_min_version = minVersion;
    changed = true;
  }
  if (maxVersion && manifest.applications?.zotero?.strict_max_version !== maxVersion) {
    manifest.applications.zotero.strict_max_version = maxVersion;
    changed = true;
  }
  if (changed) {
    writeFileSync(mPath, JSON.stringify(manifest, null, 2));
    execSync(`cd "${tmp}" && zip -r "${xpi}" . > /dev/null`);
    console.log(`Fixed manifest in ${xpi}: min=${minVersion} max=${maxVersion}`);
  }
  execSync(`rm -rf "${tmp}"`);
}
