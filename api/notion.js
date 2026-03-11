// /pages/api/notion.js (또는 /api/notion.js) 전체 수정본

const TASK_SCHEMA_CACHE_MS = 60 * 1000;
const taskSchemaCache = new Map();
const projectSchemaCache = new Map();

const TASK_PROP_PRESETS = {
  title: {
    env: 'NOTION_TASK_TITLE_PROP',
    types: ['title'],
    names: ['할 일', '이름', 'Name', '제목', 'Task'],
  },
  date: {
    env: 'NOTION_TASK_DATE_PROP',
    types: ['date'],
    names: ['날짜', '진행할 날짜', '일자', 'Date', '시작/마감'],
  },
  focus: {
    env: 'NOTION_TASK_FOCUS_PROP',
    types: ['checkbox'],
    names: ['오늘', '포커스', '집중', 'Focus', 'Today Focus'],
  },
  done: {
    env: 'NOTION_TASK_DONE_PROP',
    types: ['checkbox'],
    names: ['완료', 'Done', '체크'],
  },
  status: {
    env: 'NOTION_TASK_STATUS_PROP',
    types: ['status', 'select'],
    names: ['상태', 'Status', '진행 상태'],
  },
  priority: {
    env: 'NOTION_TASK_PRIORITY_PROP',
    types: ['select', 'status'],
    names: ['중요도', '우선순위', 'Priority'],
  },
  project: {
    env: 'NOTION_TASK_PROJECT_PROP',
    types: ['relation', 'select', 'multi_select', 'rich_text'],
    names: ['프로젝트 DB', '프로젝트', 'Project'],
  },
};

const DONE_STATUS_CANDIDATES = ['완료', '완료됨', 'done', 'complete', 'completed'];
const OPEN_STATUS_CANDIDATES = ['진행 중', '진행중', '할 일', '해야 할 일', 'to do', 'todo', '시작 전', 'not started', '대기'];
const DEFAULT_PRIORITY_CANDIDATES = ['중간', '보통', 'medium', '중'];
const TASK_REQUIRED_ENV_MAP = {
  title: 'NOTION_TASK_TITLE_PROP',
  date: 'NOTION_TASK_DATE_PROP',
};

const PROJECT_PROP_PRESETS = {
  title: {
    env: 'NOTION_PROJECT_TITLE_PROP',
    types: ['title'],
    names: ['프로젝트', '프로젝트명', 'Name', '제목', 'Project'],
  },
  status: {
    env: 'NOTION_PROJECT_STATUS_PROP',
    types: ['status', 'select'],
    names: ['상태', '진행 상태', 'Status'],
  },
  startDate: {
    env: 'NOTION_PROJECT_START_PROP',
    types: ['date'],
    names: ['시작', '시작일', '착수일', 'Start'],
  },
  endDate: {
    env: 'NOTION_PROJECT_END_PROP',
    types: ['date'],
    names: ['마감', '마감일', '종료일', 'End'],
  },
  client: {
    env: 'NOTION_PROJECT_CLIENT_PROP',
    types: ['rich_text', 'select', 'relation', 'title'],
    names: ['클라이언트', '고객', 'Client'],
  },
  priority: {
    env: 'NOTION_PROJECT_PRIORITY_PROP',
    types: ['select', 'status'],
    names: ['중요도', '우선순위', 'Priority'],
  },
};

const isValidNotionId = (id) =>
  typeof id === 'string' &&
  /^[0-9a-fA-F-]{32,36}$/.test(id) &&
  id.replace(/-/g, '').length === 32;

const normalizeISODate = (value) => (value ? String(value).split('T')[0] : null);

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

const getTitleText = (props) => {
  if (!props) return '일정';
  const key = Object.keys(props).find((propName) => props[propName]?.type === 'title');
  const prop = key ? props[key] : null;
  return prop?.title?.map((entry) => entry?.plain_text || '').join('') || '일정';
};

const getRichTextValue = (entries = []) =>
  entries.map((entry) => entry?.plain_text || '').join('').trim();

