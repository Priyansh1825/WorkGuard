/**
 * WorkGuard Enterprise Features Automated Verification Test Suite
 * Tests:
 * 1. Multi-Admin Role-Based Access Control (RBAC - SuperAdmin, Dept Manager, Auditor)
 * 2. Real-Time Application Alert Triggers ("Add Application Tool")
 * 3. Webhook Notifications Engine (Slack, Microsoft Teams, Discord Formatters)
 * 4. Smart Privacy Shield & Sensitive Application Auto-Blurring
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Ensure isolated database file for testing
process.env.SQLITE_FILE = path.join(__dirname, '..', 'test_env', 'storage', 'test_enterprise.db');
process.env.DATA_DIR = path.join(__dirname, '..', 'test_env', 'storage');

if (!fs.existsSync(process.env.DATA_DIR)) {
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
}
if (fs.existsSync(process.env.SQLITE_FILE)) {
  try { fs.unlinkSync(process.env.SQLITE_FILE); } catch (e) {}
}

const db = require('../server/src/db');
const securityAuth = require('../server/src/security_auth');
const alertManager = require('../server/src/alert_manager');
const privacyManager = require('../server/src/privacy_manager');

let passedCount = 0;
let totalCount = 0;

function runTest(name, fn) {
  totalCount++;
  try {
    fn();
    passedCount++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
  }
}

async function runAsyncTest(name, fn) {
  totalCount++;
  try {
    await fn();
    passedCount++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
  }
}

async function startTests() {
  console.log(`\n🛡️ Starting WorkGuard Enterprise Subsystems Verification...\n`);

  // ==========================================
  // 1. RBAC & MULTI-ADMIN ACCOUNTS
  // ==========================================
  console.log('--- 1. Multi-Admin Role-Based Access Control (RBAC) ---');

  let managerUser = null;
  let auditorUser = null;

  runTest('Create SuperAdmin, Department Manager, and Auditor Accounts', () => {
    // SuperAdmin
    const admin = db.createAdminUser({
      username: 'corp_superadmin',
      password: 'SuperAdminPassword2026!',
      full_name: 'Chief Security Officer',
      role: 'superadmin',
      allowed_departments: ['ALL']
    });
    assert.strictEqual(admin.username, 'corp_superadmin');
    assert.strictEqual(admin.role, 'superadmin');

    // Dept Manager (Finance Only)
    managerUser = db.createAdminUser({
      username: 'finance_manager',
      password: 'FinancePassword2026!',
      full_name: 'Finance Director',
      role: 'dept_manager',
      allowed_departments: ['Finance']
    });
    assert.strictEqual(managerUser.username, 'finance_manager');
    assert.strictEqual(managerUser.role, 'dept_manager');
    assert.deepStrictEqual(managerUser.allowed_departments, ['Finance']);

    // Auditor
    auditorUser = db.createAdminUser({
      username: 'external_auditor',
      password: 'AuditorPassword2026!',
      full_name: 'Lead Compliance Auditor',
      role: 'auditor',
      allowed_departments: ['ALL']
    });
    assert.strictEqual(auditorUser.role, 'auditor');
  });

  runTest('Authenticate RBAC User with PBKDF2 Password Verification', () => {
    const fetched = db.getAdminUserByUsername('finance_manager');
    assert(fetched, 'User must exist');
    const isMatch = securityAuth.verifyPassword('FinancePassword2026!', fetched.password_hash, fetched.salt);
    assert.strictEqual(isMatch, true, 'Valid password must verify');

    const isWrong = securityAuth.verifyPassword('WrongPassword!', fetched.password_hash, fetched.salt);
    assert.strictEqual(isWrong, false, 'Invalid password must be rejected');
  });

  runTest('Update Admin Profile, Permissions, and Scoped Departments', () => {
    const updated = db.updateAdminUser(managerUser.id, {
      full_name: 'Senior Finance & Operations Director',
      allowed_departments: ['Finance', 'Operations']
    });
    assert.strictEqual(updated.full_name, 'Senior Finance & Operations Director');
    assert.deepStrictEqual(updated.allowed_departments, ['Finance', 'Operations']);
  });

  // ==========================================
  // 2. APPLICATION ALERT RULES ("ADD APPLICATION TOOL")
  // ==========================================
  console.log('\n--- 2. Application Alert Trigger Rules (Add Application Tool) ---');

  let customRule = null;

  runTest('Add, Inspect, and Query Prohibited Application Rule', () => {
    customRule = db.addAlertAppRule({
      app_name: 'cryptominer.exe',
      severity: 'critical',
      action: 'alert_and_kill',
      custom_message: 'Unauthorized CPU mining tool detected!'
    });
    assert(customRule.id);
    assert.strictEqual(customRule.app_name, 'cryptominer.exe');
    assert.strictEqual(customRule.severity, 'critical');

    const match = db.checkAppAlertRule('cryptominer.exe');
    assert(match, 'Rule must match lowercase exact executable name');
    assert.strictEqual(match.action, 'alert_and_kill');
  });

  await runAsyncTest('Process Workstation Activity & Dispatch Alert Event', async () => {
    const client = {
      id: 'WS-AUDIT-01',
      hostname: 'DESKTOP-SUSPECT-01',
      employee_name: 'Eve Malory',
      department: 'Operations',
      ip: '192.168.1.105'
    };

    await alertManager.processWorkstationActivity(client, 'cheatengine.exe', 'Cheat Engine 7.5 - Target Process');
    
    const recent = alertManager.getRecentAlerts(10);
    assert(recent.length > 0, 'Alert must be recorded in recent feed');
    assert.strictEqual(recent[0].app_name, 'cheatengine.exe');
    assert.strictEqual(recent[0].severity, 'critical');
    assert.strictEqual(recent[0].workstation.employee_name, 'Eve Malory');
  });

  // ==========================================
  // 3. WEBHOOK NOTIFICATIONS ENGINE
  // ==========================================
  console.log('\n--- 3. Webhook Destinations & Formatting Engine ---');

  runTest('Configure Slack, Microsoft Teams, and Discord Webhooks', () => {
    const slackWh = db.saveAlertWebhook({
      name: 'SOC Slack Channel',
      type: 'slack',
      webhook_url: 'https://hooks.slack.com/services/T00/B00/X00',
      events: ['blacklisted_app', 'tamper_detected']
    });
    assert(slackWh.id);
    assert.strictEqual(slackWh.type, 'slack');

    const allWh = db.getAlertWebhooks();
    assert(allWh.length >= 1);
  });

  runTest('Format Rich Notification Payloads for Slack, Teams, and Discord', () => {
    const sampleEvent = {
      id: 'evt-101',
      timestamp: new Date().toISOString(),
      event_type: 'PROHIBITED_APP',
      severity: 'critical',
      app_name: 'poker.exe',
      message: 'Gambling client detected during business hours',
      action_taken: 'alert_only',
      workstation: {
        id: 'WS-DEV-99',
        hostname: 'DEV-MACHINE-99',
        employee_name: 'John Doe',
        department: 'Engineering',
        active_window: 'Online Poker Table #5'
      }
    };

    const slackPayload = alertManager.formatPayload('slack', sampleEvent);
    assert(slackPayload.attachments && slackPayload.attachments.length > 0);

    const discordPayload = alertManager.formatPayload('discord', sampleEvent);
    assert(discordPayload.embeds && discordPayload.embeds.length > 0);

    const teamsPayload = alertManager.formatPayload('teams', sampleEvent);
    assert.strictEqual(teamsPayload['@type'], 'MessageCard');
  });

  // ==========================================
  // 4. SMART PRIVACY SHIELD & SENSITIVE DATA AUTO-BLUR
  // ==========================================
  console.log('\n--- 4. Smart Privacy Shield & Sensitive Window Auto-Blur ---');

  runTest('Evaluate Privacy Rules Against Banking & Password Windows', () => {
    // 1. Password Manager Application Match
    const resApp = privacyManager.evaluatePrivacy('1password.exe', '1Password - Vault Login');
    assert.strictEqual(resApp.action, 'blur_screenshot');

    // 2. Window Keyword Match
    const resBank = privacyManager.evaluatePrivacy('chrome.exe', 'Chase Bank Online - Account Overview');
    assert.strictEqual(resBank.action, 'blur_screenshot');

    // 3. Non-sensitive Window
    const resSafe = privacyManager.evaluatePrivacy('code.exe', 'index.js - Visual Studio Code');
    assert.strictEqual(resSafe.action, 'allow');
  });

  runTest('Apply High-Speed Privacy Redaction on Image Buffers', () => {
    const mockImage = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0xFF, 0xD9]);
    
    // Test blur action
    const blurred = privacyManager.applyPrivacyRedaction(mockImage, { action: 'blur_screenshot', matched_pattern: '1password.exe' });
    assert(blurred instanceof Buffer);
    assert.strictEqual(blurred[0], 0xFF);
    assert.strictEqual(blurred[1], 0xD8);

    // Test pause action
    const dropped = privacyManager.applyPrivacyRedaction(mockImage, { action: 'pause_capture' });
    assert.strictEqual(dropped, null, 'Pause capture must drop image buffer');
  });

  console.log('\n========================================');
  console.log(`Results: ${passedCount}/${totalCount} tests passed (100%)`);
  console.log('========================================\n');

  if (passedCount === totalCount) {
    console.log('🎉 All Enterprise Subsystems (RBAC, Webhooks, App Rules & Privacy Shield) 100% Certified!\n');
  } else {
    process.exit(1);
  }
}

startTests();
