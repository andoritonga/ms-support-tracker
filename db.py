import os
import sqlite3
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional

DATA_DIR = os.getenv("DATA_DIR", "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "tracker.db")

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Activities table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS activities (
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
        );
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_activities_sync ON activities(sync_status);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_activities_sheet_row ON activities(sheet_row);")

    try:
        cursor.execute("ALTER TABLE activities ADD COLUMN ticket_deduction REAL DEFAULT 0.0;")
    except Exception:
        pass

    try:
        cursor.execute("""
            UPDATE activities 
            SET ticket_deduction = 1.0 
            WHERE (UPPER(customer) LIKE '%MSIG%' OR UPPER(customer) LIKE '%ASJ%') 
              AND LOWER(category) = 'issue' 
              AND (ticket_deduction IS NULL OR ticket_deduction = 0.0);
        """)
    except Exception:
        pass

    try:
        max_r_row = cursor.execute("SELECT MAX(sheet_row) as max_r FROM activities").fetchone()
        max_r = max_r_row["max_r"] or 0
        null_rows = cursor.execute("SELECT id FROM activities WHERE sheet_row IS NULL ORDER BY id ASC").fetchall()
        for idx_nr, nr in enumerate(null_rows):
            cursor.execute("UPDATE activities SET sheet_row = ? WHERE id = ?", (max_r + idx_nr + 1, nr["id"]))
    except Exception:
        pass

    # 2. Customers cache table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS config_customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # 3. Resources cache table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS config_resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer TEXT NOT NULL,
            resource_type TEXT NOT NULL DEFAULT 'RaisedBy',
            resource_value TEXT NOT NULL DEFAULT '',
            raised_by TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(customer, resource_type, resource_value)
        );
    """)
    try:
        cursor.execute("ALTER TABLE config_resources ADD COLUMN resource_type TEXT DEFAULT 'RaisedBy';")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE config_resources ADD COLUMN resource_value TEXT DEFAULT '';")
    except Exception:
        pass

    # 4. Sync metadata table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    conn.commit()
    conn.close()

# --- ACTIVITY CRUD ---

def get_all_activities(include_deleted: bool = False, order_by: str = "sheet_desc") -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    
    order_clause = "ORDER BY (sheet_row IS NULL) DESC, sheet_row DESC, id DESC"
    if order_by == "sheet_asc":
        order_clause = "ORDER BY (sheet_row IS NULL) ASC, sheet_row ASC, id ASC"
    elif order_by == "date_desc":
        order_clause = "ORDER BY date DESC, (sheet_row IS NULL) DESC, sheet_row DESC, id DESC"
    elif order_by == "date_asc":
        order_clause = "ORDER BY date ASC, sheet_row ASC, id ASC"
    elif order_by == "id_desc":
        order_clause = "ORDER BY id DESC"

    if include_deleted:
        query = f"SELECT * FROM activities {order_clause}"
    else:
        query = f"SELECT * FROM activities WHERE sync_status != 'pending_delete' {order_clause}"
        
    rows = cursor.execute(query).fetchall()
    conn.close()

    result = []
    for r in rows:
        deduction = 0.0
        if "ticket_deduction" in r.keys() and r["ticket_deduction"] is not None:
            try:
                deduction = float(r["ticket_deduction"])
            except (ValueError, TypeError):
                deduction = 0.0

        result.append({
            "rowId": r["id"],
            "sheetRow": r["sheet_row"],
            "uuid": r["uuid"],
            "customer": r["customer"] or "",
            "date": r["date"] or "",
            "raisedBy": r["raised_by"] or "",
            "services": r["services"] or "",
            "category": r["category"] or "",
            "project": r["project"] or "",
            "taskDescription": r["task_description"] or "",
            "rootCause": r["root_cause"] or "",
            "solution": r["solution"] or "",
            "clockIn": r["clock_in"] or "",
            "clockOut": r["clock_out"] or "",
            "duration": r["duration"] or "00:00",
            "durationMinutes": r["duration_minutes"] or 0,
            "status": r["status"] or "In Progress",
            "remarks": r["remarks"] or "",
            "ticketDeduction": deduction,
            "syncStatus": r["sync_status"],
            "syncError": r["sync_error"]
        })
    return result

def get_activity_by_id(activity_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def insert_activity(data: Dict[str, Any], sync_status: str = "pending_insert") -> int:
    conn = get_db_connection()
    cursor = conn.cursor()

    act_uuid = data.get("uuid") or str(uuid.uuid4())
    deduction = float(data.get("ticketDeduction", 0.0) or 0.0)
    sheet_row = data.get("sheet_row")
    if not sheet_row:
        max_row = cursor.execute("SELECT MAX(sheet_row) as max_r FROM activities").fetchone()
        sheet_row = ((max_row["max_r"] or 0) + 1) if max_row else 1

    cursor.execute("""
        INSERT INTO activities (
            uuid, sheet_row, customer, date, raised_by, services, category,
            project, task_description, root_cause, solution, clock_in, clock_out,
            duration, duration_minutes, status, remarks, ticket_deduction, sync_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    """, (
        act_uuid,
        sheet_row,
        data.get("customer", ""),
        data.get("date", ""),
        data.get("raisedBy", ""),
        data.get("services", ""),
        data.get("category", ""),
        data.get("project", ""),
        data.get("taskDescription", ""),
        data.get("rootCause", ""),
        data.get("solution", ""),
        data.get("clockIn", ""),
        data.get("clockOut", ""),
        data.get("duration", "00:00"),
        data.get("durationMinutes", 0),
        data.get("status", "In Progress"),
        data.get("remarks", ""),
        deduction,
        sync_status
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return new_id

def update_activity(activity_id: int, data: Dict[str, Any], sync_status: str = "pending_update") -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    deduction = float(data.get("ticketDeduction", 0.0) or 0.0)
    cursor.execute("""
        UPDATE activities SET
            customer = ?, date = ?, raised_by = ?, services = ?, category = ?,
            project = ?, task_description = ?, root_cause = ?, solution = ?,
            clock_in = ?, clock_out = ?, duration = ?, duration_minutes = ?,
            status = ?, remarks = ?, ticket_deduction = ?, sync_status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (
        data.get("customer", ""),
        data.get("date", ""),
        data.get("raisedBy", ""),
        data.get("services", ""),
        data.get("category", ""),
        data.get("project", ""),
        data.get("taskDescription", ""),
        data.get("rootCause", ""),
        data.get("solution", ""),
        data.get("clockIn", ""),
        data.get("clockOut", ""),
        data.get("duration", "00:00"),
        data.get("durationMinutes", 0),
        data.get("status", "In Progress"),
        data.get("remarks", ""),
        deduction,
        sync_status,
        activity_id
    ))
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return rows_affected > 0

