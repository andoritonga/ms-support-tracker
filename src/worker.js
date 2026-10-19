/**
 * Cloudflare Worker for MS Support Activity Tracker
 * Full-stack serverless runtime with Cloudflare D1 and Google Sheets Sync
 */

// ==========================================
// === HELPERS & UTILITIES ===
// ==========================================

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function checkBasicAuth(request, env) {
  const username = env.AUTH_USERNAME ? env.AUTH_USERNAME.trim() : "";
  const password = env.AUTH_PASSWORD ? env.AUTH_PASSWORD.trim() : "";
  if (!username || !password) return true;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;

  try {
    const creds = atob(authHeader.slice(6));
    const [u, p] = creds.split(":");
    return u === username && p === password;
  } catch {
    return false;
  }
}

function parseTimeToMinutes(timeVal) {
  if (!timeVal) return null;
  const match = String(timeVal).trim().match(/(\d{1,2}):(\d{2})/);
  if (match) {
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }
  return null;
}

function parseIsoDateTimeMs(timeVal) {
  if (!timeVal) return null;
  const str = String(timeVal).trim();
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})/);
  if (m) {
    const [, yr, mo, dy, hr, mn] = m.map(Number);
    return Date.UTC(yr, mo - 1, dy, hr, mn);
  }
  return null;
}

function calculateDuration(clockIn, clockOut) {
  const dt1 = parseIsoDateTimeMs(clockIn);
  const dt2 = parseIsoDateTimeMs(clockOut);
  if (dt1 !== null && dt2 !== null) {
    const diff = Math.round((dt2 - dt1) / 60000);
    if (diff > 0) {
      const hh = Math.floor(diff / 60).toString().padStart(2, "0");
      const mm = (diff % 60).toString().padStart(2, "0");
      return { durationStr: `${hh}:${mm}`, durationMinutes: diff };
    }
  }

  const m1 = parseTimeToMinutes(clockIn);
  const m2 = parseTimeToMinutes(clockOut);
  if (m1 !== null && m2 !== null) {
    let diff = m2 - m1;
    if (diff < 0) diff += 1440; // past midnight support
    if (diff > 0) {
      const hh = Math.floor(diff / 60).toString().padStart(2, "0");
      const mm = (diff % 60).toString().padStart(2, "0");
      return { durationStr: `${hh}:${mm}`, durationMinutes: diff };
    }
  }
  return { durationStr: "00:00", durationMinutes: 0 };
}

const INDONESIAN_MONTHS = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, maret: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8,
  sep: 9, september: 9,
  okt: 10, oktober: 10, oct: 10,
  nov: 11, november: 11,
  des: 12, desember: 12, dec: 12
};

function cleanDateFormat(val) {
  if (!val) return "";
  const valStr = String(val).trim().toLowerCase();

  for (const [mName, mNum] of Object.entries(INDONESIAN_MONTHS)) {
    if (valStr.includes(mName)) {
      const nums = (valStr.match(/\d+/g) || []).map(Number);
      if (nums.length >= 2) {
        const year = nums.find(n => n > 1000) || new Date().getFullYear();
        const day = nums.find(n => n <= 31) || 1;
        const mm = String(mNum).padStart(2, "0");
        const dd = String(day).padStart(2, "0");
        return `${year}-${mm}-${dd}`;
      }
    }
  }

  const parts = valStr.match(/\d+/g);
  if (parts && parts.length === 3) {
    const nums = parts.map(Number);
    let y, m, d;
    if (nums[0] > 1000) {
      [y, m, d] = nums;
    } else if (nums[2] > 1000) {
      [d, m, y] = nums;
    } else {
      [d, m, y] = [nums[0], nums[1], 2000 + nums[2]];
    }
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }

  return valStr;
}

// ==========================================
// === GOOGLE SERVICE ACCOUNT AUTH (WEB CRYPTO) ===
// ==========================================

let cachedGoogleToken = null;
let cachedGoogleTokenExpiry = 0;

function base64UrlEncode(str) {
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function arrayBufferToBase64Url(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64UrlEncode(binary);
}

function str2ab(str) {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0; i < str.length; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

function getServiceAccount(env) {
  const raw = env.SERVICE_ACCOUNT_JSON || env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getGoogleAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && cachedGoogleTokenExpiry > now + 120) {
    return cachedGoogleToken;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const unsignedToken = `${encodedHeader}.${encodedClaimSet}`;

  const pem = creds.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binaryDer = str2ab(atob(pem));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signedJwt = `${unsignedToken}.${arrayBufferToBase64Url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedGoogleToken = data.access_token;
  cachedGoogleTokenExpiry = now + (data.expires_in || 3600);
  return cachedGoogleToken;
}

// ==========================================
// === GOOGLE SHEETS REST CLIENT ===
// ==========================================

async function fetchSheetValues(spreadsheetId, range, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch sheet values (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.values || [];
}

async function appendSheetValues(spreadsheetId, range, values, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [values] })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to append sheet row (${res.status}): ${err}`);
  }
  return await res.json();
}

async function updateSheetValues(spreadsheetId, range, values, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [values] })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to update sheet range (${res.status}): ${err}`);
  }
  return await res.json();
}

async function getWorksheetId(spreadsheetId, sheetTitle, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return 0;
  const data = await res.json();
  const found = (data.sheets || []).find(s => s.properties?.title?.toLowerCase() === sheetTitle.toLowerCase());
  return found?.properties?.sheetId || 0;
}

async function deleteSheetRow(spreadsheetId, sheetTitle, rowIndex, token) {
  const sheetId = await getWorksheetId(spreadsheetId, sheetTitle, token);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: "ROWS",
              startIndex: rowIndex - 1,
              endIndex: rowIndex
            }
          }
        }
      ]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete sheet row (${res.status}): ${err}`);
  }
  return await res.json();
}

