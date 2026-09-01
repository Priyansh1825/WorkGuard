/**
 * WorkGuard High-Performance SQLite & Database Studio Verification Suite
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../server/src/db');

async function runDatabaseEngineTests() {
  console.log('🗄️ Starting WorkGuard Database Engine & Studio Test Suite...\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  // --- 1. Database Engine & Statistics ---
  console.log('--- 1. SQLite Engine & Storage Metrics ---');
  test('Verify SQLite Engine Initialization & Stats Retrieval', () => {
    const stats = db.getDatabaseStats();
    assert(stats && typeof stats === 'object', 'Stats must return an object');
    assert.strictEqual(stats.engine, 'SQLite (WAL Mode)', 'Engine must be SQLite WAL');
    assert(fs.existsSync(stats.db_path), 'workguard.db file must exist on disk');
    assert(stats.table_counts.clients >= 0, 'Clients count must be valid');
    assert(stats.table_counts.screenshots >= 0, 'Screenshots count must be valid');
    assert(stats.table_counts.policies >= 1, 'Default policy must exist');
    assert(stats.table_counts.security_settings >= 5, 'Security settings must exist');
  });

  // --- 2. Clients Table CRUD ---
  console.log('\n--- 2. Clients Table CRUD & High-Speed Queries ---');
  test('Insert, Query, Update, and Fetch Client in SQLite', () => {
    const testClientId = `test-client-${Date.now()}`;
    
    // Insert / Upsert
    const inserted = db.upsertClient({
      id: testClientId,
      hostname: 'DEV-WORKSTATION-SQL',
      username: 'db_developer',
      employee_name: 'Database Tester',
      department: 'Database Architecture',
      ip: '192.168.1.55',
      os: 'Windows 11 Enterprise',
      agent_version: '1.3.0',
      current_app: 'dbeaver.exe',
      current_window: 'WorkGuard DB Studio - DBeaver',
      cpu_usage: 14.5,
      ram_usage: 48.2
    });

    assert.strictEqual(inserted.id, testClientId, 'Client ID must match');
    assert.strictEqual(inserted.employee_name, 'Database Tester', 'Employee name must match');

    // Query single
    const queried = db.getClient(testClientId);
    assert(queried, 'Client must be found by ID');
    assert.strictEqual(queried.department, 'Database Architecture');

    // Update profile
    const updated = db.updateClientProfile(testClientId, {
      employee_name: 'Lead DB Architect',
      department: 'Infrastructure Core'
    });
    assert.strictEqual(updated.employee_name, 'Lead DB Architect');
    assert.strictEqual(updated.department, 'Infrastructure Core');

    // Clean up test client
    db.deleteClient(testClientId);
    assert.strictEqual(db.getClient(testClientId), null, 'Client should be deleted');
  });

  // --- 3. Screenshots Fast Insertion & Filtered Querying ---
  console.log('\n--- 3. Indexed Screenshot Ingestion & Filtering ---');
  test('Insert Screenshot and Query with Date & Client Filters', () => {
    const mockClientId = 'client-unit-test-sq';
    const timestamp = new Date().toISOString();

    const screenshot = db.addScreenshot({
      client_id: mockClientId,
      filepath: '/api/screenshots/raw/test/2026-09-01/shot1.jpg',
      filename: 'shot1.jpg',
      timestamp,
      active_app: 'vscode.exe',
      active_window: 'db.js - WorkGuard',
      file_size: 154200,
      is_encrypted: true
    });

    assert(screenshot && screenshot.id, 'Screenshot must return generated UUID');
    assert.strictEqual(screenshot.is_encrypted, true, 'Encryption flag must be true');

    // Filter by client
    const results = db.getScreenshots({ client_id: mockClientId, limit: 10 });
    assert(results.length >= 1, 'Must find at least 1 screenshot for mock client');
    assert.strictEqual(results[0].client_id, mockClientId);

    // Clean up
    db.deleteRecord('screenshots', screenshot.id);
  });

  // --- 4. Automatic Screenshot Retention & Purging ---
  console.log('\n--- 4. Automatic Photo Retention & Database Row Pruning ---');
  test('Purge Expired Screenshots According to Retention Policy', () => {
    // Insert an artificially old screenshot (40 days ago)
    const oldTimestamp = new Date(Date.now() - (40 * 24 * 60 * 60 * 1000)).toISOString();
    const oldShot = db.addScreenshot({
      client_id: 'client-retention-test',
      filepath: '/api/screenshots/raw/test/2026-07-20/old.jpg',
      filename: 'old.jpg',
      timestamp: oldTimestamp,
      active_app: 'oldapp.exe',
      active_window: 'Old Window',
      file_size: 50000,
      is_encrypted: false
    });

    // Run purge for retention_days = 20
    const purgeResult = db.purgeExpiredScreenshots(20);
    assert(purgeResult && typeof purgeResult.deletedCount === 'number', 'Purge result must contain deletedCount');
    assert(purgeResult.deletedCount >= 1, 'Should purge at least our expired test screenshot');

    // Verify row is gone from DB
    const searchOld = db.getScreenshots({ client_id: 'client-retention-test' });
    const exists = searchOld.some(s => s.id === oldShot.id);
    assert.strictEqual(exists, false, 'Expired screenshot record must be deleted from database');
  });

  // --- 5. Database Studio Pagination & Table Management ---
  console.log('\n--- 5. Database Studio Table Inspector & Pagination Engine ---');
  test('Fetch Paginated and Search-Filtered Table Records', () => {
    const tableData = db.getTableRecords('clients', { page: 1, limit: 5, search: '' });
    assert.strictEqual(tableData.table, 'clients', 'Table name must match');
    assert(tableData.records.length <= 5, 'Page limit must be respected');
    assert(typeof tableData.total_records === 'number', 'Total records must be a number');
    assert(typeof tableData.total_pages === 'number', 'Total pages must be calculated');

    // Test search filter
    const searchData = db.getTableRecords('clients', { page: 1, limit: 10, search: 'NonExistentXYZSearch123' });
    assert.strictEqual(searchData.records.length, 0, 'No rows should match bogus search query');
  });

  // --- 6. JSON Export & Backup Portability ---
  console.log('\n--- 6. JSON Export & Portability ---');
  test('Export Complete Database as JSON Object', () => {
    const exported = db.exportFullJson();
    assert(exported && typeof exported === 'object', 'Export must return root JSON object');
    assert(exported.security, 'Export must include security settings');
    assert(exported.policies, 'Export must include workplace policies');
    assert(exported.clients, 'Export must include clients map');
    assert(Array.isArray(exported.screenshots), 'Export must include screenshots list');
    assert(Array.isArray(exported.logs), 'Export must include audit logs');
  });

  console.log('\n========================================');
  console.log(`Results: ${passed}/${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log('========================================\n');

  if (passed === total) {
    console.log('🎉 SQLite Engine & Database Studio Architecture 100% Certified!\n');
  } else {
    console.error('❌ Some tests failed. Please review errors above.');
    process.exit(1);
  }
}

runDatabaseEngineTests();
