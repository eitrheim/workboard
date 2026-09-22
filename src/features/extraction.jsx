import { useEffect, useState } from "react";
import { Check, CheckCircle, FileArrowUp, FileText, ListChecks, Sparkle } from "@phosphor-icons/react";
import { backendApi } from "../api";

function TaskExtraction({ projects, onSendToQueue, onRemove, onNotice }) {
  const [fileState, setFileState] = useState(null);
  const [items, setItems] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [rawText, setRawText] = useState("");
  const [extractingText, setExtractingText] = useState(false);
  const [extractingFile, setExtractingFile] = useState(false);

  useEffect(
    () => () => {
      if (fileState?.url) URL.revokeObjectURL(fileState.url);
    },
    [fileState?.url],
  );

  const loadFile = async (file) => {
    if (!file) return;
    setExtractingFile(true);
    setItems([]);
    try {
      const url = URL.createObjectURL(file);
      const preview = await parseFilePreview(file);
      const dataUrl =
        preview.kind === "image"
          ? await prepareImageForExtraction(file)
          : file.size <= 6 * 1024 * 1024 && preview.kind !== "text"
            ? await fileDataUrl(file)
            : "";
      if (preview.kind === "image" && !dataUrl)
        throw new Error(
          "Could not prepare this image for AI extraction. Try a PNG, JPEG, or WebP screenshot under 6 MB.",
        );
      setFileState({
        name: file.name,
        size: formatFileSize(file.size),
        url,
        kind: preview.kind,
        page: 1,
        pageCount: preview.pages.length || 1,
        pages: preview.pages,
        text: preview.text,
      });
      const result = await backendApi.extractFile(
        file.name,
        file.type || "text/markdown",
        preview.text,
        dataUrl,
        projects,
      );
      const fallbackItems = /\.(md|markdown)$/i.test(file.name) ? extractTaskItems(file.name, preview.text) : [];
      const extractedItems = (result.items?.length ? result.items : fallbackItems).map(withDefaultExtractedOwner);
      setItems(extractedItems);
      onNotice(`AI completed a full pass and extracted ${extractedItems.length} items from ${file.name}`);
    } catch {
      const fallbackItems = /\.(md|markdown)$/i.test(file.name)
        ? extractTaskItems(file.name, (await parseFilePreview(file)).text)
        : [];
      if (fallbackItems.length) {
        setItems(fallbackItems.map(withDefaultExtractedOwner));
        onNotice(`Backend unavailable; extracted ${fallbackItems.length} Markdown tasks locally`);
      } else onNotice(error.message || "Could not extract tasks from this file");
    } finally {
      setExtractingFile(false);
    }
  };

  const replaceFile = (event) => loadFile(event.target.files?.[0]);
  const extractRawText = async () => {
    const text = rawText.trim();
    if (!text || extractingText) return;
    setExtractingText(true);
    try {
      const result = await backendApi.extractFile("Pasted text.md", "text/markdown", text, "", projects);
      setFileState({
        name: "Pasted text.md",
        size: `${text.length} characters`,
        url: "",
        kind: "text",
        page: 1,
        pageCount: 1,
        pages: [text.split(/\r?\n/)],
        text,
      });
      const extractedItems = (result.items?.length ? result.items : extractTaskItems("Pasted text.md", text)).map(
        withDefaultExtractedOwner,
      );
      setItems(extractedItems);
      onNotice(`AI completed a full pass and extracted ${extractedItems.length} items from pasted text`);
    } catch {
      const fallbackItems = extractTaskItems("Pasted text.md", text);
      if (fallbackItems.length) {
        setFileState({
          name: "Pasted text.md",
          size: `${text.length} characters`,
          url: "",
          kind: "text",
          page: 1,
          pageCount: 1,
          pages: [text.split(/\r?\n/)],
          text,
        });
        setItems(fallbackItems.map(withDefaultExtractedOwner));
        onNotice(`Backend unavailable; extracted ${fallbackItems.length} Markdown tasks locally`);
      } else onNotice(error.message || "Could not extract tasks from pasted text");
    } finally {
      setExtractingText(false);
    }
  };
  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    loadFile(event.dataTransfer.files?.[0]);
  };
  const approveOne = async (item) => {
    await onSendToQueue([item], fileState.name, false);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  };
  const removeOne = async (item) => {
    await onRemove(item.id, item);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  };
  const approveAll = async () => {
    const count = items.length;
    await onSendToQueue(items, fileState.name);
    setItems([]);
    onNotice(`${count} extracted ${count === 1 ? "item was" : "items were"} added to the review queue`);
  };
  return (
    <section className="screen-content extraction-screen">
      <div className="extraction-intro">
        <p>Drop a source file here and Workboard will identify tasks, owners, and dates for a quick first pass.</p>
        <span className="read-only-note">
          <Sparkle size={15} /> AI suggestions stay yours to approve
        </span>
      </div>
      <div className="extraction-layout">
        <section className="extraction-pane preview-pane" aria-label="File preview">
          {!fileState ? (
            <>
              <div
                className={`extraction-drop-zone ${dragActive ? "drag-active" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                <div className="drop-icon">
                  <FileArrowUp size={25} />
                </div>
                <h2>Drop a file to extract tasks</h2>
                <p>PDF, DOC, DOCX, TXT, MD, PPT, and images or screenshots</p>
                <label className="primary-button browse-file-button">
                  Choose a file
                  <input type="file" accept=".pdf,.doc,.docx,.txt,.md,.ppt,.pptx,image/*" onChange={replaceFile} />
                </label>
              </div>
              <div className="raw-text-entry">
                <label htmlFor="raw-task-text">Or paste raw text</label>
                <textarea
                  id="raw-task-text"
                  value={rawText}
                  onChange={(event) => setRawText(event.target.value)}
                  placeholder="Paste meeting notes, a transcript, or Markdown here..."
                  rows={6}
                />
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!rawText.trim() || extractingText}
                  onClick={extractRawText}
                >
                  <Sparkle size={17} /> {extractingText ? "Extracting..." : "Extract from text"}
                </button>
                {extractingText && (
                  <p className="extraction-status" role="status">
                    AI is reviewing the pasted text for tasks, milestones, dates, and owners...
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="file-preview-toolbar">
                <div className="file-preview-title">
                  <FileText size={21} />
                  <div>
                    <strong>{fileState.name}</strong>
                    <small>
                      {fileState.size} · {fileKindLabel(fileState.kind)}
                    </small>
                  </div>
                </div>
                <label className="secondary-button replace-file-button">
                  Replace file
                  <input type="file" accept=".pdf,.doc,.docx,.txt,.md,.ppt,.pptx,image/*" onChange={replaceFile} />
                </label>
              </div>
              <div className="file-preview-stage">
                {fileState.kind === "image" && <img src={fileState.url} alt={`Preview of ${fileState.name}`} />}
                {fileState.kind === "pdf" && <iframe src={fileState.url} title={`Preview of ${fileState.name}`} />}
                {fileState.kind === "text" && <pre>{fileState.text || "No readable text was found in this file."}</pre>}
                {fileState.kind === "office" && (
                  <div className="document-page-stack">
                    {fileState.pages.map((page, index) => (
                      <article className="document-page" key={`${fileState.name}-${index}`}>
                        <span>Page {index + 1}</span>
                        {page.map((paragraph, paragraphIndex) => (
                          <p key={`${index}-${paragraphIndex}`}>{paragraph}</p>
                        ))}
                      </article>
                    ))}
                  </div>
                )}
              </div>
              {fileState.pageCount > 1 && (
                <div className="page-indicator">
                  Page {fileState.page} of {fileState.pageCount}
                </div>
              )}
            </>
          )}
        </section>
        <section className="extraction-pane items-pane" aria-label="Extracted tasks and milestones">
          <div className="extracted-header">
            <div>
              <span className="eyebrow">{fileState ? `Extracted from ${fileState.name}` : "Extracted items"}</span>
              <h2>
                {fileState ? `${items.length} ${items.length === 1 ? "item" : "items"} found` : "Nothing extracted yet"}
              </h2>
            </div>
            {fileState && (
              <button
                className="primary-button extracted-approve-all"
                disabled={!items.length || extractingFile}
                onClick={approveAll}
              >
                <Check size={16} /> Approve all
              </button>
            )}
          </div>
          {fileState && extractingFile && (
            <p className="extraction-method-note processing-note" role="status">
              <Sparkle size={14} /> AI is still reviewing the document. Please wait; tasks, milestones, dates, owners,
              and supporting evidence are being extracted.
            </p>
          )}
          {!fileState ? (
            <div className="extracted-empty">
              <ListChecks size={28} />
              <p>Items will appear here after you drop in a file.</p>
            </div>
          ) : (
            <div className="extracted-list">
              {items.map((item) => (
                <ExtractedItemCard
                  item={item}
                  key={item.id}
                  onApprove={() => approveOne(item)}
                  onEdit={() => approveOne(item)}
                  onRemove={() => removeOne(item)}
                />
              ))}
              {!items.length && (
                <div className="extracted-empty compact">
                  {extractingFile ? (
                    <>
                      <Sparkle size={27} />
                      <p>Waiting for the backend to finish the deep pass...</p>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={27} />
                      <p>All extracted items are handled.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      {fileState && (
        <div className="extraction-bottom-bar">
          <div>
            <strong>
              {extractingFile
                ? "Processing document..."
                : items.length
                  ? `${items.length} items ready`
                  : "Extraction complete"}
            </strong>
            <span>
              {extractingFile
                ? "Please wait while AI completes its deep pass."
                : "Approve sends an item to the Review queue. Edit also sends it there for full editing."}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function ExtractedItemCard({ item, onApprove, onEdit, onRemove }) {
  const missing = [!item.owner && "owner", !item.dateLabel && "target date"].filter(Boolean);
  const confidence = missing.length ? "Needs details" : "High confidence";
  return (
    <article className={`extracted-item-card ${missing.length ? "missing-item" : ""}`}>
      <span className="extracted-item-select" aria-hidden="true" />
      <div className="extracted-item-main">
        <div className="extracted-item-title-row">
          <h3>{item.title}</h3>
          <span className={`extraction-confidence ${missing.length ? "needs-details" : "high-confidence"}`}>
            {confidence}
          </span>
        </div>
        <div className="extracted-item-meta">
          <span>{item.project || "Project not found"}</span>
          <span>Owner: {item.owner || "Not found"}</span>
          <span className={!item.dateLabel ? "missing-date-chip" : ""}>
            {item.dateLabel ? `Due ${item.dateLabel}` : "No date found"}
          </span>
        </div>
        <div className="extracted-item-actions">
          <button className="extract-card-approve" onClick={onApprove}>
            Approve
          </button>
          <button className="extract-card-edit" onClick={onEdit}>
            Edit
          </button>
          <button className="extract-card-discard" onClick={onRemove}>
            Discard
          </button>
        </div>
      </div>
    </article>
  );
}

function filePreviewKind(file) {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|svg)$/.test(name)) return "image";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("text/") || /\.(txt|md|markdown)$/.test(name)) return "text";
  if (/\.(doc|docx|ppt|pptx)$/.test(name) || file.type.includes("word") || file.type.includes("presentation"))
    return "office";
  return "office";
}

function fileKindLabel(kind) {
  return kind === "pdf" ? "PDF" : kind === "text" ? "Text file" : kind === "image" ? "Image" : "Office file";
}

function fileDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

async function prepareImageForExtraction(file) {
  const supportedSource = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
  if (supportedSource && file.size <= 5 * 1024 * 1024) return fileDataUrl(file);
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file.size <= 6 * 1024 * 1024 ? fileDataUrl(file) : "";
  let longestSide = Math.min(2800, Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const scale = longestSide / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if ((dataUrl.length * 3) / 4 <= 5 * 1024 * 1024) {
        bitmap.close?.();
        return dataUrl;
      }
    }
    longestSide = Math.round(longestSide * 0.72);
  }
  bitmap.close?.();
  return "";
}

async function parseFilePreview(file) {
  const kind = filePreviewKind(file);
  if (kind === "text") {
    const text = await file.text().catch(() => "");
    return { kind, text, pages: [text.split(/\r?\n/)] };
  }
  if (kind === "office" && /\.(docx|pptx)$/i.test(file.name)) {
    try {
      const pages = await parseOfficeArchive(file);
      return { kind, text: pages.flat().join("\n"), pages };
    } catch {
      return {
        kind,
        text: "",
        pages: [[`The ${file.name} file loaded, but its document content could not be decoded in this browser.`]],
      };
    }
  }
  return { kind, text: "", pages: [[`${file.name} is ready for extraction.`]] };
}

async function parseOfficeArchive(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength));
    const dataStart = nameStart + fileNameLength + extraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (name === "word/document.xml" || /^ppt\/slides\/slide\d+\.xml$/i.test(name)) {
      let content = compressed;
      if (compression === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        content = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      entries.set(name, decoder.decode(content));
    }
    offset = dataStart + compressedSize;
  }
  const slideEntries = [...entries.keys()]
    .filter((name) => name.startsWith("ppt/slides/slide"))
    .sort((left, right) => Number(left.match(/slide(\d+)/i)?.[1] || 0) - Number(right.match(/slide(\d+)/i)?.[1] || 0));
  if (entries.has("word/document.xml"))
    return chunkDocumentPages(
      xmlParagraphs(entries.get("word/document.xml"), "http://schemas.openxmlformats.org/wordprocessingml/2006/main"),
    );
  if (slideEntries.length)
    return slideEntries.map((name) =>
      xmlParagraphs(entries.get(name), "http://schemas.openxmlformats.org/drawingml/2006/main"),
    );
  throw new Error("No supported office document content found");
}

function xmlParagraphs(xml, namespace) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = [...document.getElementsByTagNameNS(namespace, "p")];
  return paragraphs
    .map((paragraph) =>
      [...paragraph.getElementsByTagNameNS(namespace, "t")]
        .map((text) => text.textContent || "")
        .join("")
        .trim(),
    )
    .filter(Boolean);
}

function chunkDocumentPages(paragraphs, perPage = 28) {
  const pages = [];
  for (let index = 0; index < paragraphs.length; index += perPage) pages.push(paragraphs.slice(index, index + perPage));
  return pages.length ? pages : [["No readable document text was found."]];
}

function formatFileSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractTaskItems(fileName, rawText) {
  const lines = rawText
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+] |\d+[.)]\s+|[-*+]\s+|\[[ xX]\]\s+)/, "")
        .replace(/[*_`#]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length >= 8 && line.length <= 220);
  const actionPattern =
    /\b(review|send|share|draft|prepare|confirm|schedule|update|create|finalize|follow[- ]?up|complete|deliver|launch|milestone|coordinate|validate|rewrite|define|stand up|provision|ingest|build|establish|configure|surface|conduct|support|design|program|produce|enable|identify|provide|read|confirm|agree|execute|sign)\b/i;
  const seen = new Set();
  const parsed = lines
    .filter(
      (line) =>
        actionPattern.test(line) || /^(phase\s+\d|scope area|nba sidekick activation|sow execution)/i.test(line),
    )
    .slice(0, 30)
    .map((line, index) => {
      const dateMatch = line.match(
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/i,
      );
      const periodMatch = line.match(/\(~?\s*\d+(?:[–-]\d+)?\s*weeks?\)/i);
      const title = line.replace(/[.!?]+$/, "");
      const type =
        /^(phase\s+\d|scope area|.*milestone|nba sidekick activation|sow execution)/i.test(line) ||
        /\bmilestone\b|\bactivation\b/i.test(line)
          ? "MILESTONE"
          : "TASK";
      const owner = /\bclient\b/i.test(line)
        ? "Client"
        : /\bwest monroe\b/i.test(line)
          ? "West Monroe"
          : /Jeff Pehler/i.test(line)
            ? "Jeff Pehler"
            : /\bSales NBA Product Owner\b/i.test(line)
              ? "Sales NBA Product Owner"
              : /\bTechnical Coordinator\b/i.test(line)
                ? "Technical Coordinator"
                : "";
      const dateLabel = dateMatch?.[0] || periodMatch?.[0]?.replace(/[()]/g, "") || "";
      const key = title.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: `extracted-${index}-${title.slice(0, 10)}`,
        type,
        title,
        owner,
        dateLabel,
        project: "",
        dateKey: dateMatch ? deadlineKeyFromLabel(dateMatch[0]) : null,
      };
    })
    .filter(Boolean);
  return parsed;
}

function extractedTaskOwner(owner) {
  const value = String(owner || "").trim();
  return /^(unknown|unassigned|not found|n\/?a)$/i.test(value) || !value ? "Ann" : value;
}

function withDefaultExtractedOwner(item) {
  return item.type === "MILESTONE" ? item : { ...item, owner: extractedTaskOwner(item.owner) };
}

export {
  TaskExtraction,
  ExtractedItemCard,
  filePreviewKind,
  fileKindLabel,
  fileDataUrl,
  prepareImageForExtraction,
  parseFilePreview,
  parseOfficeArchive,
  xmlParagraphs,
  chunkDocumentPages,
  formatFileSize,
  extractTaskItems,
  extractedTaskOwner,
  withDefaultExtractedOwner,
};
