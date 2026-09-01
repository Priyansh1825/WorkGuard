const http = require('http');
const https = require('https');
const { URL } = require('url');
const db = require('./db');

/**
 * WorkGuard Real-Time Alert & Webhook Dispatcher Engine
 * Formats and dispatches instant security and policy breach notifications
 * to Slack, Microsoft Teams, Discord, and custom webhooks.
 */
class AlertManager {
  constructor() {
    // In-memory rate limiting & deduplication: key -> lastSentTimestamp
    this.rateLimitMap = new Map();
    // Recent dispatched alerts feed (max 100 entries for Admin UI)
    this.recentDispatchedAlerts = [];
  }

  getRecentAlerts(limit = 30) {
    return this.recentDispatchedAlerts.slice(0, limit);
  }

  /**
   * Evaluates workstation telemetry and dispatches alerts if an alert rule matches.
   */
  async processWorkstationActivity(clientInfo, currentApp, currentWindow) {
    if (!currentApp || !clientInfo) return;

    const rule = db.checkAppAlertRule(currentApp);
    if (!rule) return;

    const dedupKey = `${clientInfo.id}:${currentApp.toLowerCase()}`;
    const now = Date.now();
    const lastSent = this.rateLimitMap.get(dedupKey) || 0;

    // Deduplicate: 5 minutes cooldown for same workstation+app (1 min for critical)
    const cooldownMs = rule.severity === 'critical' ? 60 * 1000 : 5 * 60 * 1000;
    if (now - lastSent < cooldownMs) {
      return;
    }
    this.rateLimitMap.set(dedupKey, now);

    const alertEvent = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      event_type: 'PROHIBITED_APPLICATION_DETECTED',
      severity: rule.severity || 'warning',
      app_name: rule.app_name,
      message: rule.custom_message || `Detected prohibited application: ${rule.app_name}`,
      action_taken: rule.action || 'alert_only',
      workstation: {
        id: clientInfo.id,
        hostname: clientInfo.hostname || 'Unknown Host',
        employee_name: clientInfo.employee_name || 'Unknown Employee',
        department: clientInfo.department || 'General',
        ip: clientInfo.ip || '127.0.0.1',
        active_window: currentWindow || 'Desktop'
      }
    };

    // Save in memory feed
    this.recentDispatchedAlerts.unshift(alertEvent);
    if (this.recentDispatchedAlerts.length > 100) this.recentDispatchedAlerts.pop();

    // Log to DB audit chain
    db.addLog(
      clientInfo.id,
      'SECURITY_ALERT_TRIGGERED',
      `[${rule.severity.toUpperCase()}] ${rule.custom_message} (App: ${currentApp}, Window: ${currentWindow})`
    );

