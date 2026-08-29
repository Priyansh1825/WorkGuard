class WebController {
  constructor() {
    this.lastWebViolations = new Map();
  }

  /**
   * Inspects window title from common browsers to detect visited websites.
   * @param {string} processName e.g. "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"
   * @param {string} windowTitle e.g. "YouTube - Google Chrome" or "GitHub: Let's build from here"
   * @param {Object} policy Active server policy
   * @param {Function} onViolation Callback to report violation to server
   */
  evaluateWebActivity(processName, windowTitle, policy, onViolation) {
    if (!policy || !policy.allowed_domains || policy.allowed_domains.length === 0) return;
    if (!processName || !windowTitle) return;

    const browserProcesses = ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe'];
    const normProc = processName.toLowerCase();

    if (!browserProcesses.includes(normProc)) {
      return; // Not a browser window
    }

    const titleLower = windowTitle.toLowerCase();
    
    // Ignore empty or browser default new tab titles
    if (titleLower.includes('new tab') || titleLower.includes('about:blank') || titleLower.trim() === '') {
      return;
    }

    // Common non-work web services / social / streaming sites to flag if not in allowed domains
    const commonBlockedKeywords = [
      'youtube', 'facebook', 'instagram', 'tiktok', 'twitter', 'x.com',
      'netflix', 'twitch', 'reddit', 'disneyplus', 'hulu', 'spotify',
      'pinterest', 'gaming', 'roblox', 'steam', 'bet365', 'casino'
    ];

    // Check if window title mentions any known non-work site that is NOT explicitly whitelisted
    for (const keyword of commonBlockedKeywords) {
      if (titleLower.includes(keyword)) {
        const isDomainWhitelisted = policy.allowed_domains.some(domain => 
          domain.toLowerCase().includes(keyword)
        );

        if (!isDomainWhitelisted) {
          const now = Date.now();
          const lastLogged = this.lastWebViolations.get(keyword) || 0;

          if (now - lastLogged > 30000) {
            this.lastWebViolations.set(keyword, now);
            const details = `Unauthorized Website Detected: '${keyword}' (Window: '${windowTitle}')`;
            console.warn(`[Web Policy Violation] ${details}`);

            if (onViolation) {
              onViolation({
                event_type: 'DOMAIN_BLOCKED',
                details: details
              });
            }
          }
          break;
        }
      }
    }
  }
}

module.exports = new WebController();
