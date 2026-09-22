import { useState } from "react";
import { Clock, NotePencil, Trash, X } from "@phosphor-icons/react";
import { calendarDateValue } from "./utils.js";

function Modal({
  modal,
  onClose,
  onApprove,
  onDismiss,
  onNotice,
  onNewTask,
  onCreateRecurring,
  onUpdateTask,
  onDeleteTask,
  projectOptions,
}) {
  if (modal.type === "new-task")
    return (
      <TaskForm
        title="Add a task"
        subtitle="Create a task directly in your work register."
        projectOptions={projectOptions}
        onClose={onClose}
        onSave={onNewTask}
      />
    );
  if (modal.type === "recurring-task")
    return <RecurringTaskForm projectOptions={projectOptions} onClose={onClose} onSave={onCreateRecurring} />;
  if (modal.type === "task-edit")
    return (
      <TaskForm
        title="Edit task details"
        subtitle="Update the task or add context."
        item={modal.task}
        projectOptions={projectOptions}
        onClose={onClose}
        onSave={(values) => onUpdateTask(modal.task.id, values)}
        onDelete={() => onDeleteTask(modal.task)}
      />
    );
  const item = modal.item;
  const isMilestone = item?.itemKind === "MILESTONE";
  return (
    <TaskForm
      title={
        modal.type === "fill"
          ? `Fill in ${isMilestone ? "milestone" : "task"} details`
          : `Edit ${isMilestone ? "milestone" : "draft"}`
      }
      subtitle={
        modal.type === "fill"
          ? `Add the missing fields before this ${isMilestone ? "milestone" : "draft"} can be approved.`
          : "Review the AI first pass before approving."
      }
      item={item}
      projectOptions={projectOptions}
      onClose={onClose}
      onSave={(values) => onApprove(item, values)}
      onReject={() => onDismiss(item.id)}
      showReject={modal.type === "edit"}
    />
  );
}

function TaskForm({ title, subtitle, item, projectOptions = [], onClose, onSave, onDelete, onReject, showReject }) {
  const isMilestone = item?.itemKind === "MILESTONE";
  const [values, setValues] = useState({
    title: item?.title || "",
    project: item?.project || "",
    effortHours: item?.effortHours || "",
    deadline: calendarDateValue(item?.deadline, item?.deadlineKey),
    owner: item?.owner || "Unassigned",
    notes: item?.notes || "",
    notesAi: item?.notesAi || false,
    itemKind: item?.itemKind || "TASK",
    milestoneType: item?.milestoneType || "Milestone",
  });
  const projectChoices = [...new Set([...projectOptions, item?.project].filter(Boolean))];
  const update = (field, value) => setValues((current) => ({ ...current, [field]: value }));
  const isEdit = Boolean(item?.status);
  const valid = isMilestone
    ? values.title && values.project && values.deadline
    : values.title && values.project && values.effortHours && Number(values.effortHours) > 0;
  const remove = () => {
    if (window.confirm(`Remove \"${item?.title}\" from Workboard? The Smartsheet row will remain unchanged.`))
      onDelete?.();
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-panel task-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <div className="modal-icon">
          <NotePencil size={21} />
        </div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
        <div className="form-grid">
          <label>
            {isMilestone ? "Name" : "Task description"}
            <input value={values.title} onChange={(event) => update("title", event.target.value)} autoFocus />
          </label>
          <label>
            Project
            <select value={values.project} onChange={(event) => update("project", event.target.value)}>
              <option value="">Select active project</option>
              {projectChoices.map((project) => (
                <option key={project} value={project}>
                  {project}
                  {item?.project === project && !projectOptions.includes(project) ? " · Finished" : ""}
                </option>
              ))}
            </select>
          </label>
          {isMilestone ? (
            <>
              <label>
                Target date
                <input
                  type="date"
                  value={values.deadline}
                  onChange={(event) => update("deadline", event.target.value)}
                />
              </label>
              <label>
                Type
                <select value={values.milestoneType} onChange={(event) => update("milestoneType", event.target.value)}>
                  <option>Milestone</option>
                  <option>Deadline</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                Effort estimate (hours)
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  inputMode="decimal"
                  value={values.effortHours}
                  onChange={(event) => update("effortHours", event.target.value)}
                  placeholder="e.g. 1.5"
                />
              </label>
              <label>
                Owner
                <input value={values.owner} onChange={(event) => update("owner", event.target.value)} />
              </label>
              <label>
                Deadline
                <input
                  type="date"
                  value={values.deadline}
                  onChange={(event) => update("deadline", event.target.value)}
                />
              </label>
            </>
          )}
        </div>
        {!isMilestone && (
          <div className="notes-field">
            <div className="notes-label-row">
              <label>
                Notes
                <textarea
                  value={values.notes}
                  onChange={(event) => update("notes", event.target.value)}
                  placeholder="Add context, links, decisions, or next steps..."
                />
              </label>
              <span className="ai-note-badge">{values.notesAi ? "AI populated" : "Owner notes"}</span>
            </div>
          </div>
        )}
        <div className="modal-footer">
          {onDelete ? (
            <button className="text-danger" type="button" onClick={remove}>
              <Trash size={17} /> Remove task
            </button>
          ) : showReject ? (
            <button className="text-danger" onClick={onReject}>
              <Trash size={17} /> Reject draft
            </button>
          ) : (
            <span />
          )}
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" disabled={!valid} onClick={() => onSave(values)}>
              {isEdit
                ? "Save changes"
                : showReject
                  ? `Save and approve${isMilestone ? " milestone" : ""}`
                  : isMilestone
                    ? "Add milestone"
                    : "Activate task"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecurringTaskForm({ projectOptions = [], onClose, onSave }) {
  const presets = {
    "Weekly review": { title: "Weekly review", effortHours: "1", weekday: "5" },
    "Status update": { title: "Prepare weekly status update", effortHours: "0.5", weekday: "5" },
    "Administrative work": { title: "Weekly administrative work", effortHours: "1", weekday: "4" },
  };
  const [values, setValues] = useState({ title: "", project: "", owner: "Ann", effortHours: "1", weekday: "5" });
  const update = (field, value) => setValues((current) => ({ ...current, [field]: value }));
  const applyPreset = (preset) => setValues((current) => ({ ...current, ...presets[preset] }));
  const valid = values.title.trim() && values.project && values.owner.trim() && Number(values.effortHours) > 0;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-panel task-modal recurring-task-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <div className="modal-icon">
          <Clock size={21} />
        </div>
        <h2>Repeat a weekly task</h2>
        <p>Create a task now and automatically add the next occurrence when you mark it done.</p>
        <div className="recurring-presets" aria-label="Suggested recurring tasks">
          {Object.keys(presets).map((preset) => (
            <button type="button" key={preset} onClick={() => applyPreset(preset)}>
              {preset}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <label>
            Task description
            <input value={values.title} onChange={(event) => update("title", event.target.value)} autoFocus />
          </label>
          <label>
            Project
            <select value={values.project} onChange={(event) => update("project", event.target.value)}>
              <option value="">Select active project</option>
              {projectOptions.map((project) => (
                <option key={project}>{project}</option>
              ))}
            </select>
          </label>
          <label>
            Owner
            <input value={values.owner} onChange={(event) => update("owner", event.target.value)} />
          </label>
          <label>
            Effort estimate (hours)
            <input
              type="number"
              min="0.25"
              step="0.25"
              inputMode="decimal"
              value={values.effortHours}
              onChange={(event) => update("effortHours", event.target.value)}
            />
          </label>
          <label>
            Due every
            <select value={values.weekday} onChange={(event) => update("weekday", event.target.value)}>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-footer">
          <span className="recurring-note">Creates the first occurrence immediately.</span>
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" disabled={!valid} onClick={() => onSave(values)}>
              <Clock size={17} /> Create weekly task
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Modal, TaskForm, RecurringTaskForm };