// ==========================================
// === D1 DATABASE OPERATIONS ===
// ==========================================

async function getSyncMeta(db, key) {
  const row = await db.prepare("SELECT value FROM sync_meta WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}

async function setSyncMeta(db, key, value) {
  await db.prepare(
    "INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
  ).bind(key, value).run();
}

const D1_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    sheet_row INTEGER,
    customer TEXT NOT NULL,
    date TEXT NOT NULL,
    raised_by TEXT,
    services TEXT,
    category TEXT,
    project TEXT,
    task_description TEXT,
    root_cause TEXT,
    solution TEXT,
    clock_in TEXT,
    clock_out TEXT,
    duration TEXT,
    duration_minutes INTEGER DEFAULT 0,
    status TEXT DEFAULT 'In Progress',
    remarks TEXT,
    ticket_deduction REAL DEFAULT 0.0,
    sync_status TEXT DEFAULT 'synced',
    sync_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_sync ON activities(sync_status)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_sheet_row ON activities(sheet_row)`,
  `CREATE TABLE IF NOT EXISTS config_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS config_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT 'RaisedBy',
    resource_value TEXT NOT NULL DEFAULT '',
    raised_by TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer, resource_type, resource_value)
  )`,
  `CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`
];

let schemaInitialized = false;
async function ensureD1Schema(db) {
  if (schemaInitialized || !db) return;
  try {
    const batch = D1_SCHEMA_STATEMENTS.map(sql => db.prepare(sql));
    await db.batch(batch);
    schemaInitialized = true;
  } catch (err) {
    console.warn("Failed to auto-ensure D1 schema:", err);
  }
}

async function countTotalActivities(db) {
  const row = await db.prepare("SELECT COUNT(*) as cnt FROM activities WHERE sync_status != 'pending_delete'").first();
  return row ? row.cnt : 0;
}

async function countPendingSync(db) {
  const row = await db.prepare("SELECT COUNT(*) as cnt FROM activities WHERE sync_status IN ('pending_insert', 'pending_update', 'pending_delete')").first();
  return row ? row.cnt : 0;
}

// In-Memory Isolate Cache
let memActivitiesCache = null;
let memActivitiesCacheTime = 0;
let memActivitiesOrderBy = "";

let memCustomersCache = null;
let memCustomersCacheTime = 0;

let memResourcesCache = new Map();

function invalidateActivitiesCache() {
  memActivitiesCache = null;
  memActivitiesCacheTime = 0;
  memActivitiesOrderBy = "";
}

function invalidateConfigCache() {
  memCustomersCache = null;
  memCustomersCacheTime = 0;
  memResourcesCache.clear();
}

async function getActivities(db, orderBy = "sheet_desc") {
  const now = Date.now();
  if (memActivitiesCache && memActivitiesOrderBy === orderBy && (now - memActivitiesCacheTime) < 30000) {
    return memActivitiesCache;
  }

  let orderClause = "ORDER BY (sheet_row IS NULL) DESC, sheet_row DESC, id DESC";
  if (orderBy === "sheet_asc") {
    orderClause = "ORDER BY (sheet_row IS NULL) ASC, sheet_row ASC, id ASC";
  } else if (orderBy === "date_desc") {
    orderClause = "ORDER BY date DESC, (sheet_row IS NULL) DESC, sheet_row DESC, id DESC";
  } else if (orderBy === "date_asc") {
    orderClause = "ORDER BY date ASC, sheet_row ASC, id ASC";
  } else if (orderBy === "id_desc") {
    orderClause = "ORDER BY id DESC";
  }

  const query = `SELECT * FROM activities WHERE sync_status != 'pending_delete' ${orderClause}`;
  const { results } = await db.prepare(query).all();

  const mapped = (results || []).map(r => ({
    rowId: r.id,
    sheetRow: r.sheet_row,
    uuid: r.uuid,
    customer: r.customer || "",
    date: r.date || "",
    raisedBy: r.raised_by || "",
    services: r.services || "",
    category: r.category || "",
    project: r.project || "",
    taskDescription: r.task_description || "",
    rootCause: r.root_cause || "",
    solution: r.solution || "",
    clockIn: r.clock_in || "",
    clockOut: r.clock_out || "",
    duration: r.duration || "00:00",
    durationMinutes: r.duration_minutes || 0,
    status: r.status || "In Progress",
    remarks: r.remarks || "",
    ticketDeduction: Number(r.ticket_deduction || 0.0),
    syncStatus: r.sync_status,
    syncError: r.sync_error
  }));

  memActivitiesCache = mapped;
  memActivitiesCacheTime = now;
  memActivitiesOrderBy = orderBy;

  return mapped;
}

async function insertActivity(db, data, syncStatus = "pending_insert") {
  const actUuid = data.uuid || crypto.randomUUID();
  const deduction = parseFloat(data.ticketDeduction || 0.0) || 0.0;

  let sheetRow = data.sheetRow || data.sheet_row;
  if (!sheetRow) {
    const maxRow = await db.prepare("SELECT MAX(sheet_row) as max_r FROM activities").first();
    sheetRow = ((maxRow?.max_r || 0) + 1);
  }

  const res = await db.prepare(`
    INSERT INTO activities (
      uuid, sheet_row, customer, date, raised_by, services, category,
      project, task_description, root_cause, solution, clock_in, clock_out,
      duration, duration_minutes, status, remarks, ticket_deduction, sync_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    actUuid,
    sheetRow,
    data.customer || "",
    data.date || "",
    data.raisedBy || "",
    data.services || "",
    data.category || "",
    data.project || "",
    data.taskDescription || "",
    data.rootCause || "",
    data.solution || "",
    data.clockIn || "",
    data.clockOut || "",
    data.duration || "00:00",
    data.durationMinutes || 0,
    data.status || "In Progress",
    data.remarks || "",
    deduction,
    syncStatus
  ).run();

  invalidateActivitiesCache();
  return res.meta?.last_row_id || 0;
}

