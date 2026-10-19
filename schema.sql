-- Cloudflare D1 Schema for MS Support Activity Tracker

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

CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);
CREATE INDEX IF NOT EXISTS idx_activities_sync ON activities(sync_status);
CREATE INDEX IF NOT EXISTS idx_activities_sheet_row ON activities(sheet_row);

CREATE TABLE IF NOT EXISTS config_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT 'RaisedBy',
    resource_value TEXT NOT NULL DEFAULT '',
    raised_by TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer, resource_type, resource_value)
);

CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
