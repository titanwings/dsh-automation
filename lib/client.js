window.__ModuleLoader__.load({ id: "@dsh-external/dsh-automation", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/AutomationView.tsx
var import_react3 = require("react");

// src/client/helpers.ts
var AutomationFormError = class extends Error {
  constructor(key) {
    super(key);
    this.key = key;
  }
};
function localDateTimeValue(date = /* @__PURE__ */ new Date()) {
  const future = new Date(date.getTime() + 60 * 60 * 1e3);
  future.setMinutes(0, 0, 0);
  const offset = future.getTimezoneOffset() * 6e4;
  return new Date(future.getTime() - offset).toISOString().slice(0, 16);
}
function defaultFormState(now = /* @__PURE__ */ new Date()) {
  return {
    name: "",
    prompt: "",
    scheduleKind: "daily",
    onceAt: localDateTimeValue(now),
    everyMinutes: "60",
    time: "09:00",
    weekdays: [1, 2, 3, 4, 5],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    provider: null,
    model: null,
    reasoningEffort: null,
    permission: "read-only"
  };
}
function exactLocalDateTimeValue(iso) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 6e4;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function formStateFromAutomation(automation) {
  const defaults = defaultFormState();
  const schedule = automation.schedule;
  return {
    ...defaults,
    name: automation.name,
    prompt: automation.prompt,
    scheduleKind: schedule.kind,
    onceAt: schedule.kind === "once" ? exactLocalDateTimeValue(schedule.at) : defaults.onceAt,
    everyMinutes: schedule.kind === "interval" ? String(schedule.everyMinutes) : defaults.everyMinutes,
    ...schedule.kind === "interval" && schedule.anchor !== void 0 ? { intervalAnchor: schedule.anchor } : {},
    time: schedule.kind === "daily" || schedule.kind === "weekly" ? schedule.time : defaults.time,
    weekdays: schedule.kind === "weekly" ? [...schedule.weekdays] : defaults.weekdays,
    timeZone: automation.timeZone,
    provider: automation.provider,
    model: automation.model,
    reasoningEffort: automation.reasoningEffort,
    permission: automation.permission
  };
}
function validateModelTarget(form) {
  if (form.provider === null !== (form.model === null)) {
    throw new AutomationFormError("form.error.model");
  }
  if (form.reasoningEffort !== null && form.provider === null) {
    throw new AutomationFormError("form.error.model");
  }
}
function buildCreateInput(form, now = /* @__PURE__ */ new Date()) {
  const name2 = form.name.trim();
  const prompt = form.prompt.trim();
  if (name2 === "") throw new AutomationFormError("form.error.name");
  if (prompt === "") throw new AutomationFormError("form.error.prompt");
  validateModelTarget(form);
  let schedule;
  switch (form.scheduleKind) {
    case "once": {
      const at = new Date(form.onceAt);
      if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) {
        throw new AutomationFormError("form.error.once");
      }
      schedule = { kind: "once", at: at.toISOString(), timeZone: form.timeZone };
      break;
    }
    case "interval": {
      const everyMinutes = Number(form.everyMinutes);
      if (!Number.isInteger(everyMinutes) || everyMinutes < 5 || everyMinutes > 43200) {
        throw new AutomationFormError("form.error.interval");
      }
      schedule = {
        kind: "interval",
        everyMinutes,
        anchor: form.intervalAnchor ?? now.toISOString(),
        timeZone: form.timeZone
      };
      break;
    }
    case "daily":
      schedule = { kind: "daily", time: form.time, timeZone: form.timeZone };
      break;
    case "weekly":
      if (form.weekdays.length === 0) throw new AutomationFormError("form.error.weekdays");
      schedule = { kind: "weekly", time: form.time, weekdays: [...form.weekdays].sort((a, b) => a - b), timeZone: form.timeZone };
      break;
  }
  return {
    name: name2,
    prompt,
    schedule,
    timeZone: form.timeZone,
    provider: form.provider,
    model: form.model,
    reasoningEffort: form.reasoningEffort,
    permission: form.permission
  };
}
function scheduleMatchesDraft(form, automation) {
  const schedule = automation.schedule;
  if (form.scheduleKind !== schedule.kind || form.timeZone !== automation.timeZone) return false;
  switch (schedule.kind) {
    case "once":
      return form.onceAt === exactLocalDateTimeValue(schedule.at);
    case "interval":
      return form.everyMinutes === String(schedule.everyMinutes) && form.intervalAnchor === schedule.anchor;
    case "daily":
      return form.time === schedule.time;
    case "weekly":
      return form.time === schedule.time && [...form.weekdays].sort((a, b) => a - b).join(",") === [...schedule.weekdays].sort((a, b) => a - b).join(",");
  }
}
function buildUpdateInput(form, automation, now = /* @__PURE__ */ new Date()) {
  const name2 = form.name.trim();
  const prompt = form.prompt.trim();
  if (name2 === "") throw new AutomationFormError("form.error.name");
  if (prompt === "") throw new AutomationFormError("form.error.prompt");
  validateModelTarget(form);
  const scheduleChanged = !scheduleMatchesDraft(form, automation);
  const routeChanged = form.provider !== automation.provider || form.model !== automation.model;
  const replacement = scheduleChanged ? buildCreateInput(form, now) : void 0;
  return {
    ...name2 === automation.name ? {} : { name: name2 },
    ...prompt === automation.prompt ? {} : { prompt },
    ...replacement === void 0 ? {} : {
      schedule: replacement.schedule,
      timeZone: replacement.timeZone
    },
    ...routeChanged ? {
      provider: form.provider,
      model: form.model,
      reasoningEffort: form.reasoningEffort
    } : form.reasoningEffort === automation.reasoningEffort ? {} : { reasoningEffort: form.reasoningEffort },
    ...form.permission === automation.permission ? {} : { permission: form.permission }
  };
}
function modelRouteChoices(catalog, currentProvider, currentModel) {
  const choices = catalog.groups.flatMap((group) => group.models.map((model) => ({
    provider: group.id,
    providerName: group.name,
    model: model.id,
    modelName: model.name,
    ...model.description === void 0 ? {} : { description: model.description },
    unavailable: false
  })));
  if (currentProvider === null || currentModel === null || choices.some((choice) => choice.provider === currentProvider && choice.model === currentModel)) {
    return choices;
  }
  return [{
    provider: currentProvider,
    providerName: currentProvider,
    model: currentModel,
    modelName: currentModel,
    unavailable: true
  }, ...choices];
}
function reasoningEffortChoices(catalog, provider, model, currentEffort) {
  const catalogModel = provider === null || model === null ? void 0 : catalog.groups.find((group) => group.id === provider)?.models.find((item) => item.id === model);
  const choices = (catalogModel?.reasoning?.efforts ?? []).map((effort) => ({
    ...effort,
    unavailable: false
  }));
  if (currentEffort === null || choices.some((choice) => choice.id === currentEffort)) return choices;
  return [{ id: currentEffort, name: currentEffort, unavailable: true }, ...choices];
}
var ATTENTION_STATUSES = /* @__PURE__ */ new Set(["failed", "interrupted"]);
function deriveOverview(snapshot) {
  const next = snapshot.automations.filter((item) => item.status === "active" && item.nextRunAt !== void 0).map((item) => item.nextRunAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return {
    total: snapshot.automations.length,
    active: snapshot.automations.filter((item) => item.status === "active").length,
    attention: snapshot.runs.filter((run) => ATTENTION_STATUSES.has(run.status) && run.unread !== false).length,
    ...next === void 0 ? {} : { nextRunAt: next }
  };
}
function formatRelativeTime(iso, now, t) {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return iso;
  const deltaMinutes = Math.round((value - now.getTime()) / 6e4);
  const abs = Math.abs(deltaMinutes);
  if (abs < 1) return t("time.now");
  const future = deltaMinutes > 0;
  if (abs < 60) return t(future ? "time.inMinute" : "time.minuteAgo", { count: abs });
  const hours = Math.round(abs / 60);
  if (hours < 24) return t(future ? "time.inHour" : "time.hourAgo", { count: hours });
  const days = Math.round(hours / 24);
  return t(future ? "time.inDay" : "time.dayAgo", { count: days });
}
function shortSessionId(sessionId) {
  return sessionId.length <= 12 ? sessionId : `${sessionId.slice(0, 8)}\u2026${sessionId.slice(-4)}`;
}
function formatSchedule(schedule, t) {
  switch (schedule.kind) {
    case "once":
      return t("schedule.onceAt", {
        time: new Date(schedule.at).toLocaleString(void 0, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })
      });
    case "interval":
      return t("schedule.everyMinutes", { count: schedule.everyMinutes });
    case "daily":
      return t("schedule.dailyAt", { time: schedule.time });
    case "weekly":
      return t("schedule.weeklyAt", {
        days: schedule.weekdays.map((day) => t(`day.${day}`)).join(" \xB7 "),
        time: schedule.time
      });
  }
}
function sortStamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function sortAutomations(items, key, direction) {
  const factor = direction === "asc" ? 1 : -1;
  return items.slice().sort((left, right) => {
    if (key === "planned") {
      const leftNext = left.nextRunAt;
      const rightNext = right.nextRunAt;
      if (leftNext === void 0 || rightNext === void 0) {
        if (leftNext === void 0 && rightNext === void 0) {
          return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
        }
        return leftNext === void 0 ? 1 : -1;
      }
      const primary2 = sortStamp(leftNext) - sortStamp(rightNext);
      if (primary2 !== 0) return primary2 * factor;
      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    }
    const primary = sortStamp(left.createdAt) - sortStamp(right.createdAt);
    if (primary !== 0) return primary * factor;
    return left.id.localeCompare(right.id);
  });
}
var WORKSPACE_SORT_DEFAULT_KEY = "dsh-automation.sort-default.workspace";
function readSortDefault(storage, storageKey) {
  if (storage === void 0) return void 0;
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return void 0;
    const parsed = JSON.parse(raw);
    if (parsed.key !== "created" && parsed.key !== "planned") return void 0;
    if (parsed.direction !== "asc" && parsed.direction !== "desc") return void 0;
    return { key: parsed.key, direction: parsed.direction };
  } catch {
    return void 0;
  }
}
function writeSortDefault(storage, storageKey, key, direction) {
  storage.setItem(storageKey, JSON.stringify({ key, direction }));
}

