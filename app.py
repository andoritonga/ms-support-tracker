import os
import json
import time
import hmac
import base64
import hashlib
import asyncio
import secrets
from collections import defaultdict, deque
from typing import List, Dict, Any, Optional, Literal
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, HTTPException, Depends, BackgroundTasks, Query
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

import db
import sync_service
import ai_service

load_dotenv()

app = FastAPI(title="MS Support Activity Tracker (SQLite + Async Sheets Sync)")
templates = Jinja2Templates(directory="templates")

# --- SECURITY HEADERS & RATE LIMITING ---
_rate_limit_buckets: Dict[str, deque] = defaultdict(deque)
_last_rate_limit_prune = 0.0

def _prune_rate_limit_buckets(now: float, max_window: float = 900.0):
    global _last_rate_limit_prune
    if len(_rate_limit_buckets) < 500 and (now - _last_rate_limit_prune) < 300.0:
        return
    _last_rate_limit_prune = now
    stale_keys = [
        k for k, q in list(_rate_limit_buckets.items())
        if not q or (now - q[-1]) > max_window
    ]
    for k in stale_keys:
        _rate_limit_buckets.pop(k, None)

def get_client_ip(request: Request) -> str:
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def enforce_rate_limit(bucket_key: str, max_requests: int, window_seconds: int):
    now = time.monotonic()
    _prune_rate_limit_buckets(now)
    q = _rate_limit_buckets[bucket_key]
    while q and (now - q[0]) > window_seconds:
        q.popleft()
    if len(q) >= max_requests:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again later.",
            headers={"Retry-After": str(window_seconds)}
        )
    q.append(now)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob: https:; "
        "connect-src 'self' https://cdn.jsdelivr.net; "
        "frame-ancestors 'none'; "
        "base-uri 'self';"
    )
    return response

if not os.path.exists("static"):
    os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/manifest.json", include_in_schema=False)
async def get_manifest():
    return FileResponse("static/manifest.json", media_type="application/manifest+json")

@app.get("/sw.js", include_in_schema=False)
async def get_sw():
    return FileResponse("static/sw.js", media_type="application/javascript")

@app.get("/favicon.ico", include_in_schema=False)
async def get_favicon():
    return FileResponse("static/favicon.ico", media_type="image/x-icon")

# --- SESSION & BASIC AUTHENTICATION (OPTION 1: ENV SECRETS + SIGNED HTTPONLY COOKIE) ---
security = HTTPBasic(auto_error=False)
SESSION_COOKIE_NAME = "ms_session"
SESSION_TTL_REMEMBER = 30 * 86400  # 30 days
SESSION_TTL_DEFAULT = 24 * 3600    # 24 hours

def get_auth_config() -> tuple[Dict[str, str], bool, bool]:
    """Return (users_map, auth_enabled, misconfigured)"""
    username = os.getenv("AUTH_USERNAME", "").strip()
    password = os.getenv("AUTH_PASSWORD", "").strip()
    auth_users_raw = os.getenv("AUTH_USERS", "").strip()
    auth_required = os.getenv("AUTH_REQUIRED", "false").strip().lower() in ("1", "true", "yes")

    users: Dict[str, str] = {}
    if bool(username) != bool(password):
        return {}, True, True
    if username and password:
        users[username] = password

    if auth_users_raw:
        for entry in auth_users_raw.split(","):
            entry = entry.strip()
            if ":" in entry:
                u, p = entry.split(":", 1)
                u, p = u.strip(), p.strip()
                if u and p:
                    users[u] = p

    if not users:
        if auth_required:
            return {}, True, True
        return {}, False, False
    return users, True, False

def _get_signing_secret(users: Dict[str, str]) -> bytes:
    explicit = os.getenv("AUTH_SECRET", "").strip()
    if explicit:
        return explicit.encode("utf-8")
    seed = "|".join(f"{u}:{p}" for u, p in sorted(users.items())) + "|ms-tracker-hmac-v1"
    return hashlib.sha256(seed.encode("utf-8")).digest()

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def _b64url_decode(s: str) -> bytes:
    pad = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("ascii"))