async function updateActivity(db, activityId, data, syncStatus = "pending_update") {
  const deduction = parseFloat(data.ticketDeduction || 0.0) || 0.0;
  await db.prepare(`
    UPDATE activities SET
      customer = ?, date = ?, raised_by = ?, services = ?, category = ?,
      project = ?, task_description = ?, root_cause = ?, solution = ?,
      clock_in = ?, clock_out = ?, duration = ?, duration_minutes = ?,
      status = ?, remarks = ?, ticket_deduction = ?, sync_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.customer || "",
    data.date || "",
    data.raisedBy || "",
    data.services || "",
    data.category || "",
    data.project || "",
    data.taskDescription || "",
    data.rootCause || "",
    data.solution || "",
    data.clockIn || "",
    data.clockOut || "",
    data.duration || "00:00",
    data.durationMinutes || 0,
    data.status || "In Progress",
    data.remarks || "",
    deduction,
    syncStatus,
    activityId
  ).run();
  invalidateActivitiesCache();
  return true;
}

async function updateActivityStatus(db, activityId, status, syncStatus = "pending_update") {
  await db.prepare(`
    UPDATE activities SET
      status = ?, sync_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status, syncStatus, activityId).run();
  invalidateActivitiesCache();
  return true;
}

async function updateActivityTicketDeduction(db, activityId, deduction) {
  const val = parseFloat(deduction || 0.0) || 0.0;
  await db.prepare(`
    UPDATE activities SET
      ticket_deduction = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(val, activityId).run();
  invalidateActivitiesCache();
  return true;
}

async function deleteActivity(db, activityId) {
  const row = await db.prepare("SELECT sync_status FROM activities WHERE id = ?").bind(activityId).first();
  if (row && row.sync_status === "pending_insert") {
    await db.prepare("DELETE FROM activities WHERE id = ?").bind(activityId).run();
  } else {
    await db.prepare("UPDATE activities SET sync_status = 'pending_delete', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(activityId).run();
  }
  invalidateActivitiesCache();
  return true;
}

async function getCachedCustomers(db) {
  const now = Date.now();
  if (memCustomersCache && (now - memCustomersCacheTime) < 60000) {
    return memCustomersCache;
  }
  const { results } = await db.prepare("SELECT name FROM config_customers ORDER BY name ASC").all();
  const list = (results || []).map(r => r.name);
  if (list.length > 0) {
    memCustomersCache = list;
    memCustomersCacheTime = now;
  }
  return list;
}

async function getCachedResources(db, customer) {
  const cClean = (customer || "").trim();
  const now = Date.now();
  const cacheKey = cClean.toLowerCase();
  const cached = memResourcesCache.get(cacheKey);
  if (cached && (now - cached.time) < 60000) {
    return cached.data;
  }

  const { results: resRb } = await db.prepare(
    "SELECT DISTINCT COALESCE(NULLIF(resource_value, ''), raised_by) as val FROM config_resources WHERE LOWER(customer) = LOWER(?) AND (resource_type IN ('RaisedBy', 'Raised By', 'raised_by') OR raised_by != '') ORDER BY val ASC"
  ).bind(cClean).all();
  const raisedBy = (resRb || []).map(r => r.val).filter(Boolean);

  const { results: actRb } = await db.prepare(
    "SELECT DISTINCT raised_by FROM activities WHERE LOWER(customer) = LOWER(?) AND raised_by != '' AND sync_status != 'pending_delete' ORDER BY raised_by ASC"
  ).bind(cClean).all();
  for (const r of actRb || []) {
    const val = (r.raised_by || "").trim();
    if (val && !raisedBy.includes(val)) raisedBy.push(val);
  }

  const { results: resPrj } = await db.prepare(
    "SELECT DISTINCT resource_value as val FROM config_resources WHERE LOWER(customer) = LOWER(?) AND resource_type IN ('Project', 'project') AND resource_value != '' ORDER BY val ASC"
  ).bind(cClean).all();
  const projects = (resPrj || []).map(r => r.val).filter(Boolean);

  const { results: actPrj } = await db.prepare(
    "SELECT DISTINCT project FROM activities WHERE LOWER(customer) = LOWER(?) AND project != '' AND project != '-' AND sync_status != 'pending_delete' ORDER BY project ASC"
  ).bind(cClean).all();
  for (const r of actPrj || []) {
    const val = (r.project || "").trim();
    if (val && !projects.includes(val)) projects.push(val);
  }

  const result = {
    raisedBy: raisedBy.sort(),
    projects: projects.sort()
  };

  memResourcesCache.set(cacheKey, { data: result, time: now });
  return result;
}

async function searchKnowledgeBase(db, query, customer, service, limit = 6) {
  const { results } = await db.prepare(`
    SELECT id, customer, date, services, category, project, task_description, root_cause, solution, duration, status
    FROM activities
    WHERE (root_cause != '' OR solution != '')
      AND sync_status != 'pending_delete'
  `).all();

  const keywords = (query || "").toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  const scored = [];

  for (const r of results || []) {
    let score = 0;
    const rCust = (r.customer || "").trim().toLowerCase();
    const rSvc = (r.services || "").trim().toLowerCase();
    const rDesc = (r.task_description || "").toLowerCase();
    const rRc = (r.root_cause || "").toLowerCase();
    const rSol = (r.solution || "").toLowerCase();

    if (customer && rCust === customer.trim().toLowerCase()) score += 4;
    if (service && rSvc === service.trim().toLowerCase()) score += 3;

    for (const kw of keywords) {
      if (rDesc.includes(kw)) score += 3;
      if (rRc.includes(kw)) score += 2;
      if (rSol.includes(kw)) score += 2;
    }

    if (keywords.length === 0 || score > 0) {
      scored.push({
        score,
        item: {
          id: r.id,
          customer: r.customer,
          date: r.date,
          services: r.services,
          category: r.category,
          project: r.project,
          taskDescription: r.task_description,
          rootCause: r.root_cause,
          solution: r.solution,
          duration: r.duration,
          status: r.status,
          score
        }
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || (b.item.date || "").localeCompare(a.item.date || ""));
  return scored.slice(0, limit).map(s => s.item);
}

// ==========================================
// === SYNC SERVICE ENGINE ===
// ==========================================

async function executeBatchChunks(db, stmts, chunkSize = 100) {
  for (let i = 0; i < stmts.length; i += chunkSize) {
    const chunk = stmts.slice(i, i + chunkSize);
    if (chunk.length > 0) {
      await db.batch(chunk);
    }
  }
}

async function syncConfigFromSheets(env) {
  const creds = getServiceAccount(env);
  if (!creds) {
    throw new Error("Google Service Account credentials not found. Please set SERVICE_ACCOUNT_JSON in Cloudflare secrets.");
  }
  if (!env.SPREADSHEET_CONFIG_ID) {
    throw new Error("SPREADSHEET_CONFIG_ID is not configured in wrangler vars.");
  }

  const token = await getGoogleAccessToken(creds);

  // 1. Customers
  try {
    const custRows = await fetchSheetValues(env.SPREADSHEET_CONFIG_ID, "Customer_Config!A:A", token);
    if (custRows && custRows.length > 1) {
      await env.DB.prepare("DELETE FROM config_customers").run();
      const stmts = [];
      for (const row of custRows.slice(1)) {
        const name = (row[0] || "").trim();
        if (name) {
          stmts.push(env.DB.prepare("INSERT OR IGNORE INTO config_customers (name) VALUES (?)").bind(name));
        }
      }
      if (stmts.length > 0) await executeBatchChunks(env.DB, stmts, 100);
    }
  } catch (err) {
    console.warn("Error syncing Customer_Config:", err);
  }

  // 2. Resources
  try {
    const resRows = await fetchSheetValues(env.SPREADSHEET_CONFIG_ID, "Customer_Resources!A:Z", token);
    if (resRows && resRows.length > 1) {
      const headers = resRows[0].map(h => String(h).trim().toLowerCase());
      const cIdx = headers.indexOf("customer");
      const tIdx = headers.indexOf("type");
      const vIdx = headers.indexOf("value");

      await env.DB.prepare("DELETE FROM config_resources").run();
      const stmts = [];

      for (const row of resRows.slice(1)) {
        let cust = "";
        let rtype = "RaisedBy";
        let rval = "";

        if (cIdx !== -1 && tIdx !== -1 && vIdx !== -1) {
          cust = (row[cIdx] || "").trim();
          rtype = (row[tIdx] || "").trim() || "RaisedBy";
          rval = (row[vIdx] || "").trim();
        } else {
          cust = (row[0] || "").trim();
          rval = (row[1] || "").trim();
        }

        if (cust && rval) {
          const rb = rtype.toLowerCase().includes("raised") ? rval : "";
          stmts.push(
            env.DB.prepare(`
              INSERT OR IGNORE INTO config_resources (customer, resource_type, resource_value, raised_by)
              VALUES (?, ?, ?, ?)
            `).bind(cust, rtype, rval, rb)
          );
        }
      }

      if (stmts.length > 0) await executeBatchChunks(env.DB, stmts, 100);
    }
  } catch (err) {
    console.warn("Error syncing Customer_Resources:", err);
  }
  invalidateConfigCache();
}

async function pullActivitiesFromSheets(env) {
  const creds = getServiceAccount(env);
  if (!creds) {
    throw new Error("Google Service Account credentials not found. Please set SERVICE_ACCOUNT_JSON in Cloudflare secrets.");
  }
  if (!env.SPREADSHEET_LOGS_ID) {
    throw new Error("SPREADSHEET_LOGS_ID is not configured in wrangler vars.");
  }

  const token = await getGoogleAccessToken(creds);
  const rows = await fetchSheetValues(env.SPREADSHEET_LOGS_ID, "Activity_Log!A:O", token);
  if (!rows || rows.length <= 1) return 0;

  const headers = rows[0].map(h => String(h).trim());
  function getVal(row, name) {
    const idx = headers.indexOf(name);
    return idx !== -1 && idx < row.length ? row[idx] : "";
  }

  // 1. Single query to pre-fetch all existing activities into memory Map
  const { results: existingList } = await env.DB.prepare(`
    SELECT id, uuid, sheet_row, sync_status, customer, date, raised_by, services, category,
           project, task_description, root_cause, solution, clock_in, clock_out,
           duration, duration_minutes, status, remarks
    FROM activities
  `).all();

  const byUuid = new Map();
  const bySheetRow = new Map();
  for (const r of existingList || []) {
    if (r.uuid) byUuid.set(String(r.uuid), r);
    if (r.sheet_row) bySheetRow.set(Number(r.sheet_row), r);
  }

  const sheetUuids = new Set();
  let updatedCount = 0;
  const stmts = [];

  for (let idxRow = 2; idxRow <= rows.length; idxRow++) {
    const row = rows[idxRow - 1];
    let uuidVal = getVal(row, "No") || getVal(row, "UUID") || getVal(row, "ID");
    const customer = getVal(row, "Customer");
    let rawDate = getVal(row, "Start Date") || getVal(row, "Date");
    const raisedBy = getVal(row, "Raised By") || getVal(row, "RaisedBy");
    const services = getVal(row, "Services");
    const category = getVal(row, "Category Type") || getVal(row, "Category");
    const project = getVal(row, "GCP Project") || getVal(row, "Project");
    const taskDesc = getVal(row, "Task Description") || getVal(row, "TaskDescription");
    const rootCause = getVal(row, "Root Cause") || getVal(row, "RootCause");
    const solution = getVal(row, "Solution");
    const rawClockIn = getVal(row, "Clock In") || getVal(row, "ClockIn");
    const rawClockOut = getVal(row, "Clock Out") || getVal(row, "ClockOut");
    const rawDuration = getVal(row, "Duration");
    const status = getVal(row, "Status") || "In Progress";
    const remarks = getVal(row, "Remarks");

    if (!rawDate && rawClockIn) rawDate = rawClockIn;
    const formattedDate = cleanDateFormat(rawDate);
    let { durationStr, durationMinutes } = calculateDuration(rawClockIn, rawClockOut);
    if (durationMinutes === 0 && rawDuration) {
      const dm = parseTimeToMinutes(rawDuration);
      if (dm !== null && dm > 0) {
        durationMinutes = dm;
        const hh = Math.floor(dm / 60).toString().padStart(2, "0");
        const mm = (dm % 60).toString().padStart(2, "0");
        durationStr = `${hh}:${mm}`;
      }
    }

    if (!uuidVal) {
      const match = bySheetRow.get(idxRow);
      uuidVal = match?.uuid || crypto.randomUUID();
    }
    const uuidStr = String(uuidVal);
    sheetUuids.add(uuidStr);

    const existing = byUuid.get(uuidStr);

    if (existing) {
      if (["pending_update", "pending_insert", "pending_delete"].includes(existing.sync_status)) {
        if (existing.sheet_row !== idxRow) {
          stmts.push(env.DB.prepare("UPDATE activities SET sheet_row = ? WHERE id = ?").bind(idxRow, existing.id));
        }
      } else {
        const hasChanged = (
          existing.sheet_row !== idxRow ||
          existing.customer !== customer ||
          existing.date !== formattedDate ||
          existing.raised_by !== raisedBy ||
          existing.services !== services ||
          existing.category !== category ||
          existing.project !== project ||
          existing.task_description !== taskDesc ||
          existing.root_cause !== rootCause ||
          existing.solution !== solution ||
          String(existing.clock_in) !== String(rawClockIn) ||
          String(existing.clock_out) !== String(rawClockOut) ||
          existing.duration !== durationStr ||
          existing.duration_minutes !== durationMinutes ||
          existing.status !== status ||
          existing.remarks !== remarks
        );

        if (hasChanged) {
          stmts.push(env.DB.prepare(`
            UPDATE activities SET
              sheet_row = ?, customer = ?, date = ?, raised_by = ?, services = ?, category = ?,
              project = ?, task_description = ?, root_cause = ?, solution = ?, clock_in = ?,
              clock_out = ?, duration = ?, duration_minutes = ?, status = ?, remarks = ?,
              sync_status = 'synced', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(
            idxRow, customer, formattedDate, raisedBy, services, category,
            project, taskDesc, rootCause, solution, String(rawClockIn), String(rawClockOut),
            durationStr, durationMinutes, status, remarks, existing.id
          ));
        }
      }
      updatedCount++;
    } else {
      let defaultDeduction = 0.0;
      const custUpper = (customer || "").toUpperCase();
      if ((custUpper.includes("MSIG") || custUpper.includes("ASJ")) && (category || "").toLowerCase() === "issue") {
        defaultDeduction = 1.0;
      }

      stmts.push(env.DB.prepare(`
        INSERT INTO activities (
          uuid, sheet_row, customer, date, raised_by, services, category,
          project, task_description, root_cause, solution, clock_in, clock_out,
          duration, duration_minutes, status, remarks, ticket_deduction, sync_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', CURRENT_TIMESTAMP)
      `).bind(
        uuidStr, idxRow, customer, formattedDate, raisedBy, services, category,
        project, taskDesc, rootCause, solution, String(rawClockIn), String(rawClockOut),
        durationStr, durationMinutes, status, remarks, defaultDeduction
      ));
      updatedCount++;
    }
  }

  // 2. Identify deleted rows in Google Sheets
  for (const r of existingList || []) {
    if (r.sync_status === "synced" && !sheetUuids.has(String(r.uuid))) {
      stmts.push(env.DB.prepare("DELETE FROM activities WHERE id = ?").bind(r.id));
    }
  }

  // 3. Execute in batched chunks of 100 statements
  await executeBatchChunks(env.DB, stmts, 100);

  invalidateActivitiesCache();
  await setSyncMeta(env.DB, "last_pull_time", new Date().toISOString());
  await setSyncMeta(env.DB, "last_sync_error", "");
  return updatedCount;
}

async function pushPendingToSheets(env) {
  const creds = getServiceAccount(env);
  if (!creds || !env.SPREADSHEET_LOGS_ID) return 0;

  const { results: pending } = await env.DB.prepare(`
    SELECT * FROM activities
    WHERE sync_status IN ('pending_insert', 'pending_update', 'pending_delete')
    ORDER BY id ASC
  `).all();

  if (!pending || pending.length === 0) return 0;

  const token = await getGoogleAccessToken(creds);
  let syncedCount = 0;

  for (const item of pending) {
    try {
      if (item.sync_status === "pending_insert") {
        const rowData = [
          item.uuid, item.customer, item.date, item.raised_by, item.services,
          item.category, item.project, item.task_description, item.root_cause,
          item.solution, item.clock_in, item.clock_out, item.duration || "00:00", item.status, item.remarks
        ];
        const res = await appendSheetValues(env.SPREADSHEET_LOGS_ID, "Activity_Log!A:O", rowData, token);
        let newRowIdx = null;
        const updatedRange = res?.updates?.updatedRange || "";
        const m = updatedRange.match(/A(\d+):/);
        if (m) newRowIdx = parseInt(m[1], 10);

        if (newRowIdx) {
          await env.DB.prepare(
            "UPDATE activities SET sync_status = 'synced', sheet_row = ?, sync_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).bind(newRowIdx, item.id).run();
        } else {
          await env.DB.prepare(
            "UPDATE activities SET sync_status = 'synced', sync_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).bind(item.id).run();
        }
        syncedCount++;
      } else if (item.sync_status === "pending_update") {
        if (item.sheet_row && item.sheet_row > 1) {
          const rowValues = [
            item.customer, item.date, item.raised_by, item.services,
            item.category, item.project, item.task_description, item.root_cause,
            item.solution, item.clock_in, item.clock_out, item.duration || "00:00", item.status, item.remarks
          ];
          await updateSheetValues(env.SPREADSHEET_LOGS_ID, `Activity_Log!B${item.sheet_row}:O${item.sheet_row}`, rowValues, token);
        }
        await env.DB.prepare(
          "UPDATE activities SET sync_status = 'synced', sync_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(item.id).run();
        syncedCount++;
      } else if (item.sync_status === "pending_delete") {
        if (item.sheet_row && item.sheet_row > 1) {
          await deleteSheetRow(env.SPREADSHEET_LOGS_ID, "Activity_Log", item.sheet_row, token);
        }
        await env.DB.prepare("DELETE FROM activities WHERE id = ?").bind(item.id).run();
        syncedCount++;
      }
    } catch (err) {
      console.error(`Error syncing item ${item.id}:`, err);
      await env.DB.prepare(
        "UPDATE activities SET sync_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(String(err.message || err).slice(0, 500), item.id).run();
    }
  }

  if (syncedCount > 0) {
    invalidateActivitiesCache();
    await setSyncMeta(env.DB, "last_push_time", new Date().toISOString());
  }
  return syncedCount;
}

async function fullSyncCycle(env) {
  if (env.DB) {
    await ensureD1Schema(env.DB);
  }
  try {
    await pushPendingToSheets(env);
    await syncConfigFromSheets(env);
    await pullActivitiesFromSheets(env);
    if (env.DB) {
      await setSyncMeta(env.DB, "last_sync_error", "");
    }
  } catch (err) {
    console.error("Full sync cycle error:", err);
    if (env.DB) {
      await setSyncMeta(env.DB, "last_sync_error", String(err.message || err).slice(0, 300));
    }
    throw err;
  }
}

// ==========================================
// === GEMINI AI SERVICE ===
// ==========================================

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash"];

async function callGemini(prompt, apiKey, systemInstruction = null) {
  if (!apiKey) throw new Error("Gemini API key is required.");

  let lastError = null;
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const contents = [];
    if (systemInstruction) {
      contents.push({ role: "user", parts: [{ text: `System Instructions: ${systemInstruction}` }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I will strictly follow these instructions." }] });
    }
    contents.push({ role: "user", parts: [{ text: prompt }] });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.3,
            topP: 0.85,
            maxOutputTokens: 2048
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        lastError = `HTTP ${res.status} (${model}): ${errText}`;
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
      return "No content generated by Gemini.";
    } catch (e) {
      lastError = `Error calling ${model}: ${e.message}`;
      continue;
    }
  }
  throw new Error(lastError || "Failed to call Gemini API.");
}

async function generateExecutiveSummary(activities, periodStr, apiKey) {
  if (!activities || activities.length === 0) {
    return "No activity logs available for the selected period.";
  }

  const total = activities.length;
  const closed = activities.filter(a => a.status === "Closed").length;
  const inProgress = total - closed;
  const totalMins = activities.reduce((sum, a) => sum + (a.durationMinutes || 0), 0);
  const totalHours = (totalMins / 60).toFixed(1);

  const customerCounts = {};
  const serviceCounts = {};
  const categoryCounts = {};
  const sampleIssues = [];

  for (const a of activities) {
    const cust = a.customer || "Unknown";
    customerCounts[cust] = (customerCounts[cust] || 0) + 1;

    const svc = a.services || "General";
    serviceCounts[svc] = (serviceCounts[svc] || 0) + 1;

    const cat = a.category || "General";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

    if (sampleIssues.length < 15 && (a.taskDescription || a.rootCause)) {
      sampleIssues.push(
        `- [${cust}] (${cat}/${svc}) ${a.taskDescription || "No desc"}. RC: ${a.rootCause || "N/A"}. Sol: ${a.solution || "N/A"}`
      );
    }
  }

  const prompt = `
Generate a formal Executive Operations & Support Summary based on the following verified incident and maintenance records:

**Reporting Period**: ${periodStr}
**High-Level Operational Metrics**:
- Total Tasks/Incidents Logged: ${total}
- Resolved / Closed: ${closed} (${total > 0 ? Math.round((closed / total) * 100) : 0}%)
- Currently In Progress: ${inProgress}
- Total Engineering Time Spent: ${totalHours} hours

**Workload Distribution by Customer**:
${JSON.stringify(customerCounts, null, 2)}

**Workload by Service**:
${JSON.stringify(serviceCounts, null, 2)}

**Workload by Category**:
${JSON.stringify(categoryCounts, null, 2)}

**Sample Incident Notes & Solutions**:
${sampleIssues.join("\n")}

**Output Format Instructions**:
Structure your response in Markdown with the following clear sections:
1. ### 📌 Executive Overview
   A concise executive summary paragraph highlighting major achievements, system stability, and SLA adherence.
2. ### 🔍 Key Incidents & Root Causes
   Bullet points of the most critical issues encountered, their root causes, and resolutions implemented.
3. ### 📈 Service & Customer Trends
   Observations on which customers or cloud services required the most engineering bandwidth and why.
4. ### 💡 Proactive Recommendations
   2-4 actionable technical recommendations to prevent recurring issues and improve efficiency.

Keep the tone objective, professional, and suitable for presentation to Director / VP-level stakeholders.
`;

  return await callGemini(
    prompt,
    apiKey,
    "You are a Principal Cloud Architect and Operations Lead creating executive-level incident and operational summaries."
  );
}

async function polishActivityNotes(taskDesc, rootCause, solution, apiKey) {
  const prompt = `
You are a Cloud Managed Services Operations Specialist.
Improve and professionally format the following activity log notes so they are clear, grammatically correct, and suitable for client presentation:

Task Description:
"""${taskDesc || ""}"""

Root Cause:
"""${rootCause || ""}"""

Solution / Action Taken:
"""${solution || ""}"""

Respond ONLY with valid JSON in this exact structure:
{
  "taskDescription": "polished task description",
  "rootCause": "polished root cause",
  "solution": "polished solution"
}
`;

  const raw = await callGemini(prompt, apiKey, "Respond ONLY in raw JSON. Do not wrap in markdown codeblocks if possible.");
  const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { taskDescription: taskDesc, rootCause, solution };
  }
}

// ==========================================
// === MAIN WORKER ROUTER ===
// ==========================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 1. Basic Auth check
    if (!checkBasicAuth(request, env)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="MS Support Tracker"' }
      });
    }

    // Ensure D1 database schema exists
    if (env.DB) {
      await ensureD1Schema(env.DB);
    }

    // 2. Health check
    if (path === "/healthz") {
      try {
        const total = await countTotalActivities(env.DB);
        const pending = await countPendingSync(env.DB);
        const lastPull = await getSyncMeta(env.DB, "last_pull_time");
        const lastPush = await getSyncMeta(env.DB, "last_push_time");
        const lastError = await getSyncMeta(env.DB, "last_sync_error");

        return jsonResponse({
          status: "ok",
          storage: "cloudflare-d1",
          total_activities: total,
          pending_sync: pending,
          last_pull: lastPull,
          last_push: lastPush,
          last_sync_error: lastError || ""
        });
      } catch (e) {
        return jsonResponse({ status: "error", error: e.message }, 500);
      }
    }

    // 3. API Routes
    if (path === "/api/sync-status" && method === "GET") {
      try {
        const total = await countTotalActivities(env.DB);
        const pending = await countPendingSync(env.DB);
        const lastPull = await getSyncMeta(env.DB, "last_pull_time");
        const lastPush = await getSyncMeta(env.DB, "last_push_time");
        const lastError = await getSyncMeta(env.DB, "last_sync_error");

        return jsonResponse({
          total_activities: total,
          pending_sync: pending,
          last_pull: lastPull,
          last_push: lastPush,
          last_sync_error: lastError || ""
        });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/trigger-sync" && method === "POST") {
      try {
        await fullSyncCycle(env);
        const err = (await getSyncMeta(env.DB, "last_sync_error")) || "";
        return jsonResponse({
          status: err ? "error" : "sync_completed",
          message: err ? err : "Full synchronization completed"
        });
      } catch (e) {
        return jsonResponse({ status: "error", message: e.message }, 500);
      }
    }

    if (path === "/api/force-resolve-pending-sync" && method === "POST") {
      try {
        await env.DB.prepare(
          "UPDATE activities SET sync_status = 'synced' WHERE sync_status IN ('pending_insert', 'pending_update')"
        ).run();
        invalidateActivitiesCache();
        await setSyncMeta(env.DB, "last_sync_error", "");
        return jsonResponse({ status: "success", message: "All pending sync items marked as synced locally" });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/customers" && method === "GET") {
      try {
        let customers = await getCachedCustomers(env.DB);
        if (!customers || customers.length === 0) {
          try {
            await syncConfigFromSheets(env);
            customers = await getCachedCustomers(env.DB);
          } catch (err) {
            console.warn("Sheet sync error during customers bootstrap:", err);
          }
        }
        return jsonResponse(customers);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/customer-resources" && method === "GET") {
      try {
        const customer = url.searchParams.get("customer") || "";
        let data = await getCachedResources(env.DB, customer);
        if (!data.raisedBy || data.raisedBy.length === 0) {
          try {
            await syncConfigFromSheets(env);
            data = await getCachedResources(env.DB, customer);
          } catch (err) {
            console.warn("Sheet sync error during resources bootstrap:", err);
          }
        }
        return jsonResponse(data);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/activity-logs" && method === "GET") {
      try {
        const refresh = url.searchParams.get("refresh") === "true";
        const orderBy = url.searchParams.get("order_by") || "sheet_desc";

        let logs = await getActivities(env.DB, orderBy);

        // Auto-bootstrap: If D1 is empty or refresh requested, pull from Google Sheets
        if (logs.length === 0 || refresh) {
          try {
            await pullActivitiesFromSheets(env);
            await syncConfigFromSheets(env);
            logs = await getActivities(env.DB, orderBy);
          } catch (err) {
            console.warn("Bootstrap sync error during activity logs fetch:", err);
          }
        }

        return jsonResponse(logs);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/submit-activity" && method === "POST") {
      try {
        const data = await request.json();
        const { durationStr, durationMinutes } = calculateDuration(data.clockIn, data.clockOut);

        const newId = await insertActivity(env.DB, {
          ...data,
          duration: durationStr,
          durationMinutes: durationMinutes
        }, "pending_insert");

        ctx.waitUntil(pushPendingToSheets(env));
        return jsonResponse({ status: "success", id: newId });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/update-status" && method === "POST") {
      try {
        const data = await request.json();
        await updateActivityStatus(env.DB, data.rowId, data.status, "pending_update");
        ctx.waitUntil(pushPendingToSheets(env));
        return jsonResponse({ status: "success" });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/update-ticket-deduction" && method === "POST") {
      try {
        const data = await request.json();
        await updateActivityTicketDeduction(env.DB, data.rowId, data.ticketDeduction);
        return jsonResponse({ status: "success", ticketDeduction: data.ticketDeduction });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/update-record" && method === "POST") {
      try {
        const data = await request.json();
        let { durationStr, durationMinutes } = calculateDuration(data.clockIn, data.clockOut);

        if (durationMinutes === 0 && !data.clockIn && !data.clockOut) {
          const existing = await env.DB.prepare(
            "SELECT clock_in, clock_out, duration, duration_minutes FROM activities WHERE id = ?"
          ).bind(data.rowId).first();
          if (existing && !existing.clock_in && !existing.clock_out && existing.duration_minutes > 0) {
            durationStr = existing.duration || "00:00";
            durationMinutes = existing.duration_minutes || 0;
          }
        }

        await updateActivity(env.DB, data.rowId, {
          ...data,
          duration: durationStr,
          durationMinutes: durationMinutes
        }, "pending_update");

        ctx.waitUntil(pushPendingToSheets(env));
        return jsonResponse({ status: "success" });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path.startsWith("/api/delete-record/") && method === "DELETE") {
      try {
        const rowId = parseInt(path.split("/").pop(), 10);
        await deleteActivity(env.DB, rowId);
        ctx.waitUntil(pushPendingToSheets(env));
        return jsonResponse({ status: "success" });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/ai/executive-summary" && method === "POST") {
      try {
        const reqData = await request.json();
        const apiKey = reqData.apiKey || env.GEMINI_API_KEY || "";
        if (!apiKey) {
          return jsonResponse({ error: "Gemini API key is required." }, 400);
        }

        const allLogs = await getActivities(env.DB, "date_desc");
        let filtered = allLogs;

        if (reqData.customer) {
          filtered = filtered.filter(a => a.customer === reqData.customer);
        }
        if (reqData.startDate) {
          filtered = filtered.filter(a => a.date >= reqData.startDate);
        }
        if (reqData.endDate) {
          filtered = filtered.filter(a => a.date <= reqData.endDate);
        }

        if (filtered.length === 0) filtered = allLogs.slice(0, 50);

        let periodStr = `${reqData.startDate || "All time"} to ${reqData.endDate || "Present"}`;
        if (reqData.customer) periodStr += ` (Customer: ${reqData.customer})`;

        const summary = await generateExecutiveSummary(filtered, periodStr, apiKey);
        return jsonResponse({ summary, count: filtered.length, period: periodStr });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/ai/polish" && method === "POST") {
      try {
        const reqData = await request.json();
        const apiKey = reqData.apiKey || env.GEMINI_API_KEY || "";
        if (!apiKey) {
          return jsonResponse({ error: "Gemini API key is required." }, 400);
        }

        const polished = await polishActivityNotes(
          reqData.taskDescription || "",
          reqData.rootCause || "",
          reqData.solution || "",
          apiKey
        );
        return jsonResponse(polished);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (path === "/api/knowledge-base/search" && method === "GET") {
      try {
        const q = url.searchParams.get("q") || "";
        const customer = url.searchParams.get("customer") || null;
        const services = url.searchParams.get("services") || null;
        const results = await searchKnowledgeBase(env.DB, q, customer, services, 6);
        return jsonResponse({ results, count: results.length });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    // 4. Serve Static Assets (Workers with Assets binding)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },

  // 5. Cloudflare Workers Cron Trigger for periodic sync
  async scheduled(event, env, ctx) {
    if (env.DB) {
      await ensureD1Schema(env.DB);
    }
    ctx.waitUntil(fullSyncCycle(env));
  }
};