// src/client/icons.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function IconFrame({ children, ...props }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", ...props, children });
}
function AutomationIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(IconFrame, { ...props, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "8.25" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 7.7v4.7l3.15 1.85" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.6 4.9 4.2 6.3M18.4 4.9l1.4 1.4" })
  ] });
}
function PlusIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconFrame, { ...props, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 5v14M5 12h14" }) });
}
function RefreshIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(IconFrame, { ...props, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M19 7v5h-5" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M18.1 15.5A7.5 7.5 0 1 1 19 12" })
  ] });
}
function PlayIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconFrame, { ...props, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m9 7 8 5-8 5V7Z" }) });
}
function PauseIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconFrame, { ...props, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9 7v10M15 7v10" }) });
}
function TrashIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconFrame, { ...props, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.5 7.5h13M9 7.5V5.7h6v1.8M8 10.5l.5 7h7l.5-7" }) });
}
function PencilIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(IconFrame, { ...props, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m5 16.5-.7 3.2 3.2-.7L18 8.5 15.5 6 5 16.5Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m13.8 7.7 2.5 2.5" })
  ] });
}
function ShieldIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(IconFrame, { ...props, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 3.8 19 6v5.1c0 4.3-2.6 7.4-7 9.1-4.4-1.7-7-4.8-7-9.1V6l7-2.2Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m9.4 12 1.7 1.7 3.7-4" })
  ] });
}
function CalendarIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(IconFrame, { ...props, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "4", y: "5.5", width: "16", height: "14", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 3.8v3.4M16 3.8v3.4M4 9.5h16" })
  ] });
}
function CheckIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconFrame, { ...props, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m5.5 12.5 4 4 9-9" }) });
}
function AlertIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(IconFrame, { ...props, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 4.2 21 19H3L12 4.2Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 9v4.5M12 16.5h.01" })
  ] });
}
function ChevronIcon(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconFrame, { ...props, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m8.5 10 3.5 3.5 3.5-3.5" }) });
}

// src/client/sort-menu.tsx
var import_react2 = require("react");

// src/client/dropdown-menu.tsx
var import_react = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
function DropdownMenu({
  ariaLabel,
  className,
  menuClassName,
  options
}) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const root = (0, import_react.useRef)(null);
  const menuRef = (0, import_react.useRef)(null);
  const [menuStyle, setMenuStyle] = (0, import_react.useState)({});
  const selectedLabel = options.find((option) => option.selected)?.label ?? options[0]?.label ?? ariaLabel;
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const close = (event) => {
      if (root.current !== null && root.current.contains(event.target)) return;
      if (menuRef.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  (0, import_react.useLayoutEffect)(() => {
    if (!open) return;
    const update = () => {
      const button = root.current?.querySelector(".dsh-automation-dropdown-btn");
      const rect = button?.getBoundingClientRect();
      if (rect === void 0) return;
      const height = menuRef.current?.offsetHeight ?? 220;
      const margin = 8;
      let top = rect.bottom + 2;
      if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 2);
      const right = Math.max(margin, window.innerWidth - rect.right);
      setMenuStyle((current) => current.top === top && current.right === right ? current : { position: "fixed", top, right });
    };
    const onScroll = (event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      update();
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, selectedLabel]);
  const menu = open && typeof document !== "undefined" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { ref: menuRef, className: `dsh-automation-dropdown-menu is-float${menuClassName === void 0 ? "" : ` ${menuClassName}`}`, style: menuStyle, children: options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    DropdownRow,
    {
      label: option.label,
      selected: option.selected,
      trailing: option.trailing,
      onSelect: () => {
        if (option.keepOpen !== true) setOpen(false);
        option.onSelect();
      }
    },
    option.key
  )) }) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: `dsh-automation-dropdown${className === void 0 ? "" : ` ${className}`}`, ref: root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: `dsh-automation-dropdown-btn${open ? " is-open" : ""}`, "aria-label": ariaLabel, "aria-expanded": open, onClick: () => setOpen((value) => !value), children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-automation-dropdown-label", children: selectedLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ChevronIcon, { width: 16, height: 16, className: "dsh-automation-dropdown-chevron" })
    ] }),
    menu
  ] });
}
function DropdownRow({
  label,
  selected,
  trailing,
  onSelect
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      className: `dsh-automation-dropdown-row${selected ? " is-selected" : ""}${trailing === void 0 ? "" : " has-trailing"}`,
      role: "menuitemradio",
      "aria-checked": selected,
      tabIndex: 0,
      onClick: onSelect,
      onKeyDown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-automation-dropdown-label-cell", children: label }),
        trailing !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            className: `dsh-automation-dropdown-default${trailing.active ? " is-on" : ""}`,
            disabled: trailing.active,
            onClick: (event) => {
              event.stopPropagation();
              trailing.onSelect();
            },
            children: trailing.label
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-automation-dropdown-spacer" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-automation-dropdown-check", children: selected ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(CheckIcon, { width: 16, height: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-automation-sort-tick" }) })
      ]
    }
  );
}

// src/client/sort-menu.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var SORT_OPTIONS = [
  ["created", "desc"],
  ["created", "asc"],
  ["planned", "asc"],
  ["planned", "desc"]
];
function SortMenu({
  t,
  storage,
  storageKey,
  sortKey,
  sortDirection,
  onSelect
}) {
  const [saved, setSaved] = (0, import_react2.useState)(() => readSortDefault(storage, storageKey));
  const options = SORT_OPTIONS.map(([key, direction]) => {
    const selected = sortKey === key && sortDirection === direction;
    const isDefault = saved?.key === key && saved.direction === direction;
    return {
      key: `${key}-${direction}`,
      label: t(key === "planned" ? `sort.planned.${direction}` : `sort.created.${direction}`),
      selected,
      keepOpen: true,
      onSelect: () => onSelect(key, direction),
      ...selected && storage !== void 0 ? {
        trailing: {
          label: t("sort.default.saved"),
          active: isDefault,
          onSelect: () => {
            writeSortDefault(storage, storageKey, key, direction);
            setSaved({ key, direction });
          }
        }
      } : {}
    };
  });
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    DropdownMenu,
    {
      ariaLabel: t("sort.by"),
      menuClassName: "dsh-automation-dropdown-sort",
      options
    }
  );
}

