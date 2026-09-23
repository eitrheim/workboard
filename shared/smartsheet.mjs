function normalized(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function findSmartsheetColumn(columns = [], ...names) {
  const wanted = names.map(normalized);
  return columns.find((column) => wanted.includes(normalized(column.title)));
}

export function mapSmartsheetColumns(columns = []) {
  return {
    task: findSmartsheetColumn(columns, "task"),
    project: findSmartsheetColumn(columns, "category"),
    deadline: findSmartsheetColumn(columns, "due date"),
    owner: findSmartsheetColumn(columns, "owner"),
    effort: findSmartsheetColumn(columns, "loe", "loe (in hours)"),
    status: findSmartsheetColumn(columns, "status"),
  };
}

export function smartsheetRowValues(row = {}, columns = []) {
  const values = new Map((row.cells || []).map((cell) => [cell.columnId, cell.displayValue ?? cell.value ?? ""]));
  return Object.fromEntries(columns.map((column) => [normalized(column.title), values.get(column.id) ?? ""]));
}

export function buildSmartsheetTaskCells(columns, { title, project, deadline, owner, effortHours, status } = {}) {
  const mapped = mapSmartsheetColumns(columns);
  const fields = [
    [mapped.task, title],
    [mapped.project, project || "Unassigned"],
    [mapped.deadline, deadline || ""],
    [mapped.owner, owner || "Unassigned"],
    [mapped.effort, effortHours],
    [mapped.status, status],
  ];
  return fields.flatMap(([column, value]) =>
    column && value !== "" && value !== undefined && value !== null ? [{ columnId: column.id, value }] : [],
  );
}

export function buildSmartsheetFieldCells(columns, fields = {}) {
  const mapped = mapSmartsheetColumns(columns);
  const aliases = {
    task: "task",
    category: "project",
    "due date": "deadline",
    owner: "owner",
    effort: "effort",
    status: "status",
  };
  return Object.entries(fields).flatMap(([name, value]) => {
    const key = aliases[name] || name;
    const column = mapped[key];
    return column && value !== undefined && value !== null && value !== "" ? [{ columnId: column.id, value }] : [];
  });
}

export function smartsheetRowId(sourceId) {
  return /^\d+$/.test(String(sourceId)) ? Number(sourceId) : sourceId;
}
