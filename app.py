import os
import json
import asyncio
import secrets
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException, Depends, BackgroundTasks
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel

import db
import sync_service
import ai_service

load_dotenv()

app = FastAPI(title="MS Support Activity Tracker (SQLite + Async Sheets Sync)")
templates = Jinja2Templates(directory="templates")

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

# OPTIONAL BASIC AUTH
security = HTTPBasic(auto_error=False)
AUTH_USERNAME = os.getenv("AUTH_USERNAME", "").strip()
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "").strip()

def check_auth(credentials: Optional[HTTPBasicCredentials] = Depends(security)):
    if not AUTH_USERNAME or not AUTH_PASSWORD:
        return True
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )
    is_user_ok = secrets.compare_digest(credentials.username, AUTH_USERNAME)
    is_pass_ok = secrets.compare_digest(credentials.password, AUTH_PASSWORD)
    if not (is_user_ok and is_pass_ok):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return True

# --- MODELS ---
class ActivityPayload(BaseModel):
    customer: str
    date: str
    raisedBy: str
    services: str
    category: str
    project: str = ""
    taskDescription: str
    rootCause: str = ""
    solution: str = ""
    clockIn: str = ""
    clockOut: str = ""
    status: str
    remarks: str = ""
    ticketDeduction: Optional[float] = 0.0

class UpdateStatusPayload(BaseModel):
    rowId: int
    status: str

class UpdateTicketDeductionPayload(BaseModel):
    rowId: int
    ticketDeduction: float

class UpdateRecordPayload(BaseModel):
    rowId: int
    customer: str
    date: str
    raisedBy: str
    services: str
    category: str
    project: str = ""
    taskDescription: str
    rootCause: str = ""
    solution: str = ""
    clockIn: str = ""
    clockOut: str = ""
    status: str
    remarks: str = ""
    ticketDeduction: Optional[float] = 0.0

class AISummaryRequest(BaseModel):
    startDate: Optional[str] = ""
    endDate: Optional[str] = ""
    customer: Optional[str] = ""
    apiKey: Optional[str] = ""

class AIPolishRequest(BaseModel):
    taskDescription: Optional[str] = ""
    rootCause: Optional[str] = ""
    solution: Optional[str] = ""
    apiKey: Optional[str] = ""

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
        "storage": "sqlite",
        "total_activities": db.count_total_activities(),
        "pending_sync": db.count_pending_sync(),
        "last_pull": db.get_sync_meta("last_pull_time"),
        "last_push": db.get_sync_meta("last_push_time"),
        "last_sync_error": db.get_sync_meta("last_sync_error") or ""
    }

@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request, _auth: bool = Depends(check_auth)):
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
async def trigger_sync(_auth: bool = Depends(check_auth)):
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
    db.set_sync_meta("last_sync_error", "")
    return {"status": "success", "message": "All pending sync items marked as synced locally"}

@app.get("/api/customers")
async def get_customers(background_tasks: BackgroundTasks, _auth: bool = Depends(check_auth)):
    customers = db.get_cached_customers()
    if not customers:
        background_tasks.add_task(sync_service.sync_config_from_sheets)
    return customers

@app.get("/api/customer-resources")
async def get_customer_resources(customer: str, background_tasks: BackgroundTasks = None, _auth: bool = Depends(check_auth)):
    data = db.get_cached_resources(customer)
    if not data.get("raisedBy") and background_tasks:
        background_tasks.add_task(sync_service.sync_config_from_sheets)
    return data

@app.get("/api/activity-logs")
async def get_activity_logs(refresh: bool = False, order_by: str = "sheet_desc", _auth: bool = Depends(check_auth)):
    if refresh:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, sync_service.pull_activities_from_sheets)
        await loop.run_in_executor(None, sync_service.sync_config_from_sheets)
    return db.get_all_activities(order_by=order_by)

@app.post("/api/submit-activity")
async def submit_activity(data: ActivityPayload, background_tasks: BackgroundTasks, _auth: bool = Depends(check_auth)):
    try:
        # Calculate duration
        duration_str = "00:00"
        duration_mins = 0
        t1 = sync_service.parse_time_to_datetime(data.clockIn, data.date)
        t2 = sync_service.parse_time_to_datetime(data.clockOut, data.date)
        if t1 and t2:
            diff = int((t2 - t1).total_seconds() / 60)
            if diff > 0:
                duration_mins = diff
                duration_str = f"{diff // 60:02d}:{diff % 60:02d}"

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
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/update-status")
async def update_status(data: UpdateStatusPayload, background_tasks: BackgroundTasks, _auth: bool = Depends(check_auth)):
    try:
        # 1. Update SQLite immediately
        db.update_activity_status(data.rowId, data.status, sync_status="pending_update")
        # 2. Queue background push to Google Sheets
        background_tasks.add_task(sync_service.push_pending_to_sheets)
        return {"status": "success"}
    except Exception as e:
        print(f"⚠️ Error updating status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/update-ticket-deduction")
async def update_ticket_deduction(data: UpdateTicketDeductionPayload, _auth: bool = Depends(check_auth)):
    try:
        ok = db.update_activity_ticket_deduction(data.rowId, data.ticketDeduction)
        if not ok:
            raise HTTPException(status_code=404, detail="Activity not found")
        return {"status": "success", "ticketDeduction": data.ticketDeduction}
    except Exception as e:
        print(f"⚠️ Error updating ticket deduction: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/update-record")
async def update_record(data: UpdateRecordPayload, background_tasks: BackgroundTasks, _auth: bool = Depends(check_auth)):
    try:
        duration_str = "00:00"
        duration_mins = 0
        t1 = sync_service.parse_time_to_datetime(data.clockIn, data.date)
        t2 = sync_service.parse_time_to_datetime(data.clockOut, data.date)
        if t1 and t2:
            diff = int((t2 - t1).total_seconds() / 60)
            if diff > 0:
                duration_mins = diff
                duration_str = f"{diff // 60:02d}:{diff % 60:02d}"

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
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/delete-record/{row_id}")
async def delete_record(row_id: int, background_tasks: BackgroundTasks, _auth: bool = Depends(check_auth)):
    try:
        # 1. Mark as pending_delete or delete from SQLite immediately
        db.delete_activity(row_id)
        # 2. Queue background delete from Google Sheets
        background_tasks.add_task(sync_service.push_pending_to_sheets)
        return {"status": "success"}
    except Exception as e:
        print(f"⚠️ Error deleting record: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- GEMINI AI ENDPOINTS ---

@app.post("/api/ai/executive-summary")
async def ai_executive_summary(req: AISummaryRequest, _auth: bool = Depends(check_auth)):
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
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ai/polish")
async def ai_polish_notes(req: AIPolishRequest, _auth: bool = Depends(check_auth)):
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
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/knowledge-base/search")
async def api_search_knowledge_base(q: str = "", customer: Optional[str] = None, services: Optional[str] = None, _auth: bool = Depends(check_auth)):
    try:
        results = db.search_knowledge_base(query=q, customer=customer, service=services, limit=6)
        return {"results": results, "count": len(results)}
    except Exception as e:
        print(f"⚠️ Error searching knowledge base: {e}")
        raise HTTPException(status_code=500, detail=str(e))