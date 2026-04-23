import { config } from "../../package.json";
import { getChildren, joinPath, makeDirectory, pathExists, statPath } from "../utils/os";
import { getSettings } from "./prefs";
import type { ResolvedPdfAttachment } from "./zoteroItems";

export async function ensureDirectory(path: string) {
  if (!(await pathExists(path))) {
    await makeDirectory(path, { createAncestors: true });
  }
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildTimestamp() {
  const date = new Date();
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ];
  return parts.join("");
}

export async function getOutputRoot() {
  const settings = getSettings();
  if (settings.outputRoot) {
    await ensureDirectory(settings.outputRoot);
    return settings.outputRoot;
  }

  const root = joinPath(Zotero.DataDirectory.dir, config.addonRef, "output");
  await ensureDirectory(root);
  return root;
}

export async function createTaskOutputDir(source: ResolvedPdfAttachment) {
  const root = await getOutputRoot();
  const folderName = [
    source.attachment.key || source.attachment.id,
    buildTimestamp(),
    slugify(source.displayTitle).slice(0, 48) || "document"
  ].join("-");
  const dir = joinPath(root, folderName);
  await ensureDirectory(dir);
  return dir;
}

export async function findNewestPdf(outputDir: string) {
  const pdfs: Array<{ path: string; lastModified: number }> = [];
  await collectPdfsRecursive(outputDir, pdfs, 3);
  pdfs.sort((a, b) => b.lastModified - a.lastModified);
  return pdfs[0]?.path || null;
}

async function collectPdfsRecursive(
  dir: string,
  results: Array<{ path: string; lastModified: number }>,
  maxDepth: number
) {
  if (maxDepth <= 0) {
    return;
  }

  let children: string[];
  try {
    children = await getChildren(dir);
  } catch (_error) {
    return;
  }

  for (const child of children) {
    let stat: any;
    try {
      stat = await statPath(child);
    } catch (_error) {
      continue;
    }

    if (stat.isDir) {
      await collectPdfsRecursive(child, results, maxDepth - 1);
      continue;
    }

    if (child.toLowerCase().endsWith(".pdf")) {
      results.push({
        path: child,
        lastModified: stat.lastModificationDate.valueOf()
      });
    }
  }
}

export function makeLocalFile(path: string) {
  const file = Components.classes["@mozilla.org/file/local;1"].createInstance(
    Components.interfaces.nsIFile
  );
  file.initWithPath(path);
  return file;
}
