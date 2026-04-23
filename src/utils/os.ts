const { OS } = ChromeUtils.importESModule("chrome://zotero/content/osfile.mjs");

export { OS };

export function joinPath(path: string, ...parts: string[]) {
  return OS.Path.join(path, ...parts);
}

export async function pathExists(path: string) {
  return OS.File.exists(path);
}

export async function makeDirectory(
  path: string,
  options: { createAncestors?: boolean } = {}
) {
  if (options.createAncestors && typeof IOUtils !== "undefined") {
    return IOUtils.makeDirectory(path, {
      createAncestors: true,
      ignoreExisting: true
    });
  }
  return OS.File.makeDir(path, {
    from: options.createAncestors ? OS.Path.dirname(path) : undefined
  });
}

export async function readTextFile(path: string) {
  return OS.File.read(path, { encoding: "utf-8" });
}

export async function writeTextFile(path: string, content: string) {
  return OS.File.writeAtomic(path, content, { encoding: "utf-8" });
}

export async function getChildren(path: string) {
  const iterator = new OS.File.DirectoryIterator(path);
  const entries: string[] = [];
  await iterator.forEach((entry: { path: string }) => {
    entries.push(entry.path);
  });
  iterator.close();
  return entries;
}

export async function statPath(path: string) {
  return OS.File.stat(path);
}

export async function readFileTail(path: string, maxBytes = 8192) {
  if (typeof IOUtils !== "undefined") {
    const info = await IOUtils.stat(path);
    const fileSize: number = info.size;
    const offset = Math.max(0, fileSize - maxBytes);
    const bytes: Uint8Array = await IOUtils.read(path, { offset });
    return new TextDecoder().decode(bytes);
  }
  const raw = await readTextFile(path);
  return raw.slice(-maxBytes);
}
