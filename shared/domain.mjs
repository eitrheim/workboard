const DEFAULT_TIME_ZONE = "America/Los_Angeles";

export function dateKeyFromDate(value, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function todayKey(timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  return dateKeyFromDate(now, timeZone);
}

export function parseDeadline(value, { timeZone = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const text = String(value ?? "").trim();
  if (!text || /^no deadline$/i.test(text)) return null;
  if (/^today$/i.test(text)) return todayKey(timeZone, now);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const normalizedText = text.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
  const numericDate = normalizedText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (numericDate) {
    const [, month, day, rawYear] = numericDate;
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const candidate = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === Number(month) - 1 && candidate.getUTCDate() === Number(day)) return candidate.toISOString().slice(0, 10);
  }
  const hasExplicitYear = /(?:^|\D)(?:19|20)\d{2}(?:\D|$)/.test(normalizedText);
  const datedText = hasExplicitYear ? normalizedText : `${normalizedText} ${todayKey(timeZone, now).slice(0, 4)}`;
  const parsed = Date.parse(datedText);
  return Number.isNaN(parsed) ? null : dateKeyFromDate(new Date(parsed), timeZone);
}

export function dateOnly(value, options = {}) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : dateKeyFromDate(value, options.timeZone || DEFAULT_TIME_ZONE);
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : parseDeadline(text, options);
}

export function dateLabel(value, options = {}) {
  const key = dateOnly(value, options);
  if (!key) return "No deadline";
  if (key === todayKey(options.timeZone || DEFAULT_TIME_ZONE, options.now || new Date())) return "Today";
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: options.timeZone || DEFAULT_TIME_ZONE });
}

export function parseEffort(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/(?:\d+(?:\.\d+)?|\.\d+)/);
  const effort = match ? Number(match[0]) : Number(value);
  return Number.isFinite(effort) && effort > 0 ? effort : 1;
}

export function effortPoints(hours) {
  const effort = Number(hours) || 1;
  return effort >= 4 ? 40 : effort > 1 ? 20 : 10;
}

export function isAnnOwner(owner) {
  return String(owner || "").trim().toLowerCase() === "ann";
}
