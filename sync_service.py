import os
import json
import re
import time
import asyncio
from datetime import datetime, date
from typing import List, Dict, Any, Optional
import gspread
from google.oauth2.service_account import Credentials
import db

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "service-account.json")
SPREADSHEET_LOGS_ID = os.getenv("SPREADSHEET_LOGS_ID", "")
SPREADSHEET_CONFIG_ID = os.getenv("SPREADSHEET_CONFIG_ID", "")

_cached_client = None
_cached_client_time = 0
_sync_lock = asyncio.Lock()

INDONESIAN_MONTHS = {
    'jan': 1, 'januari': 1,
    'feb': 2, 'februari': 2,
    'mar': 3, 'maret': 3,
    'apr': 4, 'april': 4,
    'mei': 5, 'may': 5,
    'jun': 6, 'juni': 6,
    'jul': 7, 'juli': 7,
    'agu': 8, 'agt': 8, 'agustus': 8, 'aug': 8,
    'sep': 9, 'september': 9,
    'okt': 10, 'oktober': 10, 'oct': 10,
    'nov': 11, 'november': 11,
    'des': 12, 'desember': 12, 'dec': 12
}

def clean_date_format(val: Any) -> str:
    if not val:
        return ""
    val_str = str(val).strip().lower()

    for month_name, month_num in INDONESIAN_MONTHS.items():
        if month_name in val_str:
            nums = [int(n) for n in re.findall(r'\d+', val_str)]
            if len(nums) >= 2:
                year = next((n for n in nums if n > 1000), date.today().year)
                day = next((n for n in nums if n <= 31), 1)
                try:
                    return date(year, month_num, day).strftime("%Y-%m-%d")
                except ValueError:
                    pass

    for fmt in ["%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"]:
        try:
            return datetime.strptime(val_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass

    nums = [int(n) for n in re.findall(r'\d+', val_str)]
    if len(nums) == 3:
        if nums[0] > 1000:
            y, m, d = nums[0], nums[1], nums[2]
        elif nums[2] > 1000:
            d, m, y = nums[0], nums[1], nums[2]
        else:
            d, m, y = nums[0], nums[1], 2000 + nums[2]
        try:
            return date(y, m, d).strftime("%Y-%m-%d")
        except ValueError:
            pass

    return val_str

def parse_time_to_datetime(time_val: Any, base_date_str: str) -> Optional[datetime]:
    if not time_val:
        return None
    val_str = str(time_val).strip()

    time_match = re.search(r'(\d{1,2}):(\d{2})', val_str)
    if time_match:
        hr = int(time_match.group(1))
        mn = int(time_match.group(2))
        
        base_d = date.today()
        if base_date_str:
            try:
                base_d = datetime.strptime(base_date_str, "%Y-%m-%d").date()
            except ValueError:
                pass
        return datetime(base_d.year, base_d.month, base_d.day, hr, mn)
    return None

def get_gspread_client():
    global _cached_client, _cached_client_time
    now = time.time()
    if _cached_client is not None and (now - _cached_client_time) < 1800:
        return _cached_client

    if os.path.exists(SERVICE_ACCOUNT_FILE):
        creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    elif "GCP_SERVICE_ACCOUNT_JSON" in os.environ:
        info = json.loads(os.environ["GCP_SERVICE_ACCOUNT_JSON"])
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        raise Exception("Google Service Account credentials not found!")

    _cached_client = gspread.authorize(creds)
    _cached_client_time = now
    return _cached_client

def get_logs_sheet():
    client = get_gspread_client()
    doc = client.open_by_key(SPREADSHEET_LOGS_ID)
    return doc.worksheet("Activity_Log")

def get_config_doc():
    client = get_gspread_client()
    return client.open_by_key(SPREADSHEET_CONFIG_ID)

# --- SYNC CORE FUNCTIONS ---

def sync_config_from_sheets():
    """Sync customers and resources from Google Sheets into SQLite"""
    try:
        doc = get_config_doc()
        # 1. Customers
        sheet_cust = doc.worksheet("Customer_Config")
        records = sheet_cust.get_all_values()
        if records and len(records) > 1:
            customers = [row[0] for row in records[1:] if row and row[0].strip()]
            db.bulk_set_customers(customers)

        # 2. Resources
        sheet_res = doc.worksheet("Customer_Resources")
        rows = sheet_res.get_all_values()
        valid_res = []
        if rows and len(rows) > 1:
            headers = [h.strip().lower() for h in rows[0]]
            if "customer" in headers and "type" in headers and "value" in headers:
                c_idx = headers.index("customer")
                t_idx = headers.index("type")
                v_idx = headers.index("value")
                for row in rows[1:]:
                    if len(row) > max(c_idx, t_idx, v_idx):
                        cust = row[c_idx].strip()
                        rtype = row[t_idx].strip()
                        rval = row[v_idx].strip()
                        if cust and rval:
                            valid_res.append({
                                "customer": cust,
                                "type": rtype,
                                "value": rval,
                                "raised_by": rval if rtype.lower() in ("raisedby", "raised by", "raised_by") else ""
                            })
            else:
                for row in rows[1:]:
                    cust = row[0].strip() if len(row) > 0 else ""
                    rval = row[1].strip() if len(row) > 1 else ""
                    if cust and rval:
                        valid_res.append({
                            "customer": cust,
                            "type": "RaisedBy",
                            "value": rval,
                            "raised_by": rval
                        })
        if valid_res:
            db.bulk_set_resources(valid_res)
    except Exception as e:
        print(f"⚠️ Error syncing config from Sheets: {e}")

def pull_activities_from_sheets():
    """Pull all activity logs from Sheets into SQLite (initial bootstrap or sync)"""
    try:
        sheet = get_logs_sheet()
        rows = sheet.get_all_values()
        if not rows or len(rows) <= 1:
            return 0

        headers = [h.strip() for h in rows[0]]

        def get_val(row_data, header_name):
            if header_name in headers:
                idx = headers.index(header_name)
                if idx < len(row_data):
                    return row_data[idx]
            return ""

        items = []
        for idx_row, row in enumerate(rows[1:], start=2):
            uuid_val = get_val(row, "No") or get_val(row, "UUID") or get_val(row, "ID")
            customer = get_val(row, "Customer")
            raw_date = get_val(row, "Start Date") or get_val(row, "Date")
            raised_by = get_val(row, "Raised By") or get_val(row, "RaisedBy")
            services = get_val(row, "Services")
            category = get_val(row, "Category Type") or get_val(row, "Category")
            project = get_val(row, "GCP Project") or get_val(row, "Project")
            task_desc = get_val(row, "Task Description") or get_val(row, "TaskDescription")
            root_cause = get_val(row, "Root Cause") or get_val(row, "RootCause")
            solution = get_val(row, "Solution")
            raw_clock_in = get_val(row, "Clock In") or get_val(row, "ClockIn")
            raw_clock_out = get_val(row, "Clock Out") or get_val(row, "ClockOut")
            status = get_val(row, "Status") or "In Progress"
            remarks = get_val(row, "Remarks")

            if not raw_date and raw_clock_in:
                raw_date = raw_clock_in

            formatted_date = clean_date_format(raw_date)

            duration_str = "00:00"
            duration_mins = 0
            t1 = parse_time_to_datetime(raw_clock_in, formatted_date)
            t2 = parse_time_to_datetime(raw_clock_out, formatted_date)
            if t1 and t2:
                diff = int((t2 - t1).total_seconds() / 60)
                if diff > 0:
                    duration_mins = diff
                    duration_str = f"{diff // 60:02d}:{diff % 60:02d}"

            items.append({
                "uuid": uuid_val or None,
                "sheet_row": idx_row,
                "customer": customer,
                "date": formatted_date,
                "raisedBy": raised_by,
                "services": services,
                "category": category,
                "project": project,
                "taskDescription": task_desc,
                "rootCause": root_cause,
                "solution": solution,
                "clockIn": str(raw_clock_in),
                "clockOut": str(raw_clock_out),
                "status": status,
                "remarks": remarks,
                "duration": duration_str,
                "durationMinutes": duration_mins
            })

        count = db.sync_activities_from_sheets(items)
        db.set_sync_meta("last_pull_time", datetime.now().isoformat())
        db.set_sync_meta("last_sync_error", "")
        print(f"🔄 Pulled and synced {count} activities from Google Sheets (sheet_row synchronized)")
        return count
    except Exception as e:
        print(f"⚠️ Error pulling activities from Sheets: {e}")
        db.set_sync_meta("last_sync_error", str(e)[:300])
        return 0

def push_pending_to_sheets():
    """Push pending local changes (inserts, updates, deletes) to Google Sheets"""
    pending = db.get_pending_sync_activities()
    if not pending:
        return 0

    try:
        sheet = get_logs_sheet()
    except Exception as e:
        print(f"⚠️ Cannot connect to Google Sheets to push changes: {e}")
        db.set_sync_meta("last_sync_error", str(e)[:300])
        return 0

    synced_count = 0
    for item in pending:
        item_id = item["id"]
        status = item["sync_status"]
        sheet_row = item["sheet_row"]

        try:
            if status == "pending_insert":
                row_data = [
                    item["uuid"],
                    item["customer"],
                    item["date"],
                    item["raised_by"],
                    item["services"],
                    item["category"],
                    item["project"],
                    item["task_description"],
                    item["root_cause"],
                    item["solution"],
                    item["clock_in"],
                    item["clock_out"],
                    "",
                    item["status"],
                    item["remarks"]
                ]
                sheet.append_row(row_data)
                # Calculate sheet row
                all_rows = sheet.get_all_values()
                new_row_idx = len(all_rows)
                db.mark_as_synced(item_id, sheet_row=new_row_idx)
                synced_count += 1

            elif status == "pending_update":
                if sheet_row and sheet_row > 1:
                    row_values = [
                        item["customer"],
                        item["date"],
                        item["raised_by"],
                        item["services"],
                        item["category"],
                        item["project"],
                        item["task_description"],
                        item["root_cause"],
                        item["solution"],
                        item["clock_in"],
                        item["clock_out"],
                        "",
                        item["status"],
                        item["remarks"]
                    ]
                    cell_range = f"B{sheet_row}:O{sheet_row}"
                    sheet.update(cell_range, [row_values])
                    db.mark_as_synced(item_id)
                    synced_count += 1
                else:
                    db.mark_as_synced(item_id)

            elif status == "pending_delete":
                if sheet_row and sheet_row > 1:
                    sheet.delete_rows(sheet_row)
                db.remove_deleted_activity(item_id)
                synced_count += 1

        except Exception as e:
            print(f"⚠️ Error syncing item ID {item_id}: {e}")
            db.mark_sync_error(item_id, str(e))

    if synced_count > 0:
        db.set_sync_meta("last_push_time", datetime.now().isoformat())

    return synced_count

async def full_sync_cycle():
    """Async wrapper for push pending and periodic pull"""
    async with _sync_lock:
        loop = asyncio.get_event_loop()
        # 1. Push local pending changes first
        await loop.run_in_executor(None, push_pending_to_sheets)
        # 2. Sync config dropdowns
        await loop.run_in_executor(None, sync_config_from_sheets)
        # 3. Pull latest changes from Google Sheets (two-way sync & sheet_row alignment)
        await loop.run_in_executor(None, pull_activities_from_sheets)

def bootstrap_data():
    """Initial check: if SQLite is empty, pull all data from Google Sheets"""
    db.init_db()
    total = db.count_total_activities()
    print(f"📦 SQLite Activities in database: {total}")
    if total == 0:
        print("📥 Initializing database: Pulling all records from Google Sheets...")
        sync_config_from_sheets()
        count = pull_activities_from_sheets()
        print(f"✅ Imported {count} historical activity records from Google Sheets into SQLite!")
    else:
        # Check if customers are cached
        custs = db.get_cached_customers()
        if not custs:
            sync_config_from_sheets()