// src/client/AutomationView.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var POLL_INTERVAL_MS = 15e3;
var WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
var SORT_STORAGE = typeof window === "undefined" ? void 0 : window.localStorage;
function actionKey(action, id = "") {
  return `${action}:${id}`;
}
function statusLabel(t, status) {
  return t(`status.${status}`);
}
function AutomationStatusBadge({ status, t }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: `dsh-automation-badge dsh-automation-badge--${status}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-status-dot" }),
    t(`status.${status}`)
  ] });
}
function RunStatusBadge({ status, t }) {
  const icon = status === "succeeded" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(CheckIcon, {}) : status === "failed" || status === "interrupted" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AlertIcon, {}) : status === "running" || status === "queued" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AutomationIcon, {}) : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: `dsh-automation-run-status dsh-automation-run-status--${status}`, children: [
    icon,
    statusLabel(t, status)
  ] });
}
function AutomationForm(props) {
  const { t, busy, loadModelCatalog: loadModelCatalog2, onCancel } = props;
  const [form, setForm] = (0, import_react3.useState)(() => props.mode === "create" ? defaultFormState() : formStateFromAutomation(props.automation));
  const [validationError, setValidationError] = (0, import_react3.useState)();
  const [catalog, setCatalog] = (0, import_react3.useState)({ groups: [], failures: [] });
  const [catalogError, setCatalogError] = (0, import_react3.useState)();
  const [catalogLoading, setCatalogLoading] = (0, import_react3.useState)(true);
  const [catalogGeneration, setCatalogGeneration] = (0, import_react3.useState)(0);
  (0, import_react3.useEffect)(() => {
    let live = true;
    setCatalogLoading(true);
    setCatalogError(void 0);
    void loadModelCatalog2().then((value) => {
      if (!live) return;
      setCatalog(value);
      setCatalogLoading(false);
    }, (error) => {
      if (!live) return;
      setCatalogError(error instanceof Error ? error.message : String(error));
      setCatalogLoading(false);
    });
    return () => {
      live = false;
    };
  }, [catalogGeneration, loadModelCatalog2]);
  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError(void 0);
  };
  const toggleWeekday = (day) => {
    update("weekdays", form.weekdays.includes(day) ? form.weekdays.filter((value) => value !== day) : [...form.weekdays, day]);
  };
  const updateModel = (provider, model) => {
    setForm((current) => ({
      ...current,
      provider,
      model,
      reasoningEffort: current.provider === provider && current.model === model ? current.reasoningEffort : null
    }));
    setValidationError(void 0);
  };
  const routeKey = (provider, model) => JSON.stringify([provider, model]);
  const modelChoices = modelRouteChoices(catalog, form.provider, form.model);
  const unavailableModel = modelChoices.find((choice) => choice.unavailable);
  const effortChoices = reasoningEffortChoices(
    catalog,
    form.provider,
    form.model,
    form.reasoningEffort
  );
  const selectedCatalogModel = form.provider === null || form.model === null ? void 0 : catalog.groups.find((group) => group.id === form.provider)?.models.find((model) => model.id === form.model);
  const defaultEffort = selectedCatalogModel?.reasoning?.defaultEffort;
  const defaultEffortName = defaultEffort === void 0 ? void 0 : selectedCatalogModel?.reasoning?.efforts.find((effort) => effort.id === defaultEffort)?.name ?? defaultEffort;
  const selectedEffort = form.reasoningEffort === null ? void 0 : effortChoices.find((choice) => choice.id === form.reasoningEffort);
  const submit = (event) => {
    event.preventDefault();
    try {
      setValidationError(void 0);
      if (props.mode === "create") {
        void props.onSubmit(buildCreateInput(form));
      } else {
        void props.onSubmit(buildUpdateInput(form, props.automation));
      }
    } catch (error) {
      if (error instanceof AutomationFormError) {
        setValidationError(t(error.key));
        return;
      }
      throw error;
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("form", { className: "dsh-automation-create", onSubmit: submit, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-create-heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-kicker", children: t("header.eyebrow") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { children: t(props.mode === "create" ? "form.title" : "form.editTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t(props.mode === "create" ? "form.subtitle" : "form.editSubtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dsh-automation-button dsh-automation-button--ghost", type: "button", onClick: onCancel, disabled: busy, children: t("form.cancel") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-form-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-automation-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.name") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { value: form.name, maxLength: 80, placeholder: t("form.namePlaceholder"), onChange: (event) => update("name", event.currentTarget.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-automation-field dsh-automation-field--wide", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.prompt") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("textarea", { value: form.prompt, maxLength: 12e3, rows: props.mode === "edit" ? 8 : 4, placeholder: t("form.promptPlaceholder"), onChange: (event) => update("prompt", event.currentTarget.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-automation-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.model") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
          "select",
          {
            value: form.provider === null || form.model === null ? "" : routeKey(form.provider, form.model),
            onChange: (event) => {
              const value = event.currentTarget.value;
              if (value === "") {
                updateModel(null, null);
                return;
              }
              const choice = modelChoices.find((item) => routeKey(item.provider, item.model) === value);
              if (choice !== void 0) updateModel(choice.provider, choice.model);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: t("form.followGlobal") }),
              unavailableModel !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: routeKey(unavailableModel.provider, unavailableModel.model), children: t("form.currentUnavailable", {
                provider: unavailableModel.provider,
                model: unavailableModel.model
              }) }),
              catalog.groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("optgroup", { label: group.name, children: group.models.map((model) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: routeKey(group.id, model.id), children: model.name }, model.id)) }, group.id))
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("small", { children: form.provider === null ? t("form.followGlobalHint") : t("form.pinnedModelHint") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-automation-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.reasoningEffort") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
          "select",
          {
            value: form.reasoningEffort ?? "",
            disabled: form.provider === null,
            onChange: (event) => update("reasoningEffort", event.currentTarget.value === "" ? null : event.currentTarget.value),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: defaultEffortName === void 0 ? t("form.modelDefault") : t("form.modelDefaultValue", { effort: defaultEffortName }) }),
              effortChoices.map((effort) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: effort.id, children: effort.unavailable ? t("form.effortUnavailable", { effort: effort.name }) : effort.name }, effort.id))
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("small", { children: form.provider === null ? t("form.reasoningFollowGlobal") : selectedEffort?.description ?? t("form.reasoningHint") })
      ] }),
      (catalogLoading || catalogError !== void 0 || catalog.failures.length > 0) && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-catalog-status dsh-automation-field--wide", role: "status", children: [
        catalogLoading && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.catalogLoading") }),
        catalogError !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "is-error", children: t("form.catalogError", { message: catalogError }) }),
        catalog.failures.map((failure) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "is-warning", children: t("form.catalogFailure", { provider: failure.name, message: failure.message }) }, failure.id)),
        !catalogLoading && (catalogError !== void 0 || catalog.failures.length > 0) && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => setCatalogGeneration((value) => value + 1), children: t("form.catalogRetry") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("fieldset", { className: "dsh-automation-fieldset dsh-automation-field--wide", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("legend", { children: t("form.schedule") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-automation-segmented", children: ["once", "interval", "daily", "weekly"].map((kind) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            type: "button",
            className: form.scheduleKind === kind ? "is-selected" : "",
            "aria-pressed": form.scheduleKind === kind,
            onClick: () => update("scheduleKind", kind),
            children: t(`form.${kind}`)
          },
          kind
        )) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-schedule-fields", children: [
          form.scheduleKind === "once" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-automation-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.runAt") }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "datetime-local", value: form.onceAt, onChange: (event) => update("onceAt", event.currentTarget.value) })
          ] }),
          form.scheduleKind === "interval" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-automation-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.every") }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "dsh-automation-inline-input", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "number", min: 5, max: 43200, value: form.everyMinutes, onChange: (event) => update("everyMinutes", event.currentTarget.value) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.minutes") })
            ] })
          ] }),
          (form.scheduleKind === "daily" || form.scheduleKind === "weekly") && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-automation-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.time") }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "time", value: form.time, onChange: (event) => update("time", event.currentTarget.value) })
          ] }),
          form.scheduleKind === "weekly" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-field dsh-automation-weekdays", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.days") }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { children: WEEKDAYS.map((day) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "aria-pressed": form.weekdays.includes(day), className: form.weekdays.includes(day) ? "is-selected" : "", onClick: () => toggleWeekday(day), children: t(`day.${day}`) }, day)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-automation-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("form.timeZone") }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { value: form.timeZone, onChange: (event) => update("timeZone", event.currentTarget.value) })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("fieldset", { className: "dsh-automation-fieldset dsh-automation-field--wide", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("legend", { children: t("form.permission") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-automation-permission-grid", children: ["read-only", "workspace-write"].map((permission) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: form.permission === permission ? "is-selected" : "", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "radio", name: "permission", value: permission, checked: form.permission === permission, onChange: () => update("permission", permission) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ShieldIcon, {}),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: t(permission === "read-only" ? "form.readOnly" : "form.workspaceWrite") }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("small", { children: t(permission === "read-only" ? "form.readOnlyHint" : "form.workspaceWriteHint") })
          ] })
        ] }, permission)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-form-footer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-form-error", role: "alert", children: validationError }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: "dsh-automation-button dsh-automation-button--primary", type: "submit", disabled: busy, children: [
        props.mode === "create" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PlusIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PencilIcon, {}),
        busy ? t(props.mode === "create" ? "form.submitting" : "form.saving") : t(props.mode === "create" ? "form.submit" : "form.save")
      ] })
    ] })
  ] });
}
function AutomationCard(props) {
  const { automation, now, t, busyKey, confirmingDelete, onConfirmDelete, onEdit, onMutate, onRun } = props;
  const isBusy = busyKey?.endsWith(`:${automation.id}`) === true;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "dsh-automation-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-card-top", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-card-title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-card-icon", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AutomationIcon, {}) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: automation.name }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-card-badges", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AutomationStatusBadge, { status: automation.status, t }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "dsh-automation-permission-badge", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ShieldIcon, {}),
              t(`card.permission.${automation.permission}`)
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-model-badge", children: automation.provider === null || automation.model === null ? t("card.modelGlobal") : t("card.modelPinned", {
              provider: automation.provider,
              model: automation.model,
              effort: automation.reasoningEffort ?? t("form.modelDefault")
            }) })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "dsh-automation-revision", children: [
        "v",
        automation.revision
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "dsh-automation-prompt", children: automation.prompt }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { className: "dsh-automation-prompt-details", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { children: t("card.viewPrompt") }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("pre", { children: automation.prompt })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-schedule-line", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(CalendarIcon, {}),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: formatSchedule(automation.schedule, t) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: automation.timeZone })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dl", { className: "dsh-automation-card-times", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: t("card.nextRun") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: automation.status === "active" && automation.nextRunAt !== void 0 ? formatRelativeTime(automation.nextRunAt, now, t) : "\u2014" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: t("card.lastRun") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: automation.lastRunAt === void 0 ? t("card.never") : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `dsh-automation-mini-dot dsh-automation-mini-dot--${automation.lastRunStatus ?? "succeeded"}` }),
          formatRelativeTime(automation.lastRunAt, now, t)
        ] }) })
      ] })
    ] }),
    confirmingDelete ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-delete-confirm", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: t("card.confirmDelete") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("card.confirmDeleteHint") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dsh-automation-button dsh-automation-button--ghost", type: "button", onClick: () => onConfirmDelete(), disabled: isBusy, children: t("card.cancel") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: "dsh-automation-button dsh-automation-button--danger", type: "button", onClick: () => onMutate(automation.id, "delete"), disabled: isBusy, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(TrashIcon, {}),
          t("card.confirm")
        ] })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-card-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: "dsh-automation-button dsh-automation-button--ghost", type: "button", onClick: () => onEdit(automation), disabled: isBusy, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PencilIcon, {}),
        t("card.edit")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: "dsh-automation-button dsh-automation-button--ghost", type: "button", onClick: () => onRun(automation.id), disabled: isBusy, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PlayIcon, {}),
        t("card.runNow")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: "dsh-automation-button dsh-automation-button--ghost", type: "button", onClick: () => onMutate(automation.id, automation.status === "active" ? "pause" : "resume"), disabled: isBusy, children: [
        automation.status === "active" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PauseIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PlayIcon, {}),
        t(automation.status === "active" ? "card.pause" : "card.resume")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dsh-automation-icon-button", type: "button", "aria-label": t("card.delete"), title: t("card.delete"), onClick: () => onConfirmDelete(automation.id), disabled: isBusy, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(TrashIcon, {}) })
    ] })
  ] });
}
function RecentRun({ run, now, t, busy, onOpen, onMarkRead }) {
  const timestamp = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
  const canMarkRead = run.unread !== false && (run.status === "failed" || run.status === "interrupted" || run.status === "skipped" || run.status === "cancelled");
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "dsh-automation-run", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-run-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-run-name", children: run.automationName }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-run-trigger", children: t(`run.trigger.${run.trigger}`) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("time", { dateTime: timestamp, children: formatRelativeTime(timestamp, now, t) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RunStatusBadge, { status: run.status, t }),
    (run.summary !== void 0 || run.error !== void 0) && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: run.error === void 0 ? "" : "is-error", children: run.error ?? run.summary }),
    run.sessionId !== void 0 && run.sessionArchived && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-session-id dsh-automation-session-id--archived", title: run.sessionId, children: t("run.sessionArchived", { id: shortSessionId(run.sessionId) }) }),
    run.sessionId !== void 0 && !run.sessionArchived && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dsh-automation-session-id", type: "button", onClick: () => onOpen(run.id, run.sessionId), children: t("run.openSession", { id: shortSessionId(run.sessionId) }) }),
    canMarkRead && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: "dsh-automation-run-review", type: "button", onClick: () => onMarkRead(run.id), disabled: busy, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(CheckIcon, {}),
      t("run.markRead")
    ] })
  ] });
}
function AutomationView({
  t,
  useAutomationState,
  refresh,
  createAutomation,
  updateAutomation,
  mutateAutomation,
  runNow,
  markRunRead,
  loadModelCatalog: loadModelCatalog2,
  openSession
}) {
  const state = useAutomationState((value) => value);
  const [showCreate, setShowCreate] = (0, import_react3.useState)(false);
  const [editingAutomation, setEditingAutomation] = (0, import_react3.useState)();
  const [busyKey, setBusyKey] = (0, import_react3.useState)();
  const [actionError, setActionError] = (0, import_react3.useState)();
  const [confirmDeleteId, setConfirmDeleteId] = (0, import_react3.useState)();
  const [sortKey, setSortKey] = (0, import_react3.useState)(() => readSortDefault(SORT_STORAGE, WORKSPACE_SORT_DEFAULT_KEY)?.key ?? "created");
  const [sortDirection, setSortDirection] = (0, import_react3.useState)(() => readSortDefault(SORT_STORAGE, WORKSPACE_SORT_DEFAULT_KEY)?.direction ?? "desc");
  (0, import_react3.useEffect)(() => {
    void refresh().catch(() => void 0);
    const timer = window.setInterval(() => {
      void refresh().catch(() => void 0);
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh]);
  const snapshot = state.snapshot;
  const stats = (0, import_react3.useMemo)(() => snapshot === void 0 ? void 0 : deriveOverview(snapshot), [snapshot]);
  const now = (0, import_react3.useMemo)(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow]);
  const automations = (0, import_react3.useMemo)(() => snapshot === void 0 ? [] : sortAutomations(snapshot.automations, sortKey, sortDirection), [snapshot, sortDirection, sortKey]);
  const perform = async (key, action) => {
    setBusyKey(key);
    setActionError(void 0);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("error.action"));
    } finally {
      setBusyKey(void 0);
    }
  };
  const onMutate = (id, mutation) => {
    void perform(actionKey(mutation, id), async () => {
      await mutateAutomation(id, mutation);
      if (mutation === "delete") {
        setConfirmDeleteId(void 0);
        if (editingAutomation?.id === id) setEditingAutomation(void 0);
      }
    });
  };
  const onRun = (id) => {
    void perform(actionKey("run", id), () => runNow(id));
  };
  const onOpenSession = (runId, sessionId) => {
    void perform(actionKey("run", runId), () => openSession(runId, sessionId));
  };
  const onMarkRead = (runId) => {
    void perform(actionKey("read", runId), () => markRunRead(runId));
  };
  const onCreate = async (input) => {
    await perform(actionKey("create"), async () => {
      await createAutomation(input);
      setShowCreate(false);
    });
  };
  const onUpdate = async (input) => {
    const automation = editingAutomation;
    if (automation === void 0) return;
    await perform(actionKey("update", automation.id), async () => {
      await updateAutomation(automation.id, automation.revision, input);
      setEditingAutomation(void 0);
    });
  };
  const onEdit = (automation) => {
    setShowCreate(false);
    setConfirmDeleteId(void 0);
    setEditingAutomation(automation);
  };
  if (snapshot === void 0 && (state.phase === "idle" || state.phase === "loading")) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-shell dsh-automation-centered", "data-conversation-composer-overlay": "", role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-loader", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AutomationIcon, {}) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("loading") })
    ] });
  }
  if (snapshot === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-shell dsh-automation-centered", "data-conversation-composer-overlay": "", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-error-icon", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AlertIcon, {}) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { children: t("error.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: state.error }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: "dsh-automation-button dsh-automation-button--primary", type: "button", onClick: () => {
        void refresh().catch(() => void 0);
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RefreshIcon, {}),
        t("error.retry")
      ] })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-shell", "data-conversation-composer-overlay": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("header", { className: "dsh-automation-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-heading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-logo", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AutomationIcon, {}) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-automation-kicker", children: t("header.eyebrow") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h1", { children: t("header.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t("header.subtitle") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: "dsh-automation-button dsh-automation-button--primary", type: "button", onClick: () => {
        setEditingAutomation(void 0);
        setShowCreate((value) => !value);
      }, children: [
        showCreate ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PauseIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PlusIcon, {}),
        showCreate ? t("header.closeCreate") : t("header.create")
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-scope", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: t("scope.workspace") }),
        snapshot.scope.workspaceName ?? snapshot.scope.workspaceId ?? "\u2014"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: t("scope.folder") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: snapshot.scope.cwd })
      ] })
    ] }),
    showCreate && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      AutomationForm,
      {
        mode: "create",
        t,
        busy: busyKey === actionKey("create"),
        loadModelCatalog: loadModelCatalog2,
        onCancel: () => setShowCreate(false),
        onSubmit: onCreate
      }
    ),
    editingAutomation !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      AutomationForm,
      {
        mode: "edit",
        automation: editingAutomation,
        t,
        busy: busyKey === actionKey("update", editingAutomation.id),
        loadModelCatalog: loadModelCatalog2,
        onCancel: () => setEditingAutomation(void 0),
        onSubmit: onUpdate
      },
      `${editingAutomation.id}:${editingAutomation.revision}`
    ),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "dsh-automation-stats", "aria-label": t("header.title"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("stats.total") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: stats?.total ?? 0 })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("stats.active") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: stats?.active ?? 0 })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("stats.next") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: stats?.nextRunAt === void 0 ? t("stats.noneScheduled") : formatRelativeTime(stats.nextRunAt, now, t) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: (stats?.attention ?? 0) > 0 ? "is-attention" : "", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("stats.attention") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: (stats?.attention ?? 0) === 0 ? t("stats.noAttention") : stats?.attention })
      ] })
    ] }),
    (actionError !== void 0 || state.error !== void 0) && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-inline-error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AlertIcon, {}),
      actionError ?? state.error
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-content", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "dsh-automation-main-column", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-section-heading", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { children: t("section.automations") }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t("section.automationsHint") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-section-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              SortMenu,
              {
                t,
                ...SORT_STORAGE === void 0 ? {} : { storage: SORT_STORAGE },
                storageKey: WORKSPACE_SORT_DEFAULT_KEY,
                sortKey,
                sortDirection,
                onSelect: (key, direction) => {
                  setSortKey(key);
                  setSortDirection(direction);
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dsh-automation-icon-button", type: "button", "aria-label": t("section.refresh"), title: t("section.refresh"), onClick: () => {
              void refresh().catch(() => void 0);
            }, disabled: state.phase === "loading", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RefreshIcon, {}) })
          ] })
        ] }),
        automations.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-automation-empty", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AutomationIcon, {}) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: t("empty.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t("empty.body") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { className: "dsh-automation-button dsh-automation-button--primary", type: "button", onClick: () => setShowCreate(true), children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PlusIcon, {}),
            t("empty.action")
          ] })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-automation-card-list", children: automations.map((automation) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          AutomationCard,
          {
            automation,
            now,
            t,
            busyKey,
            confirmingDelete: confirmDeleteId === automation.id,
            onConfirmDelete: setConfirmDeleteId,
            onEdit,
            onMutate,
            onRun
          },
          automation.id
        )) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("aside", { className: "dsh-automation-runs-column", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-automation-section-heading", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { children: t("section.runs") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t("section.runsHint") })
        ] }) }),
        snapshot.runs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-automation-runs-empty", children: t("runs.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-automation-run-list", children: snapshot.runs.slice(0, 12).map((run) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          RecentRun,
          {
            run,
            now,
            t,
            busy: busyKey?.endsWith(`:${run.id}`) === true,
            onOpen: onOpenSession,
            onMarkRead
          },
          run.id
        )) })
      ] })
    ] })
  ] });
}

// src/client/locales.ts
var NS = "dsh-automation";
var en = {
  tab: "Automations",
  "sidebar.open": "Open Automations",
  "sidebar.unavailable": "Start a conversation before opening Automations.",
  "header.eyebrow": "Autonomous coding work",
  "header.title": "Automations",
  "header.subtitle": "Schedule fresh, auditable agent runs for this workspace.",
  "header.create": "New automation",
  "header.closeCreate": "Close form",
  "scope.workspace": "Workspace",
  "scope.folder": "Working folder",
  "stats.total": "Total",
  "stats.active": "Active",
  "stats.next": "Next run",
  "stats.attention": "Needs attention",
  "stats.noneScheduled": "Not scheduled",
  "stats.noAttention": "All clear",
  "section.automations": "Workspace automations",
  "section.automationsHint": "Each trigger opens a fresh DSH session with its own audit trail.",
  "section.runs": "Recent runs",
  "section.runsHint": "Latest execution state across this workspace.",
  "section.refresh": "Refresh",
  "sort.by": "Sort by",
  "sort.created.desc": "Created \xB7 Newest",
  "sort.created.asc": "Created \xB7 Oldest",
  "sort.planned.asc": "Planned \xB7 Soonest",
  "sort.planned.desc": "Planned \xB7 Latest",
  "sort.default.saved": "Default",
  "empty.title": "Put recurring coding work on autopilot",
  "empty.body": "Create a focused task with an explicit schedule and permission boundary. Every run starts in a fresh session.",
  "empty.action": "Create your first automation",
  "runs.empty": "No runs yet. Trigger an automation now or wait for its schedule.",
  "form.title": "Create an automation",
  "form.subtitle": "Write a self-contained prompt: scheduled runs do not inherit this conversation.",
  "form.editTitle": "Edit automation",
  "form.editSubtitle": "Review the complete prompt, schedule, and permission boundary before saving.",
  "form.name": "Name",
  "form.namePlaceholder": "Daily regression triage",
  "form.prompt": "Task prompt",
  "form.promptPlaceholder": "Review new test failures, identify the regression, and propose the smallest verified fix\u2026",
  "form.model": "Model",
  "form.followGlobal": "Follow global",
  "form.followGlobalHint": "Resolve the live global selection when each run starts.",
  "form.pinnedModelHint": "Keep this automation on the selected provider and model.",
  "form.currentUnavailable": "Current (unavailable) \xB7 {provider}/{model}",
  "form.reasoningEffort": "Reasoning effort",
  "form.modelDefault": "Model default",
  "form.modelDefaultValue": "Model default ({effort})",
  "form.effortUnavailable": "Current (unavailable) \xB7 {effort}",
  "form.reasoningFollowGlobal": "Reasoning follows the global selection.",
  "form.reasoningHint": "Options are supplied by the selected model.",
  "form.catalogLoading": "Loading model catalog\u2026",
  "form.catalogError": "Model catalog unavailable: {message}",
  "form.catalogFailure": "Could not load {provider}: {message}",
  "form.catalogRetry": "Retry model catalog",
  "form.schedule": "Schedule",
  "form.once": "Once",
  "form.interval": "Interval",
  "form.daily": "Daily",
  "form.weekly": "Weekly",
  "form.runAt": "Run at",
  "form.every": "Every",
  "form.minutes": "minutes",
  "form.time": "Time",
  "form.days": "Days",
  "form.timeZone": "Time zone",
  "form.permission": "Permission boundary",
  "form.readOnly": "Read only",
  "form.readOnlyHint": "Inspect the workspace without changing files.",
  "form.workspaceWrite": "Workspace write",
  "form.workspaceWriteHint": "May edit files inside this workspace; approval is not inherited.",
  "form.cancel": "Cancel",
  "form.submit": "Create automation",
  "form.submitting": "Creating\u2026",
  "form.save": "Save changes",
  "form.saving": "Saving\u2026",
  "form.error.name": "Enter a name.",
  "form.error.prompt": "Enter a self-contained task prompt.",
  "form.error.once": "Choose a valid future date and time.",
  "form.error.interval": "Interval must be between 5 and 43,200 minutes.",
  "form.error.weekdays": "Select at least one day.",
  "form.error.model": "Choose Follow global or a complete provider and model target.",
  "day.1": "Mon",
  "day.2": "Tue",
  "day.3": "Wed",
  "day.4": "Thu",
  "day.5": "Fri",
  "day.6": "Sat",
  "day.7": "Sun",
  "status.active": "Active",
  "status.paused": "Paused",
  "status.queued": "Queued",
  "status.running": "Running",
  "status.succeeded": "Succeeded",
  "status.failed": "Failed",
  "status.skipped": "Skipped",
  "status.cancelled": "Cancelled",
  "status.interrupted": "Interrupted",
  "card.nextRun": "Next",
  "card.lastRun": "Last",
  "card.never": "Never run",
  "card.permission.read-only": "Read only",
  "card.permission.workspace-write": "Workspace write",
  "card.modelGlobal": "Follow global",
  "card.modelPinned": "{provider}/{model} \xB7 {effort}",
  "schedule.onceAt": "Once \xB7 {time}",
  "schedule.everyMinutes": "Every {count} minutes",
  "schedule.dailyAt": "Daily \xB7 {time}",
  "schedule.weeklyAt": "{days} \xB7 {time}",
  "card.pause": "Pause",
  "card.resume": "Resume",
  "card.runNow": "Run now",
  "card.edit": "Edit",
  "card.viewPrompt": "View complete prompt",
  "card.delete": "Delete",
  "card.confirmDelete": "Delete automation?",
  "card.confirmDeleteHint": "Run history is retained for audit.",
  "card.confirm": "Confirm delete",
  "card.cancel": "Cancel",
  "run.trigger.schedule": "Scheduled",
  "run.trigger.manual": "Manual",
  "run.trigger.catch-up": "Catch-up",
  "run.openSession": "Session {id}",
  "run.sessionArchived": "Session archived \xB7 {id}",
  "run.markRead": "Mark reviewed",
  "loading": "Loading automations\u2026",
  "error.title": "Automations could not be loaded",
  "error.retry": "Try again",
  "error.action": "The action failed. Please try again.",
  "time.now": "now",
  "time.minuteAgo": "{count}m ago",
  "time.hourAgo": "{count}h ago",
  "time.dayAgo": "{count}d ago",
  "time.inMinute": "in {count}m",
  "time.inHour": "in {count}h",
  "time.inDay": "in {count}d"
};
var zh = {
  tab: "\u81EA\u52A8\u5316",
  "sidebar.open": "\u6253\u5F00\u81EA\u52A8\u5316",
  "sidebar.unavailable": "\u8BF7\u5148\u5F00\u59CB\u4E00\u4E2A\u5BF9\u8BDD\uFF0C\u518D\u6253\u5F00\u81EA\u52A8\u5316\u3002",
  "header.eyebrow": "\u81EA\u4E3B\u7F16\u7801\u4EFB\u52A1",
  "header.title": "\u81EA\u52A8\u5316",
  "header.subtitle": "\u4E3A\u5F53\u524D\u5DE5\u4F5C\u533A\u5B89\u6392\u72EC\u7ACB\u3001\u53EF\u5BA1\u8BA1\u7684 Agent \u8FD0\u884C\u3002",
  "header.create": "\u65B0\u5EFA\u81EA\u52A8\u5316",
  "header.closeCreate": "\u6536\u8D77\u8868\u5355",
  "scope.workspace": "\u5DE5\u4F5C\u533A",
  "scope.folder": "\u5DE5\u4F5C\u76EE\u5F55",
  "stats.total": "\u5168\u90E8",
  "stats.active": "\u5DF2\u542F\u7528",
  "stats.next": "\u4E0B\u6B21\u8FD0\u884C",
  "stats.attention": "\u9700\u8981\u5173\u6CE8",
  "stats.noneScheduled": "\u6682\u65E0\u8BA1\u5212",
  "stats.noAttention": "\u4E00\u5207\u6B63\u5E38",
  "section.automations": "\u5DE5\u4F5C\u533A\u81EA\u52A8\u5316",
  "section.automationsHint": "\u6BCF\u6B21\u89E6\u53D1\u90FD\u4F1A\u521B\u5EFA\u4E00\u4E2A\u5168\u65B0\u7684 DSH Session\uFF0C\u5E76\u4FDD\u7559\u72EC\u7ACB\u5BA1\u8BA1\u8BB0\u5F55\u3002",
  "section.runs": "\u6700\u8FD1\u8FD0\u884C",
  "section.runsHint": "\u5F53\u524D\u5DE5\u4F5C\u533A\u6700\u8FD1\u7684\u6267\u884C\u72B6\u6001\u3002",
  "section.refresh": "\u5237\u65B0",
  "sort.by": "\u6392\u5E8F",
  "sort.created.desc": "\u521B\u5EFA\u65F6\u95F4 \xB7 \u65B0\u5230\u65E7",
  "sort.created.asc": "\u521B\u5EFA\u65F6\u95F4 \xB7 \u65E7\u5230\u65B0",
  "sort.planned.asc": "\u8BA1\u5212\u65F6\u95F4 \xB7 \u65E9\u5230\u665A",
  "sort.planned.desc": "\u8BA1\u5212\u65F6\u95F4 \xB7 \u665A\u5230\u65E9",
  "sort.default.saved": "\u9ED8\u8BA4",
  "empty.title": "\u8BA9\u91CD\u590D\u7684\u7F16\u7801\u5DE5\u4F5C\u81EA\u52A8\u8FD0\u884C",
  "empty.body": "\u8BBE\u7F6E\u4E00\u4E2A\u76EE\u6807\u660E\u786E\u7684\u4EFB\u52A1\u3001\u8FD0\u884C\u65F6\u95F4\u548C\u6743\u9650\u8FB9\u754C\u3002\u6BCF\u6B21\u8FD0\u884C\u90FD\u4ECE\u5168\u65B0 Session \u5F00\u59CB\u3002",
  "empty.action": "\u521B\u5EFA\u7B2C\u4E00\u4E2A\u81EA\u52A8\u5316",
  "runs.empty": "\u8FD8\u6CA1\u6709\u8FD0\u884C\u8BB0\u5F55\u3002\u4F60\u53EF\u4EE5\u7ACB\u5373\u8FD0\u884C\u4E00\u6B21\uFF0C\u6216\u7B49\u5F85\u8BA1\u5212\u89E6\u53D1\u3002",
  "form.title": "\u521B\u5EFA\u81EA\u52A8\u5316",
  "form.subtitle": "\u8BF7\u5199\u5B8C\u6574\u3001\u72EC\u7ACB\u7684\u4EFB\u52A1\u8BF4\u660E\uFF1A\u5B9A\u65F6\u8FD0\u884C\u4E0D\u4F1A\u7EE7\u627F\u5F53\u524D\u5BF9\u8BDD\u3002",
  "form.editTitle": "\u7F16\u8F91\u81EA\u52A8\u5316",
  "form.editSubtitle": "\u4FDD\u5B58\u524D\u53EF\u4EE5\u67E5\u770B\u5E76\u4FEE\u6539\u5B8C\u6574\u6307\u4EE4\u3001\u8FD0\u884C\u8BA1\u5212\u548C\u6743\u9650\u8FB9\u754C\u3002",
  "form.name": "\u540D\u79F0",
  "form.namePlaceholder": "\u6BCF\u65E5\u56DE\u5F52\u6D4B\u8BD5\u5206\u8BCA",
  "form.prompt": "\u4EFB\u52A1\u6307\u4EE4",
  "form.promptPlaceholder": "\u68C0\u67E5\u65B0\u589E\u6D4B\u8BD5\u5931\u8D25\uFF0C\u5B9A\u4F4D\u56DE\u5F52\u539F\u56E0\uFF0C\u5E76\u7ED9\u51FA\u7ECF\u8FC7\u9A8C\u8BC1\u7684\u6700\u5C0F\u4FEE\u590D\u65B9\u6848\u2026\u2026",
  "form.model": "\u6A21\u578B",
  "form.followGlobal": "\u8DDF\u968F\u5168\u5C40\u8BBE\u7F6E",
  "form.followGlobalHint": "\u6BCF\u6B21\u8FD0\u884C\u5F00\u59CB\u65F6\u8BFB\u53D6\u5F53\u65F6\u7684\u5168\u5C40\u6A21\u578B\u8BBE\u7F6E\u3002",
  "form.pinnedModelHint": "\u8BA9\u8FD9\u4E2A\u81EA\u52A8\u5316\u59CB\u7EC8\u4F7F\u7528\u6240\u9009\u670D\u52A1\u5546\u548C\u6A21\u578B\u3002",
  "form.currentUnavailable": "\u5F53\u524D\u503C\uFF08\u5DF2\u4E0B\u67B6\uFF09\xB7 {provider}/{model}",
  "form.reasoningEffort": "\u63A8\u7406\u7A0B\u5EA6",
  "form.modelDefault": "\u6A21\u578B\u9ED8\u8BA4",
  "form.modelDefaultValue": "\u6A21\u578B\u9ED8\u8BA4\uFF08{effort}\uFF09",
  "form.effortUnavailable": "\u5F53\u524D\u503C\uFF08\u5DF2\u4E0B\u67B6\uFF09\xB7 {effort}",
  "form.reasoningFollowGlobal": "\u63A8\u7406\u7A0B\u5EA6\u968F\u5168\u5C40\u6A21\u578B\u8BBE\u7F6E\u3002",
  "form.reasoningHint": "\u9009\u9879\u7531\u5F53\u524D\u6A21\u578B\u63D0\u4F9B\u3002",
  "form.catalogLoading": "\u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u76EE\u5F55\u2026",
  "form.catalogError": "\u6A21\u578B\u76EE\u5F55\u4E0D\u53EF\u7528\uFF1A{message}",
  "form.catalogFailure": "\u65E0\u6CD5\u52A0\u8F7D {provider}\uFF1A{message}",
  "form.catalogRetry": "\u91CD\u8BD5\u52A0\u8F7D\u6A21\u578B\u76EE\u5F55",
  "form.schedule": "\u8FD0\u884C\u8BA1\u5212",
  "form.once": "\u5355\u6B21",
  "form.interval": "\u95F4\u9694",
  "form.daily": "\u6BCF\u5929",
  "form.weekly": "\u6BCF\u5468",
  "form.runAt": "\u8FD0\u884C\u65F6\u95F4",
  "form.every": "\u6BCF\u9694",
  "form.minutes": "\u5206\u949F",
  "form.time": "\u65F6\u95F4",
  "form.days": "\u661F\u671F",
  "form.timeZone": "\u65F6\u533A",
  "form.permission": "\u6743\u9650\u8FB9\u754C",
  "form.readOnly": "\u53EA\u8BFB",
  "form.readOnlyHint": "\u53EF\u4EE5\u68C0\u67E5\u5DE5\u4F5C\u533A\uFF0C\u4F46\u4E0D\u4F1A\u4FEE\u6539\u6587\u4EF6\u3002",
  "form.workspaceWrite": "\u53EF\u5199\u5DE5\u4F5C\u533A",
  "form.workspaceWriteHint": "\u53EF\u4EE5\u4FEE\u6539\u5F53\u524D\u5DE5\u4F5C\u533A\u6587\u4EF6\uFF1B\u4E0D\u4F1A\u7EE7\u627F\u5386\u53F2\u6279\u51C6\u3002",
  "form.cancel": "\u53D6\u6D88",
  "form.submit": "\u521B\u5EFA\u81EA\u52A8\u5316",
  "form.submitting": "\u521B\u5EFA\u4E2D\u2026",
  "form.save": "\u4FDD\u5B58\u4FEE\u6539",
  "form.saving": "\u4FDD\u5B58\u4E2D\u2026",
  "form.error.name": "\u8BF7\u8F93\u5165\u540D\u79F0\u3002",
  "form.error.prompt": "\u8BF7\u8F93\u5165\u5B8C\u6574\u3001\u72EC\u7ACB\u7684\u4EFB\u52A1\u6307\u4EE4\u3002",
  "form.error.once": "\u8BF7\u9009\u62E9\u6709\u6548\u7684\u672A\u6765\u65E5\u671F\u548C\u65F6\u95F4\u3002",
  "form.error.interval": "\u8FD0\u884C\u95F4\u9694\u5FC5\u987B\u5728 5 \u5230 43,200 \u5206\u949F\u4E4B\u95F4\u3002",
  "form.error.weekdays": "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u5929\u3002",
  "form.error.model": "\u8BF7\u9009\u62E9\u8DDF\u968F\u5168\u5C40\u8BBE\u7F6E\uFF0C\u6216\u540C\u65F6\u6307\u5B9A\u5B8C\u6574\u7684\u670D\u52A1\u5546\u548C\u6A21\u578B\u3002",
  "day.1": "\u5468\u4E00",
  "day.2": "\u5468\u4E8C",
  "day.3": "\u5468\u4E09",
  "day.4": "\u5468\u56DB",
  "day.5": "\u5468\u4E94",
  "day.6": "\u5468\u516D",
  "day.7": "\u5468\u65E5",
  "status.active": "\u5DF2\u542F\u7528",
  "status.paused": "\u5DF2\u6682\u505C",
  "status.queued": "\u6392\u961F\u4E2D",
  "status.running": "\u8FD0\u884C\u4E2D",
  "status.succeeded": "\u5DF2\u5B8C\u6210",
  "status.failed": "\u5931\u8D25",
  "status.skipped": "\u5DF2\u8DF3\u8FC7",
  "status.cancelled": "\u5DF2\u53D6\u6D88",
  "status.interrupted": "\u5DF2\u4E2D\u65AD",
  "card.nextRun": "\u4E0B\u6B21",
  "card.lastRun": "\u6700\u8FD1",
  "card.never": "\u5C1A\u672A\u8FD0\u884C",
  "card.permission.read-only": "\u53EA\u8BFB",
  "card.permission.workspace-write": "\u53EF\u5199\u5DE5\u4F5C\u533A",
  "card.modelGlobal": "\u8DDF\u968F\u5168\u5C40\u8BBE\u7F6E",
  "card.modelPinned": "{provider}/{model} \xB7 {effort}",
  "schedule.onceAt": "\u5355\u6B21 \xB7 {time}",
  "schedule.everyMinutes": "\u6BCF {count} \u5206\u949F",
  "schedule.dailyAt": "\u6BCF\u5929 \xB7 {time}",
  "schedule.weeklyAt": "{days} \xB7 {time}",
  "card.pause": "\u6682\u505C",
  "card.resume": "\u6062\u590D",
  "card.runNow": "\u7ACB\u5373\u8FD0\u884C",
  "card.edit": "\u7F16\u8F91",
  "card.viewPrompt": "\u67E5\u770B\u5B8C\u6574\u6307\u4EE4",
  "card.delete": "\u5220\u9664",
  "card.confirmDelete": "\u786E\u8BA4\u5220\u9664\u8FD9\u4E2A\u81EA\u52A8\u5316\uFF1F",
  "card.confirmDeleteHint": "\u8FD0\u884C\u5386\u53F2\u4F1A\u4FDD\u7559\u7528\u4E8E\u5BA1\u8BA1\u3002",
  "card.confirm": "\u786E\u8BA4\u5220\u9664",
  "card.cancel": "\u53D6\u6D88",
  "run.trigger.schedule": "\u5B9A\u65F6",
  "run.trigger.manual": "\u624B\u52A8",
  "run.trigger.catch-up": "\u8865\u507F\u8FD0\u884C",
  "run.openSession": "Session {id}",
  "run.sessionArchived": "Session \u5DF2\u5F52\u6863 \xB7 {id}",
  "run.markRead": "\u6807\u8BB0\u5DF2\u5904\u7406",
  loading: "\u6B63\u5728\u52A0\u8F7D\u81EA\u52A8\u5316\u2026",
  "error.title": "\u65E0\u6CD5\u52A0\u8F7D\u81EA\u52A8\u5316",
  "error.retry": "\u91CD\u8BD5",
  "error.action": "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  "time.now": "\u521A\u521A",
  "time.minuteAgo": "{count} \u5206\u949F\u524D",
  "time.hourAgo": "{count} \u5C0F\u65F6\u524D",
  "time.dayAgo": "{count} \u5929\u524D",
  "time.inMinute": "{count} \u5206\u949F\u540E",
  "time.inHour": "{count} \u5C0F\u65F6\u540E",
  "time.inDay": "{count} \u5929\u540E"
};

// src/client/protocol.ts
function unwrapRpcResult(value) {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    throw new Error("The automation host returned an invalid response.");
  }
  const result = value;
  if (result.ok === true && "value" in result) return result.value;
  if (result.ok === false && "error" in result) {
    const error = result.error;
    throw new Error(error?.message ?? "The automation request failed.");
  }
  throw new Error("The automation host returned an invalid response.");
}

// src/client/runtime.ts
var CHANNEL = "/dsh-automation";
async function loadModelCatalog(api) {
  const response = await api.models({});
  return unwrapRpcResult(response.result);
}
function createAutomationRuntime(rpc, sessionId) {
  let state = { phase: "idle" };
  let refreshPromise;
  const listeners = /* @__PURE__ */ new Set();
  const publish = (next) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const source = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
  const refresh = async () => {
    if (refreshPromise !== void 0) return refreshPromise;
    const previous = state.snapshot;
    publish(previous === void 0 ? { phase: "loading" } : {
      phase: "loading",
      snapshot: previous,
      ...state.refreshedAt === void 0 ? {} : { refreshedAt: state.refreshedAt }
    });
    refreshPromise = (async () => {
      try {
        const payload = { sessionId };
        const response = await rpc.call(CHANNEL, "snapshot", payload);
        const snapshot = unwrapRpcResult(response);
        publish({ phase: "ready", snapshot, refreshedAt: Date.now() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publish(previous === void 0 ? { phase: "error", error: message } : {
          phase: "error",
          snapshot: previous,
          error: message,
          ...state.refreshedAt === void 0 ? {} : { refreshedAt: state.refreshedAt }
        });
        throw error;
      } finally {
        refreshPromise = void 0;
      }
    })();
    return refreshPromise;
  };
  const mutateThenRefresh = async (endpoint, payload) => {
    unwrapRpcResult(await rpc.call(CHANNEL, endpoint, payload));
    const pendingBeforeRefresh = refreshPromise;
    if (pendingBeforeRefresh !== void 0) await pendingBeforeRefresh.catch(() => void 0);
    await refresh();
  };
  const markRunRead = async (runId) => {
    const payload = { sessionId, runId };
    await mutateThenRefresh("mark-read", payload);
  };
  return {
    source,
    refresh,
    async createAutomation(input) {
      const payload = { sessionId, input };
      await mutateThenRefresh("create", payload);
    },
    async updateAutomation(automationId, expectedRevision, input) {
      const payload = { sessionId, automationId, expectedRevision, input };
      await mutateThenRefresh("update", payload);
    },
    async mutateAutomation(automationId, mutation) {
      const payload = { sessionId, automationId, mutation };
      await mutateThenRefresh("mutate", payload);
    },
    async runNow(automationId) {
      const payload = { sessionId, automationId };
      await mutateThenRefresh("run-now", payload);
    },
    markRunRead,
    async openRunSession(runId, open) {
      await open();
      await markRunRead(runId);
    }
  };
}

// src/client/navigation.ts
function normalizedLabel(value) {
  return value.trim().replace(/\s+/g, " ");
}
function findAutomationTab(tabs, label) {
  const expected = normalizedLabel(label);
  return [...tabs].find((tab) => normalizedLabel(tab.textContent ?? "") === expected);
}
function activateAutomationTab(tabs, label, onUnavailable) {
  const tab = findAutomationTab(tabs, label);
  if (tab === void 0) {
    onUnavailable();
    return "unavailable";
  }
  tab.click();
  return "opened";
}

// src/client/sidebar-entry.ts
var ENTRY_ATTR = "data-dsh-automation-entry";
var NOTICE_ID = "dsh-automation-sidebar-unavailable";
var SIBLING_ENTRY_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry]";
var ENTRY_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.25"/><path d="M12 7.7v4.7l3.15 1.85"/><path d="M5.6 4.9 4.2 6.3M18.4 4.9l1.4 1.4"/></svg>';
function sidebarRoot() {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
  if (column === null) return void 0;
  return column.querySelector('[class*="logoRow"]')?.parentElement ?? column.firstElementChild;
}
function newSessionButton(root) {
  const nested = root.querySelector('button[class*="newSession"]');
  if (nested !== null) return nested;
  return Array.from(root.children).find((child) => child.tagName === "BUTTON");
}
function automationTabs() {
  return document.querySelectorAll('[role="tab"]');
}
function installAutomationSidebarEntry(t) {
  const entry = document.createElement("button");
  entry.type = "button";
  entry.setAttribute(ENTRY_ATTR, "");
  entry.className = "dsh-automation-sidebar-entry";
  entry.setAttribute("aria-label", t("sidebar.open"));
  entry.title = t("sidebar.open");
  entry.innerHTML = ENTRY_SVG;
  const label = document.createElement("span");
  label.className = "dsh-automation-sidebar-entry-label";
  label.textContent = t("tab");
  entry.append(label);
  let notice;
  const positionNotice = () => {
    if (notice === void 0) return;
    const rect = entry.getBoundingClientRect();
    notice.style.top = `${Math.max(8, rect.bottom + 6)}px`;
    notice.style.left = `${Math.max(8, rect.left)}px`;
  };
  const hideNotice = () => {
    notice?.remove();
    notice = void 0;
  };
  const showNotice = () => {
    if (notice !== void 0) return;
    notice = document.createElement("span");
    notice.id = NOTICE_ID;
    notice.className = "dsh-automation-sidebar-feedback";
    notice.setAttribute("role", "status");
    notice.textContent = t("sidebar.unavailable");
    document.body.append(notice);
    positionNotice();
  };
  const open = () => {
    const result = activateAutomationTab(automationTabs(), t("tab"), showNotice);
    if (result === "opened") hideNotice();
  };
  entry.addEventListener("click", open);
  let rootEl;
  const placeEntry = () => {
    if (rootEl !== void 0 && !rootEl.isConnected) rootEl = void 0;
    rootEl ??= sidebarRoot();
    if (rootEl === void 0) return;
    const button = newSessionButton(rootEl);
    if (button === void 0) return;
    if (entry.parentElement !== rootEl) {
      const row = button.closest('[class*="logoRow"]');
      const base = row !== null && row.parentElement === rootEl ? row : button;
      const sibling = Array.from(rootEl.children).find((child) => child instanceof HTMLElement && child.matches(SIBLING_ENTRY_SELECTOR));
      rootEl.insertBefore(entry, sibling ?? base.nextElementSibling);
    }
  };
  placeEntry();
  const observer = new MutationObserver(placeEntry);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", positionNotice);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", positionNotice);
    entry.remove();
    hideNotice();
  };
}

// src/client/styles.ts
var STYLE_ID = "dsh-automation-styles";
var CSS_TEXT = String.raw`
.dsh-automation-sidebar-entry,.dsh-automation-sidebar-feedback{box-sizing:border-box}
.dsh-automation-sidebar-entry{display:flex;width:100%;height:38px;align-items:center;justify-content:center;gap:8px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family,system-ui);font-size:14px;line-height:20px;white-space:nowrap;cursor:pointer}
.dsh-automation-sidebar-entry:hover{background:var(--dsw-specific-sidebar-nav-item-hover,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}
.dsh-automation-sidebar-entry:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-automation-sidebar-entry svg{width:18px;height:18px;flex:none}
.dsh-automation-sidebar-entry-label{overflow:hidden;text-overflow:ellipsis}
[data-dsh-frame][data-sidebar-collapsed] .dsh-automation-sidebar-entry{justify-content:center;padding:0;width:100%}
[data-dsh-frame][data-sidebar-collapsed] .dsh-automation-sidebar-entry-label{display:none}
.dsh-automation-sidebar-feedback{display:block;position:fixed;z-index:20;max-width:260px;padding:5px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,var(--dsw-alias-border-l2));border-radius:7px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px}
.dsh-automation-section-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
.dsh-automation-dropdown{position:relative;min-width:0}
.dsh-automation-dropdown-btn{display:inline-flex;align-items:center;gap:4px;max-width:220px;height:28px;padding:0 10px;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap}
.dsh-automation-dropdown-btn:hover,.dsh-automation-dropdown-btn.is-open{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.18))}
.dsh-automation-dropdown-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-automation-dropdown-chevron{flex:none;transition:transform .16s ease}
.dsh-automation-dropdown-btn.is-open .dsh-automation-dropdown-chevron{transform:rotate(180deg)}
.dsh-automation-dropdown-menu{box-sizing:border-box;position:absolute;right:0;top:calc(100% + 2px);z-index:30;width:max-content;min-width:180px;max-width:calc(100vw - 16px);max-height:260px;overflow-x:hidden;overflow-y:auto;padding:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;background:var(--dsw-alias-bg-layer-3,#303033);box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.32))}
.dsh-automation-dropdown-menu.is-float{position:fixed;right:auto;top:auto;z-index:1200}
.dsh-automation-dropdown-menu.dsh-automation-dropdown-sort{min-width:0}
.dsh-automation-dropdown-row{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;min-height:36px;padding:6px 10px;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left}
.dsh-automation-dropdown-label-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-automation-dropdown-row:not(.has-trailing) .dsh-automation-dropdown-label-cell{flex:1}
.dsh-automation-dropdown-row.has-trailing .dsh-automation-dropdown-label-cell{flex:none}
.dsh-automation-dropdown-spacer{min-width:0}
.dsh-automation-dropdown-row:not(.has-trailing) .dsh-automation-dropdown-spacer{flex:0 0 0}
.dsh-automation-dropdown-row.has-trailing .dsh-automation-dropdown-spacer{flex:1 1 auto}
.dsh-automation-dropdown-row.has-trailing{gap:0}
.dsh-automation-dropdown-row.has-trailing .dsh-automation-dropdown-label-cell{margin-right:8px}
.dsh-automation-dropdown-row.has-trailing .dsh-automation-dropdown-default{margin-right:4px}
.dsh-automation-dropdown-check{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}
.dsh-automation-dropdown-row:hover,.dsh-automation-dropdown-row.is-selected{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,inherit)}
.dsh-automation-dropdown-default{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:auto;min-width:0;height:22px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;overflow:hidden}
.dsh-automation-dropdown-default:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.2))}
.dsh-automation-dropdown-default:disabled,.dsh-automation-dropdown-default.is-on{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.08);color:var(--dsw-alias-label-tertiary,#8b8f98);cursor:default}
.dsh-automation-sort-tick{width:16px;height:16px;flex:none}
.dsh-automation-shell,.dsh-automation-shell *{box-sizing:border-box}
.dsh-automation-shell{width:100%;height:100%;min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 clamp(20px,3vw,48px) calc(var(--dsh-composer-height,152px) + 36px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui);scrollbar-gutter:stable}
.dsh-automation-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;max-width:1440px;margin:0 auto 18px}
.dsh-automation-heading{display:flex;min-width:0;align-items:flex-start;gap:14px}.dsh-automation-heading h1{margin:1px 0 3px;font-size:25px;line-height:31px;letter-spacing:-.025em}.dsh-automation-heading p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-automation-logo{display:inline-flex;width:44px;height:44px;flex:none;align-items:center;justify-content:center;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 25%,var(--dsw-alias-border-l2));border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-state-business-tertiary) 76%,var(--dsw-alias-bg-base));box-shadow:var(--dsw-shadow-lv1);color:var(--dsw-alias-state-business-primary)}.dsh-automation-logo svg{width:23px;height:23px}
.dsh-automation-kicker{display:block;color:var(--dsw-alias-state-business-primary);font-size:10px;font-weight:700;line-height:15px;letter-spacing:.075em;text-transform:uppercase}
.dsh-automation-scope{display:flex;max-width:1440px;align-items:center;gap:22px;margin:0 auto 18px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}.dsh-automation-scope span{display:flex;min-width:0;align-items:center;gap:7px}.dsh-automation-scope strong{color:var(--dsw-alias-label-tertiary);font-weight:600}.dsh-automation-scope code{overflow:hidden;color:var(--dsw-alias-label-secondary);font:11px/17px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}
.dsh-automation-button{display:inline-flex;min-height:34px;align-items:center;justify-content:center;gap:7px;padding:6px 13px;border:1px solid transparent;border-radius:9px;font:600 12px/18px var(--dsw-font-family,system-ui);white-space:nowrap;cursor:pointer;transition:background var(--ds-transition-duration-fast,120ms),border-color var(--ds-transition-duration-fast,120ms),color var(--ds-transition-duration-fast,120ms),transform var(--ds-transition-duration-fast,120ms)}.dsh-automation-button svg{width:16px;height:16px}.dsh-automation-button:disabled{cursor:not-allowed;opacity:.45}.dsh-automation-button--primary{border-color:var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground);box-shadow:var(--dsw-shadow-lv1)}.dsh-automation-button--primary:hover:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover);transform:translateY(-1px)}.dsh-automation-button--ghost{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}.dsh-automation-button--ghost:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,var(--dsw-alias-border-l2));background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}.dsh-automation-button--danger{border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-automation-icon-button{display:inline-flex;width:32px;height:32px;flex:none;align-items:center;justify-content:center;padding:0;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}.dsh-automation-icon-button:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}.dsh-automation-icon-button:disabled{cursor:not-allowed;opacity:.4}
.dsh-automation-stats{display:grid;max-width:1440px;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 auto 22px}.dsh-automation-stats>div{position:relative;display:flex;min-height:76px;overflow:hidden;flex-direction:column;justify-content:center;padding:12px 15px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.dsh-automation-stats>div:before{position:absolute;top:0;bottom:0;left:0;width:3px;background:var(--dsw-alias-state-business-primary);content:''}.dsh-automation-stats>div.is-attention:before{background:var(--dsw-alias-state-error-primary)}.dsh-automation-stats span{color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:600;line-height:16px;text-transform:uppercase;letter-spacing:.055em}.dsh-automation-stats strong{overflow:hidden;margin-top:2px;font-size:17px;line-height:23px;text-overflow:ellipsis;white-space:nowrap}.dsh-automation-stats>div:nth-child(-n+2) strong{color:var(--dsw-alias-state-business-primary);font-size:22px}
.dsh-automation-content{display:grid;max-width:1440px;min-height:0;grid-template-columns:minmax(0,1.7fr) minmax(300px,.8fr);align-items:start;gap:18px;margin:0 auto}.dsh-automation-main-column,.dsh-automation-runs-column{min-width:0}.dsh-automation-runs-column{position:sticky;top:0}
.dsh-automation-section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;padding:0 2px}.dsh-automation-section-heading h2{margin:0;font-size:14px;line-height:20px}.dsh-automation-section-heading p{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
.dsh-automation-card-list{display:flex;flex-direction:column;gap:10px}.dsh-automation-card{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1);transition:border-color var(--ds-transition-duration-fast,120ms),box-shadow var(--ds-transition-duration-fast,120ms)}.dsh-automation-card:hover{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,var(--dsw-alias-border-l2));box-shadow:var(--dsw-shadow-lv2)}
.dsh-automation-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dsh-automation-card-title{display:flex;min-width:0;align-items:flex-start;gap:10px}.dsh-automation-card-title>div{min-width:0}.dsh-automation-card-title h3{overflow:hidden;margin:0 0 6px;font-size:14px;line-height:20px;text-overflow:ellipsis;white-space:nowrap}.dsh-automation-card-icon{display:inline-flex;width:34px;height:34px;flex:none;align-items:center;justify-content:center;border-radius:10px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}.dsh-automation-card-icon svg{width:18px;height:18px}.dsh-automation-revision{padding:2px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font:10px/15px ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-automation-card-badges{display:flex;flex-wrap:wrap;align-items:center;gap:5px}.dsh-automation-badge,.dsh-automation-permission-badge,.dsh-automation-model-badge{display:inline-flex;max-width:100%;align-items:center;gap:5px;overflow:hidden;padding:2px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-automation-status-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.dsh-automation-badge--active{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,var(--dsw-alias-border-l2));background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}.dsh-automation-badge--active .dsh-automation-status-dot{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}.dsh-automation-badge--paused{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}.dsh-automation-permission-badge svg{width:12px;height:12px}.dsh-automation-model-badge{background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-automation-prompt{display:-webkit-box;overflow:hidden;margin:13px 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px;-webkit-box-orient:vertical;-webkit-line-clamp:2}.dsh-automation-schedule-line{display:flex;min-width:0;align-items:center;gap:7px;padding:8px 9px;border-radius:8px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);font-size:11px;line-height:17px}.dsh-automation-schedule-line svg{width:14px;height:14px;flex:none}.dsh-automation-schedule-line strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-automation-schedule-line span{margin-left:auto;color:var(--dsw-alias-label-secondary);font:10px/16px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
.dsh-automation-prompt-details{margin:-7px 0 12px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:16px}.dsh-automation-prompt-details summary{width:max-content;color:var(--dsw-alias-state-business-primary);font-weight:650;cursor:pointer}.dsh-automation-prompt-details pre{max-height:320px;overflow:auto;margin:8px 0 0;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:11px/18px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-automation-card-times{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.dsh-automation-card-times>div{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-right:10px;border-right:1px solid var(--dsw-alias-border-l2)}.dsh-automation-card-times>div:last-child{padding-right:0;border-right:0}.dsh-automation-card-times dt{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}.dsh-automation-card-times dd{display:flex;align-items:center;gap:5px;margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:16px}.dsh-automation-mini-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.dsh-automation-mini-dot--succeeded{background:var(--dsw-alias-state-success-primary)}.dsh-automation-mini-dot--failed,.dsh-automation-mini-dot--interrupted{background:var(--dsw-alias-state-error-primary)}.dsh-automation-mini-dot--running,.dsh-automation-mini-dot--queued{background:var(--dsw-alias-state-business-primary)}
.dsh-automation-card-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}.dsh-automation-delete-confirm{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l2));border-radius:9px;background:var(--dsw-alias-state-error-secondary)}.dsh-automation-delete-confirm>div:first-child{display:flex;flex-direction:column}.dsh-automation-delete-confirm strong{font-size:11px;line-height:17px}.dsh-automation-delete-confirm span{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px}.dsh-automation-delete-confirm>div:last-child{display:flex;gap:6px}
.dsh-automation-run-list{display:flex;overflow:hidden;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1)}.dsh-automation-run{padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-automation-run:last-child{border-bottom:0}.dsh-automation-run-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dsh-automation-run-head>div{display:flex;min-width:0;flex-direction:column}.dsh-automation-run-name{overflow:hidden;font-size:12px;font-weight:650;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-automation-run-trigger,.dsh-automation-run-head time{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;white-space:nowrap}.dsh-automation-run-status{display:inline-flex;align-items:center;gap:5px;margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:650;line-height:16px}.dsh-automation-run-status svg{width:13px;height:13px}.dsh-automation-run-status--succeeded{color:var(--dsw-alias-state-success-primary)}.dsh-automation-run-status--failed,.dsh-automation-run-status--interrupted{color:var(--dsw-alias-state-error-primary)}.dsh-automation-run-status--running,.dsh-automation-run-status--queued{color:var(--dsw-alias-state-business-primary)}.dsh-automation-run-status--running svg{animation:dsh-automation-spin 1.6s linear infinite}.dsh-automation-run p{display:-webkit-box;overflow:hidden;margin:7px 0 0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;-webkit-box-orient:vertical;-webkit-line-clamp:3}.dsh-automation-run p.is-error{color:var(--dsw-alias-state-error-primary)}.dsh-automation-session-id{display:block;overflow:hidden;margin-top:6px;color:var(--dsw-alias-label-tertiary);font:9px/14px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}
.dsh-automation-empty,.dsh-automation-runs-empty{display:flex;min-height:250px;flex-direction:column;align-items:center;justify-content:center;padding:34px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);text-align:center}.dsh-automation-empty>span{display:inline-flex;width:48px;height:48px;align-items:center;justify-content:center;border-radius:15px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}.dsh-automation-empty h3{margin:13px 0 4px;font-size:14px}.dsh-automation-empty p{max-width:440px;margin:0 0 17px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}.dsh-automation-runs-empty{min-height:140px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}
.dsh-automation-create{max-width:1440px;margin:0 auto 18px;padding:18px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,var(--dsw-alias-border-l2));border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-state-business-tertiary) 38%,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-shadow-lv1)}.dsh-automation-create-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:16px}.dsh-automation-create-heading h2{margin:2px 0 2px;font-size:16px;line-height:22px}.dsh-automation-create-heading p{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}.dsh-automation-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.dsh-automation-field--wide{grid-column:1/-1}.dsh-automation-field{display:flex;min-width:0;flex-direction:column;gap:6px}.dsh-automation-field>span:first-child,.dsh-automation-fieldset legend{color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:650;line-height:16px}.dsh-automation-field small{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}.dsh-automation-field input,.dsh-automation-field textarea,.dsh-automation-field select{width:100%;min-width:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12px/18px var(--dsw-font-family,system-ui)}.dsh-automation-field input,.dsh-automation-field select{height:36px}.dsh-automation-field select:disabled{cursor:not-allowed;opacity:.55}.dsh-automation-field textarea{min-height:88px;resize:vertical}.dsh-automation-field input:focus,.dsh-automation-field textarea:focus,.dsh-automation-field select:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}.dsh-automation-field input::placeholder,.dsh-automation-field textarea::placeholder{color:var(--dsw-alias-label-dimmed)}
.dsh-automation-catalog-status{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}.dsh-automation-catalog-status .is-warning{color:var(--dsw-alias-label-secondary)}.dsh-automation-catalog-status .is-error{color:var(--dsw-alias-state-error-primary)}.dsh-automation-catalog-status button{margin-left:auto;padding:0;border:0;background:transparent;color:var(--dsw-alias-state-business-primary);font:600 10px/16px var(--dsw-font-family,system-ui);cursor:pointer}
.dsh-automation-fieldset{min-width:0;margin:0;padding:0;border:0}.dsh-automation-fieldset legend{margin-bottom:6px;padding:0}.dsh-automation-segmented{display:inline-grid;grid-template-columns:repeat(4,minmax(80px,1fr));gap:3px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}.dsh-automation-segmented button,.dsh-automation-weekdays button{height:29px;padding:3px 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:600 10px/16px var(--dsw-font-family,system-ui);cursor:pointer}.dsh-automation-segmented button:hover,.dsh-automation-weekdays button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-automation-segmented button.is-selected,.dsh-automation-weekdays button.is-selected{background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv1);color:var(--dsw-alias-state-business-primary)}.dsh-automation-schedule-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:10px}.dsh-automation-weekdays{grid-column:1/-1}.dsh-automation-weekdays>div{display:flex;flex-wrap:wrap;gap:4px}.dsh-automation-weekdays button{min-width:44px;border:1px solid var(--dsw-alias-border-l2)}.dsh-automation-weekdays button.is-selected{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,var(--dsw-alias-border-l2));background:var(--dsw-alias-state-business-tertiary)}.dsh-automation-inline-input{display:flex;align-items:center;gap:8px}.dsh-automation-inline-input input{max-width:150px}.dsh-automation-inline-input>span{color:var(--dsw-alias-label-secondary);font-size:11px}
.dsh-automation-permission-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dsh-automation-permission-grid label{display:flex;min-width:0;align-items:flex-start;gap:9px;padding:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);cursor:pointer}.dsh-automation-permission-grid label.is-selected{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}.dsh-automation-permission-grid input{position:absolute;opacity:0;pointer-events:none}.dsh-automation-permission-grid svg{width:17px;height:17px;flex:none;color:var(--dsw-alias-state-business-primary)}.dsh-automation-permission-grid label>span{display:flex;min-width:0;flex-direction:column}.dsh-automation-permission-grid strong{font-size:11px;line-height:17px}.dsh-automation-permission-grid small{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px}
.dsh-automation-form-footer{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:15px;padding-top:13px;border-top:1px solid var(--dsw-alias-border-l2)}.dsh-automation-form-error{flex:1;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:17px}.dsh-automation-inline-error{display:flex;max-width:1440px;align-items:center;gap:8px;margin:0 auto 14px;padding:9px 11px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,var(--dsw-alias-border-l2));border-radius:9px;background:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:17px}.dsh-automation-inline-error svg{width:15px;height:15px;flex:none}
.dsh-automation-centered{display:flex;min-height:420px;flex-direction:column;align-items:center;justify-content:center;gap:9px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-automation-centered h2{margin:3px 0 0;color:var(--dsw-alias-label-primary);font-size:15px}.dsh-automation-centered p{max-width:480px;margin:0 0 8px;color:var(--dsw-alias-label-secondary)}.dsh-automation-loader,.dsh-automation-error-icon{display:inline-flex;width:46px;height:46px;align-items:center;justify-content:center;border-radius:14px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}.dsh-automation-loader svg{animation:dsh-automation-spin 1.6s linear infinite}.dsh-automation-error-icon{background:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}
.dsh-automation-session-id{max-width:100%;padding:0;border:0;background:transparent;color:var(--dsw-alias-state-business-primary);text-align:left;cursor:pointer}.dsh-automation-session-id:hover{text-decoration:underline}.dsh-automation-session-id--archived{color:var(--dsw-alias-label-tertiary);cursor:default}.dsh-automation-session-id--archived:hover{text-decoration:none}
.dsh-automation-run-review{display:inline-flex;align-items:center;gap:4px;margin-top:7px;padding:2px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:600 9px/14px var(--dsw-font-family,system-ui);cursor:pointer}.dsh-automation-run-review svg{width:11px;height:11px}.dsh-automation-run-review:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-business-primary)}.dsh-automation-run-review:disabled{cursor:not-allowed;opacity:.45}
.dsh-automation-shell button:focus-visible,.dsh-automation-shell input:focus-visible,.dsh-automation-shell textarea:focus-visible,.dsh-automation-shell select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
@keyframes dsh-automation-spin{to{transform:rotate(360deg)}}
@media(max-width:1100px){.dsh-automation-content{grid-template-columns:1fr}.dsh-automation-runs-column{position:static}.dsh-automation-run-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.dsh-automation-run:nth-child(odd){border-right:1px solid var(--dsw-alias-border-l2)}.dsh-automation-run:nth-last-child(-n+2){border-bottom:0}}
@media(max-width:760px){.dsh-automation-shell{padding:18px 14px calc(var(--dsh-composer-height,152px) + 24px)}.dsh-automation-header{align-items:center}.dsh-automation-heading p{display:none}.dsh-automation-logo{width:38px;height:38px;border-radius:12px}.dsh-automation-stats{grid-template-columns:1fr 1fr}.dsh-automation-scope{align-items:flex-start;flex-direction:column;gap:4px}.dsh-automation-form-grid,.dsh-automation-schedule-fields,.dsh-automation-permission-grid{grid-template-columns:1fr}.dsh-automation-segmented{width:100%;grid-template-columns:1fr 1fr}.dsh-automation-card-times{grid-template-columns:1fr}.dsh-automation-card-times>div{padding-right:0;border-right:0}.dsh-automation-run-list{grid-template-columns:1fr}.dsh-automation-run:nth-child(odd){border-right:0}.dsh-automation-run:nth-last-child(2){border-bottom:1px solid var(--dsw-alias-border-l2)}}
@media(max-width:480px){.dsh-automation-header{align-items:flex-start;flex-direction:column}.dsh-automation-header>.dsh-automation-button{width:100%}.dsh-automation-heading h1{font-size:21px}.dsh-automation-stats{gap:7px}.dsh-automation-stats>div{min-height:68px;padding:10px 12px}.dsh-automation-card{padding:13px}.dsh-automation-schedule-line{align-items:flex-start;flex-wrap:wrap}.dsh-automation-schedule-line span{width:100%;margin-left:21px}.dsh-automation-card-actions{display:grid;grid-template-columns:1fr 1fr}.dsh-automation-card-actions>.dsh-automation-icon-button{position:absolute;right:28px}.dsh-automation-delete-confirm{align-items:stretch;flex-direction:column}.dsh-automation-delete-confirm>div:last-child{justify-content:flex-end}.dsh-automation-create{padding:14px}.dsh-automation-create-heading{flex-direction:column}.dsh-automation-create-heading>.dsh-automation-button{display:none}}
@media(prefers-reduced-motion:reduce){.dsh-automation-button,.dsh-automation-card{transition:none}.dsh-automation-loader svg,.dsh-automation-run-status--running svg{animation:none}}
`;
function installStyles() {
  const existing = document.getElementById(STYLE_ID);
  if (existing !== null) return () => void 0;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT;
  document.head.append(style);
  return () => {
    style.remove();
  };
}

// src/client/index.ts
var name = "dsh-automation-client";
var inject = ["slots", "locale", "connection", "sessions"];
function apply(ctx) {
  ctx.effect(() => installStyles(), "dsh-automation: styles");
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-automation: locale");
  const t = ctx.locale.bind(NS);
  const readModelCatalog = () => loadModelCatalog(ctx.connection.api.llm);
  const runtimes = /* @__PURE__ */ new Map();
  ctx.effect(() => () => {
    runtimes.clear();
  }, "dsh-automation: session runtimes");
  ctx.effect(() => installAutomationSidebarEntry(t), "dsh-automation: sidebar entry");
  ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: "automation",
    order: 40,
    locale: NS,
    label: () => t("tab"),
    inject: (sessionId) => {
      let runtime = runtimes.get(sessionId);
      if (runtime === void 0) {
        runtime = createAutomationRuntime(ctx.connection.rpc, sessionId);
        runtimes.set(sessionId, runtime);
      }
      return {
        hooks: { automationState: runtime.source },
        refresh: runtime.refresh,
        createAutomation: runtime.createAutomation,
        updateAutomation: runtime.updateAutomation,
        mutateAutomation: runtime.mutateAutomation,
        runNow: runtime.runNow,
        markRunRead: runtime.markRunRead,
        loadModelCatalog: readModelCatalog,
        openSession: (runId, runSessionId) => runtime.openRunSession(runId, async () => {
          await ctx.sessions.refresh();
          ctx.sessions.open(runSessionId);
        })
      };
    }
  }, AutomationView));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