def create_session_token(username: str, ttl_seconds: int, users: Dict[str, str]) -> str:
    now = int(time.time())
    payload = {"u": username, "iat": now, "exp": now + ttl_seconds}
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_get_signing_secret(users), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_b64}.{_b64url_encode(sig)}"

def verify_session_token(token: Optional[str], users: Dict[str, str]) -> Optional[str]:
    if not token or "." not in token or not users:
        return None
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        expected_sig = hmac.new(_get_signing_secret(users), payload_b64.encode("ascii"), hashlib.sha256).digest()
        actual_sig = _b64url_decode(sig_b64)
        if not secrets.compare_digest(expected_sig, actual_sig):
            return None
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
        exp = int(payload.get("exp", 0))
        user = str(payload.get("u", ""))
        if exp <= int(time.time()) or user not in users:
            return None
        return user
    except Exception:
        return None

def verify_user_credentials(username: str, password: str, users: Dict[str, str]) -> Optional[str]:
    matched_user = None
    u_bytes = username.encode("utf-8")
    p_bytes = password.encode("utf-8")
    for cfg_user, cfg_pass in users.items():
        u_ok = secrets.compare_digest(u_bytes, cfg_user.encode("utf-8"))
        p_ok = secrets.compare_digest(p_bytes, cfg_pass.encode("utf-8"))
        if u_ok and p_ok:
            matched_user = cfg_user
    return matched_user

def get_authenticated_user(request: Request, credentials: Optional[HTTPBasicCredentials] = None) -> Optional[str]:
    users, auth_enabled, misconfigured = get_auth_config()
    if misconfigured:
        raise HTTPException(
            status_code=503,
            detail="Server authentication is required by policy but credentials are not properly configured."
        )
    if not auth_enabled:
        return "anonymous"

    # 1. Check signed HttpOnly session cookie first
    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    cookie_user = verify_session_token(cookie_token, users)
    if cookie_user:
        return cookie_user

    # 2. Fallback to HTTP Basic Auth header if provided
    if credentials and credentials.username is not None and credentials.password is not None:
        client_ip = get_client_ip(request)
        auth_fail_key = f"auth_fail:{client_ip}"
        now = time.monotonic()
        fail_q = _rate_limit_buckets[auth_fail_key]
        while fail_q and (now - fail_q[0]) > 900:
            fail_q.popleft()
        if len(fail_q) >= 10:
            raise HTTPException(
                status_code=429,
                detail="Too many failed authentication attempts. Please try again later.",
                headers={"Retry-After": "900"}
            )
        matched = verify_user_credentials(credentials.username, credentials.password, users)
        if matched:
            return matched
        fail_q.append(now)

    return None

def check_auth(request: Request, credentials: Optional[HTTPBasicCredentials] = Depends(security)):
    user = get_authenticated_user(request, credentials)
    if user:
        return True
    # Only include WWW-Authenticate header if caller explicitly sent Basic Auth header,
    # avoiding native browser Basic Auth popup when using the web Login UI
    has_basic_header = (request.headers.get("authorization") or "").lower().startswith("basic ")
    headers = {"WWW-Authenticate": "Basic"} if has_basic_header else {}
    raise HTTPException(
        status_code=401,
        detail="Unauthorized. Please sign in at /login.",
        headers=headers,
    )

# --- MODELS ---
class ActivityPayload(BaseModel):
    customer: str = Field(..., min_length=1, max_length=200)
    date: str = Field(..., min_length=1, max_length=40)
    raisedBy: str = Field(default="", max_length=200)
    services: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., min_length=1, max_length=100)
    project: str = Field(default="", max_length=200)
    taskDescription: str = Field(..., min_length=1, max_length=5000)
    rootCause: str = Field(default="", max_length=5000)
    solution: str = Field(default="", max_length=5000)
    clockIn: str = Field(default="", max_length=64)
    clockOut: str = Field(default="", max_length=64)
    status: Literal["In Progress", "Closed"] = "In Progress"
    remarks: str = Field(default="", max_length=2000)
    ticketDeduction: Optional[float] = Field(default=0.0, ge=0.0, le=100.0)

class UpdateStatusPayload(BaseModel):
    rowId: int = Field(..., ge=1)
    status: Literal["In Progress", "Closed"]