const getSelectOptions = (property = {}) => {
  if (property.type === 'select') return property.select?.options || [];
  if (property.type === 'status') return property.status?.options || [];
  return [];
};

const getDatabaseTitle = (database) =>
  (database?.title || []).map((entry) => entry?.plain_text || '').join('').trim() || '업무 DB';

function findPropertyByPreset(properties, preset) {
  if (!properties || !preset) return null;

  const envName = process.env[preset.env];
  if (envName && properties[envName]) {
    return { name: envName, definition: properties[envName] };
  }

  for (const candidate of preset.names) {
    if (properties[candidate]) {
      return { name: candidate, definition: properties[candidate] };
    }
  }

  const normalizedCandidates = new Set(preset.names.map(normalizeKey));
  for (const [name, definition] of Object.entries(properties)) {
    if (!preset.types.includes(definition?.type)) continue;
    if (normalizedCandidates.has(normalizeKey(name))) {
      return { name, definition };
    }
  }

  for (const [name, definition] of Object.entries(properties)) {
    if (preset.types.includes(definition?.type)) {
      return { name, definition };
    }
  }

  return null;
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getTaskSchemaSettings() {
  return {
    strict: isTruthyEnv(process.env.NOTION_TASK_STRICT_SCHEMA),
    names: {
      title: process.env.NOTION_TASK_TITLE_PROP || '',
      date: process.env.NOTION_TASK_DATE_PROP || '',
      focus: process.env.NOTION_TASK_FOCUS_PROP || '',
      done: process.env.NOTION_TASK_DONE_PROP || '',
      status: process.env.NOTION_TASK_STATUS_PROP || '',
      priority: process.env.NOTION_TASK_PRIORITY_PROP || '',
      project: process.env.NOTION_TASK_PROJECT_PROP || '',
    },
  };
}

function getProjectSchemaSettings() {
  return {
    strict: isTruthyEnv(process.env.NOTION_PROJECT_STRICT_SCHEMA),
    names: {
      title: process.env.NOTION_PROJECT_TITLE_PROP || '',
      status: process.env.NOTION_PROJECT_STATUS_PROP || '',
      startDate: process.env.NOTION_PROJECT_START_PROP || '',
      endDate: process.env.NOTION_PROJECT_END_PROP || '',
      client: process.env.NOTION_PROJECT_CLIENT_PROP || '',
      priority: process.env.NOTION_PROJECT_PRIORITY_PROP || '',
    },
  };
}

function getConfiguredProperty(properties, envName, label) {
  const configuredName = process.env[envName];
  if (!configuredName) return null;
  if (!properties?.[configuredName]) {
    throw new Error(`${envName}="${configuredName}" 속성을 Notion DB에서 찾을 수 없습니다.`);
  }
  return { name: configuredName, definition: properties[configuredName] };
}

function findOptionByCandidates(options = [], candidates = []) {
  if (!options.length || !candidates.length) return null;
  const candidateSet = new Set(candidates.map(normalizeKey));
  return options.find((option) => candidateSet.has(normalizeKey(option?.name)));
}

function serializeSchemaProperty(property) {
  if (!property) return null;
  return {
    name: property.name,
    type: property.definition?.type || null,
    options: getSelectOptions(property.definition).map((option) => option.name),
  };
}

async function fetchDatabase(headers, databaseId) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: 'GET',
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `Fetch Database Failed (${databaseId})`);
  }
  return data;
}

async function queryAllFromNotionDB(headers, databaseId, bodyObj) {
  let results = [];
  let start_cursor = undefined;

  while (true) {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...bodyObj,
        start_cursor,
        page_size: 100,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || `Fetch Failed (db:${databaseId})`);
    }

    results = results.concat(data.results || []);
    if (!data.has_more) break;
    start_cursor = data.next_cursor;
  }

  return results;
}

