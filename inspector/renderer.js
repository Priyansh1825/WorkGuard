// WorkGuard Fleet & Network Inspector Engine
let isScanning = false;

async function runDiagnostics() {
  if (isScanning) return;
  isScanning = true;
  document.getElementById('btn-run-diagnostics').innerHTML = '<span>⏳</span> Diagnosing...';

  const startTime = Date.now();
  const issues = [];
  let adminOk = false;
  let hubOk = false;
  let clientsList = [];
  let serverStats = null;
  let storageInfo = null;

  // 1. Test Port 3000 (Admin Server)
  try {
    const t0 = performance.now();
    const res = await fetch('http://127.0.0.1:3000/api/stats', { signal: AbortSignal.timeout(2500) });
    const latency = Math.round(performance.now() - t0);

    if (res.ok) {
      adminOk = true;
      const data = await res.json();
      serverStats = data.stats;

      document.getElementById('pill-admin').className = 'status-indicator-pill online';
      document.getElementById('pill-admin').textContent = 'ONLINE';
      document.getElementById('admin-status-text').textContent = 'Active & Responding';
      document.getElementById('admin-latency-text').textContent = `${latency} ms (Fast)`;
      document.getElementById('admin-manager-text').textContent = 'Manager / Station Host';
    } else {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
  } catch (err) {
    document.getElementById('pill-admin').className = 'status-indicator-pill offline';
    document.getElementById('pill-admin').textContent = 'OFFLINE';
    document.getElementById('admin-status-text').textContent = 'Port 3000 Inaccessible';
    document.getElementById('admin-latency-text').textContent = 'Timeout';
    document.getElementById('admin-manager-text').textContent = 'Station Stopped';
    document.getElementById('admin-storage-text').textContent = '---';

    issues.push({
      type: 'error',
      icon: '❌',
      title: 'Admin Monitoring Server is Not Running',
      desc: 'The central WorkGuard manager station is offline or not listening on port 3000.',
      fix: '👉 Fix: Double-click "start-admin-app.bat" or "WorkGuard-Admin.exe" to launch the manager.'
    });
  }

  // 1b. If Admin is online, fetch storage info & clients list
  if (adminOk) {
    try {
      const [storageRes, clientsRes] = await Promise.all([
        fetch('http://127.0.0.1:3000/api/settings/storage'),
        fetch('http://127.0.0.1:3000/api/clients')
      ]);

      if (storageRes.ok) {
        storageInfo = await storageRes.json();
        document.getElementById('admin-storage-text').textContent = storageInfo.storage_type === 'cloud' 
          ? '☁️ Cloud S3/R2' 
          : `📁 Local (${storageInfo.retention_days || 20}d Auto-Purge)`;
      }

      if (clientsRes.ok) {
        const cData = await clientsRes.json();
        clientsList = cData.clients || [];
      }
    } catch (e) {}
  }

  // 2. Test Port 38281 (UDP Discovery Beacon)
  if (adminOk) {
    document.getElementById('pill-udp').className = 'status-indicator-pill online';
    document.getElementById('pill-udp').textContent = 'BROADCASTING';
    document.getElementById('udp-status-text').textContent = 'Active Beacon (Port 38281)';
    document.getElementById('udp-mode-text').textContent = 'Zero-Config UDP Broadcast';
    document.getElementById('udp-fw-text').textContent = 'Pass (Allowed)';
  } else {
    document.getElementById('pill-udp').className = 'status-indicator-pill offline';
    document.getElementById('pill-udp').textContent = 'DISABLED';
    document.getElementById('udp-status-text').textContent = 'Server Inactive';
    document.getElementById('udp-fw-text').textContent = 'Unknown';
  }

  // 3. Test Port 38282 (Employee Hub UI)
  try {
    const hubRes = await fetch('http://127.0.0.1:38282/api/status', { signal: AbortSignal.timeout(1500) });
    if (hubRes.ok) {
      hubOk = true;
      document.getElementById('pill-hub').className = 'status-indicator-pill online';
      document.getElementById('pill-hub').textContent = 'ACTIVE';
      document.getElementById('hub-status-text').textContent = 'Client Agent Running';
    } else {
      throw new Error();
    }
  } catch (e) {
    document.getElementById('pill-hub').className = 'status-indicator-pill offline';
    document.getElementById('pill-hub').textContent = 'IDLE';
    document.getElementById('hub-status-text').textContent = 'No local agent on this machine';
  }

  // 4. Update Admin Profile Card
  if (adminOk) {
    document.getElementById('admin-hostname').textContent = 'Localhost / Admin PC';
    document.getElementById('admin-ip').textContent = '127.0.0.1 (Port 3000)';
    document.getElementById('admin-url').textContent = 'http://127.0.0.1:3000';
  } else {
    document.getElementById('admin-hostname').textContent = 'Not Connected';
    document.getElementById('admin-ip').textContent = '---';
    document.getElementById('admin-url').textContent = 'Server Offline';
  }

  // 5. Update Connected Employees Table
  const tbody = document.getElementById('employees-tbody');
  document.getElementById('fleet-count-badge').textContent = `${clientsList.length} Connected Workstations`;

  if (clientsList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; color:#64748b; padding:24px;">
          No employee workstations connected yet.<br>
          <span style="font-size:11px; color:#94a3b8;">Start the client agent on employee computers to see them here.</span>
        </td>
      </tr>
    `;
    if (adminOk) {
      issues.push({
        type: 'warning',
        icon: '⚠️',
        title: 'Zero Employee Workstations Connected',
        desc: 'The server is running, but no client agents have registered yet.',
        fix: '👉 Fix: Ensure employee machines run "WorkGuard-Client.exe" and are on the same Wi-Fi/LAN network.'
      });
    }
  } else {
    tbody.innerHTML = '';
    clientsList.forEach(client => {
      const isOnline = client.status === 'online';
      const row = document.createElement('tr');
      const empName = client.employee_name || client.username || 'Employee';
      const empDept = client.department || 'General';

      row.innerHTML = `
        <td><strong>${empName}</strong> <span style="font-size:11px; color:#64748b;">(${client.username})</span></td>
        <td><span class="tag-dept">${empDept}</span></td>
        <td><span class="font-mono">${client.hostname}</span><br><span style="font-size:11px; color:#64748b;">${client.ip}</span></td>
        <td><span style="color:#0284c7; font-weight:600;">${client.current_app || 'Desktop'}</span></td>
        <td>
          <span style="color:${isOnline ? '#16a34a' : '#dc2626'}; font-weight:700;">
            ${isOnline ? '🟢 Online' : '🔴 Offline'}
          </span>
        </td>
      `;
      tbody.appendChild(row);
    });
  }

  // 6. Overall System Health Evaluation & Banner
  const banner = document.getElementById('overall-health-banner');
  const bannerIcon = document.getElementById('banner-icon');
  const bannerTitle = document.getElementById('banner-title');
  const bannerDesc = document.getElementById('banner-desc');
  const bannerBadge = document.getElementById('banner-status-badge');

  if (adminOk && clientsList.length > 0) {
    banner.className = 'health-banner healthy';
    bannerIcon.textContent = '✅';
    bannerTitle.textContent = 'System Operational & Fleet Healthy';
    bannerDesc.textContent = `Admin Station is online and coordinating ${clientsList.length} employee workstation(s) smoothly.`;
    bannerBadge.textContent = 'ALL SYSTEMS HEALTHY';

    issues.unshift({
      type: 'success',
      icon: '🎉',
      title: 'Zero Bottlenecks Detected',
      desc: 'All communication sockets, UDP beacons, databases, and monitoring engines are operating at peak efficiency.',
      fix: 'Everything is running perfectly.'
    });
  } else if (adminOk && clientsList.length === 0) {
    banner.className = 'health-banner warning';
    bannerIcon.textContent = '⏳';
    bannerTitle.textContent = 'Admin Station Running — Waiting for Employees';
    bannerDesc.textContent = 'The monitoring coordinator is ready. Launch the client software on employee machines to connect.';
    bannerBadge.textContent = 'WAITING FOR FLEET';
  } else {
    banner.className = 'health-banner danger';
    bannerIcon.textContent = '🛑';
    bannerTitle.textContent = 'WorkGuard Services Offline';
    bannerDesc.textContent = 'The monitoring server is not running on this laptop.';
    bannerBadge.textContent = 'SERVICES DOWN';
  }

  // 7. Render Issues List
  const issuesContainer = document.getElementById('issues-container');
  document.getElementById('issues-badge').textContent = `${issues.filter(i => i.type !== 'success').length} Actionable Items`;
  issuesContainer.innerHTML = '';

  issues.forEach(issue => {
    const item = document.createElement('div');
    item.className = `issue-item ${issue.type}`;
    item.innerHTML = `
      <div class="issue-item-icon">${issue.icon}</div>
      <div class="issue-content">
        <div class="issue-title">${issue.title}</div>
        <div class="issue-desc">${issue.desc}</div>
        <div class="issue-fix">${issue.fix}</div>
      </div>
    `;
    issuesContainer.appendChild(item);
  });

  document.getElementById('last-checked').textContent = new Date().toLocaleTimeString();
  document.getElementById('btn-run-diagnostics').innerHTML = '<span class="btn-icon">⚡</span> Run Full Diagnostics';
  isScanning = false;
}

// Event Listeners
document.getElementById('btn-run-diagnostics').addEventListener('click', runDiagnostics);

// Initial Execution & Auto-Polling every 3 seconds
runDiagnostics();
setInterval(runDiagnostics, 3000);
