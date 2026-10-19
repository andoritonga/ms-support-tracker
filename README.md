# MS Support Activity Tracker

[![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers_%26_D1-F38020.svg?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![SQLite](https://img.shields.io/badge/SQLite-Local_Storage-003B57.svg?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance activity logging, time tracking, and SLA analytics dashboard built for Managed Services (MS), Cloud Operations, and DevOps engineers.

Combines **blazing-fast local SQLite / Cloudflare D1 storage (<20ms response time)** with **background two-way synchronization to Google Sheets**, complete with printable executive SLA reports, client dossiers, Knowledge Base auto-suggest, and Google Gemini AI insights.

---

## Key Features

- **Activity Tracking & Management**:
  - Classify tasks by Customer, GCP/Cloud Project ID, Service, Category (Support vs. Issue), and PIC (`Raised By`).
  - Capture detailed incident context: Task Description, Root Cause (RC), Solution/Fix, and Remarks.
  - Expandable row details for instant technical inspection.

- **⏱️ Flexible Time & Duration Tracking**:
  - Live Stopwatch / Timer mode with persistent state.
  - Manual backdated time entry (Clock-In / Clock-Out) with automatic duration calculation.
  - Supports cross-midnight, multi-day timestamps, and automatic duration normalization/preservation on log edits.

- **🧠 Knowledge Base Auto-Suggest**:
  - Real-time search and auto-suggestion of past resolved Root Causes and Solutions while logging or editing activities.

- **🗂️ 360° Quick Customer Dossier**:
  - Slide-out drawer displaying all-time KPIs, active ongoing tasks (`In Progress`), top requested services, and frequent contacts.
  - 1-click status resolution (`✓ Selesai` / `Closed`) directly from the drawer.

- **👁️ Column Visibility Customizer**:
  - Dynamic table customizer allowing you to show/hide any column (Customer, Raised By, Duration, etc.) to fit small laptop or mobile screens.
  - User preferences persist automatically in browser `localStorage`.

- **🎫 Contract Ticket Quota & SLA Meter**:
  - Track contract ticket deductions (`0 Tkt` for inquiry, `0.5 Tkt` for changes ≤ 4h, `1.0 Tkt` for incidents/changes > 4h).
  - Real-time visual progress bar showing deducted vs. remaining contract quota.

- **📊 Visual Dashboard & Executive Analytics**:
  - Interactive Chart.js visualizations for client workload distribution, category split, service usage, and **Monthly Daily Activity Trend**.
  - Filterable by custom date ranges and presets (*Today*, *Pending*, *This Month*).

- **📑 Printable Client SLA Reports & Excel Export**:
  - Generate clean, professional, print-ready SLA summary reports formatted for client deliverables or PDF export.
  - 1-click Excel (`.xlsx`) export for filtered views.

- **✨ Google Gemini AI Integration**:
  - **AI Executive Summary**: Analyzes activity trends and highlights operational accomplishments.
  - **AI Note Polish**: Refines technical Task Descriptions, Root Causes, and Solutions into client-ready professional summaries.

- **⚡ Dual Deployment & Hybrid Storage Architecture**:
  - **Self-Hosted (Docker + FastAPI + SQLite)** or **100% Serverless (Cloudflare Workers + Cloudflare D1)**.
  - **Async Two-Way Google Sheets Sync**: Background worker/cron keeps SQLite/D1 and Google Sheets (`Activity_Log`, `Customer_Config`, `Customer_Resources`) synchronized without blocking UI threads.

- **🌙 Modern UI & PWA Ready**:
  - Seamless Dark and Light theme switching.
  - Progressive Web App (PWA) with service worker caching and mobile bottom navigation dock for homescreen installation.

---

## Architecture Overview

```text
┌────────────────────────────────────────────────────────────────────┐
│                         Web Browser / PWA                          │
│     (Modular UI, Customer Dossier, SLA Reports, KB Auto-Suggest)   │
└─────────────────┬────────────────────────────────┬─────────────────┘
                  │ Option A: Self-Hosted          │ Option B: Serverless
┌─────────────────▼────────────────┐ ┌─────────────▼─────────────────┐
│         FastAPI Backend          │ │      Cloudflare Workers       │
│  ┌────────────┐ ┌──────────────┐ │ │  ┌────────────┐ ┌───────────┐ │
│  │ SQLite DB  │ │ Async Sync   │ │ │  │ Cloudflare │ │ Cron Sync │ │
│  │ (<5ms I/O) │ │ Background   │ │ │  │ D1 SQLite  │ │ (10 mins) │ │
│  └────────────┘ └──────┬───────┘ │ │  └────────────┘ └─────┬─────┘ │
└────────────────────────┼─────────┘ └───────────────────────┼───────┘
                         │           OAuth2 / JWT            │
                         └─────────────────┬─────────────────┘
                               ┌───────────▼───────────┐
                               │     Google Sheets     │
                               │ (Activity Log/Config) │
                               └───────────────────────┘
```

---

## Option A: Quick Start with Docker (FastAPI + SQLite)

### 1. Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- Google Cloud Service Account with Google Sheets API enabled (optional if using standalone mode)

### 2. Clone the Repository
```bash
git clone https://github.com/andoritonga/ms-support-tracker.git
cd ms-support-tracker
```

### 3. Configure Environment
Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```ini
# Google Sheets Configuration (Leave blank if running standalone SQLite)
SPREADSHEET_LOGS_ID=your_activity_logs_spreadsheet_id_here
SPREADSHEET_CONFIG_ID=your_customers_config_spreadsheet_id_here
SERVICE_ACCOUNT_FILE=service-account.json

# Server Configuration
PORT=8080
HOST_PORT=8081

# In-Memory Cache TTL (seconds)
CACHE_TTL_SECONDS=300

# Optional Basic Authentication (leave blank to disable)
AUTH_USERNAME=
AUTH_PASSWORD=

# Optional Google Gemini API Key for AI Summaries
GEMINI_API_KEY=
```

Place your GCP Service Account JSON key as `service-account.json` in the root directory.

### 4. Build and Run
```bash
docker compose up -d --build
```

Access the dashboard in your browser:
👉 **http://localhost:8081**

---

## Option B: Deploying to Cloudflare Workers & D1 (100% Serverless)

You can run this application entirely serverless on Cloudflare using **Cloudflare Workers (with Static Assets)** and **Cloudflare D1** (Serverless SQLite), with zero servers or Docker containers required.

### 1. Prerequisites
- Node.js 18+ installed.
- A free [Cloudflare](https://dash.cloudflare.com/) account.
- Install dependencies and authenticate Wrangler CLI:
  ```bash
  npm install
  npx wrangler login
  ```

### 2. Create the Cloudflare D1 Database
Create the remote D1 database:
```bash
npx wrangler d1 create ms-tracker
```
Copy the `database_id` from the output and paste it into [`wrangler.jsonc`](wrangler.jsonc) under `d1_databases[0].database_id`, along with your `SPREADSHEET_LOGS_ID` and `SPREADSHEET_CONFIG_ID` in `vars`.

### 3. Initialize the D1 Schema
Execute the schema migration on your remote database (Note: the worker also auto-ensures schema and bootstraps initial sync on first request):
```bash
npm run db:init:remote
# Or directly: npx wrangler d1 execute ms-tracker --remote --file=./schema.sql
```

### 4. Configure Cloudflare Secrets
Set your Google Cloud Service Account and optional Gemini AI / Basic Auth credentials as Cloudflare encrypted secrets:
```bash
# Upload your Google Service Account JSON:
npx wrangler secret put SERVICE_ACCOUNT_JSON < service-account.json

# (Optional) Set your Gemini API Key:
npx wrangler secret put GEMINI_API_KEY

# (Optional) HTTP Basic Auth credentials:
npx wrangler secret put AUTH_USERNAME
npx wrangler secret put AUTH_PASSWORD
```

### 5. Build and Deploy
Build the static bundle from the modular HTML templates and deploy to Cloudflare:
```bash
npm run deploy
```
Your app will be live at `https://ms-tracker.<your-subdomain>.workers.dev` (or your custom domain) with automated 10-minute Google Sheets sync cron triggers!

---

## Google Sheets Integration Setup

If using Google Sheets as a synchronized cloud datastore:

1. In Google Cloud Console, enable **Google Drive API** and **Google Sheets API**.
2. Create a Service Account, download the JSON key, and save it as `service-account.json`.
3. Create two Google Sheets:
   - **Activity Logs Sheet (`Activity_Log`)**: Contains columns for `No`, `Date`, `Customer`, `Raised By`, `Services`, `Category`, `Project`, `Task Description`, `Root Cause`, `Solution`, `Clock In`, `Clock Out`, `Duration`, `Status`, `Remarks`, `Ticket Deduction`.
   - **Config Sheet**: Contains tabs for `Customer_Config` and `Customer_Resources` (customer-specific engineers/reporters and GCP Project IDs).
4. Share both spreadsheets with the Service Account email with **Editor** permissions.
5. Set `SPREADSHEET_LOGS_ID` and `SPREADSHEET_CONFIG_ID` in `.env` (for Docker) or `wrangler.jsonc` (for Cloudflare Workers).

---

## Exposing via Cloudflare Tunnel (HTTPS for Self-Hosted Docker)

To access your local Docker instance securely over the internet without opening inbound firewall ports:

### Ad-hoc Quick Tunnel:
```bash
cloudflared tunnel --url http://localhost:8081
```

### Named Production Tunnel:
```bash
cloudflared tunnel create ms-tracker
cloudflared tunnel route dns ms-tracker support.yourdomain.com
cloudflared tunnel run --url http://localhost:8081 ms-tracker
```

---

## API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Web Application UI |
| `GET` | `/healthz` | Health check, database storage status, and sync metadata |
| `GET` | `/api/sync-status` | Current Google Sheets synchronization status and pending queue count |
| `POST` | `/api/trigger-sync` | Manually trigger a full two-way synchronization cycle |
| `POST` | `/api/force-resolve-pending-sync` | Mark pending local sync queue items as synced |
| `GET` | `/api/customers` | List configured customers |
| `GET` | `/api/customer-resources?customer=<name>` | Engineers/reporters and project IDs for selected customer |
| `GET` | `/api/activity-logs?refresh=<bool>&order_by=<sort>` | Retrieve activity logs (supports `refresh=true` and custom sort order) |
| `POST` | `/api/submit-activity` | Submit a new activity log |
| `POST` | `/api/update-status` | Quick update status (`In Progress` / `Closed`) |
| `POST` | `/api/update-ticket-deduction` | Quick update contract ticket deduction (`0`, `0.5`, `1.0`) |
| `POST` | `/api/update-record` | Full edit of an existing activity record |
| `DELETE` | `/api/delete-record/{row_id}` | Delete an activity record |
| `GET` | `/api/knowledge-base/search?q=<query>` | Search past resolved incidents, root causes, and solutions |
| `POST` | `/api/ai/executive-summary` | Generate executive AI summary using Google Gemini |
| `POST` | `/api/ai/polish` | Polish technical notes (`taskDescription`, `rootCause`, `solution`) using Gemini |

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
