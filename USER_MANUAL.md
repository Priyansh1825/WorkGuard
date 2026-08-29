# 📘 WorkGuard: Complete User & Installation Manual

Official operation and installation guide for **Administrators (Managers)** and **Employees (Client Endpoints)**.

---

# PART 1: ADMINISTRATOR USER MANUAL (Manager Station)

## 1. Overview & System Requirements
The **WorkGuard Admin Station** is a native Windows desktop software designed for fleet oversight, real-time live screen monitoring, policy enforcement, and audit logs over your local network (LAN) or optional cloud storage.

* **Operating System**: Windows 10 / 11 (64-bit) or Windows Server
* **Network**: Connected to the office Local Area Network (Wi-Fi or Ethernet)
* **Hardware**: Dual-core processor or higher, 4 GB RAM minimum

---

## 2. Installation & Launch

### Step 1: Extract the Software
1. Copy `WorkGuard-Admin-Station.zip` to the manager's computer.
2. Right-click and select **Extract All** (e.g., to `C:\WorkGuard-Admin-Station\` or Desktop).

### Step 2: Start the Admin Station
* **Option A (Recommended)**: Double-click **`WorkGuard-Admin.exe`** (or `Start-Admin-Station.bat`).
* The **WorkGuard Admin Desktop Window** will open directly.
* The internal backend automatically boots on Port `3000` and starts the UDP discovery beacon on Port `38281`.

---

## 3. How to Use the Admin Station Features

### 📊 Fleet Overview
* Displays a live grid of all connected employee workstations.
* Shows each machine's **Workstation Name**, **Username**, **Online/Offline Status**, **Current Active Application & Window Title**, and **Real-Time CPU/RAM Usage**.

### 🔴 Live Screen Monitor
* Select any online workstation to watch their screen in real-time at 15–30 FPS with sub-second latency.
* Click **Full Screen** to inspect fine text or technical workflows.

### 📸 Screenshot Timeline & Gallery
* View automated silent screenshots captured according to your interval timer.
* Filter by **Date**, **Workstation Name**, or **Application Name** (e.g., `chrome.exe`, `code.exe`).
* Click any thumbnail to open the high-resolution zoom lightbox or download the full image.

### 🛡️ Whitelists & Policy Rules
* **Application Whitelist**: Add or remove permitted program executable names (e.g., `code.exe`, `excel.exe`, `slack.exe`).
* **Website Whitelist**: Add permitted work domains (e.g., `github.com`, `google.com`).
* **Work Hours**: Configure official business hours (e.g., `09:00` to `18:00`). Monitoring automatically pauses outside of business hours.
* **Enforcement Mode**:
  * `Audit & Alert`: Logs unlisted applications without disturbing the employee.
  * `Strict Block`: Terminates unauthorized applications immediately.
* Click **"Save & Deploy to All Agents"** to push updates across the network instantly.

### 🧹 Automatic Screenshot Deletion (Retention Policy)
* In the **Whitelists & Rules** tab, locate **Screenshot Auto-Delete Retention**.
* Select your retention duration: `15 Days`, `20 Days (Default)`, `30 Days`, `60 Days`, or `Keep Forever`.
* Screenshots older than this threshold are automatically deleted from your hard drive every 6 hours.
* Click **"🧹 Clean Now"** to immediately purge expired files and free disk space.

### ☁️ Optional Cloud Storage Configuration
* Under **Whitelists & Rules**, you can optionally enter a **Cloud Storage Endpoint URL** (e.g., AWS S3 bucket, Cloudflare R2, or custom cloud URL) or a **Cloud Database URL** (e.g., PostgreSQL/MongoDB).
* Leaving these fields blank keeps all data 100% offline on your local computer.

### 📥 System Tray Minimization
* Clicking the **`(X)` close button** on the Admin window minimizes the app into the **Windows System Tray** (bottom-right taskbar by the clock) so monitoring never stops.
* To restore the window: Double-click the tray icon.
* To exit completely: Right-click the tray icon and select **"❌ Exit WorkGuard Admin"**.

---

# PART 2: EMPLOYEE USER MANUAL (Client Workstations)

## 1. Overview
The **WorkGuard Client Agent** is an endpoint productivity service running on employee computers. It includes an optional **Employee Hub UI** for work shift tracking, policy transparency, and break management.

---

## 2. Installation & Setup

### Step 1: Extract the Software
1. Copy `WorkGuard-Client-Agent.zip` to the employee's computer.
2. Extract the archive (e.g., to `C:\Program Files\WorkGuard\` or user folder).

### Step 2: 1-Click Installation (Auto-Start on Boot)
1. Right-click **`Install-WorkGuard.exe`** (or `Install-WorkGuard-Agent.bat`) and click **Run as Administrator** (or open normally).
2. A confirmation dialog will appear:
   > *"WorkGuard Client Agent has been successfully installed! The agent is now running silently in the background and will auto-start with Windows."*
3. **Zero Configuration Needed**: The agent will automatically discover the manager's Admin station over your office Wi-Fi/LAN without typing any IP addresses.

---

## 3. How to Use the Employee Hub UI

Employees can open their workstation hub at any time:
* Double-click **`Employee-Hub.exe`** (or `Open-Employee-Hub.bat`).

### ⏱️ Active Work Shift Timer
* Automatically records your daily productive work time.

### ☕ Take Break Mode (Lunch & Personal Time)
* When taking a break (lunch, tea, or personal phone call), click **"☕ Take Break"**.
* **What happens**:
  * Screen capture and policy monitoring are **immediately suspended**.
  * The Admin station is notified (`"Employee went on break"`).
  * When returning to work, click **"Resume Work"** to reactivate monitoring.

### 📋 View Company Policy Rules
* Click **"View Policy Rules"** to see which applications and websites are approved by company policy (`VS Code`, `Slack`, `Teams`, `Chrome`, `Excel`, etc.).

### 🟢 Sync Status Indicator
* Shows **"Synchronized"** when connected to the manager's PC.
* If the manager's PC is turned off, it shows **"Buffering Offline"** — captures are stored safely on the local disk and automatically synced once the manager turns their PC back on.

---

## 4. Uninstallation / Removal

To remove the WorkGuard Client Agent from an employee machine:
1. Open the `WorkGuard-Client-Agent` folder.
2. Double-click **`Uninstall-WorkGuard-Agent.bat`**.
3. The autostart Windows registry key and background processes will be completely removed.

---

# ❓ Frequently Asked Questions (FAQ)

### Q1: Does WorkGuard require internet access?
**No.** WorkGuard operates 100% offline over your local office network (Wi-Fi or Ethernet switch). No data is sent to external cloud servers unless you explicitly configure a Cloud Storage URL.

### Q2: What happens if the manager turns off their PC?
The employee client agents automatically switch to **Offline Disk Buffer Mode**. They buffer screenshots locally on disk (`storage_buffer/`) and automatically upload them once the manager's PC is back online.

### Q3: Why does screen capture never show black screens on Chrome or Discord?
WorkGuard uses a native C# Win32 GDI+ capture engine (`screengrab.exe`) with `SRCCOPY | CAPTUREBLT` display context hooks to bypass hardware GPU acceleration, preventing black-screen captures on GPU-accelerated software (Chrome, Edge, VS Code, Discord, Zoom).
