import { pathExists } from "../utils/os";

export interface ResolvedPdfAttachment {
  attachment: any;
  sourcePath: string;
  displayTitle: string;
  parentTitle: string;
  parentItemID: number | null;
  libraryID: number | undefined;
}

export function hasPdfCandidate(items: any[]) {
  return items.some((item) => {
    if (isPdfAttachment(item)) {
      return true;
    }
    if (typeof item?.getAttachments === "function") {
      return item.getAttachments().length > 0;
    }
    return false;
  });
}

export async function collectPdfAttachments(items: any[]) {
  const seen = new Set<number>();
  const resolved: ResolvedPdfAttachment[] = [];

  for (const item of items) {
    if (isPdfAttachment(item)) {
      const candidate = await resolvePdfAttachment(item);
      if (candidate && !seen.has(candidate.attachment.id)) {
        seen.add(candidate.attachment.id);
        resolved.push(candidate);
      }
      continue;
    }

    if (typeof item?.getAttachments !== "function") {
      continue;
    }

    for (const attachmentID of item.getAttachments()) {
      const attachment = Zotero.Items.get(attachmentID);
      if (!isPdfAttachment(attachment)) {
        continue;
      }
      const candidate = await resolvePdfAttachment(attachment);
      if (candidate && !seen.has(candidate.attachment.id)) {
        seen.add(candidate.attachment.id);
        resolved.push(candidate);
      }
    }
  }

  return resolved;
}

export async function resolvePdfAttachmentByID(attachmentID: number) {
  const attachment = Zotero.Items.get(attachmentID);
  if (!isPdfAttachment(attachment)) {
    return null;
  }
  return resolvePdfAttachment(attachment);
}

export async function importResultAttachment(
  source: ResolvedPdfAttachment,
  filePath: string,
  langOut: string
) {
  const options: any = {
    file: filePath
  };
  if (source.parentItemID) {
    options.parentItemID = source.parentItemID;
  }
  if (source.libraryID != null) {
    options.libraryID = source.libraryID;
  }

  const item = await Zotero.Attachments.importFromFile(options);

  if (item) {
    item.setField?.(
      "title",
      `${source.parentTitle || source.displayTitle} · ${langOut} 双语对照`
    );
    item.addTag?.("babeldoc", 0);
    if (typeof item.saveTx === "function") {
      await item.saveTx();
    } else if (typeof item.save === "function") {
      await item.save();
    }
  }

  return item;
}

export async function openAttachment(win: any, item: any) {
  if (!item) {
    return;
  }

  if (Zotero.Reader?.open) {
    await Zotero.Reader.open(item.id);
    return;
  }

  if (win?.ZoteroPane?.viewAttachment) {
    win.ZoteroPane.viewAttachment(item.id);
  }
}

async function resolvePdfAttachment(item: any) {
  const sourcePath = await getAttachmentPath(item);
  if (!sourcePath || !(await pathExists(sourcePath))) {
    return null;
  }

  const parentItemID = item.parentItemID || item.parentID || null;
  const parentItem = parentItemID ? Zotero.Items.get(parentItemID) : null;
  return {
    attachment: item,
    sourcePath,
    displayTitle: getTitle(item),
    parentTitle: parentItem ? getTitle(parentItem) : getTitle(item),
    parentItemID,
    libraryID: item.libraryID
  } satisfies ResolvedPdfAttachment;
}

async function getAttachmentPath(item: any) {
  if (typeof item?.getFilePathAsync === "function") {
    return item.getFilePathAsync();
  }
  if (typeof item?.getFilePath === "function") {
    return item.getFilePath();
  }
  return null;
}

function getTitle(item: any) {
  return (
    item?.getDisplayTitle?.() ||
    item?.getField?.("title") ||
    item?.title ||
    `Item ${item?.id || ""}`
  );
}

function isPdfAttachment(item: any) {
  if (!item || typeof item.isAttachment !== "function" || !item.isAttachment()) {
    return false;
  }

  if (typeof item.isPDFAttachment === "function") {
    return item.isPDFAttachment();
  }

  return (
    item.attachmentContentType === "application/pdf" ||
    item.getField?.("contentType") === "application/pdf"
  );
}