class UpdateTicketDeductionPayload(BaseModel):
    rowId: int = Field(..., ge=1)
    ticketDeduction: float = Field(..., ge=0.0, le=100.0)

class ContractQuotaPayload(BaseModel):
    client: str = Field(..., min_length=1, max_length=50)
    quota: float = Field(..., ge=1.0, le=10000.0)

class UpdateRecordPayload(BaseModel):
    rowId: int = Field(..., ge=1)
    customer: str = Field(..., min_length=1, max_length=200)
    date: str = Field(..., min_length=1, max_length=40)
    raisedBy: str = Field(default="", max_length=200)
    services: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., min_length=1, max_length=100)
    project: str = Field(default="", max_length=200)
    taskDescription: str = Field(..., min_length=1, max_length=5000)
    rootCause: str = Field(default="", max_length=5000)
    solution: str = Field(default="", max_length=5000)
    clockIn: str = Field(default="", max_length=64)
    clockOut: str = Field(default="", max_length=64)
    status: Literal["In Progress", "Closed"] = "In Progress"
    remarks: str = Field(default="", max_length=2000)
    ticketDeduction: Optional[float] = Field(default=0.0, ge=0.0, le=100.0)

class AISummaryRequest(BaseModel):
    startDate: Optional[str] = Field(default="", max_length=40)
    endDate: Optional[str] = Field(default="", max_length=40)
    customer: Optional[str] = Field(default="", max_length=200)
    apiKey: Optional[str] = Field(default="", max_length=256)

class AIPolishRequest(BaseModel):
    taskDescription: Optional[str] = Field(default="", max_length=5000)
    rootCause: Optional[str] = Field(default="", max_length=5000)
    solution: Optional[str] = Field(default="", max_length=5000)
    apiKey: Optional[str] = Field(default="", max_length=256)

class LoginPayload(BaseModel):
    username: str = Field(..., min_length=1, max_length=150)
    password: str = Field(..., min_length=1, max_length=256)
    rememberMe: bool = Field(default=True)

# --- STARTUP & BACKGROUND SYNC WORKER ---

async def background_sync_worker():
    """Periodic background worker to push pending changes and keep SQLite fresh"""
    while True:
        try:
            await asyncio.sleep(60)  # runs every 60 seconds
            await sync_service.full_sync_cycle()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"⚠️ Periodic background sync worker error: {e}")

@app.on_event("startup")
async def on_startup():
    loop = asyncio.get_event_loop()
    # 1. Initialize SQLite database & bootstrap from Sheets if empty
    await loop.run_in_executor(None, sync_service.bootstrap_data)
    # 2. Launch background sync worker task
    asyncio.create_task(background_sync_worker())

# --- ROUTES ---

@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "storage": "sqlite"
    }

@app.get("/login", response_class=HTMLResponse)
async def serve_login(request: Request):
    users, auth_enabled, misconfigured = get_auth_config()
    if not auth_enabled and not misconfigured:
        return RedirectResponse(url="/", status_code=302)
    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    if verify_session_token(cookie_token, users):
        return RedirectResponse(url="/", status_code=302)
    return templates.TemplateResponse(request=request, name="login.html")

@app.post("/api/auth/login")
async def api_login(request: Request, response: Response, payload: LoginPayload):
    users, auth_enabled, misconfigured = get_auth_config()
    if misconfigured:
        raise HTTPException(
            status_code=503,
            detail="Authentication is required by server policy but credentials are not properly configured."
        )
    if not auth_enabled:
        return {"status": "ok", "username": "anonymous", "authEnabled": False}

    client_ip = get_client_ip(request)
    auth_fail_key = f"auth_fail:{client_ip}"
    now = time.monotonic()
    _prune_rate_limit_buckets(now)
    fail_q = _rate_limit_buckets[auth_fail_key]
    while fail_q and (now - fail_q[0]) > 900:
        fail_q.popleft()
    if len(fail_q) >= 10:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please wait 15 minutes and try again.",
            headers={"Retry-After": "900"}
        )

    matched_user = verify_user_credentials(payload.username.strip(), payload.password, users)
    if not matched_user:
        fail_q.append(now)
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    # Clear failed attempts on successful login
    _rate_limit_buckets.pop(auth_fail_key, None)

    ttl = SESSION_TTL_REMEMBER if payload.rememberMe else SESSION_TTL_DEFAULT
    token = create_session_token(matched_user, ttl, users)
    is_https = (
        request.url.scheme == "https"
        or (request.headers.get("x-forwarded-proto") or "").lower() == "https"
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=ttl,
        httponly=True,
        samesite="lax",
        secure=is_https,
        path="/"
    )
    return {
        "status": "ok",
        "username": matched_user,
        "authEnabled": True,
        "expiresIn": ttl
    }