async function getTaskSchema(headers, databaseId) {
  const cached = taskSchemaCache.get(databaseId);
  if (cached && Date.now() - cached.fetchedAt < TASK_SCHEMA_CACHE_MS) {
    return cached.value;
  }

  const database = await fetchDatabase(headers, databaseId);
  const properties = database?.properties || {};
  const settings = getTaskSchemaSettings();
  const mapped = {};

  for (const [key, preset] of Object.entries(TASK_PROP_PRESETS)) {
    const configured = getConfiguredProperty(properties, preset.env, key);
    if (configured) {
      mapped[key] = configured;
      continue;
    }
    if (settings.strict) {
      mapped[key] = null;
      continue;
    }
    mapped[key] = findPropertyByPreset(properties, preset);
  }

  for (const [key, envName] of Object.entries(TASK_REQUIRED_ENV_MAP)) {
    if (settings.strict && !settings.names[key]) {
      throw new Error(`${envName} 값을 설정해야 고정 매핑을 사용할 수 있습니다.`);
    }
  }

  if (settings.strict && !settings.names.done && !settings.names.status) {
    throw new Error('고정 매핑 사용 시 NOTION_TASK_DONE_PROP 또는 NOTION_TASK_STATUS_PROP 중 하나는 설정해야 합니다.');
  }

  if (!mapped.title) {
    throw new Error('할 일 제목 속성을 찾지 못했습니다. NOTION_TASK_TITLE_PROP를 확인해주세요.');
  }
  if (!mapped.date) {
    throw new Error('할 일 날짜 속성을 찾지 못했습니다. NOTION_TASK_DATE_PROP를 확인해주세요.');
  }
  if (!mapped.done && !mapped.status) {
    throw new Error('완료 판단용 속성을 찾지 못했습니다. NOTION_TASK_DONE_PROP 또는 NOTION_TASK_STATUS_PROP를 확인해주세요.');
  }

  const statusOptions = getSelectOptions(mapped.status?.definition);
  const priorityOptions = getSelectOptions(mapped.priority?.definition);
  const doneStatusOption =
    findOptionByCandidates(statusOptions, [process.env.NOTION_TASK_DONE_STATUS || '', ...DONE_STATUS_CANDIDATES]) ||
    null;
  const openStatusOption =
    findOptionByCandidates(statusOptions, [process.env.NOTION_TASK_DEFAULT_STATUS || '', ...OPEN_STATUS_CANDIDATES]) ||
    statusOptions.find((option) => option?.name && option.name !== doneStatusOption?.name) ||
    null;
  const defaultPriorityOption =
    findOptionByCandidates(priorityOptions, [process.env.NOTION_TASK_DEFAULT_PRIORITY || '', ...DEFAULT_PRIORITY_CANDIDATES]) ||
    priorityOptions[0] ||
    null;

  const schema = {
    databaseTitle: getDatabaseTitle(database),
    properties: {
      title: serializeSchemaProperty(mapped.title),
      date: serializeSchemaProperty(mapped.date),
      focus: serializeSchemaProperty(mapped.focus),
      done: serializeSchemaProperty(mapped.done),
      status: serializeSchemaProperty(mapped.status),
      priority: serializeSchemaProperty(mapped.priority),
      project: serializeSchemaProperty(mapped.project),
    },
    defaults: {
      status: openStatusOption?.name || null,
      doneStatus: doneStatusOption?.name || null,
      priority: defaultPriorityOption?.name || null,
    },
    mapped,
  };

  taskSchemaCache.set(databaseId, { fetchedAt: Date.now(), value: schema });
  return schema;
}

