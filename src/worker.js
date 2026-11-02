/**
 * Cloudflare Worker for MS Support Activity Tracker
 * Full-stack serverless runtime with Cloudflare D1 and Google Sheets Sync
 */

// ==========================================
// === HELPERS & UTILITIES ===
// ==========================================

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self';"
};

const workerRateLimitBuckets = new Map();
let lastWorkerRateLimitPrune = 0;

function pruneWorkerRateLimits(now, maxWindowMs = 900000) {
  if (workerRateLimitBuckets.size < 500 && (now - lastWorkerRateLimitPrune) < 300000) {
    return;
  }
  lastWorkerRateLimitPrune = now;
  for (const [key, tsList] of workerRateLimitBuckets.entries()) {
    if (!tsList || tsList.length === 0 || (now - tsList[tsList.length - 1]) > maxWindowMs) {
      workerRateLimitBuckets.delete(key);
    }
  }
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function checkWorkerRateLimit(bucketKey, maxRequests, windowMs) {
  const now = Date.now();
  pruneWorkerRateLimits(now);
  let timestamps = workerRateLimitBuckets.get(bucketKey) || [];
  timestamps = timestamps.filter(ts => now - ts < windowMs);
  if (timestamps.length >= maxRequests) {
    workerRateLimitBuckets.set(bucketKey, timestamps);
    return false;
  }
  timestamps.push(now);
  workerRateLimitBuckets.set(bucketKey, timestamps);
  return true;
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...headers
    }
  });
}

async function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b)))
  ]);
  const viewA = new Uint8Array(hashA);
  const viewB = new Uint8Array(hashB);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(viewA, viewB) && String(a).length === String(b).length;
  }
  let diff = String(a).length ^ String(b).length;
  for (let i = 0; i < viewA.length; i++) {
    diff |= viewA[i] ^ viewB[i];
  }
  return diff === 0;
}

const SESSION_COOKIE_NAME = "ms_session";
const SESSION_TTL_REMEMBER = 30 * 86400; // 30 days
const SESSION_TTL_DEFAULT = 24 * 3600;   // 24 hours

export function getAuthConfig(env) {
  const username = env.AUTH_USERNAME ? String(env.AUTH_USERNAME).trim() : "";
  const password = env.AUTH_PASSWORD ? String(env.AUTH_PASSWORD).trim() : "";
  const authUsersRaw = env.AUTH_USERS ? String(env.AUTH_USERS).trim() : "";
  const authRequired = ["1", "true", "yes"].includes(String(env.AUTH_REQUIRED || "").trim().toLowerCase());

  if (Boolean(username) !== Boolean(password)) {
    return { users: {}, authEnabled: true, misconfigured: true };
  }
  const users = {};
  if (username && password) {
    users[username] = password;
  }
  if (authUsersRaw) {
    for (const part of authUsersRaw.split(",")) {
      const sep = part.indexOf(":");
      if (sep !== -1) {
        const u = part.slice(0, sep).trim();
        const p = part.slice(sep + 1).trim();
        if (u && p) users[u] = p;
      }
    }
  }
  const hasUsers = Object.keys(users).length > 0;
  if (!hasUsers) {
    return { users: {}, authEnabled: authRequired, misconfigured: authRequired };
  }
  return { users, authEnabled: true, misconfigured: false };
}

async function getSigningHmacKey(env, users) {
  const enc = new TextEncoder();
  let secretStr = env.AUTH_SECRET ? String(env.AUTH_SECRET).trim() : "";
  if (!secretStr) {
    const sortedPairs = Object.entries(users)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([u, p]) => `${u}:${p}`)
      .join("|");
    secretStr = `${sortedPairs}|ms-tracker-hmac-v1`;
  }
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secretStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createWorkerSessionToken(username, ttlSeconds, env, users) {
  const now = Math.floor(Date.now() / 1000);
  const payloadStr = JSON.stringify({ u: username, iat: now, exp: now + ttlSeconds });
  const payloadB64 = base64UrlEncode(payloadStr);
  const key = await getSigningHmacKey(env, users);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sigB64 = arrayBufferToBase64Url(sigBuf);
  return `${payloadB64}.${sigB64}`;
}

async function verifyWorkerSessionToken(token, env, users) {
  if (!token || !token.includes(".") || !users || Object.keys(users).length === 0) return null;
  try {
    const [payloadB64, sigB64] = token.split(".", 2);
    const key = await getSigningHmacKey(env, users);
    const expectedSigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
    const expectedSigB64 = arrayBufferToBase64Url(expectedSigBuf);
    if (!(await constantTimeEqual(sigB64, expectedSigB64))) return null;
    const pad = "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const jsonStr = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const payload = JSON.parse(jsonStr);
    const now = Math.floor(Date.now() / 1000);
    if (!payload || Number(payload.exp || 0) <= now) return null;
    const u = String(payload.u || "");
    if (!Object.prototype.hasOwnProperty.call(users, u)) return null;
    return u;
  } catch {
    return null;
  }
}

function getCookieValue(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx !== -1) {
      const k = part.slice(0, idx).trim();
      if (k === name) return part.slice(idx + 1).trim();
    }
  }
  return null;
}

