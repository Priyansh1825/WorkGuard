# 🏗️ WorkGuard: Technical Architecture & Technology Stack Reference

A comprehensive technical deep-dive into **how WorkGuard works**, **what technologies and languages are used**, and **the architectural rationale behind each choice**.

---

## 1. System Architecture Diagram

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
| 🔌 WebSocket Streaming Relay Hub   |          Port 38281        | 📸 Win32 GDI+ Screen Grabber (.exe)|
| 💾 Local Database & Storage Manager|                            | 💾 Resilient Offline Disk Buffer   |
| 🧹 Auto-Retention Purge Engine     |      HTTP / WS Relay       | ⏱️ Employee Hub Status UI (Widget) |
| ☁️ Cloud URL Forwarder (Optional)  | ◄────────────────────────► | 🛡️ App & Web Policy Enforcer       |
| 📥 Windows System Tray Daemon      |          Port 3000         | ☕ Break Mode Suspend Controller   |
+------------------------------------+                            +------------------------------------+
```

---

## 2. How the Software Works (Step-by-Step Execution Flow)

### Phase 1: Boot & Zero-Configuration LAN Discovery
1. **Admin Boot**: When the manager launches `WorkGuard-Admin.exe`, the embedded Express/WebSocket backend starts on port `3000`, and a UDP broadcast beacon (`DiscoveryBeacon`) begins transmitting packets on UDP port `38281` across the local subnet.
2. **Client Auto-Detection**: When an employee PC boots, the client agent (`auto_discovery.js`) listens on UDP port `38281`. It intercepts the beacon, resolves the manager's current LAN IP address (e.g. `192.168.1.50`), and connects to `ws://192.168.1.50:3000/ws` without any manual IP configuration.

### Phase 2: Telemetry & Activity Monitoring
1. **Heartbeats & Window Inspection**: Every 3 seconds, the agent inspects the foreground window title and active process executable name using native Windows PowerShell / Win32 APIs.
2. **Policy Evaluation**: The agent compares the running process against the active whitelist:
   * If an unauthorized application is launched:
     * In **Audit & Alert Mode**: An alert event is dispatched over WebSockets and logged in the Admin audit timeline.
     * In **Strict Block Mode**: The unauthorized process is terminated immediately using `taskkill`.

### Phase 3: Hardware-Accelerated Screen Capture (GPU Bypass)
1. At the configured interval (e.g., every 15s), the agent triggers `screengrab.exe`.
2. Unlike naive JavaScript screen grabbers that produce black boxes over GPU-accelerated windows (Google Chrome, Microsoft Edge, VS Code, Discord, Zoom), the compiled C# binary captures display context directly at the Win32 GDI+ subsystem layer using `SRCCOPY | CAPTUREBLT`.
3. The image is compressed into high-definition JPEG format and sent to the upload pipeline.

### Phase 4: Offline Queue & Resilience
1. If the Admin PC is unreachable or turned off, the client switches to **Offline Buffering**:
   * Images and metadata are written to local disk in `storage_buffer/buf_<timestamp>.jpg`.
   * When connectivity to the Admin PC is restored, the queue automatically flushes and uploads all cached items chronologically.

### Phase 5: Live Screen Streaming (On-Demand)
1. Live streaming operates **only on demand** when a manager actively opens the "Live Monitor" tab in the Admin UI.
2. The Admin sends a `START_VIEW_STREAM` command to the specific workstation.
3. The agent begins capturing and streaming JPEG binary frames over WebSockets at 15–30 FPS with sub-second latency.
4. When the manager leaves the tab, the agent automatically stops streaming to conserve network bandwidth and CPU.

### Phase 6: Automated 15–20 Day Screenshot Purge
1. The server runs an automated background retention cleaner on startup and every 6 hours.
2. It scans all captured screenshots against the retention threshold (`retention_days: 20`).
3. Images older than the threshold are deleted from the physical hard drive, preventing storage overflow.

---

## 3. Technology Stack & Engineering Justification

| Technology / Language | Where It Is Used | Why We Used It (Engineering Justification) |
| :--- | :--- | :--- |
| **JavaScript (Node.js)** | Backend server, Agent daemon, WebSocket hub | **Asynchronous Non-Blocking I/O**: Perfect for handling multiple simultaneous client WebSocket streams and high-throughput image uploads with minimal memory footprint. |
| **Electron.js** | Admin Station Desktop Application | **Native OS Integration**: Allows building a cross-platform desktop station with native Windows System Tray minimization, background execution, and hardware-accelerated 60 FPS rendering. |
| **C# (.NET / C-Sharp)** | Screen capture engine (`ScreenGrab.cs`), Native `.exe` launchers | **Hardware GPU Acceleration Bypass**: Access to low-level Win32 `BitBlt` and GDI+ device contexts with `CAPTUREBLT` flags, completely eliminating black-screen issues on Chrome, Edge, and Discord. Compiles natively on Windows using `.NET csc.exe` without third-party toolchains. |
| **WebSockets (`ws`)** | Real-time communication & Live Streaming | **Sub-Second Low Latency**: Full-duplex binary communication channel required for 30 FPS live desktop streaming and instant rule deployment. |
| **UDP Socket (`dgram`)** | Auto-Discovery Beacon (`port 38281`) | **Zero-Configuration Setup**: UDP broadcast allows employee machines to discover the manager's dynamic DHCP IP address automatically without manual IP configuration. |
| **HTML5 & Vanilla CSS3** | Admin Dashboard & Employee Hub UI | **Maximum Performance & Clean Aesthetics**: Eliminates heavy framework overhead (React/Angular/Tailwind bloat), providing fast rendering, dark-mode glassmorphism, and responsive layouts. |
| **Windows Batch (`.bat`) & VBScript (`.vbs`)** | Setup, packaging, and silent launchers | **Native Windows Execution**: Allows launching background daemon processes silently without flashing command prompt windows, and provides 1-click packaging. |
| **JSON / SQLite Abstraction** | Data storage layer (`db.js`) | **Zero Database Installation**: Runs out-of-the-box on local disk without requiring complex MySQL/PostgreSQL server setup on the manager's machine. |
| **Storage Manager (`storage_manager.js`)** | Local vs. Cloud Object Storage switcher | **Future-Proof Scalability**: Allows effortlessly switching between local hard drive storage and cloud object storage (AWS S3 / Cloudflare R2) by setting a single URL. |

---

## 4. Security & Privacy Design Principles

1. **Local Network Containment**: All video frames, logs, and screenshots are transmitted strictly across the private LAN with zero telemetry sent to external third parties.
2. **Break Mode Privacy Control**: The Employee Hub provides a "Take Break" button that legally suspends screen capture during lunch or personal time.
3. **Audit Log Immutability**: All administrative actions (rule updates, threshold changes, stream access) are recorded chronologically in the audit logs.
4. **Offline Buffer Quota**: The offline buffer limits disk footprint to prevent filling up employee workstation drives if the manager is offline for weeks.
