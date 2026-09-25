# 📘 WorkGuard: Complete User Manual & Testing Guide

> **Document Type:** System Usability Manual & Step-by-Step Testing Guide  
> **Target Audience:** Project Owners, System Administrators, Managers, and QA Testers  
> **Software Version:** WorkGuard v2.4.0 (Enterprise LAN Edition)  
> **Architecture:** 100% Offline Local Area Network (Zero Cloud Dependencies)  

---

## 📑 Table of Contents

1. [Quick Overview: What Files to Use](#1-quick-overview-what-files-to-use)
2. [Part 1: Manager User Manual (Admin Station Desktop App)](#part-1-manager-user-manual-admin-station-desktop-app)
   - [1.1 How to Launch & First-Time Setup](#11-how-to-launch--first-time-setup)
   - [1.2 Fleet Overview & Real-Time Monitoring](#12-fleet-overview--real-time-monitoring)
   - [1.3 Live Screen Streaming (30 FPS Sub-Second Latency)](#13-live-screen-streaming-30-fps-sub-second-latency)
   - [1.4 Screenshot Timeline & Image Gallery](#14-screenshot-timeline--image-gallery)
   - [1.5 Setting Application & Website Whitelist Policies](#15-setting-application--website-whitelist-policies)
   - [1.6 Smart Privacy Shield (Auto-Blur Sensitive Windows)](#16-smart-privacy-shield-auto-blur-sensitive-windows)
   - [1.7 Real-Time Security Alerts & Webhooks](#17-real-time-security-alerts--webhooks)
   - [1.8 Database Studio & Record Management](#18-database-studio--record-management)
   - [1.9 Background Running & System Tray](#19-background-running--system-tray)
3. [Part 2: Employee User Manual (Client Agent & Hub Widget)](#part-2-employee-user-manual-client-agent--hub-widget)
   - [2.1 How to Install (1-Click Auto-Start on Boot)](#21-how-to-install-1-click-auto-start-on-boot)
   - [2.2 First-Time Employee Name & Department Setup](#22-first-time-employee-name--department-setup)
   - [2.3 Using the Employee Hub Widget](#23-using-the-employee-hub-widget)
   - [2.4 Taking Breaks (Pausing Monitoring for Privacy)](#24-taking-breaks-pausing-monitoring-for-privacy)
   - [2.5 How to Completely Uninstall](#25-how-to-completely-uninstall)
4. [Part 3: Complete Testing Guide (How to Test Everything Yourself)](#part-3-complete-testing-guide-how-to-test-everything-yourself)
   - [Test 1: 1-Click Automated Diagnostic Audit (`run-all-tests.bat`)](#test-1-1-click-automated-diagnostic-audit-run-all-testsbat)
   - [Test 2: 1-Click Visual Dual-UI Test on 1 PC (`1-Click-Test-Both.bat`)](#test-2-1-click-visual-dual-ui-test-on-1-pc-1-click-test-bothbat)
   - [Test 3: Live 30 FPS Screen Streaming Test](#test-3-live-30-fps-screen-streaming-test)
   - [Test 4: GPU Hardware Acceleration Screen Capture Test (No Black Screen)](#test-4-gpu-hardware-acceleration-screen-capture-test-no-black-screen)
   - [Test 5: Smart Privacy Shield & Auto-Blur Test](#test-5-smart-privacy-shield--auto-blur-test)
   - [Test 6: Offline Disk Buffering Test (Network Resilience)](#test-6-offline-disk-buffering-test-network-resilience)
   - [Test 7: Real-World Multi-PC LAN Test (Across 2 Separate Computers)](#test-7-real-world-multi-pc-lan-test-across-2-separate-computers)
5. [Part 4: Troubleshooting & Quick Fixes](#part-4-troubleshooting--quick-fixes)

---

## 1. Quick Overview: What Files to Use

The production software packages are located in the [`dist/`](file:///d:/employee_monitor/dist) folder:

```
d:\employee_monitor\dist\
├── WorkGuard-Admin-Station.zip        <-- Extract this on the MANAGER / SUPERVISOR PC
│   └── WorkGuard-Admin.exe            <-- Double-click to launch the Admin Station
│
└── WorkGuard-Client-Agent.zip         <-- Extract this on EMPLOYEE WORKSTATION PCs
    ├── Install-WorkGuard.exe          <-- Double-click to install (runs silently in background)
    └── Employee-Hub.exe               <-- Double-click to open Employee status & break widget
```

---

# Part 1: Manager User Manual (Admin Station Desktop App)

The **WorkGuard Admin Station** is a native Windows desktop application for managing all employee workstations over your office Local Area Network (LAN).

### 1.1 How to Launch & First-Time Setup
1. Extract [`dist/WorkGuard-Admin-Station.zip`](file:///d:/employee_monitor/dist/WorkGuard-Admin-Station.zip) to any folder (e.g. `C:\WorkGuard-Admin-Station\`).
2. Double-click **`WorkGuard-Admin.exe`** (or [`Start-Admin-Station.bat`](file:///d:/employee_monitor/dist/WorkGuard-Admin-Station/Start-Admin-Station.bat)).
3. **First-Time Master Password**:
   - On the first launch, set your **Administrator Master Password** (minimum 6 characters).
   - Once saved, your SQLite database and cryptographic session secrets are initialized.
4. The dashboard automatically starts the server on Port `3000` and broadcasts a UDP beacon on Port `38281`.

---

### 1.2 Fleet Overview & Real-Time Monitoring
Navigate to the **"👥 Fleet Overview"** tab:
* **Live Workstation Cards**: Displays every connected computer with:
  - **Employee Name & Assigned Department**
  - **Online/Offline Status Indicator**
  - **Current Active Application** (e.g. `code.exe`, `excel.exe`)
  - **Current Foreground Window Title**
  - **Live CPU & RAM Telemetry**
* **Department Filter**: Use the dropdown at the top to filter machines by department (*Engineering*, *Sales*, *Marketing*, *HR*).
* **Remote Profile Editing**: Click **"✏️ Edit Profile"** on any card to change an employee's name or department. The changes synchronize to the employee's PC immediately.

---

### 1.3 Live Screen Streaming (30 FPS Sub-Second Latency)
Navigate to the **"🔴 Live Monitor"** tab:
1. Select any online employee from the dropdown list or click **"Live Watch"** on their fleet card.
2. The employee's screen will stream live at **15–30 FPS** with sub-second latency.
3. Click **"Full Screen"** to inspect fine code text, spreadsheets, or designs.
4. *Bandwidth Saving*: When you leave the Live Monitor tab, streaming automatically stops to save network bandwidth and CPU.

---

### 1.4 Screenshot Timeline & Image Gallery
Navigate to the **"📸 Timeline"** tab:
* **Automated Silent Captures**: WorkGuard captures screenshots periodically (e.g., every 15s or 10 min, configurable in policy).
* **Filter by Workstation, Date, or Application**: Search specifically for screenshots where an employee was using `chrome.exe`, `excel.exe`, etc.
* **Full-Resolution Zoom Lightbox**: Click any thumbnail to view in full resolution or click **"Download"** to save to disk.

---

### 1.5 Setting Application & Website Whitelist Policies
Navigate to the **"🛡️ Policies & Rules"** tab:
* **Allowed Applications**: Add approved executable filenames (e.g. `code.exe`, `excel.exe`, `slack.exe`, `teams.exe`).
* **Allowed Websites**: Add approved domain names (e.g. `github.com`, `google.com`, `jira.com`).
* **Work Hours**: Set office hours (e.g. `09:00` to `18:00`, Monday–Friday). Monitoring automatically suspends outside of these hours.
* **Policy Enforcement Mode**:
  - `Audit & Alert`: Logs unlisted applications without disturbing the employee.
  - `Strict Block`: Automatically terminates prohibited software immediately using `taskkill`.
* Click **"Save & Deploy to All Agents"** to push updates across the entire LAN instantly.

---

### 1.6 Smart Privacy Shield (Auto-Blur Sensitive Windows)
WorkGuard automatically detects sensitive windows to protect privacy and comply with privacy regulations:
* **Protected Password Vaults**: `1password.exe`, `bitwarden.exe`, `keepass.exe`, `lastpass.exe`.
* **Sensitive Keywords**: `*bank*`, `*paypal*`, `*payroll*`, `*medical*`, `*credit card*`.
* **Actions**:
  - `blur_screenshot`: Replaces the screenshot with a privacy redaction mask.
  - `pause_capture`: Drops screenshot capture while sensitive windows are open.
  - `mask_title`: Replaces window title with `[Protected Window - Privacy Shield Active]`.

---

### 1.7 Real-Time Security Alerts & Webhooks
* Configure webhooks for **Slack**, **Microsoft Teams**, or **Discord**.
* Add custom application trigger rules (e.g., alert immediately if `utorrent.exe` or `cheatengine.exe` is launched).
* Instant notification cards will be sent to your team's Slack/Teams channel.

---

### 1.8 Database Studio & Record Management
Navigate to the **"🗄️ Database Studio"** tab:
* Inspect all SQLite tables directly: `clients`, `screenshots`, `policies`, `audit_logs`, `security_settings`.
* Search, paginate, edit, or delete records.
* Click **"📥 Export Full JSON"** to download an instant consolidated database backup.
* Click **"🧹 Clean Now"** to purge expired screenshots according to your retention policy (default: 20 days).

---

### 1.9 Background Running & System Tray
* Clicking the **`[X]` close button** on the Admin window **minimizes it to the Windows System Tray** (bottom-right by the clock) so monitoring never stops.
* **Restore Window**: Double-click the System Tray icon.
* **Exit Completely**: Right-click the System Tray icon $\rightarrow$ Click **"❌ Exit WorkGuard Admin"**.

---

# Part 2: Employee User Manual (Client Agent & Hub Widget)

The **Client Agent** runs invisibly in the background on employee computers.

### 2.1 How to Install (1-Click Auto-Start on Boot)
1. Extract [`dist/WorkGuard-Client-Agent.zip`](file:///d:/employee_monitor/dist/WorkGuard-Client-Agent.zip) on the employee's computer (e.g., to `C:\WorkGuard-Client\`).
2. Double-click **`Install-WorkGuard.exe`** (or [`Install-WorkGuard-Agent.bat`](file:///d:/employee_monitor/dist/WorkGuard-Client-Agent/Install-WorkGuard-Agent.bat)).
3. **Zero Configuration Needed**: The agent installs to Windows startup (`Run` registry key), boots silently in the background, and automatically finds the manager's Admin station over the office Wi-Fi/LAN!

---

### 2.2 First-Time Employee Name & Department Setup
1. The **Employee Hub** window will open and prompt for:
   - **Full Name** (e.g. *John Smith*)
   - **Department** (e.g. *Engineering*)
2. Once saved, the profile is **permanently locked** on the employee machine to prevent tampering.
3. Only managers can edit an employee's details remotely from the Admin Dashboard.

---

### 2.3 Using the Employee Hub Widget
Employees can open their status hub anytime by double-clicking **`Employee-Hub.exe`**:
* **Active Shift Timer**: Displays daily productive work hours.
* **Sync Status**: Shows **"🟢 Synchronized"** when connected to the manager's station.
* **View Company Policy**: Allows employees to check approved software and websites transparently.

---

### 2.4 Taking Breaks (Pausing Monitoring for Privacy)
When an employee steps away for lunch, tea, or personal time:
1. Open **`Employee-Hub.exe`**.
2. Click **"☕ Take Break"**.
3. **What happens**:
   - Screen capture and policy monitoring are **immediately paused**.
   - The Admin dashboard shows status as *"On Break"*.
4. When returning to work, click **"Resume Work"** to reactivate monitoring.

---

### 2.5 How to Completely Uninstall
To remove the WorkGuard Client Agent from an employee machine:
1. Open the `WorkGuard-Client-Agent` folder.
2. Double-click **`Uninstall-WorkGuard-Agent.bat`**.
3. All background daemon processes are terminated and the autostart registry key is removed cleanly.

---

# Part 3: Complete Testing Guide (How to Test Everything Yourself)

Follow these hands-on test procedures to verify the entire system.

---

### Test 1: 1-Click Automated Diagnostic Audit (`run-all-tests.bat`)
> **Goal:** Run an automated health audit of all 5 system layers in an isolated sandbox.

1. In the project root directory, double-click **[`run-all-tests.bat`](file:///d:/employee_monitor/run-all-tests.bat)**.
2. A console window will open and execute:
   - **[1/5] SQLite Database Engine & Studio Tests**
   - **[2/5] Security, PBKDF2 & AES-256 Storage Encryption Tests**
   - **[3/5] Enterprise RBAC, Webhooks & Privacy Shield Tests**
   - **[4/5] OTA Remote Updates Engine Tests**
   - **[5/5] Full End-to-End System Integration Tests**
3. **Expected Output**:
   ```
   ===============================================================================
     ALL TEST SUITES PASSED! 100 PERCENT SYSTEM HEALTH CERTIFIED (0 FAILURES)
   ===============================================================================
   ```

---

### Test 2: 1-Click Visual Dual-UI Test on 1 PC (`1-Click-Test-Both.bat`)
> **Goal:** Test both the Manager Admin Station and Employee Hub simultaneously on a single computer.

1. Double-click **[`1-Click-Test-Both.bat`](file:///d:/employee_monitor/1-Click-Test-Both.bat)** (or [`WorkGuard-1Click-Test.exe`](file:///d:/employee_monitor/WorkGuard-1Click-Test.exe)).
2. **What Opens**:
   - The **Admin Desktop App Window** opens on the left.
   - The **Employee Hub Widget** opens on the right.
3. **Verification Steps**:
   - Look at the Admin **Fleet Overview**: Your machine appears as an active workstation card with CPU/RAM and current window title.
   - On the Employee Hub, click **"☕ Take Break"** $\rightarrow$ Verify the Admin card immediately displays *"On Break"*.
   - On the Employee Hub, click **"Resume Work"** $\rightarrow$ Verify the Admin card switches back to active monitoring.

---

### Test 3: Live 30 FPS Screen Streaming Test
> **Goal:** Verify sub-second real-time screen streaming.

1. With the Admin Station open, click the **"🔴 Live Monitor"** tab.
2. Select your workstation from the dropdown or click **"Live Watch"**.
3. Move your mouse or open a browser window.
4. **Expected Result**: The screen in the Live Monitor tab reflects your desktop actions in real time with sub-second latency and 30 FPS smoothness.
5. Click **"Full Screen"** to inspect resolution clarity.

---

### Test 4: GPU Hardware Acceleration Screen Capture Test (No Black Screen)
> **Goal:** Verify that screen capture bypasses GPU acceleration on Chrome, Discord, and VS Code.

1. Open **Google Chrome**, **Microsoft Edge**, **Discord**, or **VS Code** with GPU hardware acceleration enabled.
2. Play a video or open a complex webpage.
3. In the Admin Station, navigate to **"📸 Timeline"** or view the **Live Monitor**.
4. **Expected Result**: The Chrome/Discord window is captured with 100% full visual fidelity — **no black boxes or blank areas**.

---

### Test 5: Smart Privacy Shield & Auto-Blur Test
> **Goal:** Verify that password managers and banking sites are automatically protected.

1. Open Notepad or a browser tab with a title containing `"Password"` or `"Bank"` (or open a password manager like `1Password` / `Bitwarden`).
2. Trigger a screenshot capture.
3. In the Admin Station **"📸 Timeline"**, check the captured image.
4. **Expected Result**: The image displays an obfuscated privacy mask banner, and the window title is masked in logs.

---

### Test 6: Offline Disk Buffering Test (Network Resilience)
> **Goal:** Verify that employee PCs store screenshots locally when the manager's PC is turned off.

1. Close the Admin Station completely (right-click tray icon $\rightarrow$ Exit).
2. Keep the employee client agent running on the workstation.
3. Open [`client/storage_buffer/`](file:///d:/employee_monitor/client/storage_buffer/) $\rightarrow$ Observe screenshot files being buffered locally on disk.
4. Restart the Admin Station (`WorkGuard-Admin.exe`).
5. **Expected Result**: The client automatically flushes and uploads all cached screenshots to the Admin station, and the local buffer empties automatically.

---

### Test 7: Real-World Multi-PC LAN Test (Across 2 Separate Computers)
> **Goal:** Verify zero-configuration automatic discovery across the office network.

1. **On PC 1 (Manager PC)**:
   - Extract `WorkGuard-Admin-Station.zip` and double-click `WorkGuard-Admin.exe`.
2. **On PC 2 (Employee PC)**:
   - Extract `WorkGuard-Client-Agent.zip` and double-click `Install-WorkGuard.exe`.
   - Enter Employee Name (e.g. *Alice Cooper*) and Department (*Engineering*).
3. **Verify Connection**:
   - On PC 1 (Admin Station), Alice's workstation card appears automatically in **Fleet Overview** within 1–2 seconds without typing any IP addresses!

---

# Part 4: Troubleshooting & Quick Fixes

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **Client shows "Offline" / Cannot find Admin PC** | Windows Firewall blocking UDP Port `38281` or TCP Port `3000`. | On Admin PC, open Windows Defender Firewall $\rightarrow$ Allow inbound traffic on TCP `3000` and UDP `38281`. Alternatively, type Admin IP into `client/config.json`. |
| **Port 3000 or 38282 is already in use** | A previous instance is still running in the background. | Double-click [`stop-all-workguard.bat`](file:///d:/employee_monitor/stop-all-workguard.bat) to forcefully kill all lingering processes and release the ports. |
| **Screenshots not purging after 20 days** | Server has not run its 6-hour cycle. | In Admin Station, go to **"🛡️ Policies & Rules"** or **"🗄️ Database Studio"** and click **"🧹 Clean Now"** for immediate cleanup. |
| **Forgot Admin Master Password** | Password hash locked in SQLite database. | Stop Admin Station $\rightarrow$ Open `server/storage/workguard.db` in SQLite $\rightarrow$ Run `DELETE FROM security_settings WHERE key LIKE 'admin_password%';` $\rightarrow$ Restart app to set a new password. |

---
*End of WorkGuard User Manual & Testing Guide. For technical architecture details, refer to [`ARCHITECTURE_AND_TECH_STACK.md`](file:///d:/employee_monitor/ARCHITECTURE_AND_TECH_STACK.md).*
