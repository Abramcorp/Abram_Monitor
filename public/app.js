"use strict";

const state = {
  banks: [],
  clients: [],
  dashboard: null,
  knowledge: [],
  managers: [],
  tasks: [],
  users: [],
  documentRequests: [],
  integrations: null,
  programTypes: [],
  programCategories: [],
  lastSeenFulfilledRequestIds: new Set(),
  user: null,
  filters: {
    query: "",
    manager: "all",
    bank: "all",
    programType: "all",
    category: "all",
    stage: "all"
  },
  board: {
    status: "current",
    groupBy: "manager"
  },
  summary: {
    groupBy: "stage" // "stage" | "client"
  },
  summaryCharts: {
    period: "year"
  },
  archive: {
    groupBy: "manager"
  },
  knowledgeSection: "banks",
  view: "summary"
};

const app = document.querySelector("#app");
const viewTabs = document.querySelector("#viewTabs");
const refreshButton = document.querySelector("#refreshButton");
const newManagerButton = document.querySelector("#newManagerButton");
const newClientButton = document.querySelector("#newClientButton");
const newDealButton = document.querySelector("#newDealButton");
const newKnowledgeButton = document.querySelector("#newKnowledgeButton");
const dialog = document.querySelector("#dealDialog");
const form = document.querySelector("#dealForm");
const saveDealButton = document.querySelector("#saveDealButton");
const clientDialog = document.querySelector("#clientDialog");
const clientForm = document.querySelector("#clientForm");
const managerDialog = document.querySelector("#managerDialog");
const managerForm = document.querySelector("#managerForm");
const dealActionDialog = document.querySelector("#dealActionDialog");
const dealActionForm = document.querySelector("#dealActionForm");
const knowledgeDialog = document.querySelector("#knowledgeDialog");
const knowledgeForm = document.querySelector("#knowledgeForm");
const knowledgeDialogTitle = document.querySelector("#knowledgeDialogTitle");
const userDialog = document.querySelector("#userDialog");
const userForm = document.querySelector("#userForm");
const userDialogTitle = document.querySelector("#userDialogTitle");
const userFormError = document.querySelector("#userFormError");
const userPasswordHint = document.querySelector("#userPasswordHint");
const userLoginField = document.querySelector("#userLogin");
const documentRequestDialog = document.querySelector("#documentRequestDialog");
const documentRequestForm = document.querySelector("#documentRequestForm");
const documentRequestDealSelect = document.querySelector("#docRequestDeal");
const documentRequestError = document.querySelector("#docRequestError");
const toastHost = document.querySelector("#toastHost");
const applicationProgramPreview = document.querySelector("#applicationProgramPreview");
const taskDialog = document.querySelector("#taskDialog");
const taskForm = document.querySelector("#taskForm");
const newTaskButton = document.querySelector("#newTaskButton");
const loginShell = document.querySelector("#loginShell");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const loginSubmit = document.querySelector("#loginSubmit");
const appShell = document.querySelector("#appShell");
const logoutButton = document.querySelector("#logoutButton");
const userBadge = document.querySelector("#userBadge");
const userBadgeName = document.querySelector("#userBadgeName");
const userBadgeRole = document.querySelector("#userBadgeRole");

const ROLE_LABELS = {
  admin: "Администратор",
  analyst_abram: "Аналитик AbramCorp",
  partner: "Партнёрский контур",
  documents_officer: "Документы"
};

function currentRole() {
  return state.user?.role || null;
}
function isAdmin() {
  return currentRole() === "admin";
}
function isAnalystAbram() {
  return currentRole() === "analyst_abram";
}
function isPartner() {
  return currentRole() === "partner";
}
function isDocumentsOfficer() {
  return currentRole() === "documents_officer";
}
function canEditKnowledge() {
  return isAdmin() || isAnalystAbram();
}
function partnerManagerName() {
  return isPartner() ? String(state.user?.fullName || "").trim() : "";
}

const VIEWS = [
  { id: "summary", label: "Сводный отчет", allowedRoles: ["admin", "analyst_abram", "partner"] },
  { id: "funnels", label: "Аналитики", allowedRoles: ["admin", "analyst_abram", "partner"] },
  { id: "archive", label: "Архив клиентов", allowedRoles: ["admin", "analyst_abram", "partner"] },
  { id: "knowledge", label: "База знаний", allowedRoles: ["admin", "analyst_abram", "partner"] },
  { id: "document-requests", label: "Запросы документов", allowedRoles: ["admin", "documents_officer"] },
  { id: "admin-panel", label: "Панель управления", allowedRoles: ["admin"] }
];

function visibleViews() {
  const role = currentRole();
  return VIEWS.filter((view) => !view.allowedRoles || view.allowedRoles.includes(role));
}

const REQUIREMENT_LABELS = {
  businessRegion: "Регион ведения бизнеса",
  ipAge: "Возраст ИП",
  revenue: "Выручка",
  documentation: "Запросы и документы",
  okved: "ОКВЭД",
  accountPresence: "Наличие счета"
};

const BOARD_STATUS_LABELS = {
  current: "Текущие",
  completed: "Завершенные"
};

const BOARD_GROUP_LABELS = {
  manager: "По аналитикам",
  client: "По клиентам",
  bank: "По банкам"
};

const SUMMARY_CHART_PERIOD_LABELS = {
  month: "Месяц",
  quarter: "Квартал",
  half: "Полугодие",
  year: "Год",
  all: "Все время"
};

const SUMMARY_CHART_PERIOD_MONTHS = {
  month: 1,
  quarter: 3,
  half: 6,
  year: 12,
  all: null
};

const BOARD_GROUP_EYEBROWS = {
  manager: "Аналитик",
  client: "Клиент",
  bank: "Банк"
};

const ARCHIVE_GROUP_LABELS = {
  manager: "По аналитикам",
  date: "По дате добавления"
};

const APPLICATION_STAGE_LABELS = {
  planned: "Плановая",
  lead: "Закинули лид",
  submitted: "Подписали заявку ждем решение",
  approved: "Одобрено",
  rejected: "Отклонено",
  blocked: "Нет возможности завести заявку (УКАЗАТЬ ПРИЧИНУ)"
};

// Дефолтные значения. Используются как fallback, пока не загрузились
// актуальные списки с бэка. После loadData PROGRAM_TYPES/PROGRAM_CATEGORIES
// проксируются на state.programTypes/programCategories (см. геттеры ниже).
const DEFAULT_PROGRAM_TYPES = ["Экспресс", "Стандарт", "Физическое лицо", "Добивка"];
const DEFAULT_PROGRAM_CATEGORIES = [
  "1 КАТЕГОРИЯ",
  "2 КАТЕГОРИЯ",
  "3 КАТЕГОРИЯ",
  "РЕГИОНАЛЬНЫЕ",
  "СВОЯ ВЫРУЧКА",
  "НАЛОГОВАЯ ДЕКЛАРАЦИЯ",
  "ФИЗАВТО",
  "ТЕСТОВЫЕ БАНКИ"
];
function PROGRAM_TYPES_LIST() {
  return (state.programTypes && state.programTypes.length)
    ? state.programTypes.map((it) => it.name)
    : DEFAULT_PROGRAM_TYPES;
}
function PROGRAM_CATEGORIES_LIST() {
  return (state.programCategories && state.programCategories.length)
    ? state.programCategories.map((it) => it.name)
    : DEFAULT_PROGRAM_CATEGORIES;
}
// Совместимость: старый код использует PROGRAM_TYPES / PROGRAM_CATEGORIES как массивы.
// Перепишем все usages на функции, а старые имена оставим как proxy через геттер.
const PROGRAM_TYPES = new Proxy([], {
  get: (_t, p) => {
    const arr = PROGRAM_TYPES_LIST();
    if (p === Symbol.iterator) return arr[Symbol.iterator].bind(arr);
    if (p === "length") return arr.length;
    if (typeof p === "string" && /^\d+$/.test(p)) return arr[Number(p)];
    const v = arr[p];
    return typeof v === "function" ? v.bind(arr) : v;
  }
});
const PROGRAM_CATEGORIES = new Proxy([], {
  get: (_t, p) => {
    const arr = PROGRAM_CATEGORIES_LIST();
    if (p === Symbol.iterator) return arr[Symbol.iterator].bind(arr);
    if (p === "length") return arr.length;
    if (typeof p === "string" && /^\d+$/.test(p)) return arr[Number(p)];
    const v = arr[p];
    return typeof v === "function" ? v.bind(arr) : v;
  }
});
const CATEGORY_FALLBACK_LABEL = "Без категории";
const KNOWLEDGE_SECTIONS = {
  banks: "Банки",
  programs: "Программы",
  categories: "Категории"
};
const MOSCOW_TIME_ZONE = "Europe/Moscow";
const DONUT_COLORS = ["#52bfc1", "#315f9c", "#80c58b", "#e3b91c", "#b66a13", "#b6414a", "#64748b"];
const AREA_SERIES_COLORS = ["#315f9c", "#b66a13", "#12806c", "#b6414a", "#6d5bd0", "#64748b"];

const currency = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
  style: "currency",
  currency: "RUB"
});

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  timeZone: MOSCOW_TIME_ZONE,
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const actionDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: MOSCOW_TIME_ZONE
});

const actionTime = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: MOSCOW_TIME_ZONE
});

const monthLabelFormatter = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  timeZone: MOSCOW_TIME_ZONE,
  year: "2-digit"
});

const dayMonthLabelFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  timeZone: MOSCOW_TIME_ZONE
});

const DAY_MS = 86400000;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return currency.format(Number(value || 0));
}

function percent(part, total) {
  const base = Number(total || 0);
  if (!base) {
    return 0;
  }
  return Math.round((Number(part || 0) / base) * 100);
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

function localDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysSince(value, base = new Date()) {
  const start = localDay(value);
  const end = localDay(base);
  if (!start || !end) {
    return null;
  }
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

function dayLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
  return `${count} ${word}`;
}

function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  return Math.max(0, Math.round((endDate - startDate) / DAY_MS));
}

function earliestDate(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  return timestamps.length ? new Date(timestamps[0]).toISOString() : "";
}

function firstEarliestDate(...groups) {
  for (const group of groups) {
    const value = earliestDate(group);
    if (value) {
      return value;
    }
  }

  return "";
}

function sortableTime(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function formatDateWithAge(value, ageText) {
  const days = daysSince(value);
  if (!value || days === null) {
    return "—";
  }
  return `${formatDate(value)} (${dayLabel(days)} ${ageText})`;
}

function formatDateTimeInput(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: MOSCOW_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function formatDateInput(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: MOSCOW_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatActionEntry(action) {
  const date = new Date(action.actionAt);
  if (Number.isNaN(date.getTime())) {
    return escapeHtml(action.action);
  }
  return `${escapeHtml(action.action)} — ${actionDate.format(date)} — ${actionTime.format(date)}`;
}

function safeExternalUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function applicationStageClass(stage) {
  return `application-stage-${String(stage || "planned").replace(/[^a-z0-9-]/gi, "")}`;
}

function statusChangeAt(deal, stageLabels) {
  return earliestDate(
    (deal.actions || [])
      .filter((action) => {
        const text = String(action.action || "").trim();
        return text.startsWith("Смена статуса:") && stageLabels.some((label) => text.endsWith(`→ ${label}`));
      })
      .map((action) => action.actionAt)
  );
}

function applicationBucketEnteredAt(deal, bucket) {
  if (bucket === "planned") {
    return firstEarliestDate(
      [statusChangeAt(deal, [APPLICATION_STAGE_LABELS.planned]), deal.createdAt],
      [deal.updatedAt, deal.lastActionAt]
    );
  }

  if (bucket === "current") {
    return firstEarliestDate(
      [
        statusChangeAt(deal, [APPLICATION_STAGE_LABELS.lead, APPLICATION_STAGE_LABELS.submitted]),
        deal.inquiryAt,
        deal.signedAt,
        deal.submittedAt
      ],
      [deal.updatedAt, deal.lastActionAt, deal.createdAt]
    );
  }

  if (bucket === "approved") {
    return firstEarliestDate(
      [statusChangeAt(deal, [APPLICATION_STAGE_LABELS.approved]), deal.completedAt],
      [deal.updatedAt, deal.lastActionAt, deal.createdAt]
    );
  }

  if (bucket === "refused") {
    return firstEarliestDate(
      [statusChangeAt(deal, [APPLICATION_STAGE_LABELS.rejected, APPLICATION_STAGE_LABELS.blocked]), deal.completedAt],
      [deal.updatedAt, deal.lastActionAt, deal.createdAt]
    );
  }

  return firstEarliestDate([deal.updatedAt, deal.lastActionAt, deal.createdAt]);
}

function sortByBucketEntry(applications, bucket) {
  return [...applications].sort((left, right) => {
    const leftEntry = sortableTime(applicationBucketEnteredAt(left, bucket));
    const rightEntry = sortableTime(applicationBucketEnteredAt(right, bucket));
    return leftEntry - rightEntry || sortableTime(left.lastActionAt) - sortableTime(right.lastActionAt) || left.id.localeCompare(right.id, "ru");
  });
}

function uiStateKey(...parts) {
  return parts.map((part) => encodeURIComponent(String(part ?? "").trim())).join("|");
}

function captureUiState() {
  return {
    openDetails: [...document.querySelectorAll("details[data-ui-state-key][open]")]
      .map((detail) => detail.dataset.uiStateKey)
      .filter(Boolean),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    view: state.view
  };
}

function restoreUiState(snapshot) {
  if (!snapshot || snapshot.view !== state.view) {
    return;
  }

  const openDetails = new Set(snapshot.openDetails || []);
  document.querySelectorAll("details[data-ui-state-key]").forEach((detail) => {
    detail.open = openDetails.has(detail.dataset.uiStateKey);
  });
  requestAnimationFrame(() => {
    window.scrollTo(snapshot.scrollX || 0, snapshot.scrollY || 0);
  });
}

const LEAD_BUCKET_STAGES = new Set(["lead", "documents_requested"]);

function getStageDateRequirements(stage, currentStage = "") {
  const requirements = [];
  if (LEAD_BUCKET_STAGES.has(stage)) {
    requirements.push({ field: "inquiryAt", label: "Дата обращения" });
  }
  if (stage === "submitted") {
    if (LEAD_BUCKET_STAGES.has(currentStage)) {
      requirements.push({ field: "inquiryAt", label: "Дата обращения" });
    }
    requirements.push({ field: "signedAt", label: "Дата подписания" });
  }
  return requirements;
}

class UnauthorizedError extends Error {
  constructor(message = "Не авторизовано") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

const AUTH_TOKEN_KEY = "am_session_token";

// Чистим устаревший localStorage-токен (был fallback'ом до перехода
// на HttpOnly+Secure+SameSite=Strict cookie).
try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* ignore */ }

// Совместимости ради оставляем функции — они теперь no-op.
// Авторизация ходит только через cookie (credentials: "same-origin").
function readStoredToken() { return ""; }
function storeToken(_token) { /* no-op — токен живёт только в HttpOnly cookie */ }

async function requestJson(url, options) {
  const headers = { "Content-Type": "application/json", ...(options?.headers || {}) };

  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (response.status === 401 && !String(url).startsWith("/api/auth/")) {
    handleSessionExpired();
    throw new UnauthorizedError(payload.error || "Сессия истекла");
  }

  if (!response.ok) {
    throw new Error(payload.error || "Ошибка запроса");
  }
  return payload;
}

const LOAD_DATA_TARGETS = {
  dashboard: { url: "/api/dashboard", apply: (payload) => { state.dashboard = payload; }, notForRoles: ["documents_officer"] },
  banks: { url: "/api/banks", apply: (payload) => { state.banks = payload.banks; }, notForRoles: ["documents_officer"] },
  clients: { url: "/api/clients", apply: (payload) => { state.clients = payload.clients; }, notForRoles: ["documents_officer"] },
  managers: { url: "/api/managers", apply: (payload) => { state.managers = payload.managers; }, notForRoles: ["documents_officer"] },
  knowledge: { url: "/api/knowledge", apply: (payload) => { state.knowledge = payload.knowledge; }, notForRoles: ["documents_officer"] },
  tasks: { url: "/api/tasks", apply: (payload) => { state.tasks = payload.tasks || []; }, notForRoles: ["documents_officer"] },
  users: { url: "/api/users", apply: (payload) => { state.users = payload.users || []; }, allowedRoles: ["admin"] },
  integrations: { url: "/api/integrations", apply: (payload) => { state.integrations = payload || null; }, allowedRoles: ["admin"] },
  programTypes: { url: "/api/program-types", apply: (payload) => { state.programTypes = payload.items || []; }, notForRoles: ["documents_officer"] },
  programCategories: { url: "/api/program-categories", apply: (payload) => { state.programCategories = payload.items || []; }, notForRoles: ["documents_officer"] },
  documentRequests: {
    url: "/api/document-requests",
    apply: (payload) => { applyDocumentRequests(payload.documentRequests || []); }
  }
};
const LOAD_DATA_ALL = Object.keys(LOAD_DATA_TARGETS);

// ===== Tasks helpers =====

function compareKey(value) {
  return String(value || "").trim().toLowerCase();
}

function tasksForClient(manager, client) {
  const m = compareKey(manager);
  const c = compareKey(client);
  return state.tasks.filter((task) => compareKey(task.manager) === m && compareKey(task.client) === c);
}

function tasksForManager(managerName) {
  const m = compareKey(managerName);
  return state.tasks.filter((task) => compareKey(task.manager) === m);
}

function classifyTask(task, now = Date.now()) {
  if (task.completedAt) {
    return "done";
  }
  const due = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
  if (Number.isNaN(due)) {
    return "active";
  }
  if (due < now) {
    return "overdue";
  }
  if (due - now < 4 * 60 * 60 * 1000) {
    return "due-soon";
  }
  return "active";
}

function summarizeTasks(tasks) {
  const now = Date.now();
  const summary = { total: tasks.length, active: 0, overdue: 0, dueSoon: 0, done: 0, nextDueAt: "" };
  let nextDue = Infinity;
  for (const task of tasks) {
    const state = classifyTask(task, now);
    if (state === "done") {
      summary.done += 1;
      continue;
    }
    summary.active += 1;
    if (state === "overdue") summary.overdue += 1;
    if (state === "due-soon") summary.dueSoon += 1;
    if (task.dueAt) {
      const due = new Date(task.dueAt).getTime();
      if (!Number.isNaN(due) && due < nextDue) {
        nextDue = due;
      }
    }
  }
  if (nextDue !== Infinity) {
    summary.nextDueAt = new Date(nextDue).toISOString();
  }
  return summary;
}

function formatDueRelative(iso) {
  if (!iso) return "";
  const now = Date.now();
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "";
  const diff = target - now;
  const absMinutes = Math.round(Math.abs(diff) / 60000);
  const formatPart = () => {
    if (absMinutes < 60) return `${absMinutes} мин`;
    const hours = Math.round(absMinutes / 60);
    if (hours < 36) return `${hours} ч`;
    const days = Math.round(hours / 24);
    return `${days} дн`;
  };
  return diff < 0 ? `просрочено на ${formatPart()}` : `через ${formatPart()}`;
}

function renderManagerTaskBadge(manager) {
  const managerName = manager?.manager || "";
  const tasks = tasksForManager(managerName);
  const summary = summarizeTasks(tasks);
  if (!summary.total) {
    return `
      <button class="tasks-strip is-manager is-empty" data-add-task-for="" data-task-manager="${escapeHtml(managerName)}" type="button">
        <span class="tasks-strip-label">Задачи аналитика</span>
        <span class="tasks-strip-meta">нет — добавить</span>
      </button>
    `;
  }
  let stateClass;
  let meta;
  if (summary.overdue) {
    stateClass = "is-overdue";
    meta = `${summary.overdue} просрочено · всего активных ${summary.active}`;
  } else if (summary.dueSoon) {
    stateClass = "is-due-soon";
    meta = `${summary.dueSoon} срочно · всего ${summary.active}`;
  } else if (summary.active) {
    stateClass = "is-active";
    meta = `${summary.active} активных${summary.nextDueAt ? ` · ${formatDueRelative(summary.nextDueAt)}` : ""}`;
  } else {
    stateClass = "is-empty";
    meta = `выполнено ${summary.done}`;
  }
  return `
    <div class="tasks-strip is-manager ${stateClass}" data-tasks-manager-only="${escapeHtml(managerName)}">
      <span class="tasks-strip-label">Задачи аналитика · ${summary.active || summary.done}</span>
      <span class="tasks-strip-meta">${escapeHtml(meta)}</span>
      <button class="ghost-button small-button tasks-strip-add" data-add-task-for="" data-task-manager="${escapeHtml(managerName)}" type="button">+ Задача</button>
    </div>
  `;
}

function renderClientTaskBadge(client) {
  const tasks = tasksForClient(client.manager || client.managerName || "", client.client);
  const summary = summarizeTasks(tasks);
  if (!summary.total) {
    return `
      <button class="tasks-strip is-empty" data-add-task-for="${escapeHtml(client.client)}" data-task-manager="${escapeHtml(client.manager || "")}" type="button">
        <span class="tasks-strip-label">Задачи</span>
        <span class="tasks-strip-meta">нет — добавить</span>
      </button>
    `;
  }
  let stateClass = "";
  let meta;
  if (summary.overdue) {
    stateClass = "is-overdue";
    meta = `${summary.overdue} просрочено · всего активных ${summary.active}`;
  } else if (summary.dueSoon) {
    stateClass = "is-due-soon";
    meta = `${summary.dueSoon} срочно · всего ${summary.active}`;
  } else if (summary.active) {
    stateClass = "is-active";
    meta = `${summary.active} активных${summary.nextDueAt ? ` · ${formatDueRelative(summary.nextDueAt)}` : ""}`;
  } else {
    stateClass = "is-empty";
    meta = `выполнено ${summary.done}`;
  }
  return `
    <div class="tasks-strip ${stateClass}" data-tasks-client="${escapeHtml(client.client)}" data-tasks-manager="${escapeHtml(client.manager || "")}">
      <span class="tasks-strip-label">Задачи · ${summary.active || summary.done}</span>
      <span class="tasks-strip-meta">${escapeHtml(meta)}</span>
      <button class="ghost-button small-button tasks-strip-add" data-add-task-for="${escapeHtml(client.client)}" data-task-manager="${escapeHtml(client.manager || "")}" type="button">+ Задача</button>
    </div>
  `;
}

function renderClientTaskList(client) {
  const tasks = tasksForClient(client.manager || client.managerName || "", client.client);
  const active = tasks.filter((task) => !task.completedAt).sort((a, b) => {
    const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return da - db;
  });
  const done = tasks.filter((task) => task.completedAt).sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
  const renderRow = (task) => {
    const cls = classifyTask(task);
    return `
      <li class="task-row task-${cls}" data-task-id="${escapeHtml(task.id)}">
        <label class="task-toggle">
          <input type="checkbox" data-task-toggle="${escapeHtml(task.id)}" ${task.completedAt ? "checked" : ""}>
          <span class="task-title">${escapeHtml(task.title)}</span>
        </label>
        <span class="task-due" title="${escapeHtml(task.dueAt || "")}">${escapeHtml(task.dueAt ? formatDueRelative(task.dueAt) : "без срока")}</span>
        <button class="icon-button small-button" data-task-delete="${escapeHtml(task.id)}" type="button" title="Удалить">×</button>
      </li>
    `;
  };
  return `
    <div class="task-list-wrap">
      <div class="task-list-head">
        <h4>Задачи клиента</h4>
        <button class="ghost-button small-button" data-add-task-for="${escapeHtml(client.client)}" data-task-manager="${escapeHtml(client.manager || "")}" type="button">+ Задача</button>
      </div>
      ${active.length ? `<ul class="task-list">${active.map(renderRow).join("")}</ul>` : `<p class="muted compact-empty">Активных задач нет.</p>`}
      ${done.length ? `<details class="task-history"><summary>Выполненные (${done.length})</summary><ul class="task-list is-done">${done.map(renderRow).join("")}</ul></details>` : ""}
    </div>
  `;
}

async function loadData(options = {}) {
  const requestedRaw = Array.isArray(options.targets) && options.targets.length
    ? options.targets.filter((target) => target in LOAD_DATA_TARGETS)
    : LOAD_DATA_ALL;
  const role = currentRole();
  const requested = requestedRaw.filter((target) => {
    const def = LOAD_DATA_TARGETS[target];
    if (def.allowedRoles && !def.allowedRoles.includes(role)) return false;
    if (def.notForRoles && def.notForRoles.includes(role)) return false;
    return true;
  });
  const responses = await Promise.all(requested.map((target) => requestJson(LOAD_DATA_TARGETS[target].url)));
  responses.forEach((payload, index) => {
    LOAD_DATA_TARGETS[requested[index]].apply(payload);
  });
  render();
  restoreUiState(options.restoreUi);
}

async function refreshDashboard(options = {}) {
  state.dashboard = await requestJson("/api/dashboard");
  render();
  restoreUiState(options.restoreUi);
}

function clientUiStateKeys(deal) {
  if (!deal?.manager || !deal?.client) {
    return [];
  }

  return [
    uiStateKey("manager", deal.manager),
    uiStateKey("client", deal.manager, deal.client, "active"),
    uiStateKey("current-manager", deal.manager),
    uiStateKey("current-client", deal.manager, deal.client)
  ];
}

function preserveClientOpenState(snapshot, deal) {
  return {
    ...snapshot,
    openDetails: [...new Set([...(snapshot?.openDetails || []), ...clientUiStateKeys(deal)])],
    view: state.view
  };
}

function closeApplicationCard(card) {
  if (card) {
    card.open = false;
  }
}

function setClientRefreshState(card, button, isLoading) {
  const clientCard = card?.closest(".client-card");
  const indicator = clientCard?.querySelector(".client-refresh-indicator");

  if (button) {
    button.disabled = isLoading;
    button.textContent = isLoading ? "Сохраняем..." : "Сохранить";
  }

  if (!clientCard) {
    return;
  }

  clientCard.classList.toggle("is-refreshing", isLoading);
  if (isLoading && !indicator) {
    const nextIndicator = document.createElement("div");
    nextIndicator.className = "client-refresh-indicator";
    nextIndicator.setAttribute("role", "status");
    nextIndicator.textContent = "Обновляем заявки";
    clientCard.querySelector(".client-drilldown")?.prepend(nextIndicator);
  } else if (!isLoading) {
    indicator?.remove();
  }
}

function setDealDialogLoading(isLoading) {
  const indicator = dialog.querySelector(".dialog-refresh-indicator");

  if (saveDealButton) {
    saveDealButton.disabled = isLoading;
    saveDealButton.textContent = isLoading ? "Сохраняем..." : "Сохранить заявку";
  }

  if (isLoading && !indicator) {
    const nextIndicator = document.createElement("div");
    nextIndicator.className = "dialog-refresh-indicator";
    nextIndicator.setAttribute("role", "status");
    nextIndicator.textContent = "Обновляем заявки";
    form.querySelector(".dialog-actions")?.before(nextIndicator);
  } else if (!isLoading) {
    indicator?.remove();
  }
}

function resetFilters() {
  const preservedQuery = state.filters?.query || "";
  state.filters = { query: preservedQuery, manager: "all", bank: "all", programType: "all", category: "all", stage: "all" };
}

function renderViewTabs() {
  const views = visibleViews();
  if (!views.some((view) => view.id === state.view)) {
    state.view = views[0]?.id || "summary";
  }
  // Подсчёт действующих запросов документов (open + fulfilled).
  const activeDocRequests = Array.isArray(state.documentRequests)
    ? state.documentRequests.filter((req) => req.status === "open" || req.status === "fulfilled").length
    : 0;

  viewTabs.innerHTML = views
    .map((view) => {
      const classes = ["tab"];
      if (state.view === view.id) classes.push("is-active");
      let badge = "";
      if (view.id === "document-requests" && activeDocRequests > 0) {
        classes.push("has-doc-pending");
        badge = `<span class="tab-counter">${activeDocRequests > 99 ? "99+" : activeDocRequests}</span>`;
      }
      return `<button class="${classes.join(" ")}" data-view="${view.id}" type="button">${view.label}${badge}</button>`;
    })
    .join("");

  viewTabs.querySelectorAll("[data-view]").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      resetFilters();
      render();
    });
  });
}