@app.post("/api/auth/logout")
async def api_logout(response: Response):
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/", samesite="lax")
    return {"status": "ok"}

@app.get("/api/auth/me")
async def api_auth_me(request: Request, credentials: Optional[HTTPBasicCredentials] = Depends(security)):
    users, auth_enabled, misconfigured = get_auth_config()
    if misconfigured:
        return {"authenticated": False, "authEnabled": True, "username": None}
    if not auth_enabled:
        return {"authenticated": True, "authEnabled": False, "username": "anonymous"}
    user = get_authenticated_user(request, credentials)
    return {
        "authenticated": bool(user),
        "authEnabled": True,
        "username": user
    }

@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request, credentials: Optional[HTTPBasicCredentials] = Depends(security)):
    user = get_authenticated_user(request, credentials)
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/api/sync-status")
async def get_sync_status(_auth: bool = Depends(check_auth)):
    return {
        "total_activities": db.count_total_activities(),
        "pending_sync": db.count_pending_sync(),
        "last_pull": db.get_sync_meta("last_pull_time"),
        "last_push": db.get_sync_meta("last_push_time"),
        "last_sync_error": db.get_sync_meta("last_sync_error") or ""
    }

@app.post("/api/trigger-sync")
async def trigger_sync(request: Request, _auth: bool = Depends(check_auth)):
    enforce_rate_limit(f"sync:{get_client_ip(request)}", max_requests=6, window_seconds=60)
    await sync_service.full_sync_cycle()
    err = db.get_sync_meta("last_sync_error") or ""
    return {
        "status": "error" if err else "sync_completed",
        "message": err if err else "Full synchronization completed"
    }

@app.post("/api/force-resolve-pending-sync")
async def force_resolve_pending_sync(_auth: bool = Depends(check_auth)):
    conn = db.get_db_connection()
    conn.execute("UPDATE activities SET sync_status = 'synced' WHERE sync_status IN ('pending_insert', 'pending_update')")
    conn.commit()
    conn.close()
    db.invalidate_activities_cache()
    db.set_sync_meta("last_sync_error", "")
    return {"status": "success", "message": "All pending sync items marked as synced locally"}

@app.get("/api/customers")
async def get_customers(background_tasks: BackgroundTasks, _auth: bool = Depends(check_auth)):
    customers = db.get_cached_customers()
    if not customers:
        background_tasks.add_task(sync_service.sync_config_from_sheets)
    return customers

@app.get("/api/contract-config")
async def get_contract_config(_auth: bool = Depends(check_auth)):
    return db.get_contract_config()

@app.post("/api/contract-config")
async def save_contract_config(data: ContractQuotaPayload, _auth: bool = Depends(check_auth)):
    return db.save_contract_quota(data.client, data.quota)

@app.get("/api/customer-resources")
async def get_customer_resources(
    customer: str = Query(..., max_length=200),
    background_tasks: BackgroundTasks = None,
    _auth: bool = Depends(check_auth)
):
    data = db.get_cached_resources(customer)
    if not data.get("raisedBy") and background_tasks:
        background_tasks.add_task(sync_service.sync_config_from_sheets)
    return data

@app.get("/api/activity-logs")
async def get_activity_logs(
    request: Request,
    refresh: bool = False,
    order_by: str = Query(default="sheet_desc", max_length=40),
    _auth: bool = Depends(check_auth)
):
    if refresh:
        enforce_rate_limit(f"sync:{get_client_ip(request)}", max_requests=6, window_seconds=60)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, sync_service.pull_activities_from_sheets)
        await loop.run_in_executor(None, sync_service.sync_config_from_sheets)
    return db.get_all_activities(order_by=order_by)