async function getProjectSchema(headers, databaseId) {
  const cached = projectSchemaCache.get(databaseId);
  if (cached && Date.now() - cached.fetchedAt < TASK_SCHEMA_CACHE_MS) {
    return cached.value;
  }

  const database = await fetchDatabase(headers, databaseId);
  const properties = database?.properties || {};
  const settings = getProjectSchemaSettings();
  const mapped = {};

  for (const [key, preset] of Object.entries(PROJECT_PROP_PRESETS)) {
    const configured = getConfiguredProperty(properties, preset.env, key);
    if (configured) {
      mapped[key] = configured;
      continue;
    }
    if (settings.strict) {
      mapped[key] = null;
      continue;
    }
    mapped[key] = findPropertyByPreset(properties, preset);
  }

  if (settings.strict && !settings.names.title) {
    throw new Error('NOTION_PROJECT_TITLE_PROP 값을 설정해야 프로젝트 고정 매핑을 사용할 수 있습니다.');
  }
  if (!mapped.title) {
    throw new Error('프로젝트 제목 속성을 찾지 못했습니다. NOTION_PROJECT_TITLE_PROP를 확인해주세요.');
  }

  const schema = {
    databaseTitle: getDatabaseTitle(database),
    properties: {
      title: serializeSchemaProperty(mapped.title),
      status: serializeSchemaProperty(mapped.status),
      startDate: serializeSchemaProperty(mapped.startDate),
      endDate: serializeSchemaProperty(mapped.endDate),
      client: serializeSchemaProperty(mapped.client),
      priority: serializeSchemaProperty(mapped.priority),
    },
    mapped,
  };

  projectSchemaCache.set(databaseId, { fetchedAt: Date.now(), value: schema });
  return schema;
}

function getPropertyDisplayValue(property) {
  if (!property) return null;
  switch (property.type) {
    case 'title':
      return getRichTextValue(property.title);
    case 'rich_text':
      return getRichTextValue(property.rich_text);
    case 'select':
      return property.select?.name || null;
    case 'status':
      return property.status?.name || null;
    case 'multi_select':
      return (property.multi_select || []).map((item) => item?.name).filter(Boolean).join(', ') || null;
    case 'relation':
      return property.relation?.length ? `연결 ${property.relation.length}건` : null;
    case 'date':
      return normalizeISODate(property.date?.start);
    case 'checkbox':
      return !!property.checkbox;
    default:
      return null;
  }
}

function getTaskDoneValue(pageProperties, taskSchema) {
  const donePropName = taskSchema.properties.done?.name;
  if (donePropName && pageProperties?.[donePropName]?.type === 'checkbox') {
    return !!pageProperties[donePropName]?.checkbox;
  }

  const statusPropName = taskSchema.properties.status?.name;
  if (statusPropName) {
    const statusValue = getPropertyDisplayValue(pageProperties?.[statusPropName]);
    if (!statusValue) return false;
    const normalized = normalizeKey(statusValue);
    if (normalizeKey(taskSchema.defaults.doneStatus) === normalized) return true;
    return DONE_STATUS_CANDIDATES.map(normalizeKey).includes(normalized);
  }

  return false;
}

function getRelationIds(property) {
  if (property?.type !== 'relation') return [];
  return (property.relation || []).map((item) => item?.id).filter(Boolean);
}

function getProjectFieldValue(property, projectMap) {
  if (!property) return { label: null, ids: [] };
  if (property.type === 'relation') {
    const ids = getRelationIds(property);
    const labels = ids.map((id) => projectMap.get(id)?.title).filter(Boolean);
    return {
      label: labels.join(', ') || (ids.length ? `연결 ${ids.length}건` : null),
      ids,
    };
  }
  return {
    label: getPropertyDisplayValue(property),
    ids: [],
  };
}

function buildTitleProperty(name, value) {
  return {
    [name]: {
      title: [{ text: { content: String(value || '').trim() } }],
    },
  };
}

function buildSelectLikeProperty(definition, name, value) {
  if (!definition || !name || !value) return null;
  if (definition.type === 'status') return { [name]: { status: { name: value } } };
  if (definition.type === 'select') return { [name]: { select: { name: value } } };
  return null;
}

function buildProjectProperty(definition, name, value) {
  if (!definition || !name || value === undefined || value === null || value === '') return null;
  if (definition.type === 'select') return { [name]: { select: { name: String(value) } } };
  if (definition.type === 'rich_text') {
    return {
      [name]: {
        rich_text: [{ text: { content: String(value) } }],
      },
    };
  }
  if (definition.type === 'multi_select') {
    const values = Array.isArray(value) ? value : [value];
    return {
      [name]: {
        multi_select: values.filter(Boolean).map((item) => ({ name: String(item) })),
      },
    };
  }
  if (definition.type === 'relation') {
    const values = Array.isArray(value) ? value : [value];
    return {
      [name]: {
        relation: values.filter(Boolean).map((id) => ({ id: String(id) })),
      },
    };
  }
  return null;
}