async function verifyUserCredentials(username, password, users) {
  let matched = null;
  for (const [cfgUser, cfgPass] of Object.entries(users)) {
    const [uOk, pOk] = await Promise.all([
      constantTimeEqual(username, cfgUser),
      constantTimeEqual(password, cfgPass)
    ]);
    if (uOk && pOk) matched = cfgUser;
  }
  return matched;
}

export async function getAuthenticatedUser(request, env) {
  const { users, authEnabled, misconfigured } = getAuthConfig(env);
  if (misconfigured) return null;
  if (!authEnabled) return "anonymous";

  // 1. Check signed HttpOnly session cookie
  const cookieToken = getCookieValue(request, SESSION_COOKIE_NAME);
  if (cookieToken) {
    const cookieUser = await verifyWorkerSessionToken(cookieToken, env, users);
    if (cookieUser) return cookieUser;
  }

  // 2. Fallback to HTTP Basic Auth header
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Basic ")) {
    const clientIp = getClientIp(request);
    if (!checkWorkerRateLimit(`auth_attempt:${clientIp}`, 20, 15 * 60 * 1000)) {
      return null;
    }
    try {
      const creds = atob(authHeader.slice(6));
      const sepIdx = creds.indexOf(":");
      if (sepIdx !== -1) {
        const u = creds.slice(0, sepIdx);
        const p = creds.slice(sepIdx + 1);
        const matched = await verifyUserCredentials(u, p, users);
        if (matched) return matched;
      }
    } catch {}
  }

  return null;
}

export async function checkBasicAuth(request, env) {
  const user = await getAuthenticatedUser(request, env);
  return Boolean(user);
}

function sanitizeSheetCell(val) {
  if (typeof val !== "string") return val;
  const trimmed = val.trimStart();
  if (trimmed && ["=", "+", "-", "@", "\t", "\r"].includes(trimmed[0])) {
    return `'${val}`;
  }
  return val;
}

function validateActivityInput(data) {
  if (!data || typeof data !== "object") {
    return "Invalid JSON payload.";
  }
  const strFields = [
    ["customer", 200, true],
    ["date", 40, true],
    ["raisedBy", 200, false],
    ["services", 200, true],
    ["category", 100, true],
    ["project", 200, false],
    ["taskDescription", 5000, true],
    ["rootCause", 5000, false],
    ["solution", 5000, false],
    ["clockIn", 64, false],
    ["clockOut", 64, false],
    ["remarks", 2000, false]
  ];
  for (const [field, maxLen, required] of strFields) {
    const val = data[field];
    if (required && (!val || typeof val !== "string" || !val.trim())) {
      return `Field '${field}' is required.`;
    }
    if (val !== undefined && val !== null && String(val).length > maxLen) {
      return `Field '${field}' exceeds maximum length (${maxLen}).`;
    }
  }
  if (data.status && !["In Progress", "Closed"].includes(data.status)) {
    return "Invalid status value.";
  }
  if (data.ticketDeduction !== undefined && data.ticketDeduction !== null) {
    const num = Number(data.ticketDeduction);
    if (isNaN(num) || num < 0 || num > 100) {
      return "Invalid ticketDeduction value.";
    }
  }
  return null;
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
  const safeValues = (values || []).map(sanitizeSheetCell);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [safeValues] })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to append sheet row (${res.status}): ${err}`);
  }
  return await res.json();
}

async function updateSheetValues(spreadsheetId, range, values, token) {
  const safeValues = (values || []).map(sanitizeSheetCell);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [safeValues] })
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
    contract_code TEXT DEFAULT '',
    contract_quota REAL DEFAULT 0.0,
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
  )`,
  `UPDATE activities
   SET ticket_deduction = 1.0
   WHERE (
     UPPER(customer) LIKE '%MSIG%'
     OR UPPER(customer) LIKE '%MITSUI SUMITOMO%'
     OR UPPER(customer) LIKE '%ASJ%'
     OR UPPER(customer) LIKE '%SIMAS JIWA%'
     OR UPPER(customer) LIKE '%ASURANSI SIMAS%'
   )
   AND LOWER(TRIM(category)) = 'issue'
   AND (ticket_deduction IS NULL OR ticket_deduction = 0.0)
   AND NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'migration_contract_fullname_v1')`,
  `INSERT OR IGNORE INTO sync_meta (key, value, updated_at)
   VALUES ('migration_contract_fullname_v1', '1', CURRENT_TIMESTAMP)`
];

function inferContractCode(customer) {
  if (!customer) return "";
  const upper = String(customer).toUpperCase();
  if (upper.includes("MSIG") || upper.includes("MITSUI SUMITOMO")) return "MSIG";
  if (upper.includes("ASJ") || upper.includes("SIMAS JIWA") || upper.includes("ASURANSI SIMAS")) return "ASJ";
  return "";
}

function isContractCustomerName(customer) {
  return inferContractCode(customer) !== "";
}