    // Dispatch to all enabled webhooks
    await this.dispatchToEnabledWebhooks(alertEvent);
  }

  async dispatchToEnabledWebhooks(alertEvent) {
    const webhooks = db.getAlertWebhooks().filter(w => w.is_enabled);
    if (webhooks.length === 0) return;

    const dispatchPromises = webhooks.map(wh => this.sendWebhook(wh, alertEvent));
    await Promise.allSettled(dispatchPromises);
  }

  async sendWebhook(webhookConfig, alertEvent) {
    try {
      const payload = this.formatPayload(webhookConfig.type, alertEvent);
      await this.executeHttpJsonPost(webhookConfig.webhook_url, payload);
    } catch (err) {
      console.warn(`[AlertManager] ⚠️ Failed to dispatch webhook '${webhookConfig.name}':`, err.message);
    }
  }

  formatPayload(type, event) {
    const colorHex = event.severity === 'critical' ? '#E11D48' : (event.severity === 'warning' ? '#F59E0B' : '#3B82F6');
    const severityEmoji = event.severity === 'critical' ? '🚨 CRITICAL' : (event.severity === 'warning' ? '⚠️ WARNING' : 'ℹ️ NOTICE');

    switch (type) {
      case 'slack':
        return {
          text: `${severityEmoji}: WorkGuard Alert - ${event.message}`,
          attachments: [
            {
              color: colorHex,
              blocks: [
                {
                  type: 'header',
                  text: { type: 'plain_text', text: `${severityEmoji}: Policy Trigger`, emoji: true }
                },
                {
                  type: 'section',
                  fields: [
                    { type: 'mrkdwn', text: `*Employee:*\n${event.workstation.employee_name}` },
                    { type: 'mrkdwn', text: `*Department:*\n${event.workstation.department}` },
                    { type: 'mrkdwn', text: `*Workstation:*\n${event.workstation.hostname} (${event.workstation.id})` },
                    { type: 'mrkdwn', text: `*Application:*\n\`${event.app_name}\`` }
                  ]
                },
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: `*Active Window:*\n_${event.workstation.active_window}_\n*Action:* \`${event.action_taken}\`` }
                }
              ]
            }
          ]
        };

      case 'discord':
        return {
          content: `${severityEmoji} **WorkGuard Security Alert**`,
          embeds: [
            {
              title: event.message,
              color: parseInt(colorHex.replace('#', ''), 16),
              fields: [
                { name: 'Employee', value: event.workstation.employee_name, inline: true },
                { name: 'Department', value: event.workstation.department, inline: true },
                { name: 'Workstation', value: event.workstation.hostname, inline: true },
                { name: 'Application', value: `\`${event.app_name}\``, inline: true },
                { name: 'Active Window', value: event.workstation.active_window, inline: false },
                { name: 'Action', value: event.action_taken, inline: true }
              ],
              timestamp: event.timestamp,
              footer: { text: 'WorkGuard Real-Time Enterprise Monitor' }
            }
          ]
        };

      case 'teams':
        return {
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: colorHex.replace('#', ''),
          summary: `${severityEmoji}: ${event.message}`,
          title: `🛡️ WorkGuard Alert: ${event.message}`,
          sections: [
            {
              facts: [
                { name: 'Employee:', value: event.workstation.employee_name },
                { name: 'Department:', value: event.workstation.department },
                { name: 'Workstation:', value: `${event.workstation.hostname} (${event.workstation.ip})` },
                { name: 'Application:', value: event.app_name },
                { name: 'Active Window:', value: event.workstation.active_window },
                { name: 'Severity:', value: event.severity.toUpperCase() }
              ],
              markdown: true
            }
          ]
        };

      default:
        // Generic JSON Webhook
        return {
          source: 'WorkGuard Enterprise Monitor',
          version: '2.0',
          ...event
        };
    }
  }

  executeHttpJsonPost(targetUrl, jsonBody) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const payloadStr = JSON.stringify(jsonBody);
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr),
          'User-Agent': 'WorkGuard-Alert-Dispatcher/2.0'
        },
        timeout: 5000
      };

      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: data });
          } else {
            reject(new Error(`Webhook endpoint returned HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Webhook request timed out after 5s'));
      });

      req.write(payloadStr);
      req.end();
    });
  }

  async testWebhook(url, type = 'slack') {
    const testEvent = {
      id: 'test-event-001',
      timestamp: new Date().toISOString(),
      event_type: 'WEBHOOK_TEST_CONNECTION',
      severity: 'info',
      app_name: 'test_probe.exe',
      message: '✅ This is a test notification from WorkGuard Enterprise.',
      action_taken: 'test_only',
      workstation: {
        id: 'WS-TEST-PROBE',
        hostname: 'CENTRAL-ADMIN-STATION',
        employee_name: 'System Administrator',
        department: 'InfoSec & Operations',
        ip: '127.0.0.1',
        active_window: 'WorkGuard Security Operations Center'
      }
    };

    const payload = this.formatPayload(type, testEvent);
    return await this.executeHttpJsonPost(url, payload);
  }
}

module.exports = new AlertManager();
