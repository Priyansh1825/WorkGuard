const { exec } = require('child_process');

class AppController {
  constructor() {
    this.lastViolations = new Map(); // processName -> timestamp of last violation log
  }

  sanitizeProcessName(name) {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/[^a-zA-Z0-9_\-\.]/g, '').trim();
  }

  /**
   * Evaluates active process against policy allowed applications.
   * @param {string} processName e.g. "discord.exe" or "code.exe"
   * @param {string} windowTitle e.g. "Discord - General"
   * @param {Object} policy Active server policy
   * @param {Function} onViolation Callback to report violation to server
   */
  evaluateProcess(processName, windowTitle, policy, onViolation) {
    if (!policy || !policy.allowed_apps || policy.allowed_apps.length === 0) return;
    if (!processName) return;

    const normalizedProc = processName.toLowerCase();
    
    // Core system processes always allowed
    const systemAllowlist = [
      'explorer.exe', 'system', 'idle', 'svchost.exe', 'csrss.exe', 
      'winlogon.exe', 'taskmgr.exe', 'services.exe', 'lsass.exe',
      'dwm.exe', 'cmd.exe', 'powershell.exe', 'windowsterminal.exe',
      'conhost.exe', 'node.exe'
    ];

    if (systemAllowlist.includes(normalizedProc)) {
      return;
    }

    // Check if process matches any allowed app in the whitelist
    const isAllowed = policy.allowed_apps.some(allowed => {
      const normAllowed = allowed.toLowerCase();
      return normalizedProc === normAllowed || normalizedProc.includes(normAllowed.replace('.exe', ''));
    });

    if (!isAllowed) {
      const now = Date.now();
      const lastLogged = this.lastViolations.get(normalizedProc) || 0;

      // Rate limit violation logs to once every 30 seconds per unlisted app
      if (now - lastLogged > 30000) {
        this.lastViolations.set(normalizedProc, now);
        
        const safeProc = this.sanitizeProcessName(processName);
        const details = `Unauthorized App Launched: '${safeProc}' (Window: '${windowTitle}')`;
        console.warn(`[Policy Violation] ${details}`);

        if (onViolation) {
          onViolation({
            event_type: 'APP_BLOCKED',
            details: details
          });
        }

        // Process Enforcement (strict taskkill) disabled temporarily pending future update
        // if (policy.policy_mode === 'strict-block' && process.platform === 'win32' && safeProc) {
        //   console.log(`[Enforcement] Strict mode active: Terminating ${safeProc}`);
        //   exec(`taskkill /F /IM "${safeProc}"`, { timeout: 4000 }, (err) => {
        //     if (err) console.error(`Failed to terminate ${safeProc}:`, err.message);
        //   });
        // }
      }
    }
  }
}

module.exports = new AppController();
