# WorkGuard: Offline Employee Monitoring & Fleet Management System

An offline-first, local area network (LAN) workplace productivity monitoring and endpoint management solution with **zero cloud dependencies**.

---

## 🌟 Key Software Capabilities

1. **Two Distinct Dedicated Software Packages**:
   - **Admin Station Desktop App (`Electron JS`)**: Native Windows desktop software with an embedded monitoring server, real-time live streaming, fleet telemetry overview, and Windows System Tray support (minimize to tray, desktop violation notifications).
   - **Client Agent Software (Silent Background Daemon)**: Invisible background process with automatic Windows boot startup, zero taskbar presence, and offline disk buffering.

2. **Zero-Configuration Automatic LAN Discovery (UDP Broadcast Beacon)**:
   - **No manual IP configuration needed!** The Admin server automatically broadcasts a discovery beacon on UDP port `38281`.
   - Client Agents automatically discover the Admin station over the local network and establish sub-second WebSocket/HTTP links instantly.

3. **Hardware Acceleration & GPU Screen Capture Bypass**:
   - Uses native Win32 DPI-aware GDI+ capture with `SRCCOPY | CAPTUREBLT` and display device context hooks (`client/bin/screengrab.exe`).
   - **Bypasses black screen issues** common with GPU-accelerated applications (e.g. Google Chrome, Microsoft Edge, Discord, Zoom, VS Code, and video players).

4. **On-Demand Live Screen Streaming & Automated Silent Screenshots**:
   - **Live Low-Latency Streaming**: Streams employee displays in real-time at 15-30 FPS only when an administrator is actively viewing.
   - **Automated Silent Screenshots**: Captures high-definition screenshots at configurable intervals (e.g. every 15s) without any popups, shutter sounds, or window focus theft.
   - **Offline Disk Queue**: If the Admin software is closed, client agents buffer captures locally in `storage_buffer/` and automatically flush them to the server upon reconnection.

5. **Application & Website Policy Enforcement**:
   - **Application Whitelist**: Monitors running foreground processes against permitted programs (`code.exe`, `excel.exe`, `slack.exe`, etc.).
   - **Website Whitelist**: Scans active browser tabs across Chrome, Edge, and Firefox.
   - **Modes**: `Audit & Alert` (records violations & notifies Admin) or `Strict Block` (terminates unauthorized apps immediately).

---

## 🏗️ Architecture

```
                                  LOCAL AREA NETWORK (LAN)
        +-------------------------------------------------------------------------+
        |                                                                         |
        v                                                                         v
+------------------------------------+                    +------------------------------------+
|    WORKGUARD ADMIN (Electron)      |                    |       CLIENT AGENT (Endpoint)      |
|                                    |                    |                                    |
| * Native Windows Desktop App       |  UDP Auto-Beacon   | * Invisible Background Daemon      |
| * Embedded Express & WS Backend    |<==================>| * HW Acceleration Screen Grabber   |
| * System Tray & Desktop Alerts     |  HTTP / WS Relay   | * UDP Auto-Discovery Receiver      |
| * SQLite/JSON Timeline DB          |      Over LAN      | * Resilient Offline Disk Buffer    |
| * Modern Glassmorphism UI          |                    | * Real-time CPU/RAM Telemetry      |
+------------------------------------+                    +------------------------------------+
```

---

## 🚀 How to Run the Software

### 1. Admin Machine (Manager / Supervisor)
Double-click `start-admin-app.bat` (or `start-admin-app.vbs` for silent launch).
* Launches the **WorkGuard Admin Desktop Application**.
* Automatically starts the backend server on port `3000` and starts the UDP discovery beacon on port `38281`.
* Minimizes to the Windows System Tray when closed so monitoring never stops.
* The Admin window provides complete fleet control, live screen streaming, whitelisting, and desktop alerts.

---

### 2. Client Workstations (Employee Workstations)

#### Automatic 1-Click Installation (Auto-Start on Boot):
1. Copy the `client/` folder or project to the employee workstation.
2. Double-click `install-autostart.bat`.
3. The client agent will now run silently in the background every time the PC turns on, finding the Admin station automatically!

#### Manual / Testing Launch:
* **Silent Background Mode**: Double-click `start-client-silent.vbs`.
* **Console Debug Mode**: Double-click `start-client.bat` (shows live logs and connection status).

#### To Remove / Uninstall Autostart:
Double-click `uninstall-autostart.bat`.

---

## 🖥️ Admin Dashboard Modules

- **Fleet Overview**: Grid view of all connected machines, CPU/RAM usage, active running application, foreground window title, and online status.
- **Live Monitor**: Select any online workstation to watch their screen in real time with sub-second latency and full-screen support.
- **Screenshot Timeline**: Searchable gallery filterable by workstation, date, and application name with full-resolution zoom lightbox.
- **Whitelists & Rules**: Add or remove allowed executable files (`.exe`) and permitted websites, adjust capture intervals, and push updates instantly to all agents.
- **Audit Logs**: Tamper-evident record of connection events, policy modifications, and rule violations.

---

## 🔒 Security & Privacy Notice
This software is designed strictly for organizational efficiency and compliance monitoring within private local networks. In compliance with workplace privacy standards, employees should be notified of company monitoring policies, and monitoring should be restricted to official business hours.
