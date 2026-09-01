/**
 * WorkGuard Comprehensive OTA & Auto-Update Engine Verification Suite
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const updatesManager = require('../server/src/updates_manager');
const db = require('../server/src/db');

async function runUpdatesTestSuite() {
  console.log('🚀 Starting WorkGuard OTA & Auto-Update Test Suite...\n');
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

  // --- 1. Version Comparison Logic ---
  console.log('--- 1. SemVer Version Comparison Engine ---');
  test('Accurately Compare Outdated, Equal, and Newer Versions', () => {
    assert.strictEqual(updatesManager.compareVersions('1.0.0', '1.2.0'), -1, '1.0.0 should be < 1.2.0');
    assert.strictEqual(updatesManager.compareVersions('1.2.0', '1.2.0'), 0, '1.2.0 should be == 1.2.0');
    assert.strictEqual(updatesManager.compareVersions('1.3.0', '1.2.0'), 1, '1.3.0 should be > 1.2.0');
    assert.strictEqual(updatesManager.compareVersions('v1.2.1', '1.2.0'), 1, 'v1.2.1 should be > 1.2.0');
    assert.strictEqual(updatesManager.compareVersions('1.2.0', 'v1.2.5'), -1, '1.2.0 should be < v1.2.5');
    assert.strictEqual(updatesManager.compareVersions('2.0.0', '1.9.9'), 1, '2.0.0 should be > 1.9.9');
  });

  // --- 2. Database Auto-Update Configuration ---
  console.log('\n--- 2. Database Auto-Update on Connect Preference ---');
  test('Get and Set Auto-Update Policy Flag', () => {
    db.setAutoUpdateEnabled(true);
    assert.strictEqual(db.isAutoUpdateEnabled(), true, 'Auto update must be enabled');

    db.setAutoUpdateEnabled(false);
    assert.strictEqual(db.isAutoUpdateEnabled(), false, 'Auto update must be disabled');

    db.setAutoUpdateEnabled(true);
    assert.strictEqual(db.isAutoUpdateEnabled(), true, 'Restored auto update to true');
  });

  // --- 3. Manual ZIP Bundle Ingestion & Checksumming ---
  console.log('\n--- 3. Manual ZIP Upload & Package Ingestion ---');
  test('Save and Checksum Uploaded Package', () => {
    // Generate a valid mock ZIP structure (PK\x03\x04 header + 150 bytes of payload)
    const mockZipHeader = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x0A, 0x00, 0x00, 0x00]);
    const mockPayload = Buffer.concat([mockZipHeader, crypto.randomBytes(200)]);

    const info = updatesManager.saveUploadedBundle(mockPayload, 'client-v1.3.0-test.zip', '1.3.0', 'Test manual upload release');
    assert.strictEqual(info.version, '1.3.0');
    assert(info.sha256 && info.sha256.length === 64, 'SHA-256 hash must be 64-char hex string');
    assert(fs.existsSync(updatesManager.getLatestZipPath()), 'Zip file must exist on disk');
  });

  // --- 4. Remote Cloud URL Release Fetcher ---
  console.log('\n--- 4. Remote Cloud Release URL Ingestion (HTTP/HTTPS) ---');
  await asyncTest('Download, Verify & Ingest Package from Cloud Server', async () => {
    // Create a local mock HTTP server that simulates a Cloud CDN / S3 bucket
    const mockCloudZip = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]), crypto.randomBytes(300)]);
    const mockServer = http.createServer((req, res) => {
      if (req.url === '/releases/client-v1.4.0.zip') {
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': mockCloudZip.length
        });
        res.end(mockCloudZip);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;
    const cloudUrl = `http://127.0.0.1:${port}/releases/client-v1.4.0.zip`;

    try {
      const cloudInfo = await updatesManager.fetchCloudRelease(cloudUrl, '1.4.0', 'Automated Cloud Release v1.4.0');
      assert.strictEqual(cloudInfo.version, '1.4.0');
      assert.strictEqual(cloudInfo.bundle_size, mockCloudZip.length);
      assert.strictEqual(cloudInfo.sha256, crypto.createHash('sha256').update(mockCloudZip).digest('hex'));
      assert.strictEqual(updatesManager.getVersionInfo().version, '1.4.0');
    } finally {
      mockServer.close();
    }
  });

  // --- 5. Reject Invalid / Non-ZIP Cloud Payload ---
  console.log('\n--- 5. Cloud Payload Validation & Non-ZIP Protection ---');
  await asyncTest('Reject Corrupted or Non-ZIP Cloud Responses', async () => {
    const mockServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Error 404: Not Found</h1><p>This is a long HTML error page returned by a web server instead of a valid binary ZIP package archive.</p></body></html>');
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;
    const cloudUrl = `http://127.0.0.1:${port}/broken.zip`;

    try {
      let threw = false;
      try {
        await updatesManager.fetchCloudRelease(cloudUrl, '1.5.0');
      } catch (e) {
        threw = true;
        assert(e.message.includes('not a valid ZIP archive') || e.message.includes('too small'), 'Must reject non-ZIP payload');
      }
      assert.strictEqual(threw, true, 'Corrupted download must throw an error');
    } finally {
      mockServer.close();
    }
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${total} tests passed (${Math.round((passed/total)*100)}%)`);
  console.log(`========================================\n`);

  if (passed === total) {
    console.log('🎉 All OTA Updates & Cloud Ingestion Tests Passed Successfully!');
    process.exit(0);
  } else {
    console.error('❌ Some tests failed!');
    process.exit(1);
  }
}

runUpdatesTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