function buildTaskFromPage(page, taskSchema, projectMap = new Map()) {
  const props = page?.properties || {};
  const titlePropName = taskSchema.properties.title?.name;
  const datePropName = taskSchema.properties.date?.name;
  const focusPropName = taskSchema.properties.focus?.name;
  const statusPropName = taskSchema.properties.status?.name;
  const priorityPropName = taskSchema.properties.priority?.name;
  const projectPropName = taskSchema.properties.project?.name;
  const projectField = projectPropName ? getProjectFieldValue(props[projectPropName], projectMap) : { label: null, ids: [] };

  return {
    id: page.id,
    text: titlePropName ? getPropertyDisplayValue(props[titlePropName]) || '제목 없음' : '제목 없음',
    date: datePropName ? normalizeISODate(getPropertyDisplayValue(props[datePropName])) : null,
    focus: focusPropName ? !!getPropertyDisplayValue(props[focusPropName]) : false,
    done: getTaskDoneValue(props, taskSchema),
    status: statusPropName ? getPropertyDisplayValue(props[statusPropName]) : null,
    priority: priorityPropName ? getPropertyDisplayValue(props[priorityPropName]) : null,
    project: projectField.label,
    projectIds: projectField.ids,
    projectId: projectField.ids[0] || null,
  };
}

function buildProjectFromPage(page, projectSchema) {
  const props = page?.properties || {};
  const titlePropName = projectSchema.properties.title?.name;
  const statusPropName = projectSchema.properties.status?.name;
  const startPropName = projectSchema.properties.startDate?.name;
  const endPropName = projectSchema.properties.endDate?.name;
  const clientPropName = projectSchema.properties.client?.name;
  const priorityPropName = projectSchema.properties.priority?.name;

  const startValue = startPropName ? getPropertyDisplayValue(props[startPropName]) : null;
  const endValue = endPropName ? getPropertyDisplayValue(props[endPropName]) : null;

  return {
    id: page.id,
    title: titlePropName ? getPropertyDisplayValue(props[titlePropName]) || '프로젝트' : '프로젝트',
    status: statusPropName ? getPropertyDisplayValue(props[statusPropName]) : null,
    startDate: normalizeISODate(startValue),
    endDate: normalizeISODate(endValue || startValue),
    client: clientPropName ? getPropertyDisplayValue(props[clientPropName]) : null,
    priority: priorityPropName ? getPropertyDisplayValue(props[priorityPropName]) : null,
  };
}

function mergeProperties(target, source) {
  if (!source) return;
  Object.assign(target, source);
}