// Legacy-кнопки в топбаре скрыты, действие вызывается через делегацию
// (data-add-manager, data-add-client, data-add-knowledge, data-add-task).
// Функция оставлена пустой ради совместимости с местами вызова.
function updateActionVisibility() {
  // intentionally empty — topbar create-buttons hidden permanently
}

// Цветовой семафор для процентных показателей
function kpiTone(value, { good, ok }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "neutral";
  if (n >= good) return "success";
  if (n >= ok) return "warning";
  return "danger";
}

function renderKpis() {
  const totals = state.dashboard.totals;
  const leadConv = Number(totals.leadToWorkingConversionRate) || 0;
  const successConv = Number(totals.completedToSuccessConversionRate) || 0;
  const kpis = [
    { label: "Лиды", value: totals.leads, tone: "neutral" },
    { label: "Заявки в работе", value: totals.working, tone: "neutral" },
    { label: "Завершенные", value: totals.completed, tone: "neutral" },
    { label: "Одобрено", value: totals.issued, tone: "success" },
    { label: "Конверсия лидов", value: `${leadConv}%`, tone: kpiTone(leadConv, { good: 60, ok: 40 }) },
    { label: "Успех завершенных", value: `${successConv}%`, tone: kpiTone(successConv, { good: 35, ok: 20 }) }
  ];

  return `
    <section class="kpi-grid">
      ${kpis
        .map((k) => `
          <div class="kpi is-${k.tone}">
            <span>${k.label}</span>
            <strong>${k.value}</strong>
          </div>
        `)
        .join("")}
    </section>
  `;
}

// Алерт-блок: вещи, требующие внимания руководителя.
// Лид-алерт раскрывается details'ом с карточками самих заявок-лидов.
function summaryAlerts() {
  // 1. Зависшие лиды (≥7 дней без активности) — собираем сам массив
  const stalledLeadsList = (state.dashboard.deals || [])
    .filter((d) => d.statusGroup === "current" && (d.stage === "lead" || d.stage === "documents_requested"))
    .filter((d) => {
      const days = daysSince(d.lastActionAt);
      return days != null && days >= 7;
    })
    .sort((a, b) => (daysSince(b.lastActionAt) || 0) - (daysSince(a.lastActionAt) || 0));
  // 2. Просрочены задачи
  const now = Date.now();
  const overdueTasks = (state.tasks || []).filter((t) => {
    if (t.completedAt) return false;
    const due = new Date(t.dueAt || 0).getTime();
    return Number.isFinite(due) && due > 0 && due < now;
  }).length;
  // 3. Документы на отправку (fulfilled, ожидают подтверждения)
  const docFulfilled = (state.documentRequests || []).filter((r) => r.status === "fulfilled").length;
  // 4. Открытые запросы документов (open)
  const docOpen = (state.documentRequests || []).filter((r) => r.status === "open").length;

  const pills = [];
  if (overdueTasks > 0) pills.push({ tone: "danger", label: "Просрочено задач", value: overdueTasks });
  if (docFulfilled > 0) pills.push({ tone: "warning", label: "Документы на отправку", value: docFulfilled });
  if (docOpen > 0)      pills.push({ tone: "warning", label: "Открытых запросов документов", value: docOpen });

  const hasStalledLeads = stalledLeadsList.length > 0;
  if (!hasStalledLeads && !pills.length) return "";

  const pillsHtml = pills.map((it) => `
    <div class="alert-pill is-${it.tone}">
      <span class="alert-pill-value">${it.value}</span>
      <span class="alert-pill-label">${escapeHtml(it.label)}</span>
    </div>
  `).join("");

  const stalledHtml = hasStalledLeads ? `
    <details class="alert-expand" data-ui-state-key="alert|stalled-leads">
      <summary class="alert-pill is-danger alert-pill-expandable" role="button">
        <span class="alert-pill-value">${stalledLeadsList.length}</span>
        <span class="alert-pill-label">Лиды без действий 7+ дней</span>
        <span class="alert-pill-chev" aria-hidden="true">▾</span>
      </summary>
      <div class="alert-expand-body">
        ${renderBoardApplicationRows(stalledLeadsList, "manager")}
      </div>
    </details>
  ` : "";

  return `
    <section class="alerts-strip" aria-label="Требует внимания">
      ${stalledHtml}
      ${pillsHtml}
    </section>
  `;
}

function renderFilters(deals) {
  const stageOptions = state.dashboard.stages.all
    .map((stage) => `<option value="${stage.id}" ${state.filters.stage === stage.id ? "selected" : ""}>${stage.label}</option>`)
    .join("");
  const managerOptions = [...new Set(deals.map((deal) => deal.manager))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map(
      (manager) =>
        `<option value="${escapeHtml(manager)}" ${state.filters.manager === manager ? "selected" : ""}>${escapeHtml(manager)}</option>`
    )
    .join("");
  const bankOptions = [...new Set(deals.map((deal) => deal.bank))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((bank) => `<option value="${escapeHtml(bank)}" ${state.filters.bank === bank ? "selected" : ""}>${escapeHtml(bank)}</option>`)
    .join("");

  return `
    <div class="filters">
      <input id="queryFilter" value="${escapeHtml(state.filters.query)}" placeholder="Клиент, аналитик, банк">
      <select id="managerFilter">
        <option value="all">Все аналитики</option>
        ${managerOptions}
      </select>
      <select id="bankFilter">
        <option value="all">Все банки</option>
        ${bankOptions}
      </select>
      <select id="stageFilter">
        <option value="all">Все этапы</option>
        ${stageOptions}
      </select>
    </div>
  `;
}

function filteredDeals(group) {
  const query = state.filters.query.toLowerCase();
  return state.dashboard.deals
    .filter((deal) => !group || deal.statusGroup === group)
    .filter((deal) => state.filters.manager === "all" || deal.manager === state.filters.manager)
    .filter((deal) => state.filters.bank === "all" || deal.bank === state.filters.bank)
    .filter((deal) => state.filters.stage === "all" || deal.stage === state.filters.stage)
    .filter((deal) => {
      if (!query) {
        return true;
      }
      return [deal.client, deal.manager, deal.bank, deal.program, deal.programType, deal.programAmountRange, deal.status, deal.comment, deal.timeline]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
}

function groupDealsByManagerAndClient(deals, clients = [], managerRecords = []) {
  const managerGroups = new Map();
  const managerMeta = new Map();
  const clientMeta = new Map();
  const clientMetaByName = new Map();
  const archivedClientNames = new Set();
  const clientKey = (manager, client) => `${manager || ""}\u0000${client || ""}`;
  const clientNameKey = (client) => String(client || "").trim().toLowerCase();

  managerRecords.forEach((manager) => {
    managerMeta.set(manager.name, manager);
    if (!managerGroups.has(manager.name)) {
      managerGroups.set(manager.name, new Map());
    }
  });

  clients.forEach((client) => {
    const managerName = client.manager || "";
    if (!managerGroups.has(managerName)) {
      return;
    }
    const managerClients = managerGroups.get(managerName);
    if (!managerClients.has(client.name)) {
      managerClients.set(client.name, []);
    }
    clientMeta.set(clientKey(managerName, client.name), client);
    clientMetaByName.set(clientNameKey(client.name), client);
    if (client.archivedAt) {
      archivedClientNames.add(clientNameKey(client.name));
    }
  });

  deals.forEach((deal) => {
    if (!managerGroups.has(deal.manager)) {
      return;
    }

    const clients = managerGroups.get(deal.manager);
    if (!clients.has(deal.client)) {
      clients.set(deal.client, []);
    }

    clients.get(deal.client).push(deal);
  });

  return [...managerGroups.entries()]
    .map(([manager, clients]) => {
      const managerRecord = managerMeta.get(manager) || { id: "", name: manager };
      const clientGroups = [...clients.entries()]
        .map(([client, applications]) => {
          const sortedApplications = [...applications].sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0));
          const exactMeta = clientMeta.get(clientKey(manager, client));
          const nameMeta = clientMetaByName.get(clientNameKey(client));
          const meta = exactMeta || (nameMeta?.archivedAt ? nameMeta : {}) || {};
          const plannedApplications = sortByBucketEntry(sortedApplications.filter((deal) => deal.stage === "planned"), "planned");
          const leadApplications = sortByBucketEntry(sortedApplications.filter((deal) => LEAD_BUCKET_STAGES.has(deal.stage)), "current");
          const workingApplications = sortByBucketEntry(sortedApplications.filter((deal) => deal.stage === "submitted"), "current");
          const currentApplications = sortByBucketEntry(
            sortedApplications.filter((deal) => deal.statusGroup === "current" && deal.stage !== "planned"),
            "current"
          );
          const successfulApplications = sortByBucketEntry(sortedApplications.filter((deal) => deal.stage === "approved"), "approved");
          const refusedApplications = sortByBucketEntry(
            sortedApplications.filter((deal) => deal.stage === "rejected" || deal.stage === "blocked"),
            "refused"
          );
          const activeApplications = [...currentApplications, ...plannedApplications];
          const completedApplications = [...successfulApplications, ...refusedApplications];
          const sumRequested = (items) => items.reduce((total, deal) => total + Number(deal.amountRequested || 0), 0);
          const sumApproved = (items) => items.reduce((total, deal) => total + Number(deal.amountApproved || 0), 0);
          const startedAt = earliestDate(sortedApplications.flatMap((deal) => [deal.inquiryAt, deal.signedAt]));
          const addedAt = meta.createdAt || earliestDate(sortedApplications.map((deal) => deal.createdAt));
          const isArchived = Boolean(meta.archivedAt || archivedClientNames.has(clientNameKey(client)));
          return {
            clientId: meta.id || "",
            manager,
            client,
            contact: meta.contact || "",
            phone: meta.phone || "",
            crmUrl: meta.crmUrl || "",
            driveUrl: meta.driveUrl || "",
            instructionUrl: meta.instructionUrl || "",
            comment: meta.comment || "",
            archivedAt: meta.archivedAt || "",
            isArchived,
            createdAt: addedAt,
            count: sortedApplications.length,
            activeCount: activeApplications.length,
            completedCount: completedApplications.length,
            currentCount: currentApplications.length,
            leadCount: leadApplications.length,
            workingCount: workingApplications.length,
            plannedCount: plannedApplications.length,
            successfulCount: successfulApplications.length,
            refusedCount: refusedApplications.length,
            amountRequested: sumRequested(sortedApplications),
            amountApproved: sumApproved(sortedApplications),
            plannedAmountRequested: sumRequested(plannedApplications),
            leadAmountRequested: sumRequested(leadApplications),
            workingAmountRequested: sumRequested(workingApplications),
            currentAmountRequested: sumRequested(currentApplications),
            approvedAmount: sumApproved(successfulApplications),
            startedAt,
            lastActionAt: sortedApplications[0]?.lastActionAt || "",
            activeApplications,
            currentApplications,
            leadApplications,
            workingApplications,
            plannedApplications,
            completedApplications,
            successfulApplications,
            refusedApplications,
            applications: sortedApplications
          };
        })
        .sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0) || b.count - a.count);

      const archivedClients = clientGroups.filter((client) => client.isArchived);
      const activeClients = clientGroups.filter((client) => !archivedClients.includes(client));
      const currentClients = activeClients.filter((client) => client.activeCount > 0 || client.count === 0);
      const completedClients = activeClients.filter((client) => client.completedCount > 0);

      return {
        managerId: managerRecord.id,
        manager,
        userId: managerRecord.userId || "",
        userLogin: managerRecord.userLogin || "",
        userFullName: managerRecord.userFullName || "",
        role: managerRecord.role || "",
        clientCount: activeClients.length,
        count: activeClients.reduce((total, client) => total + client.count, 0),
        activeCount: activeClients.reduce((total, client) => total + client.activeCount, 0),
        completedCount: activeClients.reduce((total, client) => total + client.completedCount, 0),
        currentCount: activeClients.reduce((total, client) => total + client.currentCount, 0),
        leadCount: activeClients.reduce((total, client) => total + client.leadCount, 0),
        workingCount: activeClients.reduce((total, client) => total + client.workingCount, 0),
        plannedCount: activeClients.reduce((total, client) => total + client.plannedCount, 0),
        successfulCount: activeClients.reduce((total, client) => total + client.successfulCount, 0),
        refusedCount: activeClients.reduce((total, client) => total + client.refusedCount, 0),
        amountRequested: activeClients.reduce((total, client) => total + client.amountRequested, 0),
        amountApproved: activeClients.reduce((total, client) => total + client.amountApproved, 0),
        plannedAmountRequested: activeClients.reduce((total, client) => total + client.plannedAmountRequested, 0),
        leadAmountRequested: activeClients.reduce((total, client) => total + client.leadAmountRequested, 0),
        workingAmountRequested: activeClients.reduce((total, client) => total + client.workingAmountRequested, 0),
        currentAmountRequested: activeClients.reduce((total, client) => total + client.currentAmountRequested, 0),
        approvedAmount: activeClients.reduce((total, client) => total + client.approvedAmount, 0),
        lastActionAt: activeClients[0]?.lastActionAt || "",
        currentClients,
        completedClients,
        archivedClients,
        clients: activeClients
      };
    })
    .sort((a, b) => b.count - a.count || a.manager.localeCompare(b.manager, "ru"));
}

function groupCurrentDealsByManager(deals) {
  return groupDealsByManagerAndClient(deals, state.clients, state.managers).map((manager) => ({
    ...manager,
    clients: manager.currentClients
  }));
}