@app.post("/api/submit-activity")
async def submit_activity(
    request: Request,
    data: ActivityPayload,
    background_tasks: BackgroundTasks,
    _auth: bool = Depends(check_auth)
):
    enforce_rate_limit(f"write:{get_client_ip(request)}", max_requests=60, window_seconds=60)
    try:
        # Calculate duration
        duration_str, duration_mins = sync_service.calculate_duration_tuple(data.clockIn, data.clockOut, data.date)

        activity_data = {
            "customer": data.customer,
            "date": data.date,
            "raisedBy": data.raisedBy,
            "services": data.services,
            "category": data.category,
            "project": data.project,
            "taskDescription": data.taskDescription,
            "rootCause": data.rootCause,
            "solution": data.solution,
            "clockIn": data.clockIn,
            "clockOut": data.clockOut,
            "duration": duration_str,
            "durationMinutes": duration_mins,
            "status": data.status,
            "remarks": data.remarks,
            "ticketDeduction": data.ticketDeduction if data.ticketDeduction is not None else 0.0
        }

        # 1. Save to SQLite immediately (instant response < 5ms)
        new_id = db.insert_activity(activity_data, sync_status="pending_insert")

        # 2. Queue background push to Google Sheets
        background_tasks.add_task(sync_service.push_pending_to_sheets)

        return {"status": "success", "id": new_id}
    except Exception as e:
        print(f"⚠️ Error in submit_activity: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit activity record.")

@app.post("/api/update-status")
async def update_status(
    request: Request,
    data: UpdateStatusPayload,
    background_tasks: BackgroundTasks,
    _auth: bool = Depends(check_auth)
):
    enforce_rate_limit(f"write:{get_client_ip(request)}", max_requests=60, window_seconds=60)
    try:
        # 1. Update SQLite immediately
        db.update_activity_status(data.rowId, data.status, sync_status="pending_update")
        # 2. Queue background push to Google Sheets
        background_tasks.add_task(sync_service.push_pending_to_sheets)
        return {"status": "success"}
    except Exception as e:
        print(f"⚠️ Error updating status: {e}")
        raise HTTPException(status_code=500, detail="Failed to update activity status.")

@app.post("/api/update-ticket-deduction")
async def update_ticket_deduction(
    request: Request,
    data: UpdateTicketDeductionPayload,
    background_tasks: BackgroundTasks,
    _auth: bool = Depends(check_auth)
):
    enforce_rate_limit(f"write:{get_client_ip(request)}", max_requests=60, window_seconds=60)
    try:
        ok = db.update_activity_ticket_deduction(data.rowId, data.ticketDeduction)
        if not ok:
            raise HTTPException(status_code=404, detail="Activity not found")
        background_tasks.add_task(sync_service.push_pending_to_sheets)
        return {"status": "success", "ticketDeduction": data.ticketDeduction}
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ Error updating ticket deduction: {e}")
        raise HTTPException(status_code=500, detail="Failed to update ticket deduction.")

@app.post("/api/update-record")
async def update_record(
    request: Request,
    data: UpdateRecordPayload,
    background_tasks: BackgroundTasks,
    _auth: bool = Depends(check_auth)
):
    enforce_rate_limit(f"write:{get_client_ip(request)}", max_requests=60, window_seconds=60)
    try:
        duration_str, duration_mins = sync_service.calculate_duration_tuple(data.clockIn, data.clockOut, data.date)

        if duration_mins == 0 and not data.clockIn and not data.clockOut:
            existing = db.get_activity_by_id(data.rowId)
            if existing and not existing.get("clock_in") and not existing.get("clock_out") and (existing.get("duration_minutes") or 0) > 0:
                duration_str = existing.get("duration") or "00:00"
                duration_mins = existing.get("duration_minutes") or 0

        activity_data = {
            "customer": data.customer,
            "date": data.date,
            "raisedBy": data.raisedBy,
            "services": data.services,
            "category": data.category,
            "project": data.project,
            "taskDescription": data.taskDescription,
            "rootCause": data.rootCause,
            "solution": data.solution,
            "clockIn": data.clockIn,
            "clockOut": data.clockOut,
            "duration": duration_str,
            "durationMinutes": duration_mins,
            "status": data.status,
            "remarks": data.remarks,
            "ticketDeduction": data.ticketDeduction if data.ticketDeduction is not None else 0.0
        }

        # 1. Update SQLite immediately
        db.update_activity(data.rowId, activity_data, sync_status="pending_update")
        # 2. Queue background push to Google Sheets
        background_tasks.add_task(sync_service.push_pending_to_sheets)
        return {"status": "success"}
    except Exception as e:
        print(f"⚠️ Error updating record: {e}")
        raise HTTPException(status_code=500, detail="Failed to update activity record.")