let schemaInitialized = false;
async function ensureD1Schema(db) {
  if (schemaInitialized || !db) return;
  try {
    const batch = D1_SCHEMA_STATEMENTS.map(sql => db.prepare(sql));
    await db.batch(batch);
    try {
      await db.prepare("ALTER TABLE config_customers ADD COLUMN contract_code TEXT DEFAULT ''").run();
    } catch {}
    try {
      await db.prepare("ALTER TABLE config_customers ADD COLUMN contract_quota REAL DEFAULT 0.0").run();
    } catch {}
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
      ticket_deduction = ?,
      sync_status = CASE WHEN sync_status = 'pending_insert' THEN 'pending_insert' ELSE 'pending_update' END,
      updated_at = CURRENT_TIMESTAMP
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

async function getContractConfig(db) {
  let custRows = [];
  let metaRows = [];
  try {
    const resCust = await db.prepare("SELECT name, contract_code, contract_quota FROM config_customers ORDER BY name ASC").all();
    custRows = resCust.results || [];
  } catch {
    const resCustFallback = await db.prepare("SELECT name FROM config_customers ORDER BY name ASC").all();
    custRows = resCustFallback.results || [];
  }
  try {
    const resMeta = await db.prepare("SELECT key, value FROM sync_meta WHERE key LIKE 'contract_quota_%'").all();
    metaRows = resMeta.results || [];
  } catch {}

  const quotas = { MSIG: 50.0, ASJ: 50.0 };
  for (const m of metaRows) {
    const code = String(m.key || "").replace("contract_quota_", "").trim().toUpperCase();
    if (!code || code === "ACTIVITIES" || code === "ACTIVITY_LOG") continue;
    const val = parseFloat(m.value);
    if (!isNaN(val) && val > 0) {
      quotas[code] = val;
    }
  }

  const clients = {
    MSIG: { code: "MSIG", label: "MSIG Life", quota: quotas.MSIG || 50.0 },
    ASJ: { code: "ASJ", label: "Asuransi Simas Jiwa", quota: quotas.ASJ || 50.0 }
  };
  const customerMap = {};

  for (const r of custRows) {
    const name = String(r.name || "").trim();
    const inferred = inferContractCode(name);
    let rawCode = String(r.contract_code || "").trim().toUpperCase();
    if (rawCode === "ACTIVITIES" || rawCode === "ACTIVITY_LOG") rawCode = "";
    const code = inferred || rawCode;
    const q = parseFloat(r.contract_quota || 0.0) || 0.0;
    if (code) {
      customerMap[name.toUpperCase()] = code;
      if (q > 1 && quotas[code] === undefined) {
        quotas[code] = q;
      }
      if (!clients[code]) {
        clients[code] = { code, label: name, quota: quotas[code] || (q > 1 ? q : 50.0) };
      } else {
        clients[code].quota = quotas[code] || (q > 1 ? q : clients[code].quota);
      }
    }
  }

  return { quotas, clients, customerMap };
}

async function saveContractQuota(db, client, quota) {
  const code = String(client || "").trim().toUpperCase();
  if (!code) return await getContractConfig(db);
  const qVal = Math.max(1.0, parseFloat(quota || 50.0) || 50.0);
  await setSyncMeta(db, `contract_quota_${code}`, String(qVal));
  try {
    await db.prepare(
      "UPDATE config_customers SET contract_quota = ?, updated_at = CURRENT_TIMESTAMP WHERE UPPER(contract_code) = ?"
    ).bind(qVal, code).run();
  } catch {}
  return await getContractConfig(db);
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
  const keywords = String(query || "")
    .slice(0, 200)
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .slice(0, 6);

  let sql = `
    SELECT id, customer, date, services, category, project, task_description, root_cause, solution, duration, status
    FROM activities
    WHERE (root_cause != '' OR solution != '')
      AND sync_status != 'pending_delete'
  `;
  const bindParams = [];
  if (keywords.length > 0) {
    const likeClauses = [];
    for (const kw of keywords) {
      const escapedKw = kw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      likeClauses.push("(LOWER(task_description) LIKE ? ESCAPE '\\' OR LOWER(root_cause) LIKE ? ESCAPE '\\' OR LOWER(solution) LIKE ? ESCAPE '\\')");
      bindParams.push(`%${escapedKw}%`, `%${escapedKw}%`, `%${escapedKw}%`);
    }
    sql += " AND (" + likeClauses.join(" OR ") + ")";
  }
  sql += " ORDER BY id DESC LIMIT 250";

  const stmt = db.prepare(sql);
  const { results } = bindParams.length > 0 ? await stmt.bind(...bindParams).all() : await stmt.all();

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
    const custRows = await fetchSheetValues(env.SPREADSHEET_CONFIG_ID, "Customer_Config!A:C", token);
    if (custRows && custRows.length > 1) {
      const headers = (custRows[0] || []).map(h => String(h || "").trim().toLowerCase());
      const quotaIdx = headers.findIndex(h => h.includes("quota"));
      const codeIdx = headers.findIndex(h => h.includes("contract") && !h.includes("quota"));

      await env.DB.prepare("DELETE FROM config_customers").run();
      const stmts = [];
      for (const row of custRows.slice(1)) {
        const name = (row[0] || "").trim();
        if (name) {
          let quotaVal = 0.0;
          let codeVal = "";
          if (quotaIdx > 0 && row.length > quotaIdx && String(row[quotaIdx] || "").trim()) {
            const p = parseFloat(String(row[quotaIdx]).trim());
            if (!isNaN(p) && p > 0) quotaVal = p;
          }
          if (codeIdx > 0 && row.length > codeIdx && String(row[codeIdx] || "").trim()) {
            const rawCode = String(row[codeIdx]).trim().toUpperCase();
            if (rawCode !== "ACTIVITIES" && rawCode !== "ACTIVITY_LOG") {
              codeVal = rawCode;
            }
          }
          const finalCode = inferContractCode(name) || codeVal;
          stmts.push(
            env.DB.prepare(
              "INSERT OR IGNORE INTO config_customers (name, contract_code, contract_quota) VALUES (?, ?, ?)"
            ).bind(name, finalCode, quotaVal)
          );
          if (finalCode && quotaVal > 1) {
            stmts.push(
              env.DB.prepare(
                "INSERT OR REPLACE INTO sync_meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
              ).bind(`contract_quota_${finalCode}`, String(quotaVal))
            );
          }
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
  const rows = await fetchSheetValues(env.SPREADSHEET_LOGS_ID, "Activity_Log!A:P", token);
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
           duration, duration_minutes, status, remarks, ticket_deduction
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
    const rawDeduction = (
      getVal(row, "Ticket Deduction") ||
      getVal(row, "TicketDeduction") ||
      getVal(row, "Ticket Quota") ||
      (row.length > 15 ? row[15] : "")
    );
    let hasSheetDeduction = false;
    let sheetDeductionVal = 0.0;
    if (String(rawDeduction ?? "").trim() !== "") {
      const parsedDed = parseFloat(String(rawDeduction).trim());
      if (!isNaN(parsedDed)) {
        sheetDeductionVal = parsedDed;
        hasSheetDeduction = true;
      }
    }

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
          existing.remarks !== remarks ||
          (hasSheetDeduction && Number(existing.ticket_deduction || 0.0) !== sheetDeductionVal)
        );

        if (hasChanged) {
          let updatedDeduction = Number(existing.ticket_deduction || 0.0);
          if (hasSheetDeduction) {
            updatedDeduction = sheetDeductionVal;
          } else if (
            updatedDeduction === 0.0 &&
            existing.customer !== customer &&
            isContractCustomerName(customer) &&
            (category || "").trim().toLowerCase() === "issue"
          ) {
            updatedDeduction = 1.0;
          }
          stmts.push(env.DB.prepare(`
            UPDATE activities SET
              sheet_row = ?, customer = ?, date = ?, raised_by = ?, services = ?, category = ?,
              project = ?, task_description = ?, root_cause = ?, solution = ?, clock_in = ?,
              clock_out = ?, duration = ?, duration_minutes = ?, status = ?, remarks = ?,
              ticket_deduction = ?, sync_status = 'synced', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(
            idxRow, customer, formattedDate, raisedBy, services, category,
            project, taskDesc, rootCause, solution, String(rawClockIn), String(rawClockOut),
            durationStr, durationMinutes, status, remarks, updatedDeduction, existing.id
          ));
        }
      }
      updatedCount++;
    } else {
      let defaultDeduction = 0.0;
      if (hasSheetDeduction) {
        defaultDeduction = sheetDeductionVal;
      } else if (isContractCustomerName(customer) && (category || "").trim().toLowerCase() === "issue") {
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

let activePushPromise = null;

async function _pushPendingToSheetsImpl(env) {
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

  // Build UUID -> row index map once if there are updates or deletes
  const uuidToRow = new Map();
  const hasUpdatesOrDeletes = pending.some(p => p.sync_status === "pending_update" || p.sync_status === "pending_delete");
  if (hasUpdatesOrDeletes) {
    try {
      const colARows = await fetchSheetValues(env.SPREADSHEET_LOGS_ID, "Activity_Log!A:A", token);
      for (let idx = 1; idx < colARows.length; idx++) {
        const cellVal = colARows[idx] && colARows[idx][0] ? String(colARows[idx][0]).trim() : "";
        if (cellVal) uuidToRow.set(cellVal, idx + 1);
      }
    } catch (e) {
      console.warn("Could not pre-fetch UUID column for row lookup:", e);
    }
  }

  const insertsAndUpdates = pending.filter(p => p.sync_status === "pending_insert" || p.sync_status === "pending_update");
  const deletes = pending.filter(p => p.sync_status === "pending_delete");

  // 1. Process inserts and updates first
  for (const item of insertsAndUpdates) {
    try {
      const itemUuid = String(item.uuid || "").trim();
      const targetRow = uuidToRow.get(itemUuid) || item.sheet_row;
      const dedVal = Number(item.ticket_deduction || 0.0);
      const sheetDeduction = (dedVal > 0 || isContractCustomerName(item.customer)) ? dedVal : "";

      if (item.sync_status === "pending_insert") {
        const rowData = [
          item.uuid, item.customer, item.date, item.raised_by, item.services,
          item.category, item.project, item.task_description, item.root_cause,
          item.solution, item.clock_in, item.clock_out, item.duration || "00:00", item.status, item.remarks,
          sheetDeduction
        ];
        const res = await appendSheetValues(env.SPREADSHEET_LOGS_ID, "Activity_Log!A:P", rowData, token);
        let newRowIdx = null;
        const updatedRange = res?.updates?.updatedRange || "";
        const m = updatedRange.match(/A(\d+):/);
        if (m) newRowIdx = parseInt(m[1], 10);

        if (newRowIdx) {
          if (itemUuid) uuidToRow.set(itemUuid, newRowIdx);
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
        if (targetRow && targetRow > 1) {
          const rowValues = [
            item.customer, item.date, item.raised_by, item.services,
            item.category, item.project, item.task_description, item.root_cause,
            item.solution, item.clock_in, item.clock_out, item.duration || "00:00", item.status, item.remarks,
            sheetDeduction
          ];
          await updateSheetValues(env.SPREADSHEET_LOGS_ID, `Activity_Log!B${targetRow}:P${targetRow}`, rowValues, token);
          await env.DB.prepare(
            "UPDATE activities SET sync_status = 'synced', sheet_row = ?, sync_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).bind(targetRow, item.id).run();
        } else {
          await env.DB.prepare(
            "UPDATE activities SET sync_status = 'synced', sync_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).bind(item.id).run();
        }
        syncedCount++;
      }
    } catch (err) {
      console.error(`Error syncing item ${item.id}:`, err);
      await env.DB.prepare(
        "UPDATE activities SET sync_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind("Failed to synchronize record with Google Sheets.", item.id).run();
    }
  }

  // 2. Process deletes in DESCENDING sheet_row order so row deletions never shift subsequent targets
  const deletesWithRows = deletes.map(item => {
    const itemUuid = String(item.uuid || "").trim();
    const resolvedRow = Number(uuidToRow.get(itemUuid) || item.sheet_row || 0);
    return { targetRow: resolvedRow, item };
  }).sort((a, b) => b.targetRow - a.targetRow);

  for (const { targetRow, item } of deletesWithRows) {
    try {
      if (targetRow && targetRow > 1) {
        await deleteSheetRow(env.SPREADSHEET_LOGS_ID, "Activity_Log", targetRow, token);
      }
      await env.DB.prepare("DELETE FROM activities WHERE id = ?").bind(item.id).run();
      syncedCount++;
    } catch (err) {
      console.error(`Error deleting item ${item.id}:`, err);
      await env.DB.prepare(
        "UPDATE activities SET sync_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind("Failed to delete record from Google Sheets.", item.id).run();
    }
  }

  if (syncedCount > 0) {
    invalidateActivitiesCache();
    await setSyncMeta(env.DB, "last_push_time", new Date().toISOString());
  }
  return syncedCount;
}

async function pushPendingToSheets(env) {
  if (activePushPromise) {
    try {
      await activePushPromise;
    } catch {}
  }
  activePushPromise = _pushPendingToSheetsImpl(env);
  try {
    return await activePushPromise;
  } finally {
    activePushPromise = null;
  }
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
      await setSyncMeta(env.DB, "last_sync_error", "Synchronization with Google Sheets encountered an error.");
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const contents = [];
    if (systemInstruction) {
      contents.push({ role: "user", parts: [{ text: `System Instructions: ${systemInstruction}` }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I will strictly follow these instructions." }] });
    }
    contents.push({ role: "user", parts: [{ text: prompt }] });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
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
        console.warn(`Gemini HTTP ${res.status} (${model}):`, errText.slice(0, 300));
        lastError = `Gemini API request failed with HTTP ${res.status} (${model}).`;
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
      return "No content generated by Gemini.";
    } catch (e) {
      console.warn(`Error calling ${model}:`, e);
      lastError = `Error calling Gemini model (${model}).`;
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
    const clientIp = getClientIp(request);

    // 1. Health check (unauthenticated for uptime monitors)
    if (path === "/healthz") {
      return jsonResponse({
        status: "ok",
        storage: "cloudflare-d1"
      });
    }

    // 2. Auth endpoints (/api/auth/login, /api/auth/logout, /api/auth/me, /login)
    if (path === "/api/auth/login" && method === "POST") {
      const { users, authEnabled, misconfigured } = getAuthConfig(env);
      if (misconfigured) {
        return jsonResponse({ detail: "Authentication is required by server policy but credentials are not properly configured." }, 503);
      }
      if (!authEnabled) {
        return jsonResponse({ status: "ok", username: "anonymous", authEnabled: false });
      }
      if (!checkWorkerRateLimit(`login_fail:${clientIp}`, 10, 15 * 60 * 1000)) {
        return jsonResponse(
          { detail: "Too many failed login attempts. Please wait 15 minutes and try again." },
          429,
          { "Retry-After": "900" }
        );
      }
      try {
        const body = await request.json();
        const u = String(body?.username || "").trim();
        const p = String(body?.password || "");
        const rememberMe = body?.rememberMe !== false;

        const matchedUser = await verifyUserCredentials(u, p, users);
        if (!matchedUser) {
          return jsonResponse({ detail: "Invalid username or password." }, 401);
        }

        // Clear rate limit bucket on successful login
        workerRateLimitBuckets.delete(`login_fail:${clientIp}`);

        const ttl = rememberMe ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT;
        const token = await createWorkerSessionToken(matchedUser, ttl, env, users);
        const isHttps = url.protocol === "https:" || (request.headers.get("X-Forwarded-Proto") || "").toLowerCase() === "https";
        const cookieStr = `${SESSION_COOKIE_NAME}=${token}; Max-Age=${ttl}; Path=/; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}`;

        return jsonResponse(
          { status: "ok", username: matchedUser, authEnabled: true, expiresIn: ttl },
          200,
          { "Set-Cookie": cookieStr }
        );
      } catch {
        return jsonResponse({ detail: "Invalid login request payload." }, 400);
      }
    }

    if (path === "/api/auth/logout" && method === "POST") {
      const isHttps = url.protocol === "https:" || (request.headers.get("X-Forwarded-Proto") || "").toLowerCase() === "https";
      const clearCookie = `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}`;
      return jsonResponse({ status: "ok" }, 200, { "Set-Cookie": clearCookie });
    }

    if (path === "/api/auth/me" && method === "GET") {
      const { authEnabled, misconfigured } = getAuthConfig(env);
      if (misconfigured) {
        return jsonResponse({ authenticated: false, authEnabled: true, username: null });
      }
      if (!authEnabled) {
        return jsonResponse({ authenticated: true, authEnabled: false, username: "anonymous" });
      }
      const user = await getAuthenticatedUser(request, env);
      return jsonResponse({
        authenticated: Boolean(user),
        authEnabled: true,
        username: user
      });
    }

    // Serve /login page and static assets needed by /login before auth gate
    const isPublicAsset = (
      path.startsWith("/static/") ||
      path === "/favicon.ico" ||
      path === "/favicon.png" ||
      path === "/manifest.json" ||
      path === "/sw.js"
    );

    if (path === "/login" || path === "/login.html") {
      const { authEnabled, misconfigured } = getAuthConfig(env);
      const user = await getAuthenticatedUser(request, env);
      if ((!authEnabled && !misconfigured) || user) {
        return new Response(null, {
          status: 302,
          headers: { Location: "/", ...SECURITY_HEADERS }
        });
      }
      if (env.ASSETS) {
        const loginReq = new Request(new URL("/login", request.url).toString(), {
          method: "GET",
          headers: request.headers
        });
        let assetRes = await env.ASSETS.fetch(loginReq);
        if (assetRes.status === 404) {
          const loginHtmlReq = new Request(new URL("/login.html", request.url).toString(), {
            method: "GET",
            headers: request.headers
          });
          assetRes = await env.ASSETS.fetch(loginHtmlReq);
        }
        const newHeaders = new Headers(assetRes.headers);
        for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
          newHeaders.set(k, v);
        }
        newHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
        return new Response(assetRes.body, {
          status: assetRes.status,
          statusText: assetRes.statusText,
          headers: newHeaders
        });
      }
    }

    if (isPublicAsset && env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      const newHeaders = new Headers(assetRes.headers);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        newHeaders.set(k, v);
      }
      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers: newHeaders
      });
    }

    // 3. Enforce Session Cookie or Basic Auth
    const authUser = await getAuthenticatedUser(request, env);
    if (!authUser) {
      const { misconfigured } = getAuthConfig(env);
      if (misconfigured) {
        return jsonResponse({ detail: "Server authentication is required by policy but credentials are not properly configured." }, 503);
      }
      if (!path.startsWith("/api/")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "/login", ...SECURITY_HEADERS }
        });
      }
      const hasBasicHeader = (request.headers.get("Authorization") || "").toLowerCase().startsWith("basic ");
      const extraHeaders = hasBasicHeader ? { "WWW-Authenticate": 'Basic realm="MS Support Tracker"' } : {};
      return jsonResponse(
        { error: "Unauthorized", detail: "Unauthorized. Please sign in at /login.", loginUrl: "/login" },
        401,
        extraHeaders
      );
    }

    // Ensure D1 database schema exists
    if (env.DB) {
      await ensureD1Schema(env.DB);
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
        console.error("Error in /api/sync-status:", e);
        return jsonResponse({ error: "Failed to fetch sync status." }, 500);
      }
    }

    if (path === "/api/trigger-sync" && method === "POST") {
      if (!checkWorkerRateLimit(`sync:${clientIp}`, 6, 60000)) {
        return jsonResponse({ status: "error", message: "Too many sync requests. Please wait a moment." }, 429, { "Retry-After": "60" });
      }
      try {
        await fullSyncCycle(env);
        const err = (await getSyncMeta(env.DB, "last_sync_error")) || "";
        return jsonResponse({
          status: err ? "error" : "sync_completed",
          message: err ? err : "Full synchronization completed"
        });
      } catch (e) {
        console.error("Error in /api/trigger-sync:", e);
        return jsonResponse({ status: "error", message: "Failed to complete synchronization." }, 500);
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
        console.error("Error in /api/force-resolve-pending-sync:", e);
        return jsonResponse({ error: "Failed to resolve pending sync items." }, 500);
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
        console.error("Error in /api/customers:", e);
        return jsonResponse({ error: "Failed to load customers." }, 500);
      }
    }

    if (path === "/api/contract-config" && method === "GET") {
      try {
        const cfg = await getContractConfig(env.DB);
        return jsonResponse(cfg);
      } catch (e) {
        console.error("Error in GET /api/contract-config:", e);
        return jsonResponse({ error: "Failed to load contract configuration." }, 500);
      }
    }

    if (path === "/api/contract-config" && method === "POST") {
      if (!checkWorkerRateLimit(`write:${clientIp}`, 60, 60000)) {
        return jsonResponse({ error: "Too many requests. Please try again later." }, 429, { "Retry-After": "60" });
      }
      try {
        const data = await request.json();
        const client = String(data?.client || "").trim();
        const quota = Number(data?.quota);
        if (!client || client.length > 50 || isNaN(quota) || quota < 1 || quota > 10000) {
          return jsonResponse({ error: "Invalid client or quota parameter." }, 400);
        }
        const cfg = await saveContractQuota(env.DB, client, quota);
        return jsonResponse(cfg);
      } catch (e) {
        console.error("Error in POST /api/contract-config:", e);
        return jsonResponse({ error: "Failed to save contract configuration." }, 500);
      }
    }

    if (path === "/api/customer-resources" && method === "GET") {
      try {
        const customer = (url.searchParams.get("customer") || "").slice(0, 200);
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
        console.error("Error in /api/customer-resources:", e);
        return jsonResponse({ error: "Failed to load customer resources." }, 500);
      }
    }

    if (path === "/api/activity-logs" && method === "GET") {
      try {
        const refresh = url.searchParams.get("refresh") === "true";
        const orderBy = (url.searchParams.get("order_by") || "sheet_desc").slice(0, 40);

        if (refresh && !checkWorkerRateLimit(`sync:${clientIp}`, 6, 60000)) {
          return jsonResponse({ error: "Too many refresh requests. Please wait a moment." }, 429, { "Retry-After": "60" });
        }

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
        console.error("Error in /api/activity-logs:", e);
        return jsonResponse({ error: "Failed to fetch activity logs." }, 500);
      }
    }

    if (path === "/api/submit-activity" && method === "POST") {
      if (!checkWorkerRateLimit(`write:${clientIp}`, 60, 60000)) {
        return jsonResponse({ error: "Too many requests. Please try again later." }, 429, { "Retry-After": "60" });
      }
      try {
        const data = await request.json();
        const validationErr = validateActivityInput(data);
        if (validationErr) {
          return jsonResponse({ error: validationErr }, 400);
        }
        const { durationStr, durationMinutes } = calculateDuration(data.clockIn, data.clockOut);

        const newId = await insertActivity(env.DB, {
          ...data,
          duration: durationStr,
          durationMinutes: durationMinutes
        }, "pending_insert");

        ctx.waitUntil(pushPendingToSheets(env));
        return jsonResponse({ status: "success", id: newId });
      } catch (e) {
        console.error("Error in /api/submit-activity:", e);
        return jsonResponse({ error: "Failed to submit activity record." }, 500);
      }
    }

    if (path === "/api/update-status" && method === "POST") {
      if (!checkWorkerRateLimit(`write:${clientIp}`, 60, 60000)) {
        return jsonResponse({ error: "Too many requests. Please try again later." }, 429, { "Retry-After": "60" });
      }
      try {
        const data = await request.json();
        const rowId = Number(data?.rowId);
        if (!Number.isInteger(rowId) || rowId < 1 || !["In Progress", "Closed"].includes(data?.status)) {
          return jsonResponse({ error: "Invalid rowId or status." }, 400);
        }
        await updateActivityStatus(env.DB, rowId, data.status, "pending_update");
        ctx.waitUntil(pushPendingToSheets(env));
        return jsonResponse({ status: "success" });
      } catch (e) {
        console.error("Error in /api/update-status:", e);
        return jsonResponse({ error: "Failed to update activity status." }, 500);
      }
    }

    if (path === "/api/update-ticket-deduction" && method === "POST") {
      if (!checkWorkerRateLimit(`write:${clientIp}`, 60, 60000)) {
        return jsonResponse({ error: "Too many requests. Please try again later." }, 429, { "Retry-After": "60" });
      }
      try {
        const data = await request.json();
        const rowId = Number(data?.rowId);
        const deduction = Number(data?.ticketDeduction);
        if (!Number.isInteger(rowId) || rowId < 1 || isNaN(deduction) || deduction < 0 || deduction > 100) {
          return jsonResponse({ error: "Invalid rowId or ticketDeduction." }, 400);
        }
        await updateActivityTicketDeduction(env.DB, rowId, deduction);
        ctx.waitUntil(pushPendingToSheets(env));
        return jsonResponse({ status: "success", ticketDeduction: deduction });
      } catch (e) {
        console.error("Error in /api/update-ticket-deduction:", e);
        return jsonResponse({ error: "Failed to update ticket deduction." }, 500);
      }
    }

    if (path === "/api/update-record" && method === "POST") {
      if (!checkWorkerRateLimit(`write:${clientIp}`, 60, 60000)) {
        return jsonResponse({ error: "Too many requests. Please try again later." }, 429, { "Retry-After": "60" });
      }
      try {
        const data = await request.json();
        const rowId = Number(data?.rowId);
        const validationErr = validateActivityInput(data);
        if (!Number.isInteger(rowId) || rowId < 1 || validationErr) {
          return jsonResponse({ error: validationErr || "Invalid rowId." }, 400);
        }
        let { durationStr, durationMinutes } = calculateDuration(data.clockIn, data.clockOut);

        if (durationMinutes === 0 && !data.clockIn && !data.clockOut) {
          const existing = await env.DB.prepare(
            "SELECT clock_in, clock_out, duration, duration_minutes FROM activities WHERE id = ?"
          ).bind(rowId).first();
          if (existing && !existing.clock_in && !existing.clock_out && existing.duration_minutes > 0) {
            durationStr = existing.duration || "00:00";
            durationMinutes = existing.duration_minutes || 0;
          }
        }

        await updateActivity(env.DB, rowId, {
          ...data,
          duration: durationStr,
          durationMinutes: durationMinutes
        }, "pending_update");

        ctx.waitUntil(pushPendingToSheets(env));
        return jsonResponse({ status: "success" });
      } catch (e) {
        console.error("Error in /api/update-record:", e);
        return jsonResponse({ error: "Failed to update activity record." }, 500);
      }
    }

    if (path.startsWith("/api/delete-record/") && method === "DELETE") {
      if (!checkWorkerRateLimit(`write:${clientIp}`, 60, 60000)) {
        return jsonResponse({ error: "Too many requests. Please try again later." }, 429, { "Retry-After": "60" });
      }
      try {
        const rowId = parseInt(path.split("/").pop(), 10);
        if (isNaN(rowId) || rowId < 1) {
          return jsonResponse({ error: "Invalid record ID." }, 400);
        }
        await deleteActivity(env.DB, rowId);
        ctx.waitUntil(pushPendingToSheets(env));
        return jsonResponse({ status: "success" });
      } catch (e) {
        console.error("Error in /api/delete-record:", e);
        return jsonResponse({ error: "Failed to delete activity record." }, 500);
      }
    }

    if (path === "/api/ai/executive-summary" && method === "POST") {
      if (!checkWorkerRateLimit(`ai:${clientIp}`, 10, 300000)) {
        return jsonResponse({ error: "Too many AI requests. Please wait a few minutes." }, 429, { "Retry-After": "300" });
      }
      try {
        const reqData = await request.json();
        const apiKey = String(reqData?.apiKey || env.GEMINI_API_KEY || "").trim().slice(0, 256);
        if (!apiKey) {
          return jsonResponse({ error: "Gemini API key is required." }, 400);
        }

        const allLogs = await getActivities(env.DB, "date_desc");
        let filtered = allLogs;

        if (reqData.customer) {
          filtered = filtered.filter(a => a.customer === String(reqData.customer).slice(0, 200));
        }
        if (reqData.startDate) {
          filtered = filtered.filter(a => a.date >= String(reqData.startDate).slice(0, 40));
        }
        if (reqData.endDate) {
          filtered = filtered.filter(a => a.date <= String(reqData.endDate).slice(0, 40));
        }

        if (filtered.length === 0) filtered = allLogs.slice(0, 50);

        let periodStr = `${String(reqData.startDate || "All time").slice(0, 40)} to ${String(reqData.endDate || "Present").slice(0, 40)}`;
        if (reqData.customer) periodStr += ` (Customer: ${String(reqData.customer).slice(0, 200)})`;

        const summary = await generateExecutiveSummary(filtered, periodStr, apiKey);
        return jsonResponse({ summary, count: filtered.length, period: periodStr });
      } catch (e) {
        console.error("Error in /api/ai/executive-summary:", e);
        return jsonResponse({ error: "Failed to generate AI executive summary." }, 500);
      }
    }

    if (path === "/api/ai/polish" && method === "POST") {
      if (!checkWorkerRateLimit(`ai:${clientIp}`, 15, 300000)) {
        return jsonResponse({ error: "Too many AI requests. Please wait a few minutes." }, 429, { "Retry-After": "300" });
      }
      try {
        const reqData = await request.json();
        const apiKey = String(reqData?.apiKey || env.GEMINI_API_KEY || "").trim().slice(0, 256);
        if (!apiKey) {
          return jsonResponse({ error: "Gemini API key is required." }, 400);
        }

        const polished = await polishActivityNotes(
          String(reqData.taskDescription || "").slice(0, 5000),
          String(reqData.rootCause || "").slice(0, 5000),
          String(reqData.solution || "").slice(0, 5000),
          apiKey
        );
        return jsonResponse(polished);
      } catch (e) {
        console.error("Error in /api/ai/polish:", e);
        return jsonResponse({ error: "Failed to polish activity notes with AI." }, 500);
      }
    }

    if (path === "/api/knowledge-base/search" && method === "GET") {
      try {
        const q = (url.searchParams.get("q") || "").slice(0, 200);
        const customer = url.searchParams.get("customer") ? url.searchParams.get("customer").slice(0, 200) : null;
        const services = url.searchParams.get("services") ? url.searchParams.get("services").slice(0, 200) : null;
        const results = await searchKnowledgeBase(env.DB, q, customer, services, 6);
        return jsonResponse({ results, count: results.length });
      } catch (e) {
        console.error("Error in /api/knowledge-base/search:", e);
        return jsonResponse({ error: "Failed to search knowledge base." }, 500);
      }
    }

    // 4. Serve Static Assets (Workers with Assets binding) with security headers
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      const newHeaders = new Headers(assetRes.headers);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        newHeaders.set(k, v);
      }
      if (path === "/" || path === "/index.html") {
        newHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
      }
      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers: newHeaders
      });
    }

    return new Response("Not Found", { status: 404, headers: SECURITY_HEADERS });
  },

  // 5. Cloudflare Workers Cron Trigger for periodic sync
  async scheduled(event, env, ctx) {
    if (env.DB) {
      await ensureD1Schema(env.DB);
    }
    ctx.waitUntil(fullSyncCycle(env));
  }
};