def update_activity_ticket_deduction(activity_id: int, ticket_deduction: float) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE activities SET
            ticket_deduction = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (float(ticket_deduction), activity_id))
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return rows_affected > 0

def update_activity_status(activity_id: int, status: str, sync_status: str = "pending_update") -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE activities SET
            status = ?, sync_status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (status, sync_status, activity_id))
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return rows_affected > 0

def delete_activity(activity_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # If it was never synced to Google Sheets (pending_insert), delete immediately
    row = cursor.execute("SELECT sync_status FROM activities WHERE id = ?", (activity_id,)).fetchone()
    if row and row["sync_status"] == "pending_insert":
        cursor.execute("DELETE FROM activities WHERE id = ?", (activity_id,))
    else:
        cursor.execute("""
            UPDATE activities SET
                sync_status = 'pending_delete', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (activity_id,))
        
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return rows_affected > 0

def sync_activities_from_sheets(items: List[Dict[str, Any]]) -> int:
    """Two-way sync from Google Sheets into SQLite:
    - Updates cell modifications made directly in Google Sheets.
    - Updates sheet_row to preserve exact spreadsheet ordering.
    - Inserts new rows added in Google Sheets.
    - Removes rows deleted in Google Sheets (if marked 'synced').
    - Protects local pending records (pending_insert/pending_update/pending_delete).
    """
    if not items:
        return 0

    conn = get_db_connection()
    cursor = conn.cursor()

    sheet_uuids = set()
    updated_count = 0

    for item in items:
        act_uuid = item.get("uuid")
        if not act_uuid:
            row_match = cursor.execute("SELECT uuid FROM activities WHERE sheet_row = ?", (item.get("sheet_row"),)).fetchone()
            if row_match:
                act_uuid = row_match["uuid"]
            else:
                act_uuid = str(uuid.uuid4())
            item["uuid"] = act_uuid

        sheet_uuids.add(str(act_uuid))

        existing = cursor.execute("SELECT id, sync_status FROM activities WHERE uuid = ?", (str(act_uuid),)).fetchone()

        if existing:
            act_id = existing["id"]
            sync_status = existing["sync_status"]

            if sync_status in ("pending_update", "pending_insert", "pending_delete"):
                cursor.execute("UPDATE activities SET sheet_row = ? WHERE id = ?", (item.get("sheet_row"), act_id))
            else:
                cursor.execute("""
                    UPDATE activities SET
                        sheet_row = ?,
                        customer = ?,
                        date = ?,
                        raised_by = ?,
                        services = ?,
                        category = ?,
                        project = ?,
                        task_description = ?,
                        root_cause = ?,
                        solution = ?,
                        clock_in = ?,
                        clock_out = ?,
                        duration = ?,
                        duration_minutes = ?,
                        status = ?,
                        remarks = ?,
                        sync_status = 'synced',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (
                    item.get("sheet_row"),
                    item.get("customer", ""),
                    item.get("date", ""),
                    item.get("raisedBy", ""),
                    item.get("services", ""),
                    item.get("category", ""),
                    item.get("project", ""),
                    item.get("taskDescription", ""),
                    item.get("rootCause", ""),
                    item.get("solution", ""),
                    item.get("clockIn", ""),
                    item.get("clockOut", ""),
                    item.get("duration", "00:00"),
                    item.get("durationMinutes", 0),
                    item.get("status", "In Progress"),
                    item.get("remarks", ""),
                    act_id
                ))
            updated_count += 1
        else:
            default_deduction = 0.0
            cust_upper = (item.get("customer") or "").upper()
            if ("MSIG" in cust_upper or "ASJ" in cust_upper) and (item.get("category") or "").strip().lower() == "issue":
                default_deduction = 1.0

            cursor.execute("""
                INSERT INTO activities (
                    uuid, sheet_row, customer, date, raised_by, services, category,
                    project, task_description, root_cause, solution, clock_in, clock_out,
                    duration, duration_minutes, status, remarks, ticket_deduction, sync_status, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', CURRENT_TIMESTAMP)
            """, (
                str(act_uuid),
                item.get("sheet_row"),
                item.get("customer", ""),
                item.get("date", ""),
                item.get("raisedBy", ""),
                item.get("services", ""),
                item.get("category", ""),
                item.get("project", ""),
                item.get("taskDescription", ""),
                item.get("rootCause", ""),
                item.get("solution", ""),
                item.get("clockIn", ""),
                item.get("clockOut", ""),
                item.get("duration", "00:00"),
                item.get("durationMinutes", 0),
                item.get("status", "In Progress"),
                item.get("remarks", ""),
                default_deduction
            ))
            updated_count += 1

    # Clean up records deleted directly from Google Sheets (synced only)
    if sheet_uuids:
        all_synced = cursor.execute("SELECT id, uuid FROM activities WHERE sync_status = 'synced'").fetchall()
        for r in all_synced:
            if str(r["uuid"]) not in sheet_uuids:
                cursor.execute("DELETE FROM activities WHERE id = ?", (r["id"],))

    conn.commit()
    conn.close()
    return updated_count

def bulk_import_activities(items: List[Dict[str, Any]]) -> int:
    """Alias for sync_activities_from_sheets for backwards compatibility"""
    return sync_activities_from_sheets(items)

# --- CONFIG CACHE OPERATIONS ---

def get_cached_customers() -> List[str]:
    conn = get_db_connection()
    rows = conn.execute("SELECT name FROM config_customers ORDER BY name ASC").fetchall()
    conn.close()
    return [r["name"] for r in rows]

def bulk_set_customers(customers: List[str]):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM config_customers")
    for c in customers:
        if c.strip():
            cursor.execute("INSERT OR IGNORE INTO config_customers (name) VALUES (?)", (c.strip(),))
    conn.commit()
    conn.close()

def get_cached_resources(customer: str) -> Dict[str, List[str]]:
    conn = get_db_connection()
    c_clean = (customer or "").strip()
    
    # 1. Raised By from config_resources
    rows_rb = conn.execute(
        "SELECT DISTINCT COALESCE(NULLIF(resource_value, ''), raised_by) as val FROM config_resources WHERE LOWER(customer) = LOWER(?) AND (resource_type IN ('RaisedBy', 'Raised By', 'raised_by') OR raised_by != '') ORDER BY val ASC",
        (c_clean,)
    ).fetchall()
    raised_by = [r["val"] for r in rows_rb if r["val"]]
    
    # 2. Raised By from activities (historical records)
    act_rb = conn.execute(
        "SELECT DISTINCT raised_by FROM activities WHERE LOWER(customer) = LOWER(?) AND raised_by != '' AND sync_status != 'pending_delete' ORDER BY raised_by ASC",
        (c_clean,)
    ).fetchall()
    for r in act_rb:
        val = r["raised_by"].strip()
        if val and val not in raised_by:
            raised_by.append(val)
            
    # 3. Projects from config_resources
    rows_prj = conn.execute(
        "SELECT DISTINCT resource_value as val FROM config_resources WHERE LOWER(customer) = LOWER(?) AND resource_type IN ('Project', 'project') AND resource_value != '' ORDER BY val ASC",
        (c_clean,)
    ).fetchall()
    projects = [r["val"] for r in rows_prj if r["val"]]
    
    # 4. Projects from activities (historical records)
    act_prj = conn.execute(
        "SELECT DISTINCT project FROM activities WHERE LOWER(customer) = LOWER(?) AND project != '' AND project != '-' AND sync_status != 'pending_delete' ORDER BY project ASC",
        (c_clean,)
    ).fetchall()
    for r in act_prj:
        val = r["project"].strip()
        if val and val not in projects:
            projects.append(val)
            
    conn.close()
    return {
        "raisedBy": sorted(raised_by),
        "projects": sorted(projects)
    }

def bulk_set_resources(records: List[Dict[str, str]]):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM config_resources")
    for r in records:
        cust = r.get("customer", "").strip()
        rtype = r.get("type", "RaisedBy").strip()
        rval = r.get("value", "").strip()
        rb = r.get("raised_by", "").strip() or (rval if rtype.lower() in ("raisedby", "raised by", "raised_by") else "")
        if cust and (rval or rb):
            cursor.execute("""
                INSERT OR IGNORE INTO config_resources (customer, resource_type, resource_value, raised_by)
                VALUES (?, ?, ?, ?)
            """, (cust, rtype, rval or rb, rb))
    conn.commit()
    conn.close()

# --- SYNC QUEUE OPERATIONS ---

def get_pending_sync_activities() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    rows = conn.execute("""
        SELECT * FROM activities
        WHERE sync_status IN ('pending_insert', 'pending_update', 'pending_delete')
        ORDER BY id ASC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def count_pending_sync() -> int:
    conn = get_db_connection()
    row = conn.execute("""
        SELECT COUNT(*) as cnt FROM activities
        WHERE sync_status IN ('pending_insert', 'pending_update', 'pending_delete')
    """).fetchone()
    conn.close()
    return row["cnt"] if row else 0

def count_total_activities() -> int:
    conn = get_db_connection()
    row = conn.execute("""
        SELECT COUNT(*) as cnt FROM activities
        WHERE sync_status != 'pending_delete'
    """).fetchone()
    conn.close()
    return row["cnt"] if row else 0

def mark_as_synced(activity_id: int, sheet_row: Optional[int] = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    if sheet_row is not None:
        cursor.execute("""
            UPDATE activities SET
                sync_status = 'synced', sheet_row = ?, sync_error = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (sheet_row, activity_id))
    else:
        cursor.execute("""
            UPDATE activities SET
                sync_status = 'synced', sync_error = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (activity_id,))
    conn.commit()
    conn.close()

def remove_deleted_activity(activity_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM activities WHERE id = ?", (activity_id,))
    conn.commit()
    conn.close()

def mark_sync_error(activity_id: int, error_msg: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE activities SET sync_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    """, (str(error_msg)[:500], activity_id))
    conn.commit()
    conn.close()

def set_sync_meta(key: str, value: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT OR REPLACE INTO sync_meta (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
    """, (key, value))
    conn.commit()
    conn.close()

def get_sync_meta(key: str) -> Optional[str]:
    conn = get_db_connection()
    row = conn.execute("SELECT value FROM sync_meta WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else None

def search_knowledge_base(query: str, customer: Optional[str] = None, service: Optional[str] = None, limit: int = 6) -> List[Dict[str, Any]]:
    """Search resolved incidents where root_cause or solution is documented, matching query keywords."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Require non-empty root_cause or solution
    sql_base = """
        SELECT id, customer, date, services, category, project, task_description, root_cause, solution, duration, status
        FROM activities
        WHERE (root_cause != '' OR solution != '')
          AND sync_status != 'pending_delete'
    """
    params = []
    
    keywords = [w.strip().lower() for w in (query or "").split() if len(w.strip()) >= 2]
    
    if keywords:
        like_clauses = []
        for kw in keywords[:6]:
            like_clauses.append("(LOWER(task_description) LIKE ? OR LOWER(root_cause) LIKE ? OR LOWER(solution) LIKE ?)")
            params.extend([f"%{kw}%", f"%{kw}%", f"%{kw}%"])
        sql_base += " AND (" + " OR ".join(like_clauses) + ")"
        
    cursor.execute(sql_base, params)
    rows = cursor.fetchall()
    conn.close()
    
    scored_results = []
    for r in rows:
        score = 0
        r_cust = (r["customer"] or "").strip().lower()
        r_svc = (r["services"] or "").strip().lower()
        r_desc = (r["task_description"] or "").lower()
        r_rc = (r["root_cause"] or "").lower()
        r_sol = (r["solution"] or "").lower()
        
        if customer and r_cust == customer.strip().lower():
            score += 4
        if service and r_svc == service.strip().lower():
            score += 3
            
        for kw in keywords:
            if kw in r_desc:
                score += 3
            if kw in r_rc:
                score += 2
            if kw in r_sol:
                score += 2
                
        scored_results.append((score, {
            "id": r["id"],
            "customer": r["customer"],
            "date": r["date"],
            "services": r["services"],
            "category": r["category"],
            "project": r["project"],
            "taskDescription": r["task_description"],
            "rootCause": r["root_cause"],
            "solution": r["solution"],
            "duration": r["duration"],
            "status": r["status"],
            "score": score
        }))
        
    scored_results.sort(key=lambda x: (x[0], x[1]["date"] or ""), reverse=True)
    return [item[1] for item in scored_results[:limit]]