function renderDealTable(deals) {
  if (!deals.length) {
    return `<div class="empty">Нет сделок под выбранные фильтры.</div>`;
  }

  const stageOptions = state.dashboard.stages.all;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Клиент</th>
            <th>Аналитик</th>
            <th>Программа</th>
            <th>Статус заявки</th>
            <th>Заявка</th>
            <th>Одобрено</th>
            <th>Следующее действие</th>
            <th>Комментарий</th>
          </tr>
        </thead>
        <tbody>
          ${deals
            .map(
              (deal) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(deal.client)}</strong>
                    <span class="table-meta muted">${escapeHtml(deal.bureau || "Бюро не указано")}</span>
                  </td>
                  <td>${escapeHtml(deal.manager)}</td>
                  <td>${renderApplicationProgramTitle(deal)}</td>
                  <td>
                    <select data-stage-select="${escapeHtml(deal.id)}" data-current-stage="${escapeHtml(deal.stage)}">
                      ${stageOptions
                        .map((stage) => `<option value="${stage.id}" ${stage.id === deal.stage ? "selected" : ""}>${stage.label}</option>`)
                        .join("")}
                    </select>
                  </td>
                  <td>${money(deal.amountRequested)}</td>
                  <td>${money(deal.amountApproved)}</td>
                  <td>${formatDate(deal.nextActionAt || deal.completedAt)}</td>
                  <td>${escapeHtml(deal.comment || deal.timeline || "—")}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderApplicationActions(actions = []) {
  if (!actions.length) {
    return `<div class="application-history-empty">Действий пока нет.</div>`;
  }

  return `
    <ol class="application-history">
      ${actions
        .map((action) => `<li>${formatActionEntry(action)}</li>`)
        .join("")}
    </ol>
  `;
}

function renderClientApplicationCards(applications, emptyText, type) {
  const stageOptions = state.dashboard.stages.all;
  if (!applications.length) {
    return `<div class="empty compact-empty">${emptyText}</div>`;
  }

  return `
    <div class="client-application-list">
      ${applications
        .map(
          (deal) => `
            <details class="client-application-card application-card-${escapeHtml(type)} ${applicationStageClass(deal.stage)}" data-ui-state-key="${escapeHtml(uiStateKey("deal-card", deal.id))}">
              <summary class="application-card-head">
                <strong>${renderApplicationProgramTitle(deal)}</strong>
                <span>${money(deal.amountRequested)}</span>
                <em>${escapeHtml(deal.stageLabel)}${renderDealDocumentBadge(deal)}</em>
                <small>Последнее действие: ${formatDate(deal.lastActionAt)}</small>
              </summary>
              <div class="application-card-body">
                <button class="ghost-button small-button application-action-button" data-add-deal-action="${escapeHtml(deal.id)}" type="button">
                  + Действие
                </button>
                <button class="primary-button small-button application-save-button" data-save-application="${escapeHtml(deal.id)}" type="button">
                  Сохранить
                </button>
                ${deal.stage === "planned" ? `
                  <button class="ghost-button small-button" data-edit-planned-deal="${escapeHtml(deal.id)}" type="button" title="Изменить программу, банк, сумму">
                    ✎ Изменить
                  </button>
                ` : ""}
                <button class="ghost-button small-button danger-button application-delete-button" data-delete-deal="${escapeHtml(deal.id)}" data-deal-title="${escapeHtml(deal.client + " · " + (deal.program || deal.bank || ""))}" type="button">
                  Удалить заявку
                </button>
                <label class="application-field">
                  <span>Сумма заявки</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="amountRequested" inputmode="decimal" value="${escapeHtml(deal.amountRequested || "")}">
                </label>
                <label class="application-field">
                  <span>Одобрено</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="amountApproved" inputmode="decimal" value="${escapeHtml(deal.amountApproved || "")}">
                </label>
                <label class="application-field">
                  <span>Статус</span>
                  <select data-stage-select="${escapeHtml(deal.id)}" data-current-stage="${escapeHtml(deal.stage)}">
                    ${stageOptions
                      .map((stage) => `<option value="${stage.id}" ${stage.id === deal.stage ? "selected" : ""}>${stage.label}</option>`)
                      .join("")}
                  </select>
                </label>
                <label class="application-field">
                  <span>Дата обращения</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="inquiryAt" type="datetime-local" value="${formatDateTimeInput(deal.inquiryAt)}">
                </label>
                <label class="application-field">
                  <span>Дата подписания</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="signedAt" type="datetime-local" value="${formatDateTimeInput(deal.signedAt)}">
                </label>
                <details class="application-extra-dates">
                  <summary>Прочие даты</summary>
                  <label class="application-field">
                    <span>Дата запроса КИ</span>
                    <input data-application-field="${escapeHtml(deal.id)}" data-field="kiRequestedAt" type="date" value="${formatDateInput(deal.kiRequestedAt)}">
                  </label>
                  <label class="application-field">
                    <span>Дата звонка андеррайтера</span>
                    <input data-application-field="${escapeHtml(deal.id)}" data-field="analystCallAt" type="date" value="${formatDateInput(deal.analystCallAt)}">
                  </label>
                </details>
                ${
                  type === "approved"
                    ? `<div class="application-field"><span>Одобрено</span><strong>${money(deal.amountApproved)}</strong></div>`
                    : ""
                }
                ${
                  type === "refused"
                    ? `<div class="application-field application-comment"><span>Причина</span><strong>${escapeHtml(deal.comment || deal.timeline || "—")}</strong></div>`
                    : ""
                }
                <div class="application-field application-history-field">
                  <span>Хронология</span>
                  ${renderApplicationActions(deal.actions)}
                </div>
              </div>
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderClientApplicationSections(client) {
  const renderSection = ([title, applications, count, emptyText, type, collapsible]) => collapsible
    ? `
      <details class="application-group application-group-collapsible application-group-${escapeHtml(type)}" data-ui-state-key="${escapeHtml(uiStateKey("app-group", client.manager || "", client.client || "", type))}">
        <summary class="application-group-head">
          <h4>${title} (${count})</h4>
        </summary>
        ${renderClientApplicationCards(applications, emptyText, type)}
      </details>
    `
    : `
      <section class="application-group application-group-${escapeHtml(type)}">
        <div class="application-group-head">
          <h4>${title} (${count})</h4>
          ${type === "approved" ? `<span class="application-group-amount">${money(client.approvedAmount)}</span>` : ""}
        </div>
        ${renderClientApplicationCards(applications, emptyText, type)}
      </section>
    `;

  const plannedSection = ["План подач", client.plannedApplications || [], client.plannedCount || 0, "Плановых заявок нет.", "planned", false];
  const leadSection = ["Лиды", client.leadApplications || [], client.leadCount || 0, "Лидов нет.", "current", false];
  const workingSection = ["Заявки в работе", client.workingApplications || [], client.workingCount || 0, "Заявок в работе нет.", "current", false];
  const approvedSection = ["Одобрено", client.successfulApplications || [], client.successfulCount || 0, "Одобренных заявок нет.", "approved", false];
  const refusedSection = ["Отказ / непринятые", client.refusedApplications || [], client.refusedCount || 0, "Отказов и непринятых заявок нет.", "refused", true];

  return `
    <div class="application-split">
      ${renderSection(plannedSection)}
      ${renderSection(leadSection)}
      ${renderSection(workingSection)}
      <div class="application-completed-rail">
        ${renderSection(approvedSection)}
        ${renderSection(refusedSection)}
      </div>
    </div>
  `;
}

function summaryCount(source, ...fields) {
  for (const field of fields) {
    const value = Number(source?.[field] ?? 0);
    if (value) {
      return value;
    }
  }

  return 0;
}

function renderSummaryAmountBadges(source, status = state.board.status) {
  const plannedCount = summaryCount(source, "plannedCount", "planCount");
  const approvedCount = summaryCount(source, "successfulCount", "approvedCount", "issuedCount");

  if (status === "completed") {
    return `
      <div class="summary-amounts">
        <span>Завершено <strong>${source.completedCount || 0} · ${money(source.completedAmountRequested || source.amountRequested)}</strong></span>
        <span>Одобрено <strong>${approvedCount} · ${money(source.approvedAmount)}</strong></span>
        <span>Отказ / непринятые <strong>${source.refusedCount || 0} · ${money(source.refusedAmountRequested)}</strong></span>
      </div>
    `;
  }

  return `
    <div class="summary-amounts">
      <span>План подач <strong>${plannedCount} · ${money(source.plannedAmountRequested)}</strong></span>
      <span>Лиды <strong>${source.leadCount || 0} · ${money(source.leadAmountRequested)}</strong></span>
      <span>В работе <strong>${source.workingCount || 0} · ${money(source.workingAmountRequested)}</strong></span>
    </div>
  `;
}

function renderConversionBadges(source) {
  return `
    <div class="conversion-grid">
      <span>Лиды → в работе <strong>${source.leadToWorkingConversionRate || 0}%</strong></span>
      <span>Подписанные → завершенные <strong>${source.signedToCompletedConversionRate || 0}%</strong></span>
      <span>Завершенные → успешные <strong>${source.completedToSuccessConversionRate || source.completedConversionRate || 0}%</strong></span>
    </div>
  `;
}

function renderReportTotals(groups) {
  const totalRequested = groups.reduce((total, group) => total + Number(group.amountRequested || 0), 0);
  const approvedAmount = groups.reduce((total, group) => total + Number(group.approvedAmount || 0), 0);
  const planCount = groups.reduce((total, group) => total + summaryCount(group, "plannedCount", "planCount"), 0);
  const leadCount = groups.reduce((total, group) => total + Number(group.leadCount || 0), 0);
  const workingCount = groups.reduce((total, group) => total + Number(group.workingCount || 0), 0);
  const completedCount = groups.reduce((total, group) => total + Number(group.completedCount || 0), 0);
  const successfulCount = groups.reduce((total, group) => total + Number(group.successfulCount || 0), 0);
  const refusedCount = groups.reduce((total, group) => total + Number(group.refusedCount || 0), 0);
  return {
    count: groups.reduce((total, group) => total + group.count, 0),
    amountRequested: groups.reduce((total, group) => total + Number(group.amountRequested || 0), 0),
    totalAmountRequested: totalRequested,
    plannedAmountRequested: groups.reduce((total, group) => total + Number(group.plannedAmountRequested || 0), 0),
    planCount,
    leadCount,
    workingCount,
    completedCount,
    successfulCount,
    refusedCount,
    leadAmountRequested: groups.reduce((total, group) => total + Number(group.leadAmountRequested || 0), 0),
    workingAmountRequested: groups.reduce((total, group) => total + Number(group.workingAmountRequested || 0), 0),
    currentAmountRequested: groups.reduce((total, group) => total + Number(group.currentAmountRequested || 0), 0),
    completedAmountRequested: groups.reduce((total, group) => total + Number(group.completedAmountRequested || 0), 0),
    refusedAmountRequested: groups.reduce((total, group) => total + Number(group.refusedAmountRequested || 0), 0),
    approvedAmount,
    approvalConversionRate: percent(approvedAmount, totalRequested),
    leadToWorkingConversionRate: percent(workingCount, leadCount + workingCount),
    signedToCompletedConversionRate: percent(completedCount, workingCount + completedCount),
    completedToSuccessConversionRate: percent(successfulCount, completedCount)
  };
}

function renderAddApplicationButton(manager, client) {
  return `
    <button
      class="ghost-button small-button"
      data-add-application
      data-manager="${escapeHtml(manager)}"
      data-client="${escapeHtml(client)}"
      type="button"
    >
      + Заявка
    </button>
  `;
}

function renderClientActions(client, settings = {}) {
  if (!settings.allowAddApplication && !settings.allowArchive && !client.clientId) {
    return "";
  }

  const dealsForRequest = (client.activeApplications || []).filter((deal) => deal.statusGroup === "current");
  const canRequestDocs = Boolean(dealsForRequest.length);

  return `
    <div class="client-actions">
      ${settings.allowAddApplication ? renderAddApplicationButton(client.manager || "", client.client) : ""}
      ${canRequestDocs ? `<button class="ghost-button small-button" data-add-doc-request="${escapeHtml(client.client)}" data-doc-manager="${escapeHtml(client.manager || "")}" type="button">+ Запрос документов</button>` : ""}
      ${
        settings.allowArchive && client.clientId
          ? `<button class="ghost-button small-button" data-archive-client="${escapeHtml(client.clientId)}" data-client-name="${escapeHtml(client.client)}" type="button">В архив</button>`
          : ""
      }
      ${
        client.clientId
          ? `<button class="ghost-button small-button danger-button" data-delete-client="${escapeHtml(client.clientId)}" data-client-name="${escapeHtml(client.client)}" type="button">Удалить клиента</button>`
          : ""
      }
    </div>
  `;
}

function renderClientLinks(client) {
  const links = [
    ["CRM", client.crmUrl],
    ["Диск", client.driveUrl],
    ["Инструкция", client.instructionUrl]
  ]
    .map(([label, url]) => [label, safeExternalUrl(url)])
    .filter(([, url]) => url);

  if (!links.length) {
    return "";
  }

  return `
    <div class="client-summary-links">
      ${links
        .map(
          ([label, url]) => `
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>
          `
        )
        .join("")}
    </div>
  `;
}

function renderClientSummary(client, options = {}) {
  const settings = typeof options === "object" ? options : {};
  const completedLabel = `завершено: ${client.completedCount || 0} (отказов: ${client.refusedCount || 0})`;
  return `
    ${renderClientTaskBadge(client)}
    ${renderClientDocStrip(client)}
    <div class="client-summary-main">
      <strong class="client-title">${escapeHtml(client.client)}</strong>
      <div class="client-summary-amounts">
        <span>План подач <strong>${client.plannedCount || 0} · ${money(client.plannedAmountRequested)}</strong></span>
        <span>Лиды <strong>${client.leadCount || 0} · ${money(client.leadAmountRequested)}</strong></span>
        <span>Заявки в работе <strong>${client.workingCount || 0} · ${money(client.workingAmountRequested)}</strong></span>
        <span>Одобрения <strong>${client.successfulCount || 0} · ${money(client.approvedAmount)}</strong></span>
        <span>Завершенные подачи <strong>${completedLabel}</strong></span>
      </div>
      <div class="client-summary-dates">
        ${settings.showAddedAt ? `<span>Дата добавления: ${formatDateWithAge(client.createdAt, "назад")}</span>` : ""}
        ${settings.showArchivedAt && client.archivedAt ? `<span>В архиве: ${formatDateWithAge(client.archivedAt, "назад")}</span>` : ""}
        <span>Дата начала: ${formatDateWithAge(client.startedAt, "в работе")}</span>
        <span>Последнее изменение: ${formatDateWithAge(client.lastActionAt, "назад")}</span>
      </div>
      ${renderClientLinks(client)}
    </div>
    <span class="applications-toggle" role="button" aria-label="Раскрыть заявки">Заявки</span>
  `;
}

function renderManagerGroups(deals) {
  const managers = groupCurrentDealsByManager(deals);

  if (!managers.length) {
    return `<div class="empty">Нет текущих заявок под выбранные фильтры.</div>`;
  }

  return `
    <div class="manager-stack">
      ${managers
        .map((manager) => {
          const managerDeliveryClass = managerHasDocDelivery(manager) ? " has-doc-delivery" : "";
          return `
            <details class="manager-section manager-accordion${managerDeliveryClass}" data-ui-state-key="${escapeHtml(uiStateKey("current-manager", manager.manager))}">
              <summary class="manager-head">
                ${renderManagerTaskBadge(manager)}
                ${renderManagerDocStrip(manager)}
                <div>
                  <p class="eyebrow">Аналитик</p>
                  <h3>${escapeHtml(manager.manager)}</h3>
                </div>
                <div class="manager-metrics">
                  <span>${manager.clientCount} клиентов</span>
                  <strong>Лиды ${manager.leadCount || 0} · В работе ${manager.workingCount || 0}</strong>
                  <span>${money(manager.leadAmountRequested || 0)} · ${money(manager.workingAmountRequested || 0)}</span>
                </div>
              </summary>
              <div class="client-stack">
                ${manager.clients
                  .map((client) => {
                    const clientDeliveryClass = clientHasDocDelivery(client) ? " has-doc-delivery" : "";
                    return `
                      <details class="client-card${clientDeliveryClass}" data-ui-state-key="${escapeHtml(uiStateKey("current-client", manager.manager, client.client))}">
                        <summary>
                          ${renderClientSummary(client, "active")}
                        </summary>
                        <div class="client-drilldown">
                          ${renderClientActions(client, { allowAddApplication: true, allowArchive: true })}
                          ${renderClientTaskList(client)}
                          ${renderClientApplicationSections(client)}
                        </div>
                      </details>
                    `;
                  })
                  .join("")}
              </div>
            </details>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderClientCards(clients, emptyText, options = {}) {
  const settings = { allowAddApplication: true, allowArchive: true, showAddedAt: false, showArchivedAt: false, ...options };
  if (!clients.length) {
    return `<div class="empty compact-empty">${emptyText}</div>`;
  }

  return `
    <div class="client-stack">
      ${clients
        .map((client) => {
          const deliveryClass = clientHasDocDelivery(client) ? " has-doc-delivery" : "";
          return `
            <details class="client-card${deliveryClass}" data-ui-state-key="${escapeHtml(uiStateKey("client", client.manager || "", client.client, settings.showArchivedAt ? "archive" : "active"))}">
              <summary>
                ${renderClientSummary(client, { showAddedAt: settings.showAddedAt, showArchivedAt: settings.showArchivedAt })}
              </summary>
              <div class="client-drilldown">
                ${renderClientActions(client, settings)}
                ${renderClientTaskList(client)}
                ${renderClientApplicationSections(client)}
              </div>
            </details>
          `;
        })
        .join("")}
    </div>
  `;
}

function getArchivedManagers() {
  return groupDealsByManagerAndClient(state.dashboard.deals, state.clients, state.managers)
    .map((manager) => ({
      ...manager,
      clients: manager.archivedClients
    }))
    .filter((manager) => manager.clients.length > 0);
}

function flattenArchivedClients(managers) {
  return managers.flatMap((manager) => manager.clients.map((client) => ({ ...client, manager: manager.manager })));
}

function archiveDateGroupLabel(value) {
  const date = localDay(value);
  return date ? actionDate.format(date) : "Дата не указана";
}

function archiveDateGroupKey(value) {
  const date = localDay(value);
  if (!date) {
    return "undated";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupArchivedClientsByDate(clients) {
  const groups = new Map();

  clients.forEach((client) => {
    const key = archiveDateGroupKey(client.createdAt);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: archiveDateGroupLabel(client.createdAt),
        sortAt: localDay(client.createdAt)?.getTime?.() || 0,
        clients: []
      });
    }
    groups.get(key).clients.push(client);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      clients: group.clients.sort((a, b) => a.client.localeCompare(b.client, "ru"))
    }))
    .sort((a, b) => b.sortAt - a.sortAt || a.label.localeCompare(b.label, "ru"));
}

function renderArchiveControls() {
  return `
    <div class="board-controls">
      <div class="segmented" role="group" aria-label="Группировка архива">
        ${Object.entries(ARCHIVE_GROUP_LABELS)
          .map(
            ([value, label]) => `
              <button class="${state.archive.groupBy === value ? "is-active" : ""}" data-archive-group="${value}" type="button">${label}</button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderArchiveMetrics(clients) {
  return `
    <div class="summary-amounts">
      <span>Клиентов <strong>${clients.length}</strong></span>
      <span>Одобрено <strong>${clients.reduce((total, client) => total + client.successfulCount, 0)} · ${money(clients.reduce((total, client) => total + client.approvedAmount, 0))}</strong></span>
      <span>Отказы / непринятые <strong>${clients.reduce((total, client) => total + client.refusedCount, 0)}</strong></span>
    </div>
  `;
}

function renderArchiveByManager(groups) {
  if (!groups.length) {
    return `<div class="empty">В архиве пока нет клиентов.</div>`;
  }

  return `
    <div class="manager-stack">
      ${groups
        .map(
          (manager) => `
            <details class="manager-section manager-accordion" data-ui-state-key="${escapeHtml(uiStateKey("archive-manager", manager.manager))}">
              <summary class="manager-head">
                <div>
                  <p class="eyebrow">Аналитик</p>
                  <h3>${escapeHtml(manager.manager)}</h3>
                </div>
                <div class="manager-metrics">
                  ${renderArchiveMetrics(manager.clients)}
                </div>
              </summary>
              ${renderClientCards(manager.clients, "Архивных клиентов нет.", { allowAddApplication: false, allowArchive: false, showAddedAt: true, showArchivedAt: true })}
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderArchiveByDate(clients) {
  const groups = groupArchivedClientsByDate(clients);
  if (!groups.length) {
    return `<div class="empty">В архиве пока нет клиентов.</div>`;
  }

  return `
    <div class="manager-stack">
      ${groups
        .map(
          (group) => `
            <details class="manager-section manager-accordion" data-ui-state-key="${escapeHtml(uiStateKey("archive-date", group.key))}">
              <summary class="manager-head">
                <div>
                  <p class="eyebrow">Дата добавления</p>
                  <h3>${escapeHtml(group.label)}</h3>
                </div>
                <div class="manager-metrics">
                  ${renderArchiveMetrics(group.clients)}
                </div>
              </summary>
              ${renderClientCards(group.clients, "Архивных клиентов нет.", { allowAddApplication: false, allowArchive: false, showAddedAt: true, showArchivedAt: true })}
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderArchiveView() {
  const archiveManagers = getArchivedManagers();
  const archiveClients = flattenArchivedClients(archiveManagers);

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Архив клиентов</p>
          <h2>Завершенные клиенты</h2>
          <p class="muted">В архив попадают клиенты, отправленные вручную.</p>
          ${renderArchiveMetrics(archiveClients)}
        </div>
        ${renderArchiveControls()}
      </div>
      ${state.archive.groupBy === "date" ? renderArchiveByDate(archiveClients) : renderArchiveByManager(archiveManagers)}
    </section>
  `;
}

function managerRoleByName(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return "";
  const found = state.managers.find((m) => String(m.name || "").trim().toLowerCase() === key);
  return found?.role || "";
}

function renderManagerLinkControl(manager) {
  if (!isAdmin()) return "";
  if (!manager.managerId) return "";
  if (manager.userId) {
    const loginLabel = manager.userLogin ? `@${escapeHtml(manager.userLogin)}` : "учётка";
    return `
      <div class="manager-link-info">
        <span class="manager-link-badge" title="Привязан к учётке ${escapeHtml(manager.userLogin || "")}">🔗 ${loginLabel}</span>
        <button class="ghost-button small-button" type="button" data-unlink-manager="${escapeHtml(manager.managerId)}">Отвязать</button>
      </div>
    `;
  }
  return `
    <div class="manager-link-info">
      <button class="ghost-button small-button" type="button" data-link-manager="${escapeHtml(manager.managerId)}" data-manager-name="${escapeHtml(manager.manager)}">Привязать к учётке</button>
    </div>
  `;
}

function renderManagerCard(manager) {
  const deliveryClass = managerHasDocDelivery(manager) ? " has-doc-delivery" : "";
  return `
    <details class="manager-section manager-accordion${deliveryClass}" data-ui-state-key="${escapeHtml(uiStateKey("manager", manager.manager))}">
      <summary class="manager-head">
        ${renderManagerTaskBadge(manager)}
        ${renderManagerDocStrip(manager)}
        <div>
          <p class="eyebrow">Аналитик</p>
          <h3>${escapeHtml(manager.manager)}</h3>
          ${renderManagerLinkControl(manager)}
        </div>
        <div class="manager-metrics">
          <strong>${manager.clientCount} клиентов</strong>
          <div class="summary-amounts">
            <span>План подач <strong>${manager.plannedCount} · ${money(manager.plannedAmountRequested)}</strong></span>
            <span>Лиды <strong>${manager.leadCount} · ${money(manager.leadAmountRequested)}</strong></span>
            <span>Заявки в работе <strong>${manager.workingCount} · ${money(manager.workingAmountRequested)}</strong></span>
          </div>
        </div>
      </summary>
      ${renderClientCards(manager.clients, "Клиентов пока нет.")}
    </details>
  `;
}

function renderManagerClientView() {
  const managers = groupDealsByManagerAndClient(state.dashboard.deals, state.clients, state.managers);

  if (!managers.length) {
    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Аналитики и клиенты</p>
            <h2>Карточки аналитиков</h2>
          </div>
        </div>
        <div class="empty">Аналитики пока не добавлены.</div>
      </section>
    `;
  }

  const abram = [];
  const partners = [];
  const other = [];
  for (const manager of managers) {
    const role = managerRoleByName(manager.manager);
    if (role === "analyst_abram" || role === "admin") {
      abram.push(manager);
    } else if (role === "partner") {
      partners.push(manager);
    } else {
      other.push(manager);
    }
  }

  const renderGroup = (title, items) => items.length ? `
    <div class="manager-group">
      <h3 class="manager-group-title">${escapeHtml(title)} <span>(${items.length})</span></h3>
      <div class="manager-stack">
        ${items.map(renderManagerCard).join("")}
      </div>
    </div>
  ` : "";

  const docsOnly = isDocumentsOfficer();
  const actions = !docsOnly ? `
    <div class="panel-head-actions">
      <button class="primary-button" data-add-client type="button">+ Клиент</button>
      <button class="ghost-button" data-add-task type="button">+ Задача</button>
    </div>
  ` : "";

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Аналитики и клиенты</p>
          <h2>Карточки аналитиков</h2>
        </div>
        ${actions}
      </div>
      ${renderGroup("Аналитики AbramCorp", abram)}
      ${renderGroup("Партнёрский контур", partners)}
      ${renderGroup("Без привязки к учётке", other)}
    </section>
  `;
}

function filteredKnowledge() {
  const query = state.filters.query.toLowerCase();
  const categoryFilter = state.filters.category;
  const programTypeFilter = state.filters.programType;
  const programTypeActive = programTypeFilter && programTypeFilter !== "all";
  const categoryActive = categoryFilter && categoryFilter !== "all";
  return state.knowledge
    .filter((bank) => state.filters.bank === "all" || bank.bank === state.filters.bank)
    .map((bank) => ({
      ...bank,
      programs: (bank.programs || []).filter((program) => {
        if (programTypeActive && (program.programType || "Стандарт") !== programTypeFilter) {
          return false;
        }
        if (categoryActive) {
          const programCategory = program.category || "";
          if (categoryFilter === "__none__") {
            if (programCategory) {
              return false;
            }
          } else if (programCategory !== categoryFilter) {
            return false;
          }
        }
        if (!query) {
          return true;
        }
        const requirementText = Object.values(program.requirements || {}).join(" ");
        return [
          bank.bank,
          bank.phone,
          program.bankPhone,
          program.program,
          program.programUrl,
          program.programType,
          program.category,
          program.amountRange,
          program.termRange,
          program.reviewTermDeclared,
          program.notes,
          program.changeHistory,
          requirementText
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
    }))
    .filter((bank) => {
      if (!query && !categoryActive && !programTypeActive) {
        return true;
      }
      return bank.programs.length > 0;
    });
}

function groupProgramsByType(programs = []) {
  const groups = new Map(PROGRAM_TYPES.map((type) => [type, []]));
  programs.forEach((program) => {
    const type = PROGRAM_TYPES.includes(program.programType) ? program.programType : "Стандарт";
    groups.get(type).push(program);
  });
  return [...groups.entries()].filter(([, items]) => items.length);
}

function programAmountTermText(amountRange, termRange) {
  if (amountRange && termRange) {
    return `${amountRange} (на ${termRange})`;
  }
  if (amountRange) {
    return amountRange;
  }
  if (termRange) {
    return `на ${termRange}`;
  }
  return "";
}

function programMetaSuffix(amountRange, termRange) {
  const amountTerm = programAmountTermText(amountRange, termRange);
  return amountTerm ? ` - ${amountTerm}` : "";
}

function programApplicationBaseLabel(bank, program) {
  return [
    program.programType || "Стандарт",
    bank.bank,
    program.program,
    programAmountTermText(program.amountRange, program.termRange)
  ].filter(Boolean).join(" - ");
}

function programApplicationLabel(bank, program) {
  const reviewDeclared = program.reviewTermDeclared || "не указан";
  return `${programApplicationBaseLabel(bank, program)} - рассмотрение (заявленный: ${reviewDeclared} / статистика: ${programReviewStats(program, bank)})`;
}

function listKnowledgeProgramEntries() {
  return state.knowledge.flatMap((bank) =>
    (bank.programs || []).map((program) => ({
      bank,
      program
    }))
  );
}

function flattenKnowledgePrograms() {
  return listKnowledgeProgramEntries().map((entry) => ({
    ...entry,
    label: programApplicationLabel(entry.bank, entry.program)
  }));
}

function applicationProgramTitle(deal) {
  if (!deal.program) {
    return deal.bank || "Программа не выбрана";
  }
  const entry = findProgramForDeal(deal);
  return [
    deal.programType || entry?.program.programType || "Стандарт",
    deal.bank,
    deal.program,
    programAmountTermText(
      deal.programAmountRange || entry?.program.amountRange,
      deal.programTermRange || entry?.program.termRange
    )
  ].filter(Boolean).join(" - ");
}

function findProgramForDeal(deal) {
  if (!deal) {
    return null;
  }

  if (deal.knowledgeProgramId) {
    const byId = listKnowledgeProgramEntries().find((entry) => entry.program.id === deal.knowledgeProgramId);
    if (byId) {
      return byId;
    }
  }

  const bankName = String(deal.bank || "").trim().toLowerCase();
  const programName = String(deal.program || "").trim().toLowerCase();
  if (!bankName || !programName) {
    return null;
  }

  return listKnowledgeProgramEntries().find((entry) =>
    entry.bank.bank.toLowerCase() === bankName && entry.program.program.toLowerCase() === programName
  ) || null;
}

function applicationProgramUrl(deal) {
  const entry = findProgramForDeal(deal);
  return safeExternalUrl(deal?.programUrl || entry?.program.programUrl);
}

function dealMatchesKnowledgeProgram(deal, program, bank) {
  if (!deal || !program) {
    return false;
  }
  if (deal.knowledgeProgramId && program.id) {
    return deal.knowledgeProgramId === program.id;
  }

  return String(deal.bank || "").trim().toLowerCase() === String(bank?.bank || "").trim().toLowerCase()
    && String(deal.program || "").trim().toLowerCase() === String(program.program || "").trim().toLowerCase();
}

function programReviewStats(program, bank) {
  const reviewDays = (state.dashboard?.deals || [])
    .filter((deal) => deal.statusGroup === "completed" && deal.signedAt && deal.completedAt && dealMatchesKnowledgeProgram(deal, program, bank))
    .map((deal) => daysBetween(deal.signedAt, deal.completedAt))
    .filter((days) => days !== null);

  if (!reviewDays.length) {
    return "Недостаточно данных";
  }

  const averageDays = Math.round(reviewDays.reduce((total, days) => total + days, 0) / reviewDays.length);
  const minDays = Math.min(...reviewDays);
  const maxDays = Math.max(...reviewDays);
  const rangeText = minDays === maxDays ? "" : `, диапазон ${dayLabel(minDays)} - ${dayLabel(maxDays)}`;
  return `среднее ${dayLabel(averageDays)} по ${reviewDays.length} заявкам${rangeText}`;
}

function renderApplicationProgramTitle(deal) {
  const title = applicationProgramTitle(deal);
  const url = applicationProgramUrl(deal);
  if (!url) {
    return escapeHtml(title);
  }

  return `<a class="application-program-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`;
}

function renderApplicationProgramOptions() {
  const entries = flattenKnowledgePrograms();
  if (!entries.length) {
    return `<option value="">Сначала добавьте программу в Базе знаний</option>`;
  }

  const grouped = new Map(PROGRAM_TYPES.map((type) => [type, []]));
  entries.forEach((entry) => {
    const type = PROGRAM_TYPES.includes(entry.program.programType) ? entry.program.programType : "Стандарт";
    grouped.get(type).push(entry);
  });

  return [...grouped.entries()]
    .filter(([, items]) => items.length)
    .map(
      ([type, items]) => `
        <optgroup label="${escapeHtml(type)}">
          ${items
            .sort((left, right) => left.label.localeCompare(right.label, "ru"))
            .map((entry) => `<option value="${escapeHtml(entry.program.id)}">${escapeHtml(entry.label)}</option>`)
            .join("")}
        </optgroup>
      `
    )
    .join("");
}

function renderApplicationProgramPreview(entry) {
  if (!applicationProgramPreview) {
    return;
  }

  if (!entry) {
    applicationProgramPreview.innerHTML = `<span>Выберите программу из базы знаний</span>`;
    return;
  }

  const reviewDeclared = entry.program.reviewTermDeclared || "не указан";
  const reviewStats = programReviewStats(entry.program, entry.bank);
  applicationProgramPreview.innerHTML = `
    <strong>${escapeHtml(programApplicationBaseLabel(entry.bank, entry.program))}</strong>
    <span>
      Рассмотрение:
      <em class="application-program-review-declared">заявленный: ${escapeHtml(reviewDeclared)}</em>
      <em class="application-program-review-stat">статистика: ${escapeHtml(reviewStats)}</em>
    </span>
  `;
}

function syncApplicationProgramFields() {
  const programId = form.elements.knowledgeProgramId?.value;
  const entry = listKnowledgeProgramEntries().find((item) => item.program.id === programId);
  form.elements.bank.value = entry?.bank.bank || "";
  form.elements.program.value = entry?.program.program || "";
  form.elements.programType.value = entry?.program.programType || "";
  form.elements.programAmountRange.value = entry?.program.amountRange || "";
  form.elements.programTermRange.value = entry?.program.termRange || "";
  renderApplicationProgramPreview(entry);
}

function renderKnowledgeFilters() {
  const bankOptions = [...new Set(state.knowledge.map((bank) => bank.bank))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((bank) => `<option value="${escapeHtml(bank)}" ${state.filters.bank === bank ? "selected" : ""}>${escapeHtml(bank)}</option>`)
    .join("");
  const programTypeFilter = state.filters.programType || "all";
  const programTypeOptions = PROGRAM_TYPES
    .map((type) => `<option value="${escapeHtml(type)}" ${programTypeFilter === type ? "selected" : ""}>${escapeHtml(type)}</option>`)
    .join("");
  const categoryFilter = state.filters.category || "all";
  const categoryOptions = PROGRAM_CATEGORIES
    .map((category) => `<option value="${escapeHtml(category)}" ${categoryFilter === category ? "selected" : ""}>${escapeHtml(category)}</option>`)
    .join("");

  return `
    <div class="filters">
      <input id="queryFilter" value="${escapeHtml(state.filters.query)}" placeholder="Банк, программа, категория, требование">
      <select id="bankFilter">
        <option value="all">Банки — все</option>
        ${bankOptions}
      </select>
      <select id="programTypeFilter">
        <option value="all" ${programTypeFilter === "all" ? "selected" : ""}>Программы — все</option>
        ${programTypeOptions}
      </select>
      <select id="categoryFilter">
        <option value="all" ${categoryFilter === "all" ? "selected" : ""}>Категории — все</option>
        <option value="__none__" ${categoryFilter === "__none__" ? "selected" : ""}>${escapeHtml(CATEGORY_FALLBACK_LABEL)}</option>
        ${categoryOptions}
      </select>
    </div>
  `;
}

function renderKnowledgeSectionControls() {
  return `
    <div class="segmented knowledge-sections" role="group" aria-label="Подраздел базы знаний">
      ${Object.entries(KNOWLEDGE_SECTIONS)
        .map(
          ([value, label]) => `
            <button class="${state.knowledgeSection === value ? "is-active" : ""}" data-knowledge-section="${value}" type="button">${label}</button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRequirementGrid(requirements = {}) {
  const entries = Object.entries(REQUIREMENT_LABELS);
  const isFilled = (key) => {
    const value = requirements[key];
    return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
  };
  const filled = entries.filter(([key]) => isFilled(key));
  const empty = entries.filter(([key]) => !isFilled(key));

  if (!filled.length) {
    return `<p class="muted compact-empty">Требования пока не указаны.</p>`;
  }

  const renderItem = ([key, label]) => `
    <div class="requirement-item">
      <span>${label}</span>
      <strong>${escapeHtml(requirements[key] || "Не указано")}</strong>
    </div>
  `;

  const filledHtml = filled.map(renderItem).join("");
  const emptyHtml = empty.length
    ? `
      <details class="requirement-empty-toggle">
        <summary>Показать все требования (${empty.length} пусто)</summary>
        <div class="requirement-grid requirement-grid-empty">
          ${empty.map(renderItem).join("")}
        </div>
      </details>
    `
    : "";

  return `
    <div class="requirement-grid">${filledHtml}</div>
    ${emptyHtml}
  `;
}

function renderKnowledgeProgramCard(program, bank, showBank = false) {
  const programUrl = safeExternalUrl(program.programUrl);
  const reviewStats = programReviewStats(program, bank);
  const categoryLabel = program.category || "";
  const categoryClass = categoryLabel ? ` is-${categorySlug(categoryLabel)}` : " is-none";
  const contactPhone = program.bankPhone || bank.phone;
  return `
    <details class="knowledge-card">
      <summary class="knowledge-card-head">
        <div>
          <p class="eyebrow">Банк</p>
          <h3>${escapeHtml(bank.bank)}</h3>
          ${contactPhone ? `<p class="knowledge-card-phone">Телефон: ${escapeHtml(contactPhone)}</p>` : ""}
          <h4>
            ${escapeHtml(program.program)}${program.amountRange ? ` <span>${escapeHtml(program.amountRange)}</span>` : ""}
            ${program.termRange ? ` <span>${escapeHtml(`срок ${program.termRange}`)}</span>` : ""}
            ${programUrl ? `<a class="knowledge-program-link" href="${escapeHtml(programUrl)}" target="_blank" rel="noopener noreferrer">Ссылка</a>` : ""}
          </h4>
          <div class="knowledge-card-badges">
            <span class="badge badge-type">${escapeHtml(program.programType || "Стандарт")}</span>
            <span class="badge badge-category${categoryClass}">${escapeHtml(categoryLabel || CATEGORY_FALLBACK_LABEL)}</span>
          </div>
        </div>
      </summary>
      <div class="knowledge-card-body">
        <div class="knowledge-card-actions">
          <time>${formatDate(program.updatedAt || bank.updatedAt)}</time>
          ${canEditKnowledge() ? `<button class="ghost-button small-button" data-edit-knowledge="${escapeHtml(program.id)}" type="button">Редактировать</button>` : ""}
        </div>
        ${renderRequirementGrid(program.requirements)}
        <div class="knowledge-review-terms">
          <span>Срок рассмотрения</span>
          <div>
            <strong>Заявленный: ${escapeHtml(program.reviewTermDeclared || "Не указан")}</strong>
            <strong>Статистика: ${escapeHtml(reviewStats)}</strong>
          </div>
        </div>
        <p class="knowledge-note">${escapeHtml(program.notes || "Без заметок")}</p>
        <details class="knowledge-history">
          <summary>История изменений</summary>
          <strong>${escapeHtml(program.changeHistory || `Обновлено: ${formatDate(program.updatedAt || bank.updatedAt)}`)}</strong>
        </details>
      </div>
    </details>
  `;
}

function categorySlug(category) {
  const index = PROGRAM_CATEGORIES.indexOf(category);
  return index >= 0 ? `cat-${index + 1}` : "cat-other";
}

function renderKnowledgeBanks(banks) {
  if (!banks.length) {
    return `<div class="empty">В базе знаний пока нет записей под выбранные фильтры.</div>`;
  }

  return `
    <div class="knowledge-bank-stack">
      ${banks
        .map(
          (bank) => `
            <details class="knowledge-bank" open>
              <summary class="knowledge-bank-head">
                <div>
                  <p class="eyebrow">Банк</p>
                  <h3>${escapeHtml(bank.bank)}</h3>
                  ${bank.phone ? `<p class="knowledge-bank-phone">Телефон: ${escapeHtml(bank.phone)}</p>` : ""}
                </div>
                <span>${(bank.programs || []).length} программ</span>
              </summary>
              <div class="knowledge-grid">
                ${(bank.programs || []).map((program) => renderKnowledgeProgramCard(program, bank)).join("")}
              </div>
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderKnowledgePrograms(banks) {
  const programs = banks.flatMap((bank) => (bank.programs || []).map((program) => ({ bank, program })));
  if (!programs.length) {
    return `<div class="empty">В базе знаний пока нет программ под выбранные фильтры.</div>`;
  }

  const groups = new Map(PROGRAM_TYPES.map((type) => [type, []]));
  programs.forEach((entry) => {
    const type = PROGRAM_TYPES.includes(entry.program.programType) ? entry.program.programType : "Стандарт";
    groups.get(type).push(entry);
  });
  return `
    <div class="knowledge-program-groups">
      ${[...groups.entries()]
        .filter(([, entries]) => entries.length)
        .map(([type, entries]) => {
          return `
            <details class="knowledge-program-group" open>
              <summary class="knowledge-program-group-head">
                <h4>${escapeHtml(type)}</h4>
                <span>${entries.length}</span>
              </summary>
              <div class="knowledge-grid">
                ${entries.map(({ bank, program }) => renderKnowledgeProgramCard(program, bank, true)).join("")}
              </div>
            </details>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderKnowledgeCategories(banks) {
  const programs = banks.flatMap((bank) => (bank.programs || []).map((program) => ({ bank, program })));
  if (!programs.length) {
    return `<div class="empty">В базе знаний пока нет программ под выбранные фильтры.</div>`;
  }

  const groups = new Map(PROGRAM_CATEGORIES.map((category) => [category, []]));
  groups.set("", []);
  programs.forEach((entry) => {
    const category = entry.program.category && PROGRAM_CATEGORIES.includes(entry.program.category) ? entry.program.category : "";
    groups.get(category).push(entry);
  });

  return `
    <div class="knowledge-program-groups">
      ${[...groups.entries()]
        .filter(([, entries]) => entries.length)
        .map(([category, entries]) => {
          const label = category || CATEGORY_FALLBACK_LABEL;
          const slug = category ? categorySlug(category) : "cat-none";
          return `
            <details class="knowledge-program-group is-${slug}" open>
              <summary class="knowledge-program-group-head">
                <h4>${escapeHtml(label)}</h4>
                <span>${entries.length}</span>
              </summary>
              <div class="knowledge-grid">
                ${entries.map(({ bank, program }) => renderKnowledgeProgramCard(program, bank, true)).join("")}
              </div>
            </details>
          `;
        })
        .join("")}
    </div>
  `;
}

function updateApplicationDateRequirements() {
  const requiredFields = new Set(getStageDateRequirements(form.elements.stage.value).map((requirement) => requirement.field));
  const inquiryInput = form.elements.inquiryAt;
  const signedInput = form.elements.signedAt;

  if (!inquiryInput || !signedInput) {
    return;
  }

  inquiryInput.required = requiredFields.has("inquiryAt");
  signedInput.required = requiredFields.has("signedAt");
  inquiryInput.setCustomValidity("");
  signedInput.setCustomValidity("");
}

function renderKnowledgeSectionContent(items) {
  if (state.knowledgeSection === "banks") {
    return renderKnowledgeBanks(items);
  }
  if (state.knowledgeSection === "categories") {
    return renderKnowledgeCategories(items);
  }
  return renderKnowledgePrograms(items);
}

function renderKnowledgeView() {
  const items = filteredKnowledge();
  const addBtn = canEditKnowledge()
    ? `<button class="primary-button" data-add-knowledge type="button">+ Запись БЗ</button>`
    : "";
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">База знаний</p>
          <h2>${KNOWLEDGE_SECTIONS[state.knowledgeSection]}</h2>
        </div>
        <div class="panel-head-actions">
          ${addBtn}
          ${renderKnowledgeFilters()}
        </div>
      </div>
      ${renderKnowledgeSectionControls()}
      ${renderKnowledgeSectionContent(items)}
    </section>
  `;
}

// ===== Document requests helpers =====

function showToast(message, { type = "info", durationMs = 4000 } = {}) {
  if (!toastHost || !message) return;
  const node = document.createElement("div");
  node.className = `toast ${type === "success" ? "is-success" : type === "error" ? "is-error" : ""}`.trim();
  node.textContent = message;
  toastHost.appendChild(node);
  setTimeout(() => {
    if (node.parentNode === toastHost) {
      toastHost.removeChild(node);
    }
  }, durationMs);
}

function applyDocumentRequests(items) {
  const previousSet = state.lastSeenFulfilledRequestIds instanceof Set
    ? state.lastSeenFulfilledRequestIds
    : new Set();
  const nextFulfilled = new Set();
  const newlyFulfilled = [];
  const myFullName = String(state.user?.fullName || "").trim().toLowerCase();
  for (const item of items) {
    if (item.status === "fulfilled" && item.id) {
      nextFulfilled.add(item.id);
      if (!previousSet.has(item.id) && previousSet.size > 0 && !isAdmin()) {
        const ownerMatches = String(item.manager || "").trim().toLowerCase() === myFullName;
        if (ownerMatches) {
          newlyFulfilled.push(item);
        }
      }
    }
  }
  state.documentRequests = items;
  state.lastSeenFulfilledRequestIds = nextFulfilled;
  for (const item of newlyFulfilled) {
    showToast(`Документы загружены: ${item.clientName} · ${item.program || item.bank}`, { type: "success", durationMs: 7000 });
  }
}

function documentRequestsForClient(manager, clientName) {
  const m = compareKey(manager);
  const c = compareKey(clientName);
  return state.documentRequests.filter((req) => compareKey(req.manager) === m && compareKey(req.clientName) === c);
}

function documentRequestsForManager(managerName) {
  const m = compareKey(managerName);
  return state.documentRequests.filter((req) => compareKey(req.manager) === m);
}

function clientHasDocDelivery(client) {
  return documentRequestsForClient(client.manager || "", client.client)
    .some((req) => req.status === "fulfilled");
}

function managerHasDocDelivery(manager) {
  const name = manager?.manager || "";
  return documentRequestsForManager(name).some((req) => req.status === "fulfilled");
}

function summarizeDocRequests(items) {
  const summary = { total: items.length, open: 0, fulfilled: 0, delivered: 0 };
  for (const item of items) {
    if (item.status === "open") summary.open += 1;
    else if (item.status === "fulfilled") summary.fulfilled += 1;
    else if (item.status === "delivered") summary.delivered += 1;
  }
  return summary;
}

function documentRequestForDeal(dealId) {
  if (!dealId) return null;
  const list = state.documentRequests.filter((req) => req.dealId === dealId);
  if (!list.length) return null;
  return list.find((req) => req.status === "open")
    || list.find((req) => req.status === "fulfilled")
    || list.slice().sort((a, b) => (a.deliveredAt < b.deliveredAt ? 1 : -1))[0];
}

function canConfirmRequest(req) {
  if (!req || req.status !== "fulfilled") return false;
  if (isAdmin()) return true;
  const me = String(state.user?.fullName || "").trim().toLowerCase();
  const owner = String(req.manager || "").trim().toLowerCase();
  return me && owner && me === owner;
}

function renderDealDocumentBadge(deal) {
  const req = documentRequestForDeal(deal.id);
  if (!req) return "";
  if (req.status === "delivered") {
    const when = req.deliveredAt ? formatDate(req.deliveredAt) : "";
    return `<span class="deal-doc-badge is-delivered" title="Документы получены${when ? ` ${when}` : ""}">✓ Документы получены</span>`;
  }
  if (req.status === "fulfilled") {
    const when = req.fulfilledAt ? formatDate(req.fulfilledAt) : "";
    const confirmBtn = canConfirmRequest(req)
      ? `<button class="ghost-button small-button doc-confirm-button" data-confirm-doc-request="${escapeHtml(req.id)}" type="button">Я забрал</button>`
      : "";
    return `<span class="deal-doc-badge is-fulfilled" title="Документы загружены${when ? ` ${when}` : ""}">⚠ Документы на отправку${when ? ` · ${when}` : ""}</span>${confirmBtn}`;
  }
  const when = req.createdAt ? formatDate(req.createdAt) : "";
  return `<span class="deal-doc-badge is-requested" title="Запрошены ${when}">● Документы запрошены${when ? ` · ${when}` : ""}</span>`;
}

function renderClientDocStrip(client) {
  const reqs = documentRequestsForClient(client.manager || "", client.client);
  const summary = summarizeDocRequests(reqs);
  if (!summary.open && !summary.fulfilled) {
    return "";
  }
  const parts = [];
  if (summary.open) {
    parts.push(`<span class="doc-strip is-pending">Запросов: ${summary.open}</span>`);
  }
  if (summary.fulfilled) {
    parts.push(`<span class="doc-strip is-delivery">ДОКУМЕНТЫ НА ОТПРАВКУ: ${summary.fulfilled}</span>`);
  }
  return `<div class="client-doc-strip">${parts.join("")}</div>`;
}

function renderManagerDocStrip(manager) {
  const name = manager?.manager || "";
  const reqs = documentRequestsForManager(name);
  const summary = summarizeDocRequests(reqs);
  if (!summary.open && !summary.fulfilled) {
    return "";
  }
  const parts = [];
  if (summary.open) {
    parts.push(`<span class="doc-strip is-pending">Запросов: ${summary.open}</span>`);
  }
  if (summary.fulfilled) {
    parts.push(`<span class="doc-strip is-delivery">ДОКУМЕНТЫ НА ОТПРАВКУ: ${summary.fulfilled}</span>`);
  }
  return `<div class="manager-doc-strip">${parts.join("")}</div>`;
}

function renderDocumentRequestsView() {
  if (!isAdmin() && !isDocumentsOfficer()) {
    return `<div class="empty">Доступ только для администраторов и обработчиков документов.</div>`;
  }
  const all = state.documentRequests;
  const active = all.filter((req) => req.status !== "delivered");
  const archive = all.filter((req) => req.status === "delivered");
  const open = active.filter((req) => req.status === "open").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const fulfilled = active.filter((req) => req.status === "fulfilled").sort((a, b) => (a.fulfilledAt < b.fulfilledAt ? -1 : 1));
  const archiveSorted = archive.slice().sort((a, b) => (a.deliveredAt < b.deliveredAt ? 1 : -1));

  const renderCard = (req, { archived = false } = {}) => {
    const drive = req.driveUrl
      ? `<a href="${escapeHtml(req.driveUrl)}" target="_blank" rel="noopener noreferrer">Диск клиента</a>`
      : `<span>Ссылка на диск не указана</span>`;
    const isFulfilled = req.status === "fulfilled";
    const isDelivered = req.status === "delivered";
    let headTime;
    if (isDelivered) {
      headTime = `Получено ${formatDate(req.deliveredAt)}${req.deliveredBy ? ` · ${escapeHtml(req.deliveredBy)}` : ""}`;
    } else if (isFulfilled) {
      headTime = `Загружено ${formatDate(req.fulfilledAt)}${req.fulfilledBy ? ` · ${escapeHtml(req.fulfilledBy)}` : ""}`;
    } else {
      headTime = `Запрошено ${formatDate(req.createdAt)}${req.createdBy ? ` · ${escapeHtml(req.createdBy)}` : ""}`;
    }
    const attachments = Array.isArray(req.attachments) ? req.attachments : [];
    const canEditAttachments = !archived && !isDelivered && (isAdmin() || isDocumentsOfficer());
    const attachmentsList = attachments.length
      ? `<ul class="doc-attachments-list">
          ${attachments.map((att) => {
            const sizeMb = att.size ? ` · ${(att.size / 1024 / 1024).toFixed(2)} MB` : "";
            const link = att.driveLink
              ? `<a href="${escapeHtml(att.driveLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(att.fileName)}</a>`
              : `<span>${escapeHtml(att.fileName)}</span>`;
            const del = canEditAttachments
              ? `<button class="ghost-button small-button danger-button" data-delete-attachment="${escapeHtml(req.id)}" data-attachment-id="${escapeHtml(att.id)}" type="button" title="Удалить файл">✕</button>`
              : "";
            return `<li>${link}<span class="doc-attachment-meta">${sizeMb}</span>${del}</li>`;
          }).join("")}
        </ul>`
      : (canEditAttachments ? `<div class="doc-attachments-empty">Файлы не прикреплены</div>` : "");
    const uploader = canEditAttachments
      ? `<div class="doc-attachments-upload">
          <input type="file" multiple data-upload-attachment="${escapeHtml(req.id)}" id="upload-${escapeHtml(req.id)}">
          <label class="ghost-button small-button" for="upload-${escapeHtml(req.id)}">📎 Прикрепить файлы</label>
          <span class="doc-upload-hint">До 50 MB на файл, до 20 файлов за раз</span>
        </div>`
      : "";
    let cta = "";
    if (!archived) {
      cta = isFulfilled
        ? `<span class="doc-request-pending-note">Ждём подтверждения от ${escapeHtml(req.manager)}</span>`
        : `<button class="primary-button" data-fulfill-doc-request="${escapeHtml(req.id)}" type="button">Отправить пакет (${attachments.length})</button>`;
    }
    const deleteBtn = isAdmin()
      ? `<button class="ghost-button small-button danger-button" data-delete-doc-request="${escapeHtml(req.id)}" type="button">Удалить запрос</button>`
      : "";
    const stateClass = isDelivered ? "is-delivered" : (isFulfilled ? "is-fulfilled" : "");
    return `
      <article class="doc-request-card ${stateClass}">
        <div class="doc-request-card-head">
          <div class="doc-request-titles">
            <h3 class="doc-request-client">${escapeHtml(req.clientName)}</h3>
            ${req.bank ? `<p class="doc-request-bank">${escapeHtml(req.bank)}</p>` : ""}
            <p class="doc-request-meta">
              ${req.program ? `<span>${escapeHtml(req.program)}</span>` : ""}
              <span>Запросил: ${escapeHtml(req.manager)}</span>
              ${drive}
            </p>
          </div>
          <time>${headTime}</time>
        </div>
        ${req.period ? `<div class="doc-request-period"><span>Период</span><strong>${escapeHtml(req.period)}</strong></div>` : ""}
        <div class="doc-request-items">${escapeHtml(req.items)}</div>
        ${attachmentsList}
        ${uploader}
        ${(deleteBtn || cta) ? `<div class="doc-request-actions">${deleteBtn}${cta}</div>` : ""}
      </article>
    `;
  };

  if (!active.length && !archive.length) {
    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Документы</p>
            <h2>Запросов нет</h2>
          </div>
        </div>
        <div class="empty">Когда аналитик создаст запрос, он появится здесь.</div>
      </section>
    `;
  }

  const resendBtn = (isAdmin() || isDocumentsOfficer()) && active.length
    ? `<button class="ghost-button" data-resend-doc-requests type="button" title="Переотправить уведомления по всем активным запросам в Telegram">🔄 Переотправить уведомления</button>`
    : "";

  // Группировка запросов по клиенту → свёрнутые <details>.
  // Внутри каждого клиента — счётчик, сумма последних дат активности.
  const renderDocRequestsByClient = (requests, bucket, options = {}) => {
    if (!requests.length) return "";
    const byClient = new Map();
    for (const req of requests) {
      const key = req.clientName || "Без клиента";
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push(req);
    }
    const entries = [...byClient.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));
    return `
      <div class="doc-client-stack">
        ${entries.map(([clientName, list]) => {
          const stateKey = uiStateKey("doc-client", bucket, clientName);
          const analysts = [...new Set(list.map((r) => r.manager).filter(Boolean))].join(", ");
          // Преобладающий статус — для цвета кружка.
          const statuses = list.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
          const dominantStatus = statuses.fulfilled ? "fulfilled" : statuses.open ? "open" : statuses.delivered ? "delivered" : "open";
          const countLabel = list.length > 99 ? "99+" : String(list.length);
          return `
            <details class="doc-client-group" data-ui-state-key="${escapeHtml(stateKey)}">
              <summary class="doc-client-group-head">
                <span class="doc-client-count is-${dominantStatus}" title="Запросов в группе: ${list.length}">${countLabel}</span>
                <span class="doc-client-name">${escapeHtml(clientName)}</span>
                <span class="doc-client-meta">${analysts ? escapeHtml(analysts) : ""}</span>
              </summary>
              <div class="doc-request-stack">
                ${list.map((req) => renderCard(req, { archived: options.archived })).join("")}
              </div>
            </details>
          `;
        }).join("")}
      </div>
    `;
  };

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Документы</p>
          <h2>Активные запросы (${active.length})</h2>
        </div>
        ${resendBtn ? `<div class="panel-head-actions">${resendBtn}</div>` : ""}
      </div>
      ${open.length ? `
        <h3 class="doc-section-title">Ждут загрузки (${open.length})</h3>
        ${renderDocRequestsByClient(open, "open")}
      ` : ""}
      ${fulfilled.length ? `
        <h3 class="doc-section-title">Загружены, ждут подтверждения аналитика (${fulfilled.length})</h3>
        ${renderDocRequestsByClient(fulfilled, "fulfilled")}
      ` : ""}
      ${!active.length ? `<div class="empty">Активных запросов нет.</div>` : ""}
      ${archive.length ? `
        <details class="doc-request-archive" data-ui-state-key="doc-requests|archive">
          <summary class="doc-section-title">Архив запросов (${archive.length})</summary>
          ${renderDocRequestsByClient(archiveSorted, "archive", { archived: true })}
        </details>
      ` : ""}
    </section>
  `;
}

function renderIntegrationsView() {
  if (!isAdmin()) {
    return `<div class="empty">Доступ только для администраторов.</div>`;
  }
  const status = state.integrations?.google || null;
  let statusBlock;
  if (!status) {
    statusBlock = `<div class="empty">Загрузка статуса…</div>`;
  } else if (!status.configured) {
    const missing = Array.isArray(status.missingEnvs) ? status.missingEnvs : [];
    const missingHtml = missing.length
      ? `<p>Не заданы переменные: ${missing.map((n) => `<code>${escapeHtml(n)}</code>`).join(", ")}</p>`
      : `<p>Серверные переменные не настроены.</p>`;
    statusBlock = `
      <div class="integration-status is-error">
        <h3>Google Drive</h3>
        ${missingHtml}
        <p class="muted">Полный список: <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>GOOGLE_REDIRECT_URI</code>, <code>OAUTH_TOKEN_ENCRYPTION_KEY</code>.</p>
        <p class="muted">После добавления переменных в Railway → Variables дождитесь redeploy и обновите страницу.</p>
      </div>`;
  } else if (status.connected) {
    statusBlock = `
      <div class="integration-status is-connected">
        <h3>Google Drive — подключён</h3>
        <p>Аккаунт: <strong>${escapeHtml(status.email || "(email не определён)")}</strong></p>
        ${status.connectedAt ? `<p class="muted">Подключён ${formatDate(status.connectedAt)}</p>` : ""}
        <div class="dialog-actions">
          <button class="ghost-button danger-button" data-disconnect-google type="button">Отключить</button>
        </div>
      </div>`;
  } else {
    statusBlock = `
      <div class="integration-status">
        <h3>Google Drive — не подключён</h3>
        <p>Файлы из запросов документов будут загружаться в папку клиента <code>5. ПОДАЧИ / &lt;банк&gt;</code>.</p>
        <p class="muted">Подключите аккаунт, у которого есть доступ к папкам всех клиентов.</p>
        <div class="dialog-actions">
          <button class="primary-button" data-connect-google type="button">Подключить Google Drive</button>
        </div>
      </div>`;
  }
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Интеграции</p>
          <h2>Внешние сервисы</h2>
        </div>
      </div>
      ${statusBlock}
    </section>
  `;
}

// Объединённая «Панель управления» (admin only):
// Аналитики (быстрое создание) → Пользователи → Интеграции
function renderAdminPanelView() {
  if (!isAdmin()) {
    return `<div class="empty">Доступ только для администраторов.</div>`;
  }
  return `
    <section class="panel admin-panel-section">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Команда</p>
          <h2>Аналитики</h2>
          <p class="muted">Создавайте аналитиков и привязывайте их к учёткам</p>
        </div>
        <div class="panel-head-actions">
          <button class="primary-button" data-add-manager type="button">+ Аналитик</button>
        </div>
      </div>
    </section>
    ${renderTaxonomyView("Типы программ", "program-type", state.programTypes || [])}
    ${renderTaxonomyView("Категории программ", "program-category", state.programCategories || [])}
    ${renderUsersView()}
    ${renderIntegrationsView()}
  `;
}

// Универсальный рендер списка taxonomy + inline-форма добавления.
function renderTaxonomyView(title, kind, items) {
  const rows = items.length
    ? items.map((it) => `
        <li class="taxonomy-row" data-taxonomy-id="${escapeHtml(it.id)}">
          <span class="taxonomy-name" data-taxonomy-name>${escapeHtml(it.name)}</span>
          <span class="taxonomy-actions">
            <button class="ghost-button small-button" data-edit-taxonomy="${escapeHtml(kind)}" data-id="${escapeHtml(it.id)}" type="button">Изменить</button>
            <button class="ghost-button small-button danger-button" data-delete-taxonomy="${escapeHtml(kind)}" data-id="${escapeHtml(it.id)}" data-name="${escapeHtml(it.name)}" type="button">Удалить</button>
          </span>
        </li>
      `).join("")
    : `<li class="taxonomy-empty">Пока пусто. Добавьте первое значение.</li>`;
  return `
    <section class="panel admin-panel-section">
      <div class="panel-head">
        <div>
          <p class="eyebrow">База знаний</p>
          <h2>${escapeHtml(title)}</h2>
          <p class="muted">Эти значения подставляются в селекты при создании и редактировании программ</p>
        </div>
        <div class="panel-head-actions">
          <form class="taxonomy-add" data-taxonomy-add="${escapeHtml(kind)}">
            <input type="text" name="name" placeholder="Новое значение" required maxlength="120">
            <button class="primary-button small-button" type="submit">+ Добавить</button>
          </form>
        </div>
      </div>
      <ul class="taxonomy-list">${rows}</ul>
    </section>
  `;
}

function renderUsersView() {
  if (!isAdmin()) {
    return `<div class="empty">Доступ только для администраторов.</div>`;
  }
  const meId = state.user?.id;
  const sorted = [...state.users].sort((a, b) => {
    const roleOrder = (role) => ({ admin: 0, analyst_abram: 1, partner: 2 }[role] ?? 99);
    return roleOrder(a.role) - roleOrder(b.role) || a.fullName.localeCompare(b.fullName, "ru");
  });
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Учётные записи</p>
          <h2>Пользователи (${sorted.length})</h2>
        </div>
        <button class="primary-button" data-add-user="1" type="button">+ Пользователь</button>
      </div>
      ${sorted.length ? `
        <table class="users-table">
          <thead>
            <tr>
              <th>Логин</th>
              <th>ФИО</th>
              <th>Роль</th>
              <th>Создан</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((user) => `
              <tr>
                <td><code>${escapeHtml(user.login)}</code></td>
                <td>${escapeHtml(user.fullName)}${user.id === meId ? ` <span class="user-row-self">— это вы</span>` : ""}</td>
                <td><span class="user-role-badge user-role-${escapeHtml(user.role)}">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</span></td>
                <td><time>${formatDate(user.createdAt)}</time></td>
                <td class="users-row-actions">
                  <button class="ghost-button small-button" data-edit-user="${escapeHtml(user.id)}" type="button">Изменить</button>
                  ${user.id === meId ? "" : `<button class="ghost-button small-button danger-button" data-delete-user="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.fullName)}" type="button">Удалить</button>`}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">Пока нет пользователей.</div>`}
    </section>
  `;
}

function renderCurrent() {
  const deals = filteredDeals("current");
  return `
    ${renderKpis()}
    <section class="content-grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Аналитики</p>
            <h2>Текущие клиенты</h2>
          </div>
          ${renderFilters(state.dashboard.deals.filter((deal) => deal.statusGroup === "current"))}
        </div>
        ${renderManagerGroups(deals)}
      </div>

      <aside class="panel">
        <p class="eyebrow">Контроль</p>
        <h2>Ближайшие действия</h2>
        <ul class="list">
          ${state.dashboard.currentSummary.nextActions
            .map(
              (deal) => `
                <li class="list-item">
                  <strong>${escapeHtml(deal.client)}</strong>
                  <span>${escapeHtml(deal.manager)} · ${escapeHtml(applicationProgramTitle(deal))} · ${escapeHtml(deal.stageLabel)}</span>
                  <span class="muted">${formatDate(deal.nextActionAt)}</span>
                </li>
              `
            )
            .join("") || `<li class="list-item muted">Нет запланированных действий.</li>`}
        </ul>
      </aside>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Воронка</p>
          <h2>Текущие заявки по статусам</h2>
        </div>
      </div>
      <div class="funnel">
        ${state.dashboard.currentFunnel
          .map(
            (stage) => `
              <article class="stage-column">
                <strong>${stage.label}</strong>
                <div class="stage-count">${stage.count}</div>
                <div class="stage-sum">${money(stage.amountRequested)}</div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderBarRows(items, labelKey, valueKey, classKey) {
  if (!items.length) {
    return `<div class="empty compact-empty">Нет данных для графика.</div>`;
  }

  const max = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);
  return `
    <div class="chart-list">
      ${items
        .map((item) => {
          const value = Number(item[valueKey] || 0);
          const width = Math.max(4, Math.round((value / max) * 100));
          const label = item[labelKey] || item.label;
          const normalizedValueKey = valueKey.toLowerCase();
          const displayValue = normalizedValueKey.includes("rate") ? `${value}%` : normalizedValueKey.includes("amount") ? money(value) : value;
          return `
            <div class="bar-row">
              <strong>${escapeHtml(label)}</strong>
              <div class="bar-track"><div class="bar ${escapeHtml(item[classKey] || "")}" style="width: ${width}%"></div></div>
              <span>${displayValue}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function monthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: MOSCOW_TIME_ZONE,
      year: "numeric",
      month: "2-digit"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}`;
}

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: MOSCOW_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dealApplicationDate(deal) {
  return deal.applicationDate || deal.signedAt || deal.submittedAt || deal.inquiryAt || deal.createdAt || deal.updatedAt || deal.lastActionAt;
}

function approvedDealDate(deal) {
  return deal.completedAt || deal.updatedAt || deal.lastActionAt || deal.signedAt || deal.createdAt;
}

function summaryChartPeriodStart(period = state.summaryCharts.period) {
  const months = SUMMARY_CHART_PERIOD_MONTHS[period];
  if (!months) {
    return null;
  }

  const clock = new Date(state.dashboard?.time?.iso || state.dashboard?.generatedAt || Date.now());
  if (Number.isNaN(clock.getTime())) {
    return null;
  }
  return new Date(clock.getFullYear(), clock.getMonth() - months + 1, 1);
}

function isInSummaryChartPeriod(value, period = state.summaryCharts.period) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const start = summaryChartPeriodStart(period);
  return !start || date >= start;
}

function summaryChartBucketMode(period = state.summaryCharts.period) {
  return period === "month" ? "day" : "month";
}

function summaryChartClock() {
  const clock = new Date(state.dashboard?.time?.iso || state.dashboard?.generatedAt || Date.now());
  return Number.isNaN(clock.getTime()) ? new Date() : clock;
}

function shiftMonth(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function summaryChartFixedBuckets(period = state.summaryCharts.period) {
  const start = summaryChartPeriodStart(period);
  if (!start) {
    return [];
  }

  const clock = summaryChartClock();
  const buckets = [];
  if (summaryChartBucketMode(period) === "day") {
    for (let cursor = new Date(start); cursor <= clock; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
      buckets.push({
        key: `day:${dayKey(cursor)}`,
        label: dayMonthLabelFormatter.format(cursor),
        sortKey: dayKey(cursor),
        count: 0
      });
    }
    return buckets;
  }

  for (let cursor = new Date(start); cursor <= clock; cursor = shiftMonth(cursor, 1)) {
    buckets.push({
      key: `month:${monthKey(cursor)}`,
      label: monthLabelFormatter.format(cursor),
      sortKey: monthKey(cursor),
      count: 0
    });
  }
  return buckets;
}

function summaryChartPeriodBucket(dateValue) {
  const mode = summaryChartBucketMode();
  const key = mode === "day" ? dayKey(dateValue) : monthKey(dateValue);
  if (!key) {
    return null;
  }
  const date = new Date(dateValue);
  return {
    key: `${mode}:${key}`,
    label: mode === "day" ? dayMonthLabelFormatter.format(date) : monthLabelFormatter.format(date),
    sortKey: key
  };
}

function buildPeriodCountRows(deals, dateGetter, filterFn = () => true) {
  const period = state.summaryCharts.period;
  const rows = new Map(summaryChartFixedBuckets(period).map((bucket) => [bucket.key, bucket]));

  deals
    .filter(filterFn)
    .forEach((deal) => {
      const dateValue = dateGetter(deal);
      if (!isInSummaryChartPeriod(dateValue, period)) {
        return;
      }
      const bucket = summaryChartPeriodBucket(dateValue);
      if (!bucket) {
        return;
      }
      if (!rows.has(bucket.key)) {
        rows.set(bucket.key, { ...bucket, count: 0 });
      }
      rows.get(bucket.key).count += 1;
    });

  return [...rows.values()]
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .filter((row) => period !== "all" || row.count > 0);
}

function statusDealDate(deal, status) {
  return status === "completed" ? approvedDealDate(deal) : dealApplicationDate(deal);
}

function buildStatusCountPeriodRows(status = state.board.status) {
  return buildPeriodCountRows(
    state.dashboard?.deals || [],
    (deal) => statusDealDate(deal, status),
    (deal) => deal.statusGroup === status
  );
}

function buildStatusFocusPeriodRows(status = state.board.status) {
  return buildPeriodCountRows(
    state.dashboard?.deals || [],
    (deal) => statusDealDate(deal, status),
    (deal) => status === "completed" ? deal.stage === "approved" : deal.stage === "submitted"
  );
}

function summaryFocusFilter(deal, status = state.board.status) {
  return status === "completed" ? deal.stage === "approved" : deal.stage === "submitted";
}

function boardGroupName(deal, groupBy = state.board.groupBy) {
  if (groupBy === "bank") {
    return deal.bank || "Банк не выбран";
  }
  if (groupBy === "client") {
    return deal.client || "Клиент не выбран";
  }
  return deal.manager || "Аналитик не выбран";
}

function buildGroupedDealRows({ filterFn, dateGetter }) {
  const groupBy = state.board.groupBy;
  const period = state.summaryCharts.period;
  const rows = new Map();

  (state.dashboard?.deals || [])
    .filter(filterFn)
    .forEach((deal) => {
      const dateValue = dateGetter(deal);
      if (!isInSummaryChartPeriod(dateValue, period)) {
        return;
      }
      const name = boardGroupName(deal, groupBy);
      const key = `${groupBy}:${name}`;
      if (!rows.has(key)) {
        rows.set(key, {
          key,
          name,
          groupBy,
          count: 0,
          amountRequested: 0,
          approvedAmount: 0,
          successfulCount: 0
        });
      }
      const row = rows.get(key);
      row.count += 1;
      row.amountRequested += Number(deal.amountRequested || 0);
      row.approvedAmount += Number(deal.amountApproved || 0);
      row.successfulCount += deal.stage === "approved" ? 1 : 0;
    });

  return [...rows.values()];
}

function buildGroupedPeriodSeries(baseRows, status = state.board.status, focusOnly = false, limit = 6) {
  if (!baseRows.length) {
    return [];
  }

  const bucketKeys = new Set(baseRows.map((row) => row.key));
  const groupBy = state.board.groupBy;
  const period = state.summaryCharts.period;
  const rows = new Map();

  (state.dashboard?.deals || [])
    .filter((deal) => focusOnly ? summaryFocusFilter(deal, status) : deal.statusGroup === status)
    .forEach((deal) => {
      const dateValue = statusDealDate(deal, status);
      if (!isInSummaryChartPeriod(dateValue, period)) {
        return;
      }
      const bucket = summaryChartPeriodBucket(dateValue);
      if (!bucket || !bucketKeys.has(bucket.key)) {
        return;
      }
      const name = boardGroupName(deal, groupBy);
      const key = `${groupBy}:${name}`;
      if (!rows.has(key)) {
        rows.set(key, {
          key,
          name,
          total: 0,
          values: new Map()
        });
      }
      const row = rows.get(key);
      row.total += 1;
      row.values.set(bucket.key, Number(row.values.get(bucket.key) || 0) + 1);
    });

  const sorted = [...rows.values()]
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "ru"));
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  const series = head.map((row, index) => ({
    name: row.name,
    total: row.total,
    color: AREA_SERIES_COLORS[index % AREA_SERIES_COLORS.length],
    values: baseRows.map((bucket) => Number(row.values.get(bucket.key) || 0))
  }));

  if (tail.length) {
    series.push({
      name: "Остальные",
      total: tail.reduce((total, row) => total + row.total, 0),
      color: AREA_SERIES_COLORS[series.length % AREA_SERIES_COLORS.length],
      values: baseRows.map((bucket) => tail.reduce((total, row) => total + Number(row.values.get(bucket.key) || 0), 0))
    });
  }

  return series;
}

function buildTopRequestedRows(status = state.board.status) {
  return buildGroupedDealRows({
    filterFn: (deal) => deal.statusGroup === status,
    dateGetter: status === "completed" ? approvedDealDate : dealApplicationDate
  })
    .sort((left, right) => Number(right.amountRequested || 0) - Number(left.amountRequested || 0) || left.name.localeCompare(right.name, "ru"))
    .slice(0, 8);
}

function buildTopCountRows(status = state.board.status) {
  if (status !== "completed") {
    return buildGroupedDealRows({
      filterFn: (deal) => deal.statusGroup === "current",
      dateGetter: dealApplicationDate
    })
      .sort((left, right) => Number(right.count || 0) - Number(left.count || 0) || Number(right.amountRequested || 0) - Number(left.amountRequested || 0) || left.name.localeCompare(right.name, "ru"))
      .slice(0, 8);
  }

  return buildGroupedDealRows({
    filterFn: (deal) => deal.stage === "approved",
    dateGetter: approvedDealDate
  })
    .sort((left, right) => Number(right.successfulCount || 0) - Number(left.successfulCount || 0) || Number(right.approvedAmount || 0) - Number(left.approvedAmount || 0) || left.name.localeCompare(right.name, "ru"))
    .slice(0, 8);
}

function buildOutcomeShareItems(status = state.board.status) {
  if (status !== "completed") {
    const currentItems = (state.dashboard?.deals || []).filter((deal) => {
      if (deal.stage !== "lead" && deal.stage !== "submitted") {
        return false;
      }
      return isInSummaryChartPeriod(dealApplicationDate(deal));
    });
    const leads = currentItems.filter((deal) => LEAD_BUCKET_STAGES.has(deal.stage));
    const working = currentItems.filter((deal) => deal.stage === "submitted");

    return [
      { label: "Лиды", value: leads.length, amount: leads.reduce((total, deal) => total + Number(deal.amountRequested || 0), 0), color: "#e3b91c" },
      { label: "Заявки в работе", value: working.length, amount: working.reduce((total, deal) => total + Number(deal.amountRequested || 0), 0), color: "#52bfc1" }
    ];
  }

  const items = (state.dashboard?.deals || []).filter((deal) => {
    if (deal.stage !== "approved" && deal.stage !== "rejected" && deal.stage !== "blocked") {
      return false;
    }
    return isInSummaryChartPeriod(approvedDealDate(deal));
  });
  const approved = items.filter((deal) => deal.stage === "approved");
  const refused = items.filter((deal) => deal.stage === "rejected" || deal.stage === "blocked");

  return [
    { label: "Успешно завершенные", value: approved.length, amount: approved.reduce((total, deal) => total + Number(deal.amountApproved || 0), 0), color: "#80c58b" },
    { label: "Непринятые", value: refused.length, amount: refused.reduce((total, deal) => total + Number(deal.amountRequested || 0), 0), color: "#e88787" }
  ];
}

function donutSegments(items) {
  const filtered = items
    .map((item, index) => ({
      ...item,
      color: item.color || DONUT_COLORS[index % DONUT_COLORS.length],
      value: Number(item.value || 0),
      amount: Number(item.amount || 0)
    }))
    .filter((item) => item.value > 0);
  const total = filtered.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;

  return {
    total,
    segments: filtered.map((item) => {
      const share = percent(item.value, total);
      const start = cursor;
      cursor += total ? (item.value / total) * 100 : 0;
      return {
        ...item,
        share,
        start,
        end: cursor
      };
    })
  };
}

function renderDonutChart(items, centerLabel = "заявок") {
  const { total, segments } = donutSegments(items);
  if (!segments.length) {
    return `<div class="empty compact-empty">Нет данных для диаграммы.</div>`;
  }

  const gradient = segments
    .map((segment) => `${segment.color} ${segment.start.toFixed(2)}% ${segment.end.toFixed(2)}%`)
    .join(", ");

  return `
    <div class="donut-chart">
      <div class="donut-visual" style="background: conic-gradient(${gradient})">
        <span class="donut-center">
          <strong>${total}</strong>
          <small>${escapeHtml(centerLabel)}</small>
        </span>
      </div>
      <div class="donut-legend">
        ${segments
          .map(
            (segment) => `
              <div class="donut-legend-row">
                <span class="donut-swatch" style="background:${segment.color}"></span>
                <strong>${escapeHtml(segment.label)}</strong>
                <span>${segment.share}% · ${segment.value}${segment.amount ? ` · ${money(segment.amount)}` : ""}</span>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function areaChartLabelStep(points) {
  if (points.length <= 6) {
    return 1;
  }
  return Math.ceil(points.length / 6);
}

function renderAreaChart(items, labelKey, valueKey, chartClass = "default", series = []) {
  const values = items.map((item) => Number(item[valueKey] || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!items.length || !total) {
    return `<div class="empty compact-empty">Нет данных для графика.</div>`;
  }

  const width = 760;
  const height = 280;
  const padding = { top: 22, right: 20, bottom: 46, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const baseline = padding.top + plotHeight;
  const max = Math.max(...values, 1);
  const points = items.map((item, index) => {
    const x = pointsX(index, items.length, padding.left, plotWidth);
    const value = Number(item[valueKey] || 0);
    const y = baseline - (value / max) * plotHeight;
    return {
      x,
      y,
      value,
      label: item[labelKey] || item.label || ""
    };
  });
  const linePath = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const buildLinePath = (lineValues) => lineValues
    .map((value, index) => {
      const x = pointsX(index, items.length, padding.left, plotWidth);
      const y = baseline - (Number(value || 0) / max) * plotHeight;
      return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `M ${points[0].x.toFixed(1)} ${baseline} L ${points
    .map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" L ")} L ${points[points.length - 1].x.toFixed(1)} ${baseline} Z`;
  const gradientId = `area-gradient-${chartClass}`;
  const labelStep = areaChartLabelStep(points);
  const ticks = [0, Math.ceil(max / 2), max].filter((value, index, list) => list.indexOf(value) === index);

  return `
    <div class="area-chart area-chart-${escapeHtml(chartClass)}">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`Динамика: ${total}`)}">
        <defs>
          <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="currentColor" stop-opacity="0.34"></stop>
            <stop offset="100%" stop-color="currentColor" stop-opacity="0.06"></stop>
          </linearGradient>
        </defs>
        ${ticks
          .map((tick) => {
            const y = baseline - (tick / max) * plotHeight;
            return `
              <line class="area-grid-line" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}"></line>
              <text class="area-axis-text" x="${padding.left - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end">${tick}</text>
            `;
          })
          .join("")}
        <path class="area-fill" d="${areaPath}" fill="url(#${gradientId})"></path>
        <path class="area-line" d="${linePath}"></path>
        ${series
          .map(
            (line) => `
              <path class="area-series-line" d="${buildLinePath(line.values)}" style="--series-color:${escapeHtml(line.color)}"></path>
              ${line.values
                .map((value, index) => {
                  if (!value) {
                    return "";
                  }
                  const x = pointsX(index, items.length, padding.left, plotWidth);
                  const y = baseline - (Number(value || 0) / max) * plotHeight;
                  return `<circle class="area-series-point" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" style="--series-color:${escapeHtml(line.color)}"></circle>`;
                })
                .join("")}
            `
          )
          .join("")}
        ${points
          .map(
            (point) => `
              <circle class="area-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5"></circle>
              <text class="area-point-value" x="${point.x.toFixed(1)}" y="${Math.max(12, point.y - 9).toFixed(1)}" text-anchor="middle">${point.value || ""}</text>
            `
          )
          .join("")}
        ${points
          .map((point, index) => {
            const show = index === 0 || index === points.length - 1 || index % labelStep === 0;
            return show
              ? `<text class="area-axis-text" x="${point.x.toFixed(1)}" y="${height - 16}" text-anchor="middle">${escapeHtml(point.label)}</text>`
              : "";
          })
          .join("")}
      </svg>
      <div class="area-chart-foot">
        <span>Всего: <strong>${total}</strong></span>
        <span>Пик: <strong>${max}</strong></span>
      </div>
      ${
        series.length
          ? `
            <div class="area-series-legend">
              ${series
                .map(
                  (line) => `
                    <span>
                      <i style="--series-color:${escapeHtml(line.color)}"></i>
                      ${escapeHtml(line.name)} <strong>${line.total}</strong>
                    </span>
                  `
                )
                .join("")}
            </div>
          `
          : ""
      }
    </div>
  `;
}

function pointsX(index, length, left, plotWidth) {
  if (length <= 1) {
    return left + plotWidth / 2;
  }
  return left + (index / (length - 1)) * plotWidth;
}

function compactShareItems(items, valueKey, amountKey, limit = 5) {
  const sorted = [...items]
    .map((item) => ({
      label: item.name,
      value: Number(item[valueKey] || 0),
      amount: Number(item[amountKey] || 0)
    }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value || right.amount - left.amount);
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  if (!tail.length) {
    return head;
  }

  return [
    ...head,
    {
      label: "Остальные",
      value: tail.reduce((sum, item) => sum + item.value, 0),
      amount: tail.reduce((sum, item) => sum + item.amount, 0)
    }
  ];
}

function summaryStatusShareItems(totals, status) {
  if (status === "completed") {
    return [
      { label: "Одобрено", value: totals.successfulCount, amount: totals.approvedAmount, color: "#80c58b" },
      { label: "Отказ", value: totals.refusedCount, amount: totals.refusedAmountRequested, color: "#e88787" }
    ];
  }

  return [
    { label: "План подач", value: totals.planCount, amount: totals.plannedAmountRequested, color: "#cfd8e3" },
    { label: "Лиды", value: totals.leadCount, amount: totals.leadAmountRequested, color: "#e3b91c" },
    { label: "В работе", value: totals.workingCount, amount: totals.workingAmountRequested, color: "#52bfc1" }
  ];
}

function summaryGroupShareItems(groups, status) {
  return compactShareItems(groups, "count", "amountRequested");
}

function summaryStatusTitle(status) {
  return status === "completed" ? "Структура завершенных" : "Структура текущих";
}

function summaryPortfolioTitle(status) {
  const groupLabel = BOARD_GROUP_LABELS[state.board.groupBy].toLowerCase();
  return `${status === "completed" ? "Доля завершенного портфеля" : "Доля текущего портфеля"} · ${groupLabel}`;
}

function summaryTotalAreaTitle(status) {
  return status === "completed" ? "Завершенных заявок" : "Текущих заявок";
}

function summaryFocusAreaTitle(status) {
  return status === "completed" ? "Заявок одобрено" : "Заявок в работе";
}

function summaryOutcomeTitle(status) {
  return status === "completed" ? "Лиды в успешные и непринятые" : "Лиды в заявки в работе";
}

function summaryTopCountTitle(status) {
  return status === "completed" ? "Топ по количеству одобрений" : "Топ по количеству текущих заявок";
}

function renderSummaryCharts(groups, status = state.board.status, totals = renderReportTotals(groups)) {
  const applicationCountRows = buildStatusCountPeriodRows(status);
  const focusCountRows = buildStatusFocusPeriodRows(status);
  const applicationSeries = buildGroupedPeriodSeries(applicationCountRows, status);
  const focusSeries = buildGroupedPeriodSeries(focusCountRows, status, true);
  const topByAmount = buildTopRequestedRows(status);
  const topByCount = buildTopCountRows(status);
  const chartPeriodLabel = SUMMARY_CHART_PERIOD_LABELS[state.summaryCharts.period].toLowerCase();

  return `
    <section class="summary-dashboard-grid">
      <article class="summary-chart-card">
        <p class="eyebrow">Доли</p>
        <h3>${summaryStatusTitle(status)}</h3>
        ${renderDonutChart(summaryStatusShareItems(totals, status), status === "completed" ? "завершено" : "заявок")}
      </article>
      <article class="summary-chart-card">
        <p class="eyebrow">Распределение</p>
        <h3>${summaryPortfolioTitle(status)}</h3>
        ${renderDonutChart(summaryGroupShareItems(groups, status), "заявок")}
      </article>
      <article class="summary-chart-card">
        <p class="eyebrow">Период · ${chartPeriodLabel}</p>
        <h3>${summaryTotalAreaTitle(status)}</h3>
        ${renderAreaChart(applicationCountRows, "label", "count", `${status}-total`, applicationSeries)}
      </article>
      <article class="summary-chart-card">
        <p class="eyebrow">Период · ${chartPeriodLabel}</p>
        <h3>${summaryFocusAreaTitle(status)}</h3>
        ${renderAreaChart(focusCountRows, "label", "count", status === "completed" ? "approvals" : "working", focusSeries)}
      </article>
      <article class="summary-chart-card">
        <p class="eyebrow">Конверсия · ${chartPeriodLabel}</p>
        <h3>${summaryOutcomeTitle(status)}</h3>
        ${renderDonutChart(buildOutcomeShareItems(status), status === "completed" ? "завершено" : "заявок")}
      </article>
      <article class="summary-chart-card">
        <p class="eyebrow">Объем</p>
        <h3>Топ по сумме заявок</h3>
        ${renderBarRows(topByAmount, "name", "amountRequested", "groupBy")}
      </article>
      <article class="summary-chart-card">
        <p class="eyebrow">${status === "completed" ? "Одобрения" : "Количество"} · ${chartPeriodLabel}</p>
        <h3>${summaryTopCountTitle(status)}</h3>
        ${renderBarRows(topByCount, "name", status === "completed" ? "successfulCount" : "count", "groupBy")}
      </article>
    </section>
  `;
}

function renderCompleted() {
  const deals = filteredDeals("completed");
  const byResult = state.dashboard.completedAnalytics.byResult.map((item) => ({ ...item, className: item.id }));
  return `
    ${renderKpis()}
    <section class="content-grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Аналитика</p>
            <h2>Итоги завершенных</h2>
          </div>
          ${renderFilters(state.dashboard.deals.filter((deal) => deal.statusGroup === "completed"))}
        </div>
        ${renderBarRows(byResult, "label", "count", "className")}
      </div>

      <aside class="panel">
        <p class="eyebrow">Банки</p>
        <h2>Конверсия по банкам</h2>
        <div class="chart-list">
          ${state.dashboard.completedAnalytics.byBank
            .map(
              (bank) => `
                <div class="list-item">
                  <strong>${escapeHtml(bank.bank)} · ${bank.conversionRate}%</strong>
                  <span class="muted">Одобрено ${bank.issuedCount} из ${bank.count}; среднее ${money(bank.averageApproved)}</span>
                </div>
              `
            )
            .join("") || `<div class="list-item muted">Нет завершенных заявок.</div>`}
        </div>
      </aside>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Реестр</p>
          <h2>Список завершенных сделок</h2>
        </div>
      </div>
      ${renderDealTable(deals)}
    </section>
  `;
}

function renderBoardControls() {
  return `
    <div class="board-controls">
      <div class="segmented" role="group" aria-label="Тип отчета">
        ${Object.entries(BOARD_STATUS_LABELS)
          .map(
            ([value, label]) => `
              <button class="${state.board.status === value ? "is-active" : ""}" data-board-status="${value}" type="button">${label}</button>
            `
          )
          .join("")}
      </div>
      <div class="segmented" role="group" aria-label="Группировка отчета">
        ${Object.entries(BOARD_GROUP_LABELS)
          .map(
            ([value, label]) => `
              <button class="${state.board.groupBy === value ? "is-active" : ""}" data-board-group="${value}" type="button">${label}</button>
            `
          )
          .join("")}
      </div>
      <div class="chart-filter-row" aria-label="Настройки графиков">
        <label>
          Период
          <select id="summaryChartPeriod">
            ${Object.entries(SUMMARY_CHART_PERIOD_LABELS)
              .map(
                ([value, label]) => `
                  <option value="${value}" ${state.summaryCharts.period === value ? "selected" : ""}>${label}</option>
                `
              )
              .join("")}
          </select>
        </label>
      </div>
    </div>
  `;
}

function resolveBoardApplications(group) {
  if (Array.isArray(group?.applicationIds) && group.applicationIds.length) {
    const dealById = new Map((state.dashboard?.deals || []).map((deal) => [deal.id, deal]));
    return group.applicationIds.map((id) => dealById.get(id)).filter(Boolean);
  }
  return Array.isArray(group?.applications) ? group.applications : [];
}

// Stage → семантический оттенок для левой полоски / бейджа карточки
function stageTone(stage) {
  if (stage === "approved") return "success";
  if (stage === "rejected" || stage === "blocked") return "danger";
  if (stage === "submitted") return "info";
  if (stage === "planned") return "neutral";
  return "warning";
}

function daysSince(dateValue) {
  if (!dateValue) return null;
  const t = new Date(dateValue).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / (24 * 3600 * 1000));
  return days >= 0 ? days : null;
}

function ageBadge(days, { stalledFrom = 7 } = {}) {
  if (days == null) return "";
  const tone = days >= stalledFrom ? "danger" : days >= Math.floor(stalledFrom * 0.6) ? "warning" : "neutral";
  const word = days === 0 ? "сегодня" : days === 1 ? "1 день" : `${days} дн.`;
  return `<span class="deal-card-age is-${tone}">${word}</span>`;
}

function renderBoardApplicationRows(applications, groupBy) {
  if (!applications.length) {
    return `<div class="empty compact-empty">Заявок нет.</div>`;
  }

  return `
    <div class="deal-card-grid">
      ${applications
        .map((deal) => {
          const tone = stageTone(deal.stage);
          const program = applicationProgramTitle(deal);
          const bankLabel = deal.bank || "Без банка";
          const subtitle = groupBy === "bank"
            ? `${escapeHtml(program)} · аналитик ${escapeHtml(deal.manager)}`
            : groupBy === "client"
              ? `${escapeHtml(program)} · ${escapeHtml(bankLabel)}`
              : `${escapeHtml(program)} · ${escapeHtml(bankLabel)}`;
          const ageDays = daysSince(deal.lastActionAt || deal.applicationDate);
          const docBadge = renderDealDocumentBadge(deal);
          return `
            <article class="deal-card is-${tone}">
              <header class="deal-card-head">
                <span class="deal-card-stage is-${tone}">${escapeHtml(deal.stageLabel || "—")}</span>
                ${ageBadge(ageDays)}
              </header>
              <h4 class="deal-card-client">${escapeHtml(deal.client)}</h4>
              <p class="deal-card-subtitle">${subtitle}</p>
              <div class="deal-card-amount">
                <span class="deal-card-amount-label">Сумма</span>
                <strong>${money(deal.amountRequested)}</strong>
                ${deal.amountApproved ? `<span class="deal-card-amount-approved">одобрено ${money(deal.amountApproved)}</span>` : ""}
              </div>
              ${docBadge ? `<div class="deal-card-doc-row">${docBadge}</div>` : ""}
              <footer class="deal-card-foot">
                <span>Аналитик: <strong>${escapeHtml(deal.manager)}</strong></span>
                <span>Заявка: <strong>${formatDate(deal.applicationDate)}</strong></span>
                <span>Действие: <strong>${formatDate(deal.lastActionAt)}</strong></span>
              </footer>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderBoardSummaryGroups(groups) {
  if (!groups.length) {
    return `<div class="empty">Нет данных для выбранного отчета.</div>`;
  }

  return `
    <div class="board-group-stack">
      ${groups
        .map(
          (group) => `
            <details class="board-group-card">
              <summary>
                <div>
                  <p class="eyebrow">${BOARD_GROUP_EYEBROWS[state.board.groupBy] || "Группа"}</p>
                  <h3>${escapeHtml(group.name)}</h3>
                </div>
                <div class="manager-metrics">
                  <span>${group.count} заявок</span>
                  <strong>${money(group.amountRequested)} в выбранном отчете (${group.approvalConversionRate || 0}%)</strong>
                  ${renderSummaryAmountBadges(group, state.board.status)}
                  ${renderConversionBadges(group)}
                </div>
              </summary>
              ${renderBoardApplicationRows(resolveBoardApplications(group), state.board.groupBy)}
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

// Канонический порядок этапов в воронке (для сводного отчёта).
const SUMMARY_STAGE_ORDER = [
  "planned",
  "lead",
  "documents_requested",
  "submitted",
  "approved",
  "rejected",
  "blocked"
];

// Группировка заявок по этапу — раскрывающиеся секции с карточками.
function renderDealsByStage() {
  const deals = state.dashboard?.deals || [];
  if (!deals.length) {
    return `<div class="empty">Нет заявок.</div>`;
  }
  const stages = state.dashboard?.stages?.all || [];
  const stageLabelMap = Object.fromEntries(stages.map((s) => [s.id, s.label]));

  const byStage = new Map();
  for (const deal of deals) {
    const id = deal.stage || "unknown";
    if (!byStage.has(id)) byStage.set(id, []);
    byStage.get(id).push(deal);
  }

  // Стабильный порядок: сначала из SUMMARY_STAGE_ORDER, потом остальные.
  const orderedIds = [
    ...SUMMARY_STAGE_ORDER.filter((id) => byStage.has(id)),
    ...[...byStage.keys()].filter((id) => !SUMMARY_STAGE_ORDER.includes(id))
  ];

  return `
    <div class="stage-sections">
      ${orderedIds.map((id) => {
        const items = byStage.get(id) || [];
        if (!items.length) return "";
        const label = stageLabelMap[id] || (items[0]?.stageLabel) || id;
        const tone = stageTone(id);
        const sumReq = items.reduce((acc, d) => acc + (Number(d.amountRequested) || 0), 0);
        const sumApp = items.reduce((acc, d) => acc + (Number(d.amountApproved) || 0), 0);
        const stateKey = uiStateKey("summary-stage", id);
        const sortedItems = items.slice().sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0));
        return `
          <details class="stage-section is-${tone}" data-ui-state-key="${escapeHtml(stateKey)}">
            <summary class="stage-section-head">
              <span class="stage-section-label is-${tone}">${escapeHtml(label)}</span>
              <span class="stage-section-count">${items.length}</span>
              <span class="stage-section-meta">${money(sumReq)}${sumApp ? ` · одобр. ${money(sumApp)}` : ""}</span>
            </summary>
            <div class="stage-section-body">
              ${renderStageClientsGroup(id, sortedItems)}
            </div>
          </details>
        `;
      }).join("")}
    </div>
  `;
}

// Внутри stage-section группируем заявки по клиенту: каждый клиент —
// свёрнутый <details> с шапкой (счётчик заявок + сумма + аналитик) и
// сеткой карточек заявок внутри.
function renderStageClientsGroup(stageId, items) {
  if (!items.length) return `<div class="empty compact-empty">Заявок нет.</div>`;
  const byClient = new Map();
  for (const d of items) {
    const key = d.client || "Без клиента";
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push(d);
  }
  const entries = [...byClient.entries()].sort((a, b) => {
    // Сначала клиенты у кого свежее последнее действие.
    const aLast = Math.max(...a[1].map((d) => new Date(d.lastActionAt || 0).getTime()));
    const bLast = Math.max(...b[1].map((d) => new Date(d.lastActionAt || 0).getTime()));
    if (aLast !== bLast) return bLast - aLast;
    return a[0].localeCompare(b[0], "ru");
  });
  return `
    <div class="stage-client-stack">
      ${entries.map(([clientName, dealsOfClient]) => {
        const sortedDeals = dealsOfClient.slice().sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0));
        const sumReq = sortedDeals.reduce((acc, d) => acc + (Number(d.amountRequested) || 0), 0);
        const sumApp = sortedDeals.reduce((acc, d) => acc + (Number(d.amountApproved) || 0), 0);
        const analysts = [...new Set(sortedDeals.map((d) => d.manager).filter(Boolean))].join(", ");
        const stateKey = uiStateKey("summary-stage-client", stageId, clientName);
        return `
          <details class="stage-client-group" data-ui-state-key="${escapeHtml(stateKey)}">
            <summary class="stage-client-group-head">
              <span class="stage-client-count">${sortedDeals.length}</span>
              <span class="stage-client-name">${escapeHtml(clientName)}</span>
              <span class="stage-client-meta">${analysts ? escapeHtml(analysts) : ""}</span>
              <span class="stage-client-sum">${money(sumReq)}${sumApp ? ` · одобр. ${money(sumApp)}` : ""}</span>
            </summary>
            <div class="stage-client-group-body">
              ${renderBoardApplicationRows(sortedDeals, "client")}
            </div>
          </details>
        `;
      }).join("")}
    </div>
  `;
}

function renderSummary() {
  // Графики берут текущие group/status, тоталы строки — current+по аналитикам.
  const groups = state.dashboard.boardSummaries?.[state.board.status]?.[state.board.groupBy] || [];
  const totals = renderReportTotals(groups);
  const reportTime = state.dashboard.time || { iso: state.dashboard.generatedAt, source: "server" };
  const reportTimeAttr = `Обновлено ${formatDate(reportTime.iso)} MSK · источник: ${reportTime.source || "server"}`;
  const allDeals = state.dashboard?.deals || [];
  const totalReq = allDeals.reduce((acc, d) => acc + (Number(d.amountRequested) || 0), 0);
  const totalApp = allDeals.reduce((acc, d) => acc + (Number(d.amountApproved) || 0), 0);

  const groupBy = state.summary?.groupBy === "client" ? "client" : "stage";
  const h2Title = groupBy === "client" ? "Все заявки по клиентам" : "Все заявки по статусам";
  const listHtml = groupBy === "client" ? renderDealsByClient() : renderDealsByStage();

  return `
    ${renderKpis()}
    ${summaryAlerts()}
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 title="${escapeHtml(reportTimeAttr)}">${h2Title}</h2>
          <p class="summary-totals-line">
            <strong>${allDeals.length}</strong> заявок · <strong>${money(totalReq)}</strong>
            ${totalApp ? ` · одобрено <strong>${money(totalApp)}</strong>` : ""}
          </p>
        </div>
      </div>
      ${renderSummaryCharts(groups, state.board.status, totals)}
      <div class="summary-groupby-bar">
        <div class="segmented summary-groupby" role="tablist" aria-label="Группировка заявок">
          <button class="${groupBy === "stage" ? "is-active" : ""}" data-summary-groupby="stage" type="button">По статусам</button>
          <button class="${groupBy === "client" ? "is-active" : ""}" data-summary-groupby="client" type="button">По клиентам</button>
        </div>
      </div>
      ${listHtml}
    </section>
  `;
}

// Группировка: верхний уровень — клиент; внутри клиента — секции по статусам с карточками.
function renderDealsByClient() {
  const deals = state.dashboard?.deals || [];
  if (!deals.length) return `<div class="empty">Нет заявок.</div>`;

  const stages = state.dashboard?.stages?.all || [];
  const stageLabelMap = Object.fromEntries(stages.map((s) => [s.id, s.label]));

  const byClient = new Map();
  for (const deal of deals) {
    const key = deal.client || "Без клиента";
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push(deal);
  }

  const entries = [...byClient.entries()].sort((a, b) => {
    const aLast = Math.max(...a[1].map((d) => new Date(d.lastActionAt || 0).getTime()));
    const bLast = Math.max(...b[1].map((d) => new Date(d.lastActionAt || 0).getTime()));
    if (aLast !== bLast) return bLast - aLast;
    return a[0].localeCompare(b[0], "ru");
  });

  return `
    <div class="client-overview-stack">
      ${entries.map(([clientName, clientDeals]) => {
        const analysts = [...new Set(clientDeals.map((d) => d.manager).filter(Boolean))].join(", ");
        const totalCount = clientDeals.length;
        const sumReq = clientDeals.reduce((acc, d) => acc + (Number(d.amountRequested) || 0), 0);
        const sumApp = clientDeals.reduce((acc, d) => acc + (Number(d.amountApproved) || 0), 0);
        // Доминирующий статус — для цвета левой полоски карточки клиента.
        const stageCounts = clientDeals.reduce((acc, d) => {
          acc[d.stage] = (acc[d.stage] || 0) + 1; return acc;
        }, {});
        const dominantStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        const tone = stageTone(dominantStage);
        // Группировка внутри клиента по этапу.
        const byStage = new Map();
        for (const d of clientDeals) {
          if (!byStage.has(d.stage)) byStage.set(d.stage, []);
          byStage.get(d.stage).push(d);
        }
        const stageOrdered = [
          ...SUMMARY_STAGE_ORDER.filter((id) => byStage.has(id)),
          ...[...byStage.keys()].filter((id) => !SUMMARY_STAGE_ORDER.includes(id))
        ];
        const stateKey = uiStateKey("summary-client", clientName);
        return `
          <details class="client-overview is-${tone}" data-ui-state-key="${escapeHtml(stateKey)}">
            <summary class="client-overview-head">
              <span class="client-overview-count">${totalCount}</span>
              <span class="client-overview-name">${escapeHtml(clientName)}</span>
              <span class="client-overview-meta">${analysts ? escapeHtml(analysts) : ""}</span>
              <span class="client-overview-sum">${money(sumReq)}${sumApp ? ` · одобр. ${money(sumApp)}` : ""}</span>
            </summary>
            <div class="client-overview-body">
              ${stageOrdered.map((sid) => {
                const items = byStage.get(sid) || [];
                const label = stageLabelMap[sid] || items[0]?.stageLabel || sid;
                const sTone = stageTone(sid);
                const sorted = items.slice().sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0));
                return `
                  <div class="client-overview-stage is-${sTone}">
                    <div class="client-overview-stage-head">
                      <span class="stage-section-label is-${sTone}">${escapeHtml(label)}</span>
                      <span class="client-overview-stage-count">${items.length}</span>
                    </div>
                    ${renderBoardApplicationRows(sorted, "client")}
                  </div>
                `;
              }).join("")}
            </div>
          </details>
        `;
      }).join("")}
    </div>
  `;
}

function updatePageHeader() {
  const view = VIEWS.find((item) => item.id === state.view);
  const label = view?.label || "Мониторинг состояния заявок";
  const heading = document.querySelector(".topbar h1");
  if (heading) {
    heading.textContent = label;
  }
  document.title = `${label} · Deal Monitor`;
}

function render() {
  // documents_officer не имеет dashboard — рендерим вкладку сразу.
  if (!state.dashboard && !isDocumentsOfficer()) {
    app.innerHTML = `<div class="loading">Загрузка данных...</div>`;
    return;
  }

  // Снимаем снимок состояния UI ДО перерисовки:
  // — какие <details> были раскрыты (по data-ui-state-key)
  // — позиция скролла
  // — значение и каретка активного input/textarea
  const uiSnapshot = captureUiState();
  const activeEl = document.activeElement;
  let focusSnapshot = null;
  if (activeEl && activeEl !== document.body && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT")) {
    focusSnapshot = {
      id: activeEl.id || "",
      name: activeEl.name || "",
      dataField: activeEl.dataset?.field || "",
      dataApplicationField: activeEl.dataset?.applicationField || "",
      selectionStart: typeof activeEl.selectionStart === "number" ? activeEl.selectionStart : null,
      selectionEnd: typeof activeEl.selectionEnd === "number" ? activeEl.selectionEnd : null,
      value: activeEl.value
    };
  }

  renderViewTabs();
  updatePageHeader();
  updateActionVisibility();

  const views = {
    funnels: renderManagerClientView,
    current: renderCurrent,
    completed: renderCompleted,
    archive: renderArchiveView,
    knowledge: renderKnowledgeView,
    summary: renderSummary,
    "document-requests": renderDocumentRequestsView,
    "admin-panel": renderAdminPanelView
  };

  const renderer = views[state.view] || (isDocumentsOfficer() ? renderDocumentRequestsView : renderSummary);
  app.innerHTML = renderer();
  bindDynamicControls();

  // Восстанавливаем то, что снимали выше.
  restoreUiState(uiSnapshot);
  if (focusSnapshot) {
    const target = findFocusTarget(focusSnapshot);
    if (target) {
      try { target.focus({ preventScroll: true }); } catch { /* ignore */ }
      if (focusSnapshot.selectionStart != null && typeof target.setSelectionRange === "function") {
        try { target.setSelectionRange(focusSnapshot.selectionStart, focusSnapshot.selectionEnd); }
        catch { /* selection unsupported on this input type */ }
      }
    }
  }
}

// Ищем элемент, на котором был фокус, после перерисовки.
// Перебираем стратегии от самой надёжной к более слабой.
function findFocusTarget(snap) {
  if (!snap) return null;
  if (snap.id) {
    const byId = document.getElementById(snap.id);
    if (byId) return byId;
  }
  if (snap.dataApplicationField && snap.dataField) {
    return document.querySelector(`[data-application-field="${CSS.escape(snap.dataApplicationField)}"][data-field="${CSS.escape(snap.dataField)}"]`);
  }
  if (snap.name) {
    return document.querySelector(`[name="${CSS.escape(snap.name)}"]`);
  }
  return null;
}

let queryFilterDebounceTimer = null;

function scheduleQueryFilterRender(input) {
  const cursor = input.selectionStart;
  clearTimeout(queryFilterDebounceTimer);
  queryFilterDebounceTimer = setTimeout(() => {
    render();
    const next = document.querySelector("#queryFilter");
    if (next) {
      next.focus();
      if (cursor != null) {
        try {
          next.setSelectionRange(cursor, cursor);
        } catch {
          // setSelectionRange unsupported on this input type — ignore
        }
      }
    }
  }, 200);
}

const NEGATIVE_FINAL_STAGES = new Set(["rejected", "blocked"]);
const NEGATIVE_STAGE_LABELS = { rejected: "Отклонено", blocked: "Нет возможности завести" };

async function handleSaveApplication(saveButton) {
  const card = saveButton.closest(".client-application-card");
  const stageSelect = card?.querySelector("[data-stage-select]");
  const dealId = saveButton.dataset.saveApplication;
  const currentStage = stageSelect?.dataset.currentStage || "";
  const nextStage = stageSelect?.value || currentStage;
  const requirements = getStageDateRequirements(nextStage, currentStage);
  const payload = { stage: nextStage };

  for (const requirement of requirements) {
    const dateInput = card?.querySelector(`[data-field="${requirement.field}"]`);
    if (!dateInput?.value) {
      dateInput?.focus();
      dateInput?.setCustomValidity(`${requirement.label} обязательна для выбранного статуса`);
      dateInput?.reportValidity();
      dateInput?.addEventListener("input", () => dateInput.setCustomValidity(""), { once: true });
      return;
    }
    payload[requirement.field] = dateInput.value;
  }

  if (NEGATIVE_FINAL_STAGES.has(nextStage) && !NEGATIVE_FINAL_STAGES.has(currentStage)) {
    const label = NEGATIVE_STAGE_LABELS[nextStage] || nextStage;
    const reason = window.prompt(`Укажите причину статуса «${label}»:`, "");
    if (reason === null) {
      stageSelect.value = currentStage;
      return;
    }
    const trimmed = reason.trim();
    if (!trimmed) {
      window.alert("Причина обязательна для этого статуса");
      stageSelect.focus();
      return;
    }
    payload.comment = trimmed;
  }

  card?.querySelectorAll("[data-application-field]").forEach((input) => {
    if (input.dataset.field) {
      payload[input.dataset.field] = input.value;
    }
  });

  const uiSnapshot = captureUiState();
  setClientRefreshState(card, saveButton, true);
  try {
    const { deal } = await requestJson(`/api/deals/${encodeURIComponent(dealId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    closeApplicationCard(card);
    await refreshDashboard({ restoreUi: preserveClientOpenState(uiSnapshot, deal) });
  } catch (error) {
    setClientRefreshState(card, saveButton, false);
    window.alert(error.message);
  }
}

async function handleArchiveClient(button) {
  if (!button.dataset.archiveClient) {
    return;
  }
  const confirmed = window.confirm(`Отправить клиента "${button.dataset.clientName}" в архив?`);
  if (!confirmed) {
    return;
  }
  await requestJson(`/api/clients/${encodeURIComponent(button.dataset.archiveClient)}/archive`, { method: "PATCH" });
  await loadData({ targets: ["clients", "dashboard"] });
}

async function handleDeleteClient(button) {
  if (!button.dataset.deleteClient) {
    return;
  }
  const name = button.dataset.clientName || "клиента";
  const confirmed = window.confirm(`Удалить клиента "${name}" безвозвратно?\nВсе его заявки и задачи останутся, но потеряют ссылку на карточку клиента.`);
  if (!confirmed) {
    return;
  }
  try {
    await requestJson(`/api/clients/${encodeURIComponent(button.dataset.deleteClient)}`, { method: "DELETE" });
    await loadData({ targets: ["clients", "dashboard", "tasks"] });
  } catch (error) {
    window.alert(error.message);
  }
}

async function handleDeleteDeal(button) {
  if (!button.dataset.deleteDeal) {
    return;
  }
  const title = button.dataset.dealTitle || "эту заявку";
  const confirmed = window.confirm(`Удалить заявку "${title}" безвозвратно?`);
  if (!confirmed) {
    return;
  }
  try {
    await requestJson(`/api/deals/${encodeURIComponent(button.dataset.deleteDeal)}`, { method: "DELETE" });
    await refreshDashboard();
  } catch (error) {
    window.alert(error.message);
  }
}

let dynamicControlsInitialized = false;

function initDynamicControls() {
  if (dynamicControlsInitialized) {
    return;
  }
  dynamicControlsInitialized = true;

  app.addEventListener("input", (event) => {
    if (event.target?.id === "queryFilter") {
      state.filters.query = event.target.value;
      scheduleQueryFilterRender(event.target);
    }
  });

  // Submit формы добавления нового значения в taxonomy (в Панели управления).
  app.addEventListener("submit", async (event) => {
    const form = event.target?.closest?.("[data-taxonomy-add]");
    if (!form) return;
    event.preventDefault();
    const kind = form.dataset.taxonomyAdd;
    const input = form.querySelector('input[name="name"]');
    const name = (input?.value || "").trim();
    if (!name) return;
    await handleAddTaxonomy(kind, name);
    if (input) input.value = "";
  });

  app.addEventListener("change", async (event) => {
    const target = event.target;
    if (!target) {
      return;
    }
    if (target.dataset?.taskToggle) {
      await handleToggleTask(target.dataset.taskToggle, target.checked);
      return;
    }
    if (target.dataset?.uploadAttachment) {
      await handleUploadAttachment(target);
      return;
    }
    if (!target.id) {
      return;
    }
    switch (target.id) {
      case "managerFilter":
        state.filters.manager = target.value;
        render();
        break;
      case "bankFilter":
        state.filters.bank = target.value;
        render();
        break;
      case "programTypeFilter":
        state.filters.programType = target.value;
        render();
        break;
      case "categoryFilter":
        state.filters.category = target.value;
        render();
        break;
      case "stageFilter":
        state.filters.stage = target.value;
        render();
        break;
      case "summaryChartPeriod":
        state.summaryCharts.period = target.value;
        render();
        break;
      default:
        break;
    }
  });

  app.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const programLink = target.closest(".knowledge-program-link, .application-program-link");
    if (programLink) {
      event.stopPropagation();
      return;
    }

    const summaryGroupBy = target.closest("[data-summary-groupby]");
    if (summaryGroupBy) {
      state.summary = state.summary || {};
      state.summary.groupBy = summaryGroupBy.dataset.summaryGroupby;
      render();
      return;
    }

    const boardStatus = target.closest("[data-board-status]");
    if (boardStatus) {
      state.board.status = boardStatus.dataset.boardStatus;
      render();
      return;
    }

    const boardGroup = target.closest("[data-board-group]");
    if (boardGroup) {
      state.board.groupBy = boardGroup.dataset.boardGroup;
      render();
      return;
    }

    const archiveGroup = target.closest("[data-archive-group]");
    if (archiveGroup) {
      state.archive.groupBy = archiveGroup.dataset.archiveGroup;
      render();
      return;
    }

    const knowledgeSection = target.closest("[data-knowledge-section]");
    if (knowledgeSection) {
      state.knowledgeSection = knowledgeSection.dataset.knowledgeSection;
      render();
      return;
    }

    const addApplication = target.closest("[data-add-application]");
    if (addApplication) {
      event.preventDefault();
      event.stopPropagation();
      openApplicationDialog(addApplication.dataset.manager, addApplication.dataset.client);
      return;
    }

    const archiveClient = target.closest("[data-archive-client]");
    if (archiveClient) {
      event.preventDefault();
      event.stopPropagation();
      await handleArchiveClient(archiveClient);
      return;
    }

    const addUserBtn = target.closest("[data-add-user]");
    if (addUserBtn) {
      event.preventDefault();
      event.stopPropagation();
      openUserDialog(null);
      return;
    }

    const editUserBtn = target.closest("[data-edit-user]");
    if (editUserBtn) {
      event.preventDefault();
      event.stopPropagation();
      const entry = state.users.find((u) => u.id === editUserBtn.dataset.editUser);
      if (entry) {
        openUserDialog(entry);
      }
      return;
    }

    const deleteUserBtn = target.closest("[data-delete-user]");
    if (deleteUserBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleDeleteUser(deleteUserBtn);
      return;
    }

    const linkManagerBtn = target.closest("[data-link-manager]");
    if (linkManagerBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleLinkManagerToUser(linkManagerBtn);
      return;
    }

    const unlinkManagerBtn = target.closest("[data-unlink-manager]");
    if (unlinkManagerBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleUnlinkManagerFromUser(unlinkManagerBtn);
      return;
    }

    const connectGoogleBtn = target.closest("[data-connect-google]");
    if (connectGoogleBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleConnectGoogle();
      return;
    }

    const disconnectGoogleBtn = target.closest("[data-disconnect-google]");
    if (disconnectGoogleBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleDisconnectGoogle();
      return;
    }

    const deleteAttachmentBtn = target.closest("[data-delete-attachment]");
    if (deleteAttachmentBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleDeleteAttachment(deleteAttachmentBtn);
      return;
    }

    const resendDocsBtn = target.closest("[data-resend-doc-requests]");
    if (resendDocsBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleResendDocRequests(resendDocsBtn);
      return;
    }

    const addDocRequestBtn = target.closest("[data-add-doc-request]");
    if (addDocRequestBtn) {
      event.preventDefault();
      event.stopPropagation();
      openDocumentRequestDialog({
        clientName: addDocRequestBtn.dataset.addDocRequest || "",
        manager: addDocRequestBtn.dataset.docManager || ""
      });
      return;
    }

    const fulfillDocRequestBtn = target.closest("[data-fulfill-doc-request]");
    if (fulfillDocRequestBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleFulfillDocumentRequest(fulfillDocRequestBtn);
      return;
    }

    const deleteDocRequestBtn = target.closest("[data-delete-doc-request]");
    if (deleteDocRequestBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleDeleteDocumentRequest(deleteDocRequestBtn);
      return;
    }

    const confirmDocRequestBtn = target.closest("[data-confirm-doc-request]");
    if (confirmDocRequestBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleConfirmDocumentRequest(confirmDocRequestBtn);
      return;
    }

    const deleteClient = target.closest("[data-delete-client]");
    if (deleteClient) {
      event.preventDefault();
      event.stopPropagation();
      await handleDeleteClient(deleteClient);
      return;
    }

    const deleteDeal = target.closest("[data-delete-deal]");
    if (deleteDeal) {
      event.preventDefault();
      event.stopPropagation();
      await handleDeleteDeal(deleteDeal);
      return;
    }

    const addDealAction = target.closest("[data-add-deal-action]");
    if (addDealAction) {
      event.preventDefault();
      event.stopPropagation();
      openDealActionDialog(addDealAction.dataset.addDealAction);
      return;
    }

    const editTaxonomyBtn = target.closest("[data-edit-taxonomy]");
    if (editTaxonomyBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleEditTaxonomy(editTaxonomyBtn);
      return;
    }
    const deleteTaxonomyBtn = target.closest("[data-delete-taxonomy]");
    if (deleteTaxonomyBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleDeleteTaxonomy(deleteTaxonomyBtn);
      return;
    }

    // Делегационные «+ Создать» кнопки (вынесены из топбара по разделам).
    const addManagerBtn = target.closest("[data-add-manager]");
    if (addManagerBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (newManagerButton) newManagerButton.click();
      return;
    }
    const addClientBtn = target.closest("[data-add-client]");
    if (addClientBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (newClientButton) newClientButton.click();
      return;
    }
    const addKnowledgeBtn = target.closest("[data-add-knowledge]");
    if (addKnowledgeBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (newKnowledgeButton) newKnowledgeButton.click();
      return;
    }
    const addTaskBtn = target.closest("[data-add-task]");
    if (addTaskBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (newTaskButton) newTaskButton.click();
      return;
    }

    const editPlannedDeal = target.closest("[data-edit-planned-deal]");
    if (editPlannedDeal) {
      event.preventDefault();
      event.stopPropagation();
      const dealId = editPlannedDeal.dataset.editPlannedDeal;
      const deal = (state.dashboard?.deals || []).find((d) => d.id === dealId);
      if (deal && deal.stage === "planned") {
        openApplicationDialog(deal.manager, deal.client, deal);
      } else if (deal) {
        window.alert("Редактирование доступно только для заявок на этапе «Плановая».");
      }
      return;
    }

    const editKnowledge = target.closest("[data-edit-knowledge]");
    if (editKnowledge) {
      event.preventDefault();
      event.stopPropagation();
      const entry = findKnowledgeProgram(editKnowledge.dataset.editKnowledge);
      if (entry) {
        openKnowledgeDialog(entry);
      }
      return;
    }

    const saveApplication = target.closest("[data-save-application]");
    if (saveApplication) {
      event.preventDefault();
      event.stopPropagation();
      await handleSaveApplication(saveApplication);
      return;
    }

    const addTaskFor = target.closest("[data-add-task-for]");
    if (addTaskFor) {
      event.preventDefault();
      event.stopPropagation();
      openTaskDialog({
        manager: addTaskFor.dataset.taskManager || "",
        client: addTaskFor.dataset.addTaskFor || ""
      });
      return;
    }

    const deleteTaskBtn = target.closest("[data-task-delete]");
    if (deleteTaskBtn) {
      event.preventDefault();
      event.stopPropagation();
      await handleDeleteTask(deleteTaskBtn.dataset.taskDelete);
      return;
    }

    const duePreset = target.closest("[data-due-preset]");
    if (duePreset) {
      event.preventDefault();
      applyDuePreset(duePreset.dataset.duePreset);
    }
  });
}

function bindDynamicControls() {
  initDynamicControls();
}

function fillDealFormOptions() {
  const programSelect = form.elements.knowledgeProgramId;
  const stageSelect = form.elements.stage;
  const clientOptions = document.querySelector("#clientOptions");
  const bankOptions = document.querySelector("#bankOptions");

  const managerOptions = state.managers
    .map((manager) => `<option value="${escapeHtml(manager.name)}">${escapeHtml(manager.name)}</option>`)
    .join("");
  const clientNames = [...new Set([...state.clients.map((client) => client.name), ...state.dashboard.deals.map((deal) => deal.client)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));
  const bankNames = [
    ...new Set([
      ...state.banks.map((bank) => bank.name),
      ...state.dashboard.deals.map((deal) => deal.bank),
      ...state.knowledge.map((entry) => entry.bank)
    ])
  ].sort((a, b) => a.localeCompare(b, "ru"));
  [form.elements.manager, clientForm.elements.manager].forEach((select) => {
    const selected = select.value;
    select.innerHTML = `<option value="">Выберите аналитика</option>${managerOptions || `<option value="" disabled>Сначала добавьте аналитика</option>`}`;
    if (selected && state.managers.some((manager) => manager.name === selected)) {
      select.value = selected;
    }
  });
  clientOptions.innerHTML = clientNames.map((client) => `<option value="${escapeHtml(client)}"></option>`).join("");
  bankOptions.innerHTML = bankNames.map((bank) => `<option value="${escapeHtml(bank)}"></option>`).join("");
  programSelect.innerHTML = renderApplicationProgramOptions();
  stageSelect.value = "planned";
  syncApplicationProgramFields();
  updateApplicationDateRequirements();
}

function findKnowledgeProgram(programId) {
  for (const bank of state.knowledge) {
    const program = (bank.programs || []).find((item) => item.id === programId);
    if (program) {
      return { bank, program };
    }
  }
  return null;
}

// Перестраивает <option> в селектах диалога БЗ из актуальных списков таксономии.
function rebuildKnowledgeTaxonomySelects() {
  const typeSelect = knowledgeForm?.elements?.programType;
  const categorySelect = knowledgeForm?.elements?.category;
  if (typeSelect) {
    const types = PROGRAM_TYPES_LIST();
    typeSelect.innerHTML = types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  }
  if (categorySelect) {
    const cats = PROGRAM_CATEGORIES_LIST();
    categorySelect.innerHTML = `<option value="">Без категории</option>`
      + cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }
}

function openKnowledgeDialog(entry = null) {
  fillDealFormOptions();
  knowledgeForm.reset();
  rebuildKnowledgeTaxonomySelects();
  knowledgeForm.elements.programId.value = entry?.program?.id || "";
  knowledgeForm.elements.bank.value = entry?.bank?.bank || "";
  knowledgeForm.elements.bankPhone.value = entry?.bank?.phone || entry?.program?.bankPhone || "";
  knowledgeForm.elements.program.value = entry?.program?.program || "";
  knowledgeForm.elements.programUrl.value = entry?.program?.programUrl || "";
  knowledgeForm.elements.amountRange.value = entry?.program?.amountRange || "";
  knowledgeForm.elements.termRange.value = entry?.program?.termRange || "";
  knowledgeForm.elements.reviewTermDeclared.value = entry?.program?.reviewTermDeclared || "";
  // Тип программы: если у программы значение из устаревшего/удалённого списка —
  // добавляем как option на лету, чтобы при сохранении оно не сменилось.
  const currentType = entry?.program?.programType || "";
  const typeList = PROGRAM_TYPES_LIST();
  const typeSel = knowledgeForm.elements.programType;
  if (currentType && !typeList.includes(currentType) && typeSel) {
    const opt = document.createElement("option");
    opt.value = currentType;
    opt.textContent = `${currentType} (нет в списке)`;
    typeSel.appendChild(opt);
  }
  typeSel.value = currentType || (typeList.includes("Стандарт") ? "Стандарт" : typeList[0] || "");

  const currentCat = entry?.program?.category || "";
  const catList = PROGRAM_CATEGORIES_LIST();
  const catSel = knowledgeForm.elements.category;
  if (currentCat && !catList.includes(currentCat) && catSel) {
    const opt = document.createElement("option");
    opt.value = currentCat;
    opt.textContent = `${currentCat} (нет в списке)`;
    catSel.appendChild(opt);
  }
  catSel.value = currentCat;

  const requirements = entry?.program?.requirements || {};
  Object.keys(REQUIREMENT_LABELS).forEach((key) => {
    knowledgeForm.elements[key].value = requirements[key] || "";
  });
  knowledgeForm.elements.notes.value = entry?.program?.notes || "";
  knowledgeForm.elements.changeHistory.value = entry?.program?.changeHistory || "";
  if (knowledgeForm.elements.changeNote) {
    knowledgeForm.elements.changeNote.value = "";
  }
  if (knowledgeDialogTitle) {
    knowledgeDialogTitle.textContent = entry ? "Редактировать программу" : "Новая запись";
  }
  knowledgeDialog.showModal();
}

function openApplicationDialog(manager, client, deal = null) {
  fillDealFormOptions();
  form.reset();
  setDealDialogLoading(false);
  const lockedManager = isPartner() ? partnerManagerName() : (deal?.manager || manager || "");
  form.elements.manager.value = lockedManager;
  form.elements.client.value = deal?.client || client || "";
  form.elements.managerLocked.value = lockedManager;
  form.elements.manager.disabled = true;
  form.elements.client.readOnly = Boolean(deal || client);
  form.elements.stage.value = deal?.stage || "planned";
  // Edit-mode: пробрасываем dealId через dataset формы, заполняем поля.
  if (deal) {
    form.dataset.dealId = deal.id;
    if (deal.knowledgeProgramId && form.elements.knowledgeProgramId) {
      form.elements.knowledgeProgramId.value = deal.knowledgeProgramId;
    }
    if (form.elements.amountRequested) form.elements.amountRequested.value = deal.amountRequested || "";
    if (form.elements.amountApproved) form.elements.amountApproved.value = deal.amountApproved || "";
    if (form.elements.comment) form.elements.comment.value = deal.comment || "";
    const title = dialog.querySelector("h2");
    if (title) title.textContent = "Редактирование заявки";
    const saveBtn = document.querySelector("#saveDealButton");
    if (saveBtn) saveBtn.textContent = "Сохранить изменения";
  } else {
    delete form.dataset.dealId;
    const title = dialog.querySelector("h2");
    if (title) title.textContent = "Новая заявка";
    const saveBtn = document.querySelector("#saveDealButton");
    if (saveBtn) saveBtn.textContent = "Сохранить заявку";
  }
  syncApplicationProgramFields();
  updateApplicationDateRequirements();
  dialog.showModal();
}

function openDealActionDialog(dealId) {
  dealActionForm.reset();
  dealActionForm.elements.dealId.value = dealId;
  dealActionForm.elements.actionAt.value = formatDateTimeInput(state.dashboard?.time?.iso || new Date().toISOString());
  dealActionDialog.showModal();
}

refreshButton.addEventListener("click", loadData);

const fullscreenButton = document.querySelector("#fullscreenButton");
if (fullscreenButton) {
  fullscreenButton.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {
        // тихий fail если браузер запретил
      });
    } else {
      document.exitFullscreen?.();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.textContent = document.fullscreenElement ? "⛶⃕" : "⛶";
  });
}

newManagerButton.addEventListener("click", () => {
  managerForm.reset();
  managerDialog.showModal();
});

form.elements.stage.addEventListener("change", updateApplicationDateRequirements);
form.elements.knowledgeProgramId.addEventListener("change", syncApplicationProgramFields);

if (newDealButton) {
  newDealButton.addEventListener("click", () => {
    fillDealFormOptions();
    form.reset();
    setDealDialogLoading(false);
    if (isPartner()) {
      const name = partnerManagerName();
      form.elements.manager.value = name;
      form.elements.managerLocked.value = name;
      form.elements.manager.disabled = true;
    } else {
      form.elements.manager.disabled = false;
      form.elements.managerLocked.value = "";
    }
    form.elements.client.readOnly = false;
    form.elements.stage.value = "planned";
    syncApplicationProgramFields();
    updateApplicationDateRequirements();
    dialog.showModal();
  });
}

newClientButton.addEventListener("click", () => {
  fillDealFormOptions();
  clientForm.reset();
  if (isPartner()) {
    const name = partnerManagerName();
    clientForm.elements.manager.value = name;
    clientForm.elements.manager.disabled = true;
  } else {
    clientForm.elements.manager.disabled = false;
  }
  clientDialog.showModal();
});

managerForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(managerForm);
  await requestJson("/api/managers", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData.entries()))
  });
  managerDialog.close();
  await loadData({ targets: ["managers"] });
});

newKnowledgeButton.addEventListener("click", () => {
  openKnowledgeDialog();
});

if (newTaskButton) {
  newTaskButton.addEventListener("click", () => {
    openTaskDialog();
  });
}

async function handleToggleTask(taskId, completed) {
  try {
    await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify({ completed })
    });
    await loadData({ targets: ["tasks"] });
  } catch (error) {
    window.alert(error.message);
    await loadData({ targets: ["tasks"] });
  }
}

async function handleDeleteTask(taskId) {
  if (!taskId) {
    return;
  }
  const confirmed = window.confirm("Удалить задачу?");
  if (!confirmed) {
    return;
  }
  try {
    await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
    await loadData({ targets: ["tasks"] });
  } catch (error) {
    window.alert(error.message);
  }
}

function formatDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function applyDuePreset(preset) {
  if (!taskForm) {
    return;
  }
  const input = taskForm.elements.dueAt;
  if (!input) {
    return;
  }
  const now = new Date();
  let target;
  if (preset === "tomorrow-10") {
    target = new Date(now);
    target.setDate(target.getDate() + 1);
    target.setHours(10, 0, 0, 0);
  } else {
    const hours = Number(preset) || 24;
    target = new Date(now.getTime() + hours * 60 * 60 * 1000);
    target.setSeconds(0, 0);
  }
  input.value = formatDateTimeLocal(target);
}

function fillTaskDialogOptions(preselectManager) {
  const managerSelect = document.querySelector("#taskManager");
  const clientSelect = document.querySelector("#taskClient");
  if (!managerSelect || !clientSelect) {
    return;
  }
  const managerNames = [...new Set([
    ...state.managers.map((manager) => manager.name),
    ...state.clients.map((client) => client.manager).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b, "ru"));
  managerSelect.innerHTML = `<option value="" disabled selected>Выберите аналитика</option>${managerNames
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  if (preselectManager && managerNames.includes(preselectManager)) {
    managerSelect.value = preselectManager;
  }
  refreshTaskClientOptions();
}

function refreshTaskClientOptions(preselectClient = null) {
  const managerSelect = document.querySelector("#taskManager");
  const clientSelect = document.querySelector("#taskClient");
  if (!managerSelect || !clientSelect) {
    return;
  }
  const manager = managerSelect.value;
  const clientNames = [...new Set(
    state.clients.filter((c) => !manager || c.manager === manager).map((c) => c.name)
  )].sort((a, b) => a.localeCompare(b, "ru"));
  clientSelect.innerHTML = `<option value="" disabled selected>Выберите клиента</option>${clientNames
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  if (preselectClient && clientNames.includes(preselectClient)) {
    clientSelect.value = preselectClient;
  }
}

function openTaskDialog({ manager = "", client = "" } = {}) {
  if (!taskDialog || !taskForm) {
    return;
  }
  taskForm.reset();
  const presetManager = isPartner() ? partnerManagerName() : manager;
  fillTaskDialogOptions(presetManager);
  const managerSelect = document.querySelector("#taskManager");
  if (managerSelect) {
    managerSelect.disabled = isPartner();
  }
  if (client) {
    refreshTaskClientOptions(client);
  }
  applyDuePreset("24");
  taskDialog.showModal();
}

if (taskForm) {
  document.querySelector("#taskManager")?.addEventListener("change", () => refreshTaskClientOptions());
  taskForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") {
      return;
    }
    event.preventDefault();
    if (!taskForm.reportValidity()) {
      return;
    }
    const payload = Object.fromEntries(new FormData(taskForm).entries());
    if (isPartner()) {
      payload.manager = partnerManagerName();
    }
    try {
      await requestJson("/api/tasks", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      taskDialog.close();
      await loadData({ targets: ["tasks"] });
    } catch (error) {
      window.alert(error.message);
    }
  });
}

form.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  syncApplicationProgramFields();
  updateApplicationDateRequirements();
  if (!form.reportValidity()) {
    return;
  }

  const formData = new FormData(form);
  if (form.elements.manager.disabled) {
    formData.set("manager", form.elements.managerLocked.value);
  }
  formData.delete("managerLocked");
  const uiSnapshot = captureUiState();
  setDealDialogLoading(true);

  try {
    const editId = form.dataset.dealId || "";
    const payload = Object.fromEntries(formData.entries());
    let deal;
    if (editId) {
      // Редактирование существующей заявки.
      ({ deal } = await requestJson(`/api/deals/${encodeURIComponent(editId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }));
    } else {
      ({ deal } = await requestJson("/api/deals", {
        method: "POST",
        body: JSON.stringify(payload)
      }));
    }
    try {
      await refreshDashboard({ restoreUi: preserveClientOpenState(uiSnapshot, deal) });
    } finally {
      dialog.close();
      delete form.dataset.dealId;
    }
  } catch (error) {
    window.alert(error.message);
  } finally {
    setDealDialogLoading(false);
  }
});

clientForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(clientForm);
  const payload = Object.fromEntries(formData.entries());
  if (isPartner()) {
    payload.manager = partnerManagerName();
  }
  await requestJson("/api/clients", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  clientDialog.close();
  await loadData({ targets: ["clients"] });
});

dealActionForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(dealActionForm);
  const dealId = formData.get("dealId");
  await requestJson(`/api/deals/${encodeURIComponent(dealId)}/actions`, {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData.entries()))
  });
  dealActionDialog.close();
  await refreshDashboard();
});

function buildChangeHistoryWithNote(existing, note) {
  const cleanNote = String(note || "").trim();
  const previous = String(existing || "").trim();
  if (!cleanNote) {
    return previous;
  }
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const newLine = `[${stamp}] ${cleanNote}`;
  return previous ? `${newLine}\n${previous}` : newLine;
}

knowledgeForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(knowledgeForm);
  const payload = Object.fromEntries(formData.entries());
  const programId = payload.programId;
  delete payload.programId;
  const note = payload.changeNote;
  delete payload.changeNote;
  payload.changeHistory = buildChangeHistoryWithNote(payload.changeHistory, note);
  await requestJson(programId ? `/api/knowledge/programs/${encodeURIComponent(programId)}` : "/api/knowledge", {
    method: programId ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
  knowledgeDialog.close();
  state.view = "knowledge";
  await loadData({ targets: ["knowledge"] });
});

// ===== Users management =====

function openUserDialog(entry) {
  if (!userDialog || !userForm) {
    return;
  }
  userForm.reset();
  if (userFormError) {
    userFormError.hidden = true;
    userFormError.textContent = "";
  }
  if (userDialogTitle) {
    userDialogTitle.textContent = entry ? "Редактировать пользователя" : "Новый пользователь";
  }
  userForm.elements.userId.value = entry?.id || "";
  if (userLoginField) {
    userLoginField.value = entry?.login || "";
    userLoginField.readOnly = Boolean(entry);
  }
  userForm.elements.fullName.value = entry?.fullName || "";
  userForm.elements.role.value = entry?.role || "partner";
  userForm.elements.password.value = "";
  userForm.elements.password.required = !entry;
  if (userForm.elements.telegramChatId) {
    userForm.elements.telegramChatId.value = entry?.telegramChatId || "";
  }
  if (userPasswordHint) {
    userPasswordHint.textContent = entry
      ? "(оставьте пустым, чтобы не менять)"
      : "";
  }
  userDialog.showModal();
}

async function handleDeleteUser(button) {
  const userId = button.dataset.deleteUser;
  if (!userId) return;
  const name = button.dataset.userName || "пользователя";
  if (!window.confirm(`Удалить пользователя "${name}" безвозвратно?`)) return;
  try {
    await requestJson(`/api/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    await loadData({ targets: ["users"] });
  } catch (error) {
    window.alert(error.message);
  }
}

// ==== Taxonomy (типы программ / категории программ) ====

function taxonomyKindToTarget(kind) {
  return kind === "program-type" ? "programTypes" : "programCategories";
}

function taxonomyKindToUrl(kind) {
  return kind === "program-type" ? "/api/program-types" : "/api/program-categories";
}

async function handleAddTaxonomy(kind, name) {
  try {
    await requestJson(taxonomyKindToUrl(kind), {
      method: "POST",
      body: JSON.stringify({ name })
    });
    await loadData({ targets: [taxonomyKindToTarget(kind)] });
    render();
    showToast("Добавлено", { type: "success" });
  } catch (error) {
    window.alert(error.message);
  }
}

async function handleEditTaxonomy(button) {
  const kind = button.dataset.editTaxonomy;
  const id = button.dataset.id;
  const row = button.closest(".taxonomy-row");
  const currentName = row?.querySelector("[data-taxonomy-name]")?.textContent || "";
  const next = window.prompt("Новое значение:", currentName);
  if (next === null) return;
  const trimmed = String(next).trim();
  if (!trimmed) return;
  if (trimmed === currentName) return;
  try {
    await requestJson(`${taxonomyKindToUrl(kind)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: trimmed })
    });
    await loadData({ targets: [taxonomyKindToTarget(kind)] });
    render();
    showToast("Изменено", { type: "success" });
  } catch (error) {
    window.alert(error.message);
  }
}

async function handleDeleteTaxonomy(button) {
  const kind = button.dataset.deleteTaxonomy;
  const id = button.dataset.id;
  const name = button.dataset.name || "значение";
  if (!window.confirm(`Удалить «${name}»? Программы с этим значением останутся, но в списке селекта его больше не будет.`)) return;
  try {
    await requestJson(`${taxonomyKindToUrl(kind)}/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadData({ targets: [taxonomyKindToTarget(kind)] });
    render();
    showToast("Удалено", { type: "info" });
  } catch (error) {
    window.alert(error.message);
  }
}

async function handleLinkManagerToUser(button) {
  const managerId = button.dataset.linkManager;
  const managerName = button.dataset.managerName || "";
  if (!managerId) return;
  // Подгружаем актуальный список пользователей если их нет
  if (!Array.isArray(state.users) || !state.users.length) {
    try {
      await loadData({ targets: ["users"] });
    } catch (error) {
      window.alert("Не удалось загрузить список пользователей: " + error.message);
      return;
    }
  }
  const candidates = (state.users || []).filter((u) => u.role === "analyst_abram" || u.role === "partner" || u.role === "admin");
  if (!candidates.length) {
    window.alert("Нет учёток, к которым можно привязать. Создайте аналитика или партнёра.");
    return;
  }
  const list = candidates
    .map((u, i) => `${i + 1}. ${u.fullName || u.login} (${u.login}) — ${ROLE_LABELS[u.role] || u.role}`)
    .join("\n");
  const answer = window.prompt(
    `Привязать аналитика «${managerName}» к учётке.\n\nВведите логин или номер из списка:\n\n${list}`,
    ""
  );
  if (!answer) return;
  const trimmed = answer.trim();
  let chosen = null;
  // Сначала пробуем как номер.
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= candidates.length) {
    chosen = candidates[asNumber - 1];
  } else {
    const lower = trimmed.toLowerCase();
    chosen = candidates.find((u) => String(u.login || "").toLowerCase() === lower)
      || candidates.find((u) => String(u.fullName || "").toLowerCase() === lower);
  }
  if (!chosen) {
    window.alert(`Учётка «${trimmed}» не найдена среди аналитиков и партнёров.`);
    return;
  }
  try {
    await requestJson(`/api/managers/${encodeURIComponent(managerId)}`, {
      method: "PATCH",
      body: JSON.stringify({ userId: chosen.id })
    });
    showToast(`Привязано: ${managerName} → ${chosen.login}`, { type: "success" });
    await loadData({ targets: ["managers"] });
  } catch (error) {
    window.alert(error.message);
  }
}

async function handleConnectGoogle() {
  try {
    const res = await requestJson("/api/integrations/google/auth-url");
    if (res?.url) {
      window.location.href = res.url;
    } else {
      window.alert("Не удалось получить ссылку авторизации");
    }
  } catch (error) {
    window.alert(error.message);
  }
}

async function handleDisconnectGoogle() {
  if (!window.confirm("Отключить Google Drive? Прикреплённые файлы на самом Диске не удалятся.")) {
    return;
  }
  try {
    await requestJson("/api/integrations/google", { method: "DELETE" });
    showToast("Google Drive отключён", { type: "info" });
    await loadData({ targets: ["integrations"] });
    render();
  } catch (error) {
    window.alert(error.message);
  }
}

async function handleUploadAttachment(input) {
  const reqId = input.dataset.uploadAttachment;
  if (!reqId || !input.files?.length) return;
  const files = [...input.files];
  input.value = ""; // сбрасываем, чтобы можно было повторно выбрать те же файлы
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  showToast(`Загружаем ${files.length} ${files.length === 1 ? "файл" : "файлов"} на Drive…`, { type: "info" });
  try {
    const res = await fetch(`/api/document-requests/${encodeURIComponent(reqId)}/attachments`, {
      method: "POST",
      credentials: "same-origin",
      body: formData
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const result = await res.json();
    const uploadedCount = result.uploaded?.length || 0;
    const errorCount = result.errors?.length || 0;
    if (uploadedCount > 0) {
      showToast(`Загружено: ${uploadedCount}${errorCount ? ` · ошибок: ${errorCount}` : ""}`, { type: "success" });
    }
    if (errorCount > 0) {
      const list = result.errors.map((e) => `${e.fileName}: ${e.error}`).join("\n");
      window.alert(`Ошибки при загрузке:\n\n${list}`);
    }
    await loadData({ targets: ["documentRequests"] });
    render();
  } catch (error) {
    window.alert(`Не удалось загрузить: ${error.message}`);
  }
}

async function handleResendDocRequests(button) {
  if (!window.confirm("Переотправить уведомления по всем активным запросам? Аналитики получат повторные сообщения в Telegram.")) return;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Отправляем…";
  try {
    const res = await requestJson("/api/document-requests/resend", { method: "POST" });
    const parts = [];
    if (res?.open) parts.push(`open: ${res.open}`);
    if (res?.fulfilled) parts.push(`fulfilled: ${res.fulfilled}`);
    if (res?.errors) parts.push(`ошибок: ${res.errors}`);
    const msg = parts.length ? parts.join(" · ") : "Активных запросов нет";
    showToast(`Переотправлено: ${msg}`, { type: res?.errors ? "error" : "success" });
  } catch (error) {
    window.alert(`Не удалось переотправить: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handleDeleteAttachment(button) {
  const reqId = button.dataset.deleteAttachment;
  const attId = button.dataset.attachmentId;
  if (!reqId || !attId) return;
  if (!window.confirm("Удалить файл? Он будет удалён и с Google Drive.")) return;
  try {
    await requestJson(`/api/document-requests/${encodeURIComponent(reqId)}/attachments/${encodeURIComponent(attId)}`, { method: "DELETE" });
    showToast("Файл удалён", { type: "info" });
    await loadData({ targets: ["documentRequests"] });
    render();
  } catch (error) {
    window.alert(error.message);
  }
}

async function handleUnlinkManagerFromUser(button) {
  const managerId = button.dataset.unlinkManager;
  if (!managerId) return;
  if (!window.confirm("Отвязать аналитика от учётки?")) return;
  try {
    await requestJson(`/api/managers/${encodeURIComponent(managerId)}`, {
      method: "PATCH",
      body: JSON.stringify({ userId: "" })
    });
    showToast("Привязка снята", { type: "info" });
    await loadData({ targets: ["managers"] });
  } catch (error) {
    window.alert(error.message);
  }
}

if (userForm) {
  userForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") {
      return;
    }
    event.preventDefault();
    if (!userForm.reportValidity()) {
      return;
    }
    const formData = new FormData(userForm);
    const payload = Object.fromEntries(formData.entries());
    const userId = payload.userId;
    delete payload.userId;
    if (!payload.password) {
      delete payload.password;
    }
    if (userId) {
      delete payload.login; // не позволяем менять login
    }
    if (userFormError) {
      userFormError.hidden = true;
      userFormError.textContent = "";
    }
    try {
      await requestJson(
        userId ? `/api/users/${encodeURIComponent(userId)}` : "/api/users",
        { method: userId ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );
      userDialog.close();
      await loadData({ targets: ["users"] });
    } catch (error) {
      if (userFormError) {
        userFormError.hidden = false;
        userFormError.textContent = error.message || "Не удалось сохранить";
      }
    }
  });
}

// ===== Document request dialog & handlers =====

function openDocumentRequestDialog({ clientName, manager }) {
  if (!documentRequestDialog || !documentRequestForm) {
    return;
  }
  documentRequestForm.reset();
  if (documentRequestError) {
    documentRequestError.hidden = true;
    documentRequestError.textContent = "";
  }
  const targetManager = compareKey(manager);
  const targetClient = compareKey(clientName);
  const deals = (state.dashboard?.deals || []).filter((deal) =>
    compareKey(deal.manager) === targetManager &&
    compareKey(deal.client) === targetClient &&
    (deal.stage === "planned" || deal.statusGroup === "current")
  );
  if (!documentRequestDealSelect) return;
  if (!deals.length) {
    documentRequestDealSelect.innerHTML = `<option value="" disabled selected>Нет активных заявок</option>`;
  } else {
    documentRequestDealSelect.innerHTML = deals
      .map((deal) => `<option value="${escapeHtml(deal.id)}">${escapeHtml(deal.bank || "")} · ${escapeHtml(deal.program || "")} (${escapeHtml(deal.stageLabel)})</option>`)
      .join("");
  }
  documentRequestDialog.showModal();
}

async function handleFulfillDocumentRequest(button) {
  const reqId = button.dataset.fulfillDocRequest;
  if (!reqId) return;
  if (!window.confirm("Подтвердить, что документы загружены?")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/document-requests/${encodeURIComponent(reqId)}/fulfill`, { method: "PATCH" });
    await loadData({ targets: ["documentRequests"] });
    showToast("Запрос закрыт. Аналитик увидит «Документы загружены».", { type: "success" });
  } catch (error) {
    showToast(error.message || "Не удалось закрыть запрос", { type: "error" });
  } finally {
    button.disabled = false;
  }
}

async function handleDeleteDocumentRequest(button) {
  const reqId = button.dataset.deleteDocRequest;
  if (!reqId) return;
  if (!window.confirm("Удалить запрос документов?")) return;
  try {
    await requestJson(`/api/document-requests/${encodeURIComponent(reqId)}`, { method: "DELETE" });
    await loadData({ targets: ["documentRequests"] });
  } catch (error) {
    showToast(error.message || "Не удалось удалить запрос", { type: "error" });
  }
}

async function handleConfirmDocumentRequest(button) {
  const reqId = button.dataset.confirmDocRequest;
  if (!reqId) return;
  if (!window.confirm("Подтвердить, что документы получены?")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/document-requests/${encodeURIComponent(reqId)}/confirm`, { method: "PATCH" });
    await loadData({ targets: ["documentRequests"] });
    showToast("Спасибо! Запрос закрыт.", { type: "success" });
  } catch (error) {
    showToast(error.message || "Не удалось подтвердить", { type: "error" });
  } finally {
    button.disabled = false;
  }
}

if (documentRequestForm) {
  documentRequestForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") {
      return;
    }
    event.preventDefault();
    if (!documentRequestForm.reportValidity()) {
      return;
    }
    const payload = Object.fromEntries(new FormData(documentRequestForm).entries());
    try {
      await requestJson("/api/document-requests", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      documentRequestDialog.close();
      await loadData({ targets: ["documentRequests"] });
      showToast("Запрос отправлен", { type: "success" });
    } catch (error) {
      if (documentRequestError) {
        documentRequestError.hidden = false;
        documentRequestError.textContent = error.message || "Не удалось отправить запрос";
      }
    }
  });
}

// ===== Auth bootstrap =====

function showLoginScreen({ focus = true } = {}) {
  if (loginShell) {
    loginShell.classList.add("is-visible");
    loginShell.removeAttribute("hidden");
  }
  if (loginError) {
    loginError.hidden = true;
    loginError.textContent = "";
  }
  if (loginForm) {
    loginForm.reset();
    if (focus) {
      const loginInput = loginForm.elements.login;
      loginInput?.focus?.();
    }
  }
}

function showAppShell() {
  if (loginShell) {
    loginShell.classList.remove("is-visible");
    loginShell.removeAttribute("hidden");
  }
  if (appShell) appShell.removeAttribute("hidden");
}

function applyUserToBadge(user) {
  if (!userBadge || !userBadgeName || !userBadgeRole) {
    return;
  }
  if (!user) {
    userBadge.hidden = true;
    userBadgeName.textContent = "";
    userBadgeRole.textContent = "";
    if (logoutButton) logoutButton.hidden = true;
    return;
  }
  userBadge.hidden = false;
  userBadgeName.textContent = user.fullName || user.login;
  userBadgeRole.textContent = ROLE_LABELS[user.role] || user.role;
  if (logoutButton) logoutButton.hidden = false;
}

function handleSessionExpired() {
  storeToken("");
  state.user = null;
  applyUserToBadge(null);
  showLoginScreen();
}

async function fetchCurrentUser() {
  try {
    const { user } = await requestJson("/api/auth/me");
    return user || null;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return null;
    }
    throw error;
  }
}

function pickInitialView() {
  if (isDocumentsOfficer()) {
    state.view = "document-requests";
    return;
  }
  const allowed = visibleViews();
  if (!allowed.some((view) => view.id === state.view)) {
    state.view = allowed[0]?.id || "summary";
  }
}

async function startApplication() {
  const user = await fetchCurrentUser();
  if (!user) {
    state.user = null;
    applyUserToBadge(null);
    showLoginScreen();
    return;
  }
  state.user = user;
  applyUserToBadge(user);
  pickInitialView();
  showAppShell();
  try {
    await loadData();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return;
    }
    app.innerHTML = `<div class="empty">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
  }
  // Если вернулись с Google OAuth callback — показать toast и почистить URL.
  try {
    const sp = new URLSearchParams(window.location.search);
    const integ = sp.get("integration");
    if (integ === "connected") {
      const email = sp.get("email") || "";
      showToast(`Google Drive подключён${email ? ` — ${email}` : ""}`, { type: "success" });
      sp.delete("integration"); sp.delete("email");
      const newSearch = sp.toString();
      window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
      if (isAdmin()) {
        state.view = "integrations";
        await loadData({ targets: ["integrations"] });
        render();
      }
    } else if (integ === "error") {
      const reason = sp.get("reason") || "";
      showToast(`Не удалось подключить Drive${reason ? `: ${reason}` : ""}`, { type: "error" });
      sp.delete("integration"); sp.delete("reason");
      const newSearch = sp.toString();
      window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
    }
  } catch {
    // не критично
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginSubmit) loginSubmit.disabled = true;
    if (loginError) {
      loginError.hidden = true;
      loginError.textContent = "";
    }
    const formData = new FormData(loginForm);
    const payload = {
      login: String(formData.get("login") || "").trim(),
      password: String(formData.get("password") || "")
    };
    try {
      const { user } = await requestJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.user = user;
      applyUserToBadge(user);
      pickInitialView();
      showAppShell();
      await loadData();
    } catch (error) {
      if (loginError) {
        loginError.hidden = false;
        loginError.textContent = error.message || "Ошибка входа";
      }
    } finally {
      if (loginSubmit) loginSubmit.disabled = false;
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore — даже если бэк ругнулся, локально разлогиниваемся
    } finally {
      logoutButton.disabled = false;
    }
    storeToken("");
    state.user = null;
    applyUserToBadge(null);
    state.dashboard = null;
    state.banks = [];
    state.clients = [];
    state.managers = [];
    state.knowledge = [];
    state.tasks = [];
    showLoginScreen();
  });
}

startApplication().catch((error) => {
  console.error("Bootstrap failed", error);
  app.innerHTML = `<div class="empty">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
});

// Refresh after long inactivity when user returns to the tab.
let lastVisibilityRefreshAt = Date.now();
const VISIBILITY_REFRESH_THROTTLE_MS = 30_000;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    return;
  }
  const now = Date.now();
  if (now - lastVisibilityRefreshAt < VISIBILITY_REFRESH_THROTTLE_MS) {
    return;
  }
  lastVisibilityRefreshAt = now;
  loadData({ targets: ["dashboard", "tasks"] }).catch(() => {
    // ignore — main app still usable; next manual ↻ will retry
  });
});