@app.delete("/api/delete-record/{row_id}")
async def delete_record(
    request: Request,
    row_id: int,
    background_tasks: BackgroundTasks,
    _auth: bool = Depends(check_auth)
):
    enforce_rate_limit(f"write:{get_client_ip(request)}", max_requests=60, window_seconds=60)
    try:
        # 1. Mark as pending_delete or delete from SQLite immediately
        db.delete_activity(row_id)
        # 2. Queue background delete from Google Sheets
        background_tasks.add_task(sync_service.push_pending_to_sheets)
        return {"status": "success"}
    except Exception as e:
        print(f"⚠️ Error deleting record: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete activity record.")

# --- GEMINI AI ENDPOINTS ---

@app.post("/api/ai/executive-summary")
async def ai_executive_summary(request: Request, req: AISummaryRequest, _auth: bool = Depends(check_auth)):
    enforce_rate_limit(f"ai:{get_client_ip(request)}", max_requests=10, window_seconds=300)
    api_key = ai_service.get_api_key(req.apiKey)
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is required. Please set GEMINI_API_KEY in .env or provide it in the prompt."
        )

    all_acts = db.get_all_activities()
    filtered = []
    for a in all_acts:
        if req.customer and a.get("customer") != req.customer:
            continue
        if req.startDate and a.get("date") and a.get("date") < req.startDate:
            continue
        if req.endDate and a.get("date") and a.get("date") > req.endDate:
            continue
        filtered.append(a)

    if not filtered:
        filtered = all_acts[:50]

    period_str = f"{req.startDate or 'All time'} to {req.endDate or 'Present'}"
    if req.customer:
        period_str += f" (Customer: {req.customer})"

    try:
        loop = asyncio.get_event_loop()
        summary = await loop.run_in_executor(
            None,
            ai_service.generate_executive_summary,
            filtered,
            period_str,
            api_key
        )
        return {"summary": summary, "count": len(filtered), "period": period_str}
    except Exception as e:
        print(f"⚠️ Error generating AI executive summary: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate AI executive summary.")

@app.post("/api/ai/polish")
async def ai_polish_notes(request: Request, req: AIPolishRequest, _auth: bool = Depends(check_auth)):
    enforce_rate_limit(f"ai:{get_client_ip(request)}", max_requests=15, window_seconds=300)
    api_key = ai_service.get_api_key(req.apiKey)
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is required. Please set GEMINI_API_KEY in .env or provide it in the prompt."
        )
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            ai_service.polish_activity_notes,
            req.taskDescription or "",
            req.rootCause or "",
            req.solution or "",
            api_key
        )
        return result
    except Exception as e:
        print(f"⚠️ Error polishing notes: {e}")
        raise HTTPException(status_code=500, detail="Failed to polish activity notes with AI.")

@app.get("/api/knowledge-base/search")
async def api_search_knowledge_base(
    q: str = Query(default="", max_length=200),
    customer: Optional[str] = Query(default=None, max_length=200),
    services: Optional[str] = Query(default=None, max_length=200),
    _auth: bool = Depends(check_auth)
):
    try:
        results = db.search_knowledge_base(query=q, customer=customer, service=services, limit=6)
        return {"results": results, "count": len(results)}
    except Exception as e:
        print(f"⚠️ Error searching knowledge base: {e}")
        raise HTTPException(status_code=500, detail="Failed to search knowledge base.")