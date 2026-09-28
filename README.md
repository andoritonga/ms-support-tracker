# MS Support Activity Tracker (CloudOps Tracker)

[![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![SQLite](https://img.shields.io/badge/SQLite-Local_Storage-003B57.svg?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance activity logging, time tracking, and SLA analytics dashboard built for Managed Services (MS), Cloud Operations, and DevOps engineers. 

Combines **blazing-fast local SQLite storage (<5ms response time)** with **background two-way synchronization to Google Sheets**, complete with printable executive SLA reports, client dossiers, and Google Gemini AI insights.

---

## Key Features

- **Activity Tracking & Management**:
  - Classify tasks by Customer, GCP/Cloud Project ID, Service, Category (Support vs. Issue), and PIC (`Raised By`).
  - Capture detailed incident context: Task Description, Root Cause (RC), Solution/Fix, and Remarks.
  - Expandable row details for instant technical inspection.

- **🗂️ 360° Quick Customer Dossier**:
  - Slide-out drawer displaying all-time KPIs, active ongoing tasks (`In Progress`), top requested services, and frequent contacts.
  - 1-click status resolution (`✓ Selesai` / `Closed`) directly from the drawer.

- **👁️ Column Visibility Customizer**:
  - Dynamic table customizer allowing you to show/hide any column (Customer, Raised By, Duration, etc.) to fit small laptop or mobile screens.
  - User preferences persist automatically in browser `localStorage`.

- **🎫 Contract Ticket Quota & SLA Meter**:
  - Track contract ticket deductions (e.g. `0 Tkt` for inquiry, `0.5 Tkt` for changes ≤ 4h, `1.0 Tkt` for incidents/changes > 4h).
  - Real-time visual progress bar showing deducted vs. remaining quota.

- **⚡ Dual-Storage Architecture**:
  - **Local SQLite Datastore**: Instant page loads, zero network latency, and offline resiliency.
  - **Async Two-Way Google Sheets Sync**: Background worker keeps SQLite and Google Sheets synchronized without blocking UI threads.

- **⏱️ Flexible Time Logging**:
  - Live Stopwatch / Timer mode with persistent state.
  - Manual backdated time entry (Clock-In / Clock-Out) with automatic duration calculation.

- **📊 Visual Dashboard & Executive Analytics**:
  - Chart.js visualizations for client workload distribution, category split, and service usage.
  - Filterable by custom date ranges and presets (*Today*, *Pending*, *This Month*).

- **📑 Printable Client SLA Reports & Excel Export**:
  - Generate clean, professional, print-ready SLA summary reports formatted for client deliverables or PDF export.
  - 1-click Excel (`.xlsx`) export for filtered views.

- **✨ Google Gemini AI Integration**:
  - AI Executive Summary: Analyzes activity trends and highlights operational accomplishments.
  - AI Note Polish: Refines technical root causes and solutions into client-ready professional summaries.

- **🌙 Modern UI & PWA Ready**:
  - Seamless Dark and Light theme switching.
  - Progressive Web App (PWA) with service worker caching for mobile homescreen installation.

---

## Architecture Overview

```text
┌────────────────────────────────────────────────────────┐
│                   Web Browser / PWA                    │
│   (Responsive Dashboard, Customer Dossier, Hotkeys)    │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP REST / JSON
┌───────────────────────────▼────────────────────────────┐
│                    FastAPI Backend                     │
│  ┌───────────────────────┐  ┌───────────────────────┐  │
│  │   SQLite Local DB     │  │ Async Sync Worker     │  │
│  │   (<5ms Read/Write)   │  │ (Two-Way Background)  │  │
│  └───────────────────────┘  └───────────┬───────────┘  │
└─────────────────────────────────────────┼──────────────┘
                                          │ OAuth2 Service Account
                              ┌───────────▼───────────┐
                              │     Google Sheets     │
                              │ (Activity Log/Config) │
                              └───────────────────────┘
```

---

## Quick Start with Docker

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

## Google Sheets Integration Setup

If using Google Sheets as a synchronized cloud datastore:

1. In Google Cloud Console, enable **Google Drive API** and **Google Sheets API**.
2. Create a Service Account, download the JSON key, and save it as `service-account.json`.
3. Create two Google Sheets:
   - **Activity Logs Sheet**: Contains columns for `No`, `Date`, `Customer`, `Raised By`, `Services`, `Category`, `Project`, `Task Description`, `Root Cause`, `Solution`, `Clock In`, `Clock Out`, `Duration`, `Status`, `Remarks`, `Ticket Deduction`.
   - **Config Sheet**: Contains tabs for `Customer`, `Services`, `Category`, and customer-specific engineers/reporters.
4. Share both spreadsheets with the Service Account email with **Editor** permissions.
5. Set `SPREADSHEET_LOGS_ID` and `SPREADSHEET_CONFIG_ID` in `.env`.

---

## Exposing via Cloudflare Tunnel (HTTPS)

To access your instance securely over the internet without opening inbound firewall ports:

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
| `GET` | `/healthz` | Health check & sync metadata |
| `GET` | `/api/sync-status` | Google Sheets pending sync status |
| `POST` | `/api/trigger-sync` | Trigger immediate two-way synchronization |
| `GET` | `/api/customers` | List configured customers |
| `GET` | `/api/customer-resources?customer=<name>` | Engineers and project IDs for selected customer |
| `GET` | `/api/activity-logs` | Retrieve activity logs from SQLite |
| `POST` | `/api/submit-activity` | Submit new activity log |
| `POST` | `/api/update-status` | Quick update status (`In Progress` / `Closed`) |
| `POST` | `/api/update-ticket-deduction` | Update manual contract ticket deduction |
| `POST` | `/api/update-record` | Edit existing activity record |
| `DELETE` | `/api/delete-record/{row_id}` | Delete an activity record |
| `POST` | `/api/ai-summary` | Generate executive AI summary using Gemini |
| `POST` | `/api/ai-polish-notes` | Polish technical notes using Gemini |

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
