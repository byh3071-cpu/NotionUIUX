// /pages/api/notion.js (또는 /api/notion.js) 전체 수정본

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { action, text, pageId, done, date, newDate, range, from, to, title, start, end } = req.body;

  const NOTION_KEY = process.env.NOTION_KEY;
  const NOTION_DB_ID = process.env.NOTION_DB_ID;
  const NOTION_EVENTS_DB_ID = process.env.NOTION_EVENTS_DB_ID;
  const NOTION_MEMOS_DB_ID = process.env.NOTION_MEMOS_DB_ID;

    const isValidNotionId = (id) => typeof id === "string" && /^[0-9a-fA-F-]{32,36}$/.test(id) && id.replace(/-/g,"").length === 32;
    
    if (!NOTION_KEY || !NOTION_DB_ID) {
      return res.status(500).json({ error: 'Missing NOTION_KEY or NOTION_DB_ID' });
    }
    if (!isValidNotionId(NOTION_DB_ID)) {
      return res.status(500).json({ error: `Invalid NOTION_DB_ID format: ${String(NOTION_DB_ID)}` });
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

  // KST 고정 "오늘" (기기/서버 타임존 달라도 동일)
  const kstToday = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  // Notion date.start 정규화 (혹시 시간 문자열이 와도 YYYY-MM-DD로 통일)
  const normalizeISODate = (v) => (v ? String(v).split('T')[0] : null);

  const getTitleText = (props) => {
  if (!props) return '일정';
  const key = Object.keys(props).find((k) => props[k]?.type === 'title');
  const p = key ? props[key] : null;
  return p?.title?.[0]?.plain_text || '일정';
};

// ✅ Notion DB query pagination (100개 제한 해결)
const queryAllFromNotionDB = async (databaseId, bodyObj) => {
  let results = [];
  let start_cursor = undefined;

  while (true) {
    const r = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...bodyObj,
        start_cursor,
        page_size: 100,
      }),
    });

    const j = await r.json();
    if (!r.ok) throw new Error(j?.message || `Fetch Failed (db:${databaseId})`);

    results = results.concat(j.results || []);
    if (!j.has_more) break;
    start_cursor = j.next_cursor;
  }

  return results;
};

  try {
    // ✅ 오늘 것만 가져오기 (DB 100개 제한/누락 방지)
if (action === 'fetch') {
  
const fromISO =
  normalizeISODate(from) ||
  normalizeISODate(range?.from) ||
  kstToday;

const toISO =
  normalizeISODate(to) ||
  normalizeISODate(range?.to) ||
  kstToday;

// 1) TASKS (✅ pagination + 안전한 range filter)
const taskPages = await queryAllFromNotionDB(NOTION_DB_ID, {
  filter: {
    and: [
      { property: '날짜', date: { on_or_after: fromISO } },
      { property: '날짜', date: { on_or_before: toISO } },
    ],
  },
  sorts: [{ property: '날짜', direction: 'ascending' }],
});

const tasks = (taskPages || []).map((page) => ({
  id: page.id,
  text: page.properties?.['할 일']?.title?.[0]?.plain_text || '제목 없음',
  date: normalizeISODate(page.properties?.['날짜']?.date?.start),
  done: !!page.properties?.['완료']?.checkbox,
}));

// 2) EVENTS (✅ pagination + 안전한 range filter)
let events = [];
if (NOTION_EVENTS_DB_ID) {
  const eventPages = await queryAllFromNotionDB(NOTION_EVENTS_DB_ID, {
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

  return res.status(200).json({ success: true, tasks, events });
}



    // ✅ 생성: date가 안 오면 KST 오늘로 강제 (기기간 날짜 꼬임 방지)
    if (action === 'create') {
      const safeDate = normalizeISODate(date) || kstToday;

      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { database_id: NOTION_DB_ID },
          properties: {
            '할 일': { title: [{ text: { content: text || '' } }] },
            '날짜': { date: { start: safeDate } },
            '완료': { checkbox: false },
          },
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
      const props = {};
      if (done !== undefined) props['완료'] = { checkbox: !!done };
      const safeNewDate = normalizeISODate(newDate);
      if (safeNewDate) props['날짜'] = { date: { start: safeNewDate } };
      if (text !== undefined && String(text).trim()) props['할 일'] = { title: [{ text: { content: String(text).trim() } }] };

      if (Object.keys(props).length === 0) {
        return res.status(400).json({ error: 'update requires done, newDate or text' });
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
      const pages = await queryAllFromNotionDB(NOTION_MEMOS_DB_ID, {
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