function getStatusNameForDone(taskSchema, nextDone, requestedStatus) {
  if (requestedStatus) return requestedStatus;
  if (nextDone) return taskSchema.defaults.doneStatus || '완료';
  return taskSchema.defaults.status || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const {
    action,
    text,
    pageId,
    done,
    date,
    newDate,
    range,
    from,
    to,
    title,
    start,
    end,
    status,
    priority,
    project,
  } = req.body;

  const NOTION_KEY = process.env.NOTION_KEY;
  const NOTION_DB_ID = process.env.NOTION_DB_ID;
  const NOTION_PROJECTS_DB_ID = process.env.NOTION_PROJECTS_DB_ID;
  const NOTION_EVENTS_DB_ID = process.env.NOTION_EVENTS_DB_ID;
  const NOTION_MEMOS_DB_ID = process.env.NOTION_MEMOS_DB_ID;

  if (!NOTION_KEY || !NOTION_DB_ID) {
    return res.status(500).json({ error: 'Missing NOTION_KEY or NOTION_DB_ID' });
  }
  if (!isValidNotionId(NOTION_DB_ID)) {
    return res.status(500).json({ error: `Invalid NOTION_DB_ID format: ${String(NOTION_DB_ID)}` });
  }
  if (NOTION_PROJECTS_DB_ID && !isValidNotionId(NOTION_PROJECTS_DB_ID)) {
    return res.status(500).json({ error: `Invalid NOTION_PROJECTS_DB_ID format: ${String(NOTION_PROJECTS_DB_ID)}` });
  }
  if (NOTION_EVENTS_DB_ID && !isValidNotionId(NOTION_EVENTS_DB_ID)) {
    return res.status(500).json({ error: `Invalid NOTION_EVENTS_DB_ID format: ${String(NOTION_EVENTS_DB_ID)}` });
  }
  if (NOTION_MEMOS_DB_ID && !isValidNotionId(NOTION_MEMOS_DB_ID)) {
    return res.status(500).json({ error: `Invalid NOTION_MEMOS_DB_ID format: ${String(NOTION_MEMOS_DB_ID)}` });
  }

  const headers = {
    Authorization: `Bearer ${NOTION_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  const kstToday = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  try {
    // ✅ 오늘 것만 가져오기 (DB 100개 제한/누락 방지)
if (action === 'fetch' || action === 'schema' || action === 'fetchProjects') {
  const taskSchema = await getTaskSchema(headers, NOTION_DB_ID);
  let projectSchema = null;
  let projects = [];
  let projectMap = new Map();
  if (NOTION_PROJECTS_DB_ID) {
    projectSchema = await getProjectSchema(headers, NOTION_PROJECTS_DB_ID);
    const projectPages = await queryAllFromNotionDB(headers, NOTION_PROJECTS_DB_ID, {});
    projects = (projectPages || []).map((page) => buildProjectFromPage(page, projectSchema));
    projectMap = new Map(projects.map((project) => [project.id, project]));
  }
  if (action === 'schema') {
    return res.status(200).json({ success: true, taskSchema, projectSchema });
  }
  if (action === 'fetchProjects') {
    return res.status(200).json({ success: true, projects, projectSchema });
  }

const fromISO =
  normalizeISODate(from) ||
  normalizeISODate(range?.from) ||
  kstToday;

const toISO =
  normalizeISODate(to) ||
  normalizeISODate(range?.to) ||
  kstToday;

const taskDatePropName = taskSchema.properties.date?.name;
const taskQuery = {};
if (taskDatePropName) {
  taskQuery.filter = {
    and: [
      { property: taskDatePropName, date: { on_or_after: fromISO } },
      { property: taskDatePropName, date: { on_or_before: toISO } },
    ],
  };
  taskQuery.sorts = [{ property: taskDatePropName, direction: 'ascending' }];
}

const taskPages = await queryAllFromNotionDB(headers, NOTION_DB_ID, taskQuery);

const tasks = (taskPages || [])
  .map((page) => buildTaskFromPage(page, taskSchema, projectMap))
  .filter((task) => {
    if (!task.date || !taskDatePropName) return true;
    return task.date >= fromISO && task.date <= toISO;
  });

// 2) EVENTS (✅ pagination + 안전한 range filter)
let events = [];
if (NOTION_EVENTS_DB_ID) {
  const eventPages = await queryAllFromNotionDB(headers, NOTION_EVENTS_DB_ID, {
    filter: {
      and: [
        { property: '진행할 날짜', date: { on_or_after: fromISO } },
        { property: '진행할 날짜', date: { on_or_before: toISO } },
      ],
    },
    sorts: [{ property: '진행할 날짜', direction: 'ascending' }],
  });

  events = (eventPages || []).map((page) => {
    const title = getTitleText(page.properties);
    const d = page.properties?.['진행할 날짜']?.date;

    return {
      id: page.id,
      title,
      start: d?.start || null,
      end: d?.end || null,
    };
  });
}

  return res.status(200).json({ success: true, tasks, events, taskSchema, projects, projectSchema });
}



    // ✅ 생성: date가 안 오면 KST 오늘로 강제 (기기간 날짜 꼬임 방지)
    if (action === 'create') {
      const safeDate = normalizeISODate(date) || kstToday;
      const taskSchema = await getTaskSchema(headers, NOTION_DB_ID);
      const titlePropName = taskSchema.properties.title?.name;
      if (!titlePropName) {
        return res.status(500).json({ error: 'Task title property could not be resolved' });
      }

      const properties = {};
      mergeProperties(properties, buildTitleProperty(titlePropName, text || ''));
      if (taskSchema.properties.date?.name) {
        properties[taskSchema.properties.date.name] = { date: { start: safeDate } };
      }
      if (taskSchema.properties.done?.name) {
        properties[taskSchema.properties.done.name] = { checkbox: !!done };
      }
      const createStatusName = getStatusNameForDone(taskSchema, !!done, status);
      mergeProperties(
        properties,
        buildSelectLikeProperty(
          taskSchema.mapped.status?.definition,
          taskSchema.properties.status?.name,
          createStatusName,
        ),
      );
      mergeProperties(
        properties,
        buildSelectLikeProperty(
          taskSchema.mapped.priority?.definition,
          taskSchema.properties.priority?.name,
          priority || taskSchema.defaults.priority,
        ),
      );
      mergeProperties(
        properties,
        buildProjectProperty(
          taskSchema.mapped.project?.definition,
          taskSchema.properties.project?.name,
          project,
        ),
      );

      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { database_id: NOTION_DB_ID },
          properties,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Create Failed');

      return res.status(200).json({ success: true, id: data.id });
    }

    // ✅ 일정(Event) 생성
    if (action === 'createEvent') {
      if (!NOTION_EVENTS_DB_ID) {
        return res.status(500).json({ error: 'NOTION_EVENTS_DB_ID is not configured' });
      }
      const safeTitle = String(title || '').trim() || '일정';
      const safeStart = start || kstToday + 'T00:00:00+09:00';
      const safeEnd = end || null;

      const dateProp = { start: safeStart };
      if (safeEnd) dateProp.end = safeEnd;

      const titlePropName = process.env.NOTION_EVENTS_TITLE_PROP || '제목';
      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { database_id: NOTION_EVENTS_DB_ID },
          properties: {
            [titlePropName]: { title: [{ text: { content: safeTitle } }] },
            '진행할 날짜': { date: dateProp },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Create Event Failed');

      return res.status(200).json({ success: true, id: data.id });
    }

    // ✅ 완료 토글 + 날짜 변경(미루기) + 텍스트 수정
    if (action === 'update' && pageId) {
      const taskSchema = await getTaskSchema(headers, NOTION_DB_ID);
      const props = {};
      if (done !== undefined) {
        if (taskSchema.properties.done?.name) {
          props[taskSchema.properties.done.name] = { checkbox: !!done };
        }
        if (taskSchema.properties.status?.name) {
          const nextStatusName = getStatusNameForDone(taskSchema, !!done, status);
          mergeProperties(
            props,
            buildSelectLikeProperty(
              taskSchema.mapped.status?.definition,
              taskSchema.properties.status.name,
              nextStatusName,
            ),
          );
        }
      }
      const safeNewDate = normalizeISODate(newDate);
      if (safeNewDate && taskSchema.properties.date?.name) {
        props[taskSchema.properties.date.name] = { date: { start: safeNewDate } };
      }
      if (text !== undefined && String(text).trim() && taskSchema.properties.title?.name) {
        mergeProperties(props, buildTitleProperty(taskSchema.properties.title.name, String(text).trim()));
      }
      if (status !== undefined && taskSchema.properties.status?.name) {
        mergeProperties(
          props,
          buildSelectLikeProperty(
            taskSchema.mapped.status?.definition,
            taskSchema.properties.status.name,
            status,
          ),
        );
      }
      if (priority !== undefined && taskSchema.properties.priority?.name) {
        mergeProperties(
          props,
          buildSelectLikeProperty(
            taskSchema.mapped.priority?.definition,
            taskSchema.properties.priority.name,
            priority,
          ),
        );
      }
      if (project !== undefined && taskSchema.properties.project?.name) {
        mergeProperties(
          props,
          buildProjectProperty(
            taskSchema.mapped.project?.definition,
            taskSchema.properties.project.name,
            project,
          ),
        );
      }

      if (Object.keys(props).length === 0) {
        return res.status(400).json({ error: 'update requires done, newDate, text, status, priority or project' });
      }

      const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: props }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Update Failed');

      return res.status(200).json({ success: true });
    }

    // ✅ 일정 수정 (제목, 날짜, 시간)
    if (action === 'updateEvent' && pageId && NOTION_EVENTS_DB_ID) {
      const props = {};
      const titlePropName = process.env.NOTION_EVENTS_TITLE_PROP || '제목';
      const safeTitle = title !== undefined ? String(title).trim() : '';
      if (safeTitle) props[titlePropName] = { title: [{ text: { content: safeTitle } }] };
      if (start || end) {
        const toFullISO = (s) => {
          if (!s) return null;
          s = String(s).trim();
          if (/[+Z]/.test(s)) return s;
          if (s.includes('T')) return s.padEnd(19, ':00').slice(0, 19) + '+09:00';
          return s + 'T00:00:00+09:00';
        };
        let startISO = toFullISO(start);
        let endISO = toFullISO(end);
        if (!endISO && startISO) endISO = startISO;
        if (!startISO && endISO) startISO = endISO;
        if (startISO && endISO) props['진행할 날짜'] = { date: { start: startISO, end: endISO } };
      }
      if (Object.keys(props).length === 0) return res.status(400).json({ error: 'updateEvent requires title, start, or end' });
      const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: props }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Update Event Failed');
      return res.status(200).json({ success: true });
    }

    // ✅ 메모: 전체 조회 (모든 기기 동기화)
    if (action === 'fetchMemos') {
      if (!NOTION_MEMOS_DB_ID) {
        return res.status(200).json({ success: true, memos: [], syncEnabled: false });
      }
      const memoProp = process.env.NOTION_MEMOS_TITLE_PROP || '메모';
      const pages = await queryAllFromNotionDB(headers, NOTION_MEMOS_DB_ID, {
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      });
      const memos = (pages || [])
        .filter((p) => !p.archived)
        .map((p) => ({
          id: p.id,
          text: p.properties?.[memoProp]?.title?.[0]?.plain_text ?? '',
          timestamp: p.created_time ? new Date(p.created_time).getTime() : Date.now(),
        }))
        .filter((m) => m.text !== undefined);
      return res.status(200).json({ success: true, memos, syncEnabled: true });
    }

    // ✅ 메모: 생성
    if (action === 'createMemo') {
      if (!NOTION_MEMOS_DB_ID) {
        return res.status(500).json({ error: 'NOTION_MEMOS_DB_ID is not configured' });
      }
      const memoProp = process.env.NOTION_MEMOS_TITLE_PROP || '메모';
      const safeText = String(text ?? '').trim() || ' ';
      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { database_id: NOTION_MEMOS_DB_ID },
          properties: {
            [memoProp]: { title: [{ text: { content: safeText } }] },
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Create Memo Failed');
      const ts = data.created_time ? new Date(data.created_time).getTime() : Date.now();
      return res.status(200).json({ success: true, id: data.id, timestamp: ts });
    }

    // ✅ 메모: 수정
    if (action === 'updateMemo' && pageId) {
      if (!NOTION_MEMOS_DB_ID) {
        return res.status(500).json({ error: 'NOTION_MEMOS_DB_ID is not configured' });
      }
      const memoProp = process.env.NOTION_MEMOS_TITLE_PROP || '메모';
      const safeText = String(text ?? '').trim();
      if (!safeText) {
        return res.status(400).json({ error: 'updateMemo requires non-empty text' });
      }
      const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          properties: {
            [memoProp]: { title: [{ text: { content: safeText } }] },
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Update Memo Failed');
      return res.status(200).json({ success: true });
    }

    // ✅ 메모: 삭제(archive)
    if (action === 'deleteMemo' && pageId) {
      const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ archived: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Delete Memo Failed');
      return res.status(200).json({ success: true });
    }

    // ✅ 삭제(archive)
    if ((action === 'delete' || action === 'deleteEvent') && pageId) {
      const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ archived: true }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Delete Failed');

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Server Error' });
  }
}
