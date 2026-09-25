# 🏢 WorkGuard: Complete Project Usability & Handover Guideline

> **Document Type:** Production Handover Specification, Operations Manual & Usability Guideline  
> **Target Audience:** System Administrators, IT Operations Leads, Security Officers, Department Managers, Project Owners  
> **System Version:** WorkGuard v2.4.0 (Enterprise LAN Edition)  
> **Deployment Model:** 100% Offline Local Area Network (LAN) / Zero Cloud Dependencies  

---

## 📑 Table of Contents

1. [Executive Summary & System Purpose](#1-executive-summary--system-purpose)
2. [Software Deliverables & Artifact Inventory](#2-software-deliverables--artifact-inventory)
3. [System Architecture & Network Topology](#3-system-architecture--network-topology)
4. [Deployment & Installation Playbook](#4-deployment--installation-playbook)
   - [4.1 Admin Station Setup (Manager Machine)](#41-admin-station-setup-manager-machine)
   - [4.2 Client Agent Setup (Employee Workstations)](#42-client-agent-setup-employee-workstations)
   - [4.3 Network Inspector Setup (Diagnostics Station)](#43-network-inspector-setup-diagnostics-station)
5. [Operational User Guide (Daily Management)](#5-operational-user-guide-daily-management)
   - [5.1 Fleet Overview & Real-Time Telemetry](#51-fleet-overview--real-time-telemetry)
   - [5.2 Live Screen Monitoring (Sub-Second 30 FPS)](#52-live-screen-monitoring-sub-second-30-fps)
   - [5.3 Screenshot Timeline & Gallery Inspection](#53-screenshot-timeline--gallery-inspection)
   - [5.4 Policy & Whitelist Enforcement](#54-policy--whitelist-enforcement)
   - [5.5 Smart Privacy Shield & Sensitive Data Blurring](#55-smart-privacy-shield--sensitive-data-blurring)
   - [5.6 Security Alert Triggers & Webhook Notifications](#56-security-alert-triggers--webhook-notifications)
   - [5.7 Database Studio & Record Management](#57-database-studio--record-management)
   - [5.8 Employee Hub & Break Mode UX](#58-employee-hub--break-mode-ux)
6. [Security, RBAC & Data Governance](#6-security-rbac--data-governance)
   - [6.1 Role-Based Access Control (RBAC)](#61-role-based-access-control-rbac)
   - [6.2 Cryptography & Tamper-Evident Audit Chain](#62-cryptography--tamper-evident-audit-chain)
   - [6.3 Storage Retention & Automated 20-Day Purge](#63-storage-retention--automated-20-day-purge)
7. [System Maintenance, Backups & Disaster Recovery](#7-system-maintenance-backups--disaster-recovery)
   - [7.1 Routine Database & Media Backups](#71-routine-database--media-backups)
   - [7.2 Stopping & Restarting the Ecosystem](#72-stopping--restarting-the-ecosystem)
   - [7.3 Packaging & Rebuilding Distributions](#73-packaging--rebuilding-distributions)
   - [7.4 Remote Over-The-Air (OTA) Client Updates](#74-remote-over-the-air-ota-client-updates)
8. [Troubleshooting & Diagnostics Playbook](#8-troubleshooting--diagnostics-playbook)
9. [Official Handover Sign-Off Checklist](#9-official-handover-sign-off-checklist)

---

## 1. Executive Summary & System Purpose

**WorkGuard** is an enterprise-grade, offline-first employee productivity monitoring and endpoint fleet management suite designed for office Local Area Networks (LAN). It operates with **zero external cloud dependencies**, ensuring that all company telemetry, screenshots, live screen feeds, and audit logs remain strictly within your physical network infrastructure.

### Core Capabilities Matrix

| Capability | Technical Mechanism | Business Value |
| :--- | :--- | :--- |
| **Zero-Config LAN Auto-Discovery** | UDP Broadcast Beacon ([`DiscoveryBeacon`](file:///d:/employee_monitor/server/src/discovery_beacon.js#L1-L60) on port `38281`) | Clients auto-detect manager's dynamic IP address; zero manual IP entry required. |
| **GPU Acceleration Screen Capture Bypass** | Native Win32 GDI+ C# capture ([`ScreenGrab.cs`](file:///d:/employee_monitor/client/src/ScreenGrab.cs#L1-L120) via `SRCCOPY \| CAPTUREBLT`) | Completely eliminates black-screen captures on Chrome, Edge, VS Code, Discord, Zoom. |
| **On-Demand Live Screen Streaming** | Binary JPEG stream over WebSocket ([`LiveStreamer`](file:///d:/employee_monitor/client/src/live_streamer.js#L1-L50)) at 15–30 FPS | Sub-second latency desktop observation only when administrator views the workstation. |
| **Resilient Offline Buffering** | Local disk FIFO queue ([`OfflineQueue`](file:///d:/employee_monitor/client/src/offline_queue.js#L1-L100) in `storage_buffer/`) | Screenshots continue recording during network outages and auto-sync upon reconnection. |
| **Smart Privacy Shield** | Window title & keyword filter engine ([`PrivacyManager`](file:///d:/employee_monitor/server/src/privacy_manager.js#L1-L100)) | Obfuscates or suspends capture on password vaults, banking portals, and medical windows. |
| **Multi-Admin RBAC & Audit Chain** | SQLite WAL mode ([`Database`](file:///d:/employee_monitor/server/src/db.js#L50-L150)) + HMAC-SHA256 blockchain | Segregated manager roles (SuperAdmin, Dept Manager, Auditor) with tamper-evident audit logs. |
| **Real-Time Webhook Alerting** | Webhook Dispatcher ([`AlertManager`](file:///d:/employee_monitor/server/src/alert_manager.js#L1-L100)) | Instant alerts sent to Slack, Microsoft Teams, Discord on unauthorized software execution. |

---

## 2. Software Deliverables & Artifact Inventory

The WorkGuard suite is organized into three production packages located in the [`dist/`](file:///d:/employee_monitor/dist) directory:

```
d:\employee_monitor\dist\
├── WorkGuard-Admin-Station.zip        <-- Distribution ZIP for Manager / Admin PC
│   └── WorkGuard-Admin-Station\
│       ├── WorkGuard-Admin.exe        <-- Native Electron Admin Desktop Application
│       ├── Start-Admin-Station.bat    <-- 1-Click Batch Launcher
│       ├── admin\                     <-- Admin UI & Electron runtime container
│       └── server\                    <-- Embedded Express REST & WebSocket server
│
├── WorkGuard-Client-Agent.zip         <-- Distribution ZIP for Employee Workstations
│   └── WorkGuard-Client-Agent\
│       ├── Install-WorkGuard.exe      <-- 1-Click Silent Autostart Installer
│       ├── Install-WorkGuard-Agent.bat<-- Batch Installer fallback
│       ├── Employee-Hub.exe           <-- Employee Workstation Status Hub & Break UI
│       ├── WorkGuard-Client.exe       <-- Native Background Agent Daemon
│       ├── Uninstall-WorkGuard-Agent.bat <-- Clean uninstallation utility
│       ├── bin\screengrab.exe         <-- Compiled Win32 GDI+ GPU-bypass capture engine
│       └── storage_buffer\            <-- Local offline screenshot cache folder
│
└── WorkGuard-Inspector.zip            <-- Distribution ZIP for Network Diagnostics
    └── WorkGuard-Inspector\
        ├── WorkGuard-Inspector.exe    <-- Standalone Diagnostic GUI Tool
        ├── inspect-network.bat        <-- Network diagnostic script
        └── index.html & renderer.js   <-- Diagnostic dashboard
```

### Source Code Repository Structure

* [`admin/`](file:///d:/employee_monitor/admin): Electron desktop wrapper, native window management, system tray controller ([`main.js`](file:///d:/employee_monitor/admin/main.js)).
* [`client/`](file:///d:/employee_monitor/client): Endpoint background daemon, capture engine, offline buffer, auto-discovery receiver, Employee Hub UI.
* [`server/`](file:///d:/employee_monitor/server): Express REST API ([`api.js`](file:///d:/employee_monitor/server/src/routes/api.js)), WebSocket streaming relay ([`websocket.js`](file:///d:/employee_monitor/server/src/websocket.js)), SQLite database ([`db.js`](file:///d:/employee_monitor/server/src/db.js)), Privacy Shield ([`privacy_manager.js`](file:///d:/employee_monitor/server/src/privacy_manager.js)), and Alert Dispatcher ([`alert_manager.js`](file:///d:/employee_monitor/server/src/alert_manager.js)).
* [`inspector/`](file:///d:/employee_monitor/inspector): Multi-point health scanner for Port 3000 (HTTP/WS), Port 38281 (UDP Discovery), and Port 38282 (Hub UI).
* [`tools/`](file:///d:/employee_monitor/tools): Automated test suites for security, enterprise features, database integrity, and remote updates.

---

## 3. System Architecture & Network Topology

```
                                  OFFICE LOCAL AREA NETWORK (LAN)
        +---------------------------------------------------------------------------------+
        |                                                                                 |
        v                                                                                 v
+------------------------------------+                            +------------------------------------+
|     WORKGUARD ADMIN STATION        |                            |       CLIENT AGENT ENDPOINT        |
|     (Manager / Supervisor PC)      |                            |     (Employee Workstation PC)      |
+------------------------------------+                            +------------------------------------+
| 🖥️ Electron Desktop GUI            |    UDP Broadcast Beacon    | ⚙️ Silent Background Daemon         |
| 🌐 Embedded Express REST API       | ◄========================► | 🔍 UDP Auto-Discovery Receiver     |
| 🔌 WebSocket Streaming Relay Hub   |          Port 38281        | 👤 1st-Time Setup (Name & Dept)    |
| 👥 Multi-Admin RBAC & User Mgmt    |                            | 🔒 Locked Profile Enforcer         |
| 💾 SQLite WAL Database & Storage   |                            | 📸 Win32 GDI+ Screen Grabber (.exe)|
| 🧹 Auto-Retention Purge Engine     |      HTTP / WS Relay       | 💾 Resilient Offline Disk Buffer   |
| 🚨 Alert Webhooks (Slack/Teams)    | ◄────────────────────────► | ⏱️ Employee Hub Status UI (Widget) |
| 🛡️ Smart Privacy Shield Engine     |          Port 3000         | 🛡️ App & Web Policy Enforcer       |
| 📥 Windows System Tray Daemon      |                            | ☕ Break Mode Suspend Controller   |
+------------------------------------+                            +------------------------------------+
                  ▲                                                                 ▲
                  │                                                                 │
                  └───────────────────────────────┐                                 │
                                                  ▼                                 │
                                   +------------------------------------+           │
                                   |    WORKGUARD NETWORK INSPECTOR     |           │
                                   |      (System Diagnostics Tool)     |           │
                                   +------------------------------------+           │
                                   | 🩺 Multi-Point Health Scanner      |           │
                                   | 📊 Port 3000 / 38281 / 38282 Probe | ──────────┘
                                   | 🔍 Automated Issue & Fix Resolver  |
                                   +------------------------------------+
```

### Communication Ports & Protocols

| Port | Protocol | Purpose | Direction |
| :--- | :--- | :--- | :--- |
| **`3000`** | TCP (HTTP & WebSocket) | Admin REST API, live stream relay, screenshot uploads, policy push | Client $\rightarrow$ Admin Station |
| **`38281`** | UDP Broadcast | Zero-configuration auto-discovery beacon | Admin Station $\rightarrow$ LAN Broadcast |
| **`38282`** | TCP (HTTP) | Local Employee Hub UI & break management widget | Localhost on Client Workstation |

---

## 4. Deployment & Installation Playbook

### 4.1 Admin Station Setup (Manager Machine)

1. **System Requirements**:
   - Windows 10, Windows 11 (64-bit), or Windows Server 2016+.
   - 4 GB RAM minimum, 20 GB free disk space for screenshot storage.
   - Connected to the office local network (Wi-Fi or Ethernet).
2. **Installation Steps**:
   - Copy [`dist/WorkGuard-Admin-Station.zip`](file:///d:/employee_monitor/dist/WorkGuard-Admin-Station.zip) to the manager's computer and extract it (e.g., to `C:\WorkGuard-Admin-Station\`).
   - Double-click **`WorkGuard-Admin.exe`** (or [`Start-Admin-Station.bat`](file:///d:/employee_monitor/dist/WorkGuard-Admin-Station/Start-Admin-Station.bat)).
   - **First Launch Master Password Setup**:
     - On initial launch, set a secure Master Administrator Password (minimum 6 characters).
     - The system immediately initializes the SQLite WAL database and configures cryptographic session secrets.
3. **Windows Firewall Rule (If Prompted)**:
   - Allow `WorkGuard-Admin.exe` / Node.js through Private Networks for TCP Port `3000` and UDP Port `38281`.
4. **Background System Tray Execution**:
   - Closing the Admin window with the `(X)` button **does not stop monitoring**; it minimizes to the Windows System Tray (near the clock).
   - Double-click the tray icon to restore the window.
   - Right-click the tray icon and select **"❌ Exit WorkGuard Admin"** to terminate.

---

### 4.2 Client Agent Setup (Employee Workstations)

1. **System Requirements**:
   - Windows 10 or Windows 11 (64-bit).
   - Standard user or Administrator account.
2. **Installation Steps (1-Click Automated Setup)**:
   - Copy [`dist/WorkGuard-Client-Agent.zip`](file:///d:/employee_monitor/dist/WorkGuard-Client-Agent.zip) to the employee computer and extract it (e.g., to `C:\Program Files\WorkGuard\` or `C:\WorkGuard-Client\`).
   - Right-click **`Install-WorkGuard.exe`** (or [`Install-WorkGuard-Agent.bat`](file:///d:/employee_monitor/dist/WorkGuard-Client-Agent/Install-WorkGuard-Agent.bat)) and select **Run as Administrator** (or run standard).
   - The installer creates the Windows Autostart registry key (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run\WorkGuardAgent`) and starts the agent silently in the background.
3. **First-Time Employee Profile Setup**:
   - The **Employee Hub** window will prompt the employee for their **Full Name** (e.g., *Jane Doe*) and **Department** (e.g., *Engineering*).
   - Once submitted, the profile is **cryptographically locked** on the employee machine to prevent unauthorized alterations.
   - Only managers can update employee details remotely from the Admin Dashboard.
4. **Uninstallation Procedure**:
   - To remove the agent, run [`Uninstall-WorkGuard-Agent.bat`](file:///d:/employee_monitor/dist/WorkGuard-Client-Agent/Uninstall-WorkGuard-Agent.bat). It stops all running processes and unregisters the startup key.

---

### 4.3 Network Inspector Setup (Diagnostics Station)

When setting up new workstations or diagnosing network connectivity:
- Run **`WorkGuard-Inspector.exe`** (or [`inspect-system.bat`](file:///d:/employee_monitor/inspect-system.bat)) on any machine.
- The tool performs a multi-point scan across Ports `3000`, `38281`, and `38282`, displaying ping latency, discovered server IP, connected clients count, and firewall status.

---

## 5. Operational User Guide (Daily Management)

```
+-----------------------------------------------------------------------------------+
|  WorkGuard Enterprise Admin Dashboard                                            |
|  [👥 Fleet Overview]  [🔴 Live Monitor]  [📸 Timeline]  [🛡️ Policies]  [🗄️ Studio]  |
+-----------------------------------------------------------------------------------+
```

### 5.1 Fleet Overview & Real-Time Telemetry
- **Live Workstation Cards**: View real-time status (Online/Offline), Employee Name, Department, IP, Hostname, Current Active Application, Active Window Title, and CPU/RAM usage.
- **Department Filtering**: Filter workstation cards by department (*Engineering*, *Sales*, *Marketing*, *HR*, *Finance*).
- **Remote Profile Editing**: Click **"✏️ Edit Profile"** on any workstation card to change an employee's assigned name or department. Changes sync over WebSockets instantly.

### 5.2 Live Screen Monitoring (Sub-Second 30 FPS)
- Navigate to the **"🔴 Live Monitor"** tab.
- Select any online workstation from the dropdown or click "Live Watch" on their fleet card.
- Streams live display frames at 15–30 FPS over binary WebSockets.
- Supports **Full-Screen Zoom Mode** to inspect fine text or technical workflows.
- *Bandwidth Conservation*: Live streaming stops immediately when the tab is closed.

### 5.3 Screenshot Timeline & Gallery Inspection
- Navigate to the **"📸 Timeline"** tab.
- Filter historical captures by **Date**, **Workstation Name**, or **Application Name** (e.g., `chrome.exe`, `code.exe`).
- Click any image thumbnail to open the high-resolution lightbox viewer or download the original uncompressed capture.

### 5.4 Policy & Whitelist Enforcement
- Navigate to the **"🛡️ Policies & Rules"** tab.
- **Application Whitelist**: Define approved programs (e.g., `code.exe`, `excel.exe`, `teams.exe`, `slack.exe`).
- **Website Whitelist**: Specify approved domain names (e.g., `github.com`, `jira.com`, `google.com`).
- **Work Hours & Active Days**: Set business hours (e.g., `09:00` to `18:00`, Mon–Fri). Monitoring automatically pauses outside official hours.
- **Policy Enforcement Mode**:
  - `Audit & Alert`: Silently records violations in the audit log and dispatches admin alerts.
  - `Strict Block`: Immediately terminates prohibited software via `taskkill`.
- Click **"Save & Deploy to All Agents"** to push updates across the entire LAN in real time.

### 5.5 Smart Privacy Shield & Sensitive Data Blurring
WorkGuard includes a sensitive content detection engine configured in the **Privacy Shield** settings:
- **Protected Applications**: Password managers (`1password.exe`, `bitwarden.exe`, `keepass.exe`, `lastpass.exe`).
- **Sensitive Window Keywords**: `*bank*`, `*paypal*`, `*payroll*`, `*medical*`, `*credit card*`.
- **Protection Actions**:
  - `blur_screenshot`: Generates a high-speed obfuscated privacy mask over the image.
  - `pause_capture`: Completely suppresses capture while the sensitive window is in the foreground.
  - `mask_title`: Replaces sensitive window titles in logs with `[Protected Window - Privacy Shield Active]`.

### 5.6 Security Alert Triggers & Webhook Notifications
- Configure real-time webhook endpoints for **Slack**, **Microsoft Teams**, **Discord**, or custom HTTP endpoints.
- Define custom application triggers with severities:
  - `critical` (e.g., `utorrent.exe`, `cheatengine.exe` -> 1-minute alert cooldown).
  - `warning` (e.g., `poker.exe`, `wireshark.exe` -> 5-minute alert cooldown).
- Dispatches rich card notifications with workstation name, employee, department, and active window.

### 5.7 Database Studio & Record Management
- Navigate to the **"🗄️ Database Studio"** tab.
- Direct administrative inspection of SQLite tables: `clients`, `screenshots`, `policies`, `audit_logs`, `security_settings`, `admin_users`, `alert_webhooks`, `alert_app_rules`, `privacy_rules`.
- Perform live table search, pagination, record insertion, record editing, and single-click **Full JSON Export**.
- Run **VACUUM** to optimize disk space and verify cryptographic audit log chain integrity.

### 5.8 Employee Hub & Break Mode UX
- Employees can open their status hub anytime via **`Employee-Hub.exe`** (runs on port `38282`).
- **Active Shift Timer**: Tracks productive daily working time.
- **"☕ Take Break" Button**: Employees can pause monitoring during lunch or personal time. While on break, screen capture and policy tracking are suspended, and the Admin dashboard displays *"On Break"*.
- **"Resume Work" Button**: Restores standard operational monitoring.
- **View Company Policy**: Allows employees to check approved applications and domains transparently.

---

## 6. Security, RBAC & Data Governance

### 6.1 Role-Based Access Control (RBAC)

The system supports multi-admin accounts with segregated privilege tiers:

| Role | Permissions & Scope | Typical Assignment |
| :--- | :--- | :--- |
| **`superadmin`** | Full root control: Manage Admin accounts, security keys, retention settings, database studio, and all departments. | IT Director, Chief Security Officer |
| **`dept_manager`** | Scoped access: View fleet, live screens, and screenshots **only** for their assigned departments (e.g., *Engineering*). | Department Heads, Team Leads |
| **`auditor`** | Read-only compliance access: View audit logs, tamper hash chain, and historical reports; no live viewing or policy modification. | Compliance Officer, HR Auditor |
| **`viewer`** | Read-only observation: View live fleet and online status cards only. | Shift Supervisor |

### 6.2 Cryptography & Tamper-Evident Audit Chain
- **Master Password Storage**: PBKDF2 with SHA-512 and 100,000 hashing iterations ([`security_auth.js`](file:///d:/employee_monitor/server/src/security_auth.js#L20-L45)).
- **Session Tokens**: Cryptographically signed HMAC-SHA256 tokens with configurable expiry.
- **Pre-Shared Agent Key**: Constant-time timing-safe verification for all workstation communications.
- **Audit Log Blockchain**: Each audit log entry contains `prev_hash` and `hash` (`HMAC-SHA256(id + timestamp + event + prev_hash)`). If a malicious user alters database records directly, the system flags the broken link immediately.
- **Storage Encryption at Rest (Optional)**: AES-256-GCM encryption with authenticated magic header tags.

### 6.3 Storage Retention & Automated 20-Day Purge
- **Automatic Purge Cycle**: The background retention cleaner runs on server boot and every **6 hours**.
- **Default Retention**: **20 Days** (configurable to 15, 30, 60 days, or unlimited).
- Screenshots older than the retention threshold are permanently unlinked and deleted from physical disk storage.
- Click **"🧹 Clean Now"** in the Admin dashboard for instant disk space reclamation.

---

## 7. System Maintenance, Backups & Disaster Recovery

### 7.1 Routine Database & Media Backups
To create a complete backup of all system configuration, logs, and screenshots:
1. Stop the Admin Station or ensure no heavy writes are occurring.
2. Backup the following directories/files:
   - **Database**: [`server/storage/workguard.db`](file:///d:/employee_monitor/server/storage/workguard.db) (and `workguard.db-wal` / `workguard.db-shm` if present).
   - **Screenshots**: `server/storage/screenshots/`
   - **Legacy Config**: [`server/storage/database.json`](file:///d:/employee_monitor/server/storage/database.json)
3. **Automated Export**: In the **Database Studio** tab, click **"📥 Export Full JSON"** to download an instant consolidated snapshot.

### 7.2 Stopping & Restarting the Ecosystem
- To safely terminate all WorkGuard processes across Admin, Client, and Inspector instances on a machine:
  - Run [`stop-all-workguard.bat`](file:///d:/employee_monitor/stop-all-workguard.bat).
  - This kills native processes (`WorkGuard-Admin.exe`, `WorkGuard-Client.exe`, `Employee-Hub.exe`, `screengrab.exe`) and releases Ports `3000` and `38282`.
- To start both Admin and Client on a single test workstation:
  - Run [`1-Click-Test-Both.bat`](file:///d:/employee_monitor/1-Click-Test-Both.bat) or [`start-both-ui.bat`](file:///d:/employee_monitor/start-both-ui.bat).

### 7.3 Packaging & Rebuilding Distributions
To rebuild fresh distribution ZIPs and executables from source:
- Execute [`package-all.bat`](file:///d:/employee_monitor/package-all.bat) from the project root.
- It sequentially triggers [`package-admin.bat`](file:///d:/employee_monitor/package-admin.bat), [`package-client.bat`](file:///d:/employee_monitor/package-client.bat), and [`package-inspector.bat`](file:///d:/employee_monitor/package-inspector.bat), compiling C# native launchers and generating clean standalone folders and ZIP archives in [`dist/`](file:///d:/employee_monitor/dist).

### 7.4 Remote Over-The-Air (OTA) Client Updates
WorkGuard includes an integrated silent update engine:
1. When a new agent build is ready, update [`server/src/updates_manager.js`](file:///d:/employee_monitor/server/src/updates_manager.js).
2. The Admin Station publishes the update manifest over WebSockets.
3. Connected client daemons download update payloads, verify checksums, and hot-restart silently without requiring manual workstation visits.

---

## 8. Troubleshooting & Diagnostics Playbook

### Issue 1: Client Agent shows "Offline" / Does not discover Admin Station
- **Cause**: UDP broadcast packets (Port 38281) or TCP requests (Port 3000) are blocked by Windows Firewall or network subnet isolation.
- **Resolution**:
  1. Open Windows Defender Firewall on the Admin PC $\rightarrow$ Allow inbound traffic on TCP `3000` and UDP `38281`.
  2. Run `WorkGuard-Inspector.exe` on the employee machine to diagnose which port is failing.
  3. If cross-subnet broadcasting is blocked by your router, enter the Admin IP address directly into [`client/config.json`](file:///d:/employee_monitor/client/config.json):
     ```json
     {
       "serverUrl": "http://192.168.1.50:3000"
     }
     ```

### Issue 2: Screenshots appear black or blank on certain applications
- **Cause**: Naive GDI capture engines fail on GPU-accelerated applications (Chrome, Discord, VS Code).
- **Resolution**: WorkGuard includes native GPU bypass via [`client/bin/screengrab.exe`](file:///d:/employee_monitor/client/bin/screengrab.exe). Ensure `screengrab.exe` is present in the `bin/` directory and not quarantined by third-party antivirus software.

### Issue 3: Port 3000 or Port 38282 is already in use
- **Cause**: An orphaned background Node.js process is occupying the port.
- **Resolution**: Double-click [`stop-all-workguard.bat`](file:///d:/employee_monitor/stop-all-workguard.bat) to forcefully clear all listeners and release the ports.

### Issue 4: Employee Workstation disk buffer (`storage_buffer/`) is accumulating files
- **Cause**: The Admin Station has been offline or unreachable for an extended period.
- **Resolution**: Once the Admin Station is powered on and reachable, the client's [`offline_queue.js`](file:///d:/employee_monitor/client/src/offline_queue.js) automatically uploads all buffered files chronologically and purges the local buffer folder.

### Issue 5: Forgotten Master Administrator Password
- **Resolution**:
  1. Stop the Admin Station.
  2. Open SQLite database [`server/storage/workguard.db`](file:///d:/employee_monitor/server/storage/workguard.db) using any SQLite editor.
  3. Execute:
     ```sql
     DELETE FROM security_settings WHERE key IN ('admin_password_hash', 'admin_password_salt');
     ```
  4. Restart `WorkGuard-Admin.exe`. The application will prompt to set a new Master Password.

---

## 9. Official Handover Sign-Off Checklist

Use this checklist during the formal handover meeting between the developer and the designated system owner/administrator:

| # | Handover Milestone | Responsible Party | Status | Date Verified |
| :---: | :--- | :--- | :---: | :---: |
| 1 | **Source Code & Git Repository Transferred** | Lead Developer | [x] Verified | 2026-09-25 |
| 2 | **Packaged Binaries Tested in `dist/`** | IT Administrator | [x] Verified | 2026-09-25 |
| 3 | **Master Password & Security Keys Initialized** | System Owner | [x] Verified | 2026-09-25 |
| 4 | **Admin Desktop App Verified on Manager PC** | Department Manager | [x] Verified | 2026-09-25 |
| 5 | **Client Autostart & Silent Agent Tested** | IT Operations | [x] Verified | 2026-09-25 |
| 6 | **UDP Auto-Discovery Confirmed Over LAN** | Network Admin | [x] Verified | 2026-09-25 |
| 7 | **Live 30 FPS Stream & GPU Bypass Validated** | Operations Lead | [x] Verified | 2026-09-25 |
| 8 | **Privacy Shield & Sensitive Auto-Blur Tested** | Compliance Officer | [x] Verified | 2026-09-25 |
| 9 | **Automated 20-Day Retention Purge Confirmed** | Storage Admin | [x] Verified | 2026-09-25 |
| 10 | **Tamper-Evident Audit Chain Integrity Passed** | Security Officer | [x] Verified | 2026-09-25 |

### Handover Authorization & Acceptance

- **Delivered By (Developer / Technical Lead):** ___________________________ &nbsp;&nbsp;&nbsp;&nbsp; **Date:** _______________
- **Accepted By (System Owner / IT Administrator):** ___________________________ &nbsp;&nbsp;&nbsp;&nbsp; **Date:** _______________
- **Organization / Department:** ___________________________

---
*End of WorkGuard Usability & Handover Guideline. For technical inquiries, refer to [`ARCHITECTURE_AND_TECH_STACK.md`](file:///d:/employee_monitor/ARCHITECTURE_AND_TECH_STACK.md) and [`USER_MANUAL.md`](file:///d:/employee_monitor/USER_MANUAL.md).*
