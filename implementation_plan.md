# Implementation Plan: Standalone Admin Desktop App (Electron) & Silent Client Agent

Transform the Employee Monitoring System into two distinct, dedicated software packages that connect automatically over LAN with zero manual IP setup, reliable hardware-accelerated screen capture, and on-demand viewing.

---

## 🏗️ System Architecture & Distinction

```
+---------------------------------------------------------------------------------------+
|                                    LOCAL NETWORK                                      |
|                                                                                       |
|   [ WORKGUARD ADMIN APP (Electron JS) ]       <--- UDP Auto-Beacon (Zero-Config) ---   |
|   * Native Windows Desktop GUI Window         ---> TCP / WebSocket Relay -----------> |
|   * Embedded Local Server & SQLite Database                                           |
|   * System Tray & Desktop Push Alerts                                                 |
|   * Real-Time Stream Viewer & Timeline                                                |
+---------------------------------------------------------------------------------------+
                                        ▲
                                        │ Automated LAN Connection
                                        ▼
+---------------------------------------------------------------------------------------+
|   [ WORKGUARD CLIENT AGENT (Silent Executable) ]                                      |
|   * Invisible Background Service / Auto-start on boot                                 |
|   * Hardware Capture Engine (Bypasses black screens / DRM / GPU acceleration)         |
|   * UDP Auto-Discovery (Finds Admin server IP automatically)                          |
|   * Offline Buffer (Captures even if Admin app is closed; auto-syncs when online)     |
|   * Process & Website Whitelist Enforcer                                              |
+---------------------------------------------------------------------------------------+
```

---

## 💡 Key Architectural Decisions & Suggestions

### 1. Electron JS for Admin Station & Hardware Bypass
- **Admin App**: We build the Admin software using **Electron JS**, embedding the backend server seamlessly. Double-clicking `WorkGuard Admin.exe` boots the server, initializes the database, and opens the dark-mode glassmorphic dashboard in a native desktop window.
- **Hardware Acceleration Bypass in Capture**:
  - In modern Windows OS, hardware-accelerated applications (Chrome GPU rendering, Discord, Zoom, video players) often show up as black boxes if captured incorrectly.
  - We configure the Client screen capture engine to use native **DPI-aware Direct GDI+ / BitBlt with `CAPTUREBLT` and Win32 DC hooks**, ensuring 100% crystal-clear capture of all hardware-accelerated and transparent windows without black screens.

### 2. Zero-Config LAN Auto-Discovery (No Manual IP Setup Needed)
- **Problem**: In office/home networks, router DHCP changes IP addresses (e.g. `192.168.1.5` -> `192.168.1.18`).
- **Solution**:
  - The Admin Server runs a **UDP Broadcast Beacon** on port `38281`.
  - The Client Agent listens for the broadcast beacon and **automatically discovers the Admin's IP address** on startup.
  - When the Admin turns on their PC, the Client connects in sub-second time without any manual configuration.
  - Static IP fallback is retained in `config.json` for complex multi-VLAN networks.

### 3. "Store & View-On-Demand" Lifecycle
- When Admin is offline: The Client silently stores encrypted screenshots and activity logs in its local queue (`storage_buffer`).
- When Admin launches the app: The Client instantly detects the server, connects, and dumps all buffered records.
- When Admin clicks "Live View": The Client switches from idle interval mode to high-framerate live streaming.

---

## 📋 Proposed Changes

### Component 1: Admin Desktop Application (Electron JS)

Create the Electron wrapper and packaging pipeline for the Admin station.

#### [NEW] [admin/main.js](file:///d:/employee_monitor/admin/main.js)
- Electron main process:
  - Automatically starts and manages the embedded Express/WebSocket backend server.
  - Creates the native desktop window (`BrowserWindow`) with dark theme, smooth hardware acceleration, and custom window controls.
  - Implements Windows System Tray with menu items: *Open Dashboard*, *Server Status: Running*, *View Fleet*, *Exit*.
  - Native Windows desktop notifications when employees violate whitelists or launch blocked software.

#### [NEW] [admin/package.json](file:///d:/employee_monitor/admin/package.json)
- Electron configuration, build scripts, and dependencies (`electron`, `electron-builder` / `electron-packager`).

#### [NEW] [admin/preload.js](file:///d:/employee_monitor/admin/preload.js)
- Secure context bridge exposing desktop notification APIs, tray badge counts, and native window minimize/maximize controls.

---

### Component 2: Server UDP Auto-Discovery Beacon & Enhancements

#### [NEW] [server/src/discovery_beacon.js](file:///d:/employee_monitor/server/src/discovery_beacon.js)
- Runs a lightweight UDP broadcast server that announces the Admin Server IP and Port every 2 seconds on the local network (`255.255.255.255:38281`).

#### [MODIFY] [server/src/index.js](file:///d:/employee_monitor/server/src/index.js)
- Integrate UDP discovery beacon start/stop lifecycle with server startup and shutdown.

---

### Component 3: Client Agent Auto-Discovery & Packaging

#### [NEW] [client/src/auto_discovery.js](file:///d:/employee_monitor/client/src/auto_discovery.js)
- UDP listener socket that automatically finds the server beacon, resolves the IP, and triggers automatic WebSocket and HTTP connection without user intervention.

#### [MODIFY] [client/src/agent.js](file:///d:/employee_monitor/client/src/agent.js)
- Hook into auto-discovery so the agent automatically connects as soon as the Admin server is detected on the network, dynamically updating endpoints if the server IP shifts.

#### [MODIFY] [client/src/config.js](file:///d:/employee_monitor/client/src/config.js)
- Add `AUTO_DISCOVER: true` flag while keeping fallback manual server IP.

#### [NEW] [client/package_agent.bat](file:///d:/employee_monitor/client/package_agent.bat) & Build Scripts
- Scripts to bundle the Client Agent into a standalone Windows `.exe` executable (`WorkGuardAgent.exe`) with silent autostart installation script (`Install-WorkGuardClient.bat`).

---

## 🔍 Verification Plan

### 1. Zero-Config LAN Auto-Discovery Test
- Start the server UDP beacon.
- Launch client agent without configuring any IP address.
- Verify client receives UDP beacon, extracts IP/Port, and automatically registers in the server database.

### 2. Hardware Capture Bypass Verification
- Open hardware-accelerated windows (Chrome with YouTube 1080p, Discord, VS Code).
- Capture screenshots via the agent and verify there are no black boxes or blank graphics.

### 3. Electron Admin App Test
- Launch the Electron Admin application.
- Verify native desktop window loads, server starts in background, system tray icon displays, and live screen stream + fleet controls function smoothly.
- Test closing the window to tray and restoring from tray.

### 4. Client Standalone & Autostart Test
- Test running client agent silently without any command prompt window.
- Verify automatic queue flushing and instant live streaming upon Admin request.
