/**
 * WorkGuard Comprehensive Security Layer Verification Suite
 */
const assert = require('assert');
const securityAuth = require('../server/src/security_auth');
const db = require('../server/src/db');

async function runSecurityTests() {
  console.log('🛡️ Starting WorkGuard Comprehensive Security Tests...\n');
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

  // --- 1. PBKDF2 Password Hashing ---
  console.log('--- 1. PBKDF2 Password Hashing & Timing-Safe Verification ---');
  test('PBKDF2 Hash and Verify Valid Password', () => {
    const password = 'SuperSecretAdminPassword2026!';
    const { hash, salt } = securityAuth.hashPassword(password);
    assert(typeof hash === 'string' && hash.length === 128, 'SHA-512 hex hash must be 128 chars');
    assert(typeof salt === 'string' && salt.length === 64, 'Salt must be 64 hex chars');
    
    const isValid = securityAuth.verifyPassword(password, hash, salt);
    assert.strictEqual(isValid, true, 'Valid password must verify true');

    const isInvalid = securityAuth.verifyPassword('WrongPassword123!', hash, salt);
    assert.strictEqual(isInvalid, false, 'Invalid password must verify false');
  });

  // --- 2. HMAC Signed Session Tokens ---
  console.log('\n--- 2. Cryptographic Session Token Verification ---');
  test('Generate and Verify Valid Session Token', () => {
    const secret = 'test-session-secret-key-1234567890123456';
    const token = securityAuth.generateSessionToken({ role: 'admin', user: 'admin' }, secret, 60);
    assert(token && token.includes('.'), 'Token must be dot-delimited');

    const payload = securityAuth.verifySessionToken(token, secret);
    assert(payload, 'Payload must be decoded');
    assert.strictEqual(payload.role, 'admin');
    assert.strictEqual(payload.user, 'admin');
  });

  test('Reject Tampered Session Token', () => {
    const secret = 'test-session-secret-key-1234567890123456';
    const token = securityAuth.generateSessionToken({ role: 'admin' }, secret, 60);
    const tampered = token.slice(0, -4) + 'abcd';
    const payload = securityAuth.verifySessionToken(tampered, secret);
    assert.strictEqual(payload, null, 'Tampered token must return null');
  });

  // --- 3. Timing-Safe PSK Verification ---
  console.log('\n--- 3. Timing-Safe Pre-Shared Key (PSK) Agent Verification ---');
  test('Verify Correct and Incorrect PSK Tokens', () => {
    const serverKey = 'wg-secret-corp-handshake-key-2026';
    assert.strictEqual(securityAuth.verifyAgentKey(serverKey, serverKey), true, 'Identical keys must match');
    assert.strictEqual(securityAuth.verifyAgentKey('wrong-key', serverKey), false, 'Wrong key must be rejected');
    assert.strictEqual(securityAuth.verifyAgentKey('', serverKey), false, 'Empty key must be rejected');
  });

  // --- 4. AES-256-GCM Cryptographic Storage ---
  console.log('\n--- 4. AES-256-GCM Storage Encryption & On-The-Fly Decryption ---');
  test('Encrypt and Decrypt Screenshot Buffer with Magic Header', () => {
    const originalText = 'SAMPLE_JPEG_BINARY_DATA_' + Date.now();
    const originalBuffer = Buffer.from(originalText, 'utf8');
    const encKey = 'my-super-secret-aes-storage-key-2026';

    const encrypted = securityAuth.encryptBuffer(originalBuffer, encKey);
    assert(encrypted.slice(0, 4).toString('utf8') === 'WGEN', 'Encrypted buffer must have WGEN magic bytes');
    assert.notStrictEqual(encrypted.toString('utf8'), originalText, 'Encrypted buffer must not match plaintext');

    const decrypted = securityAuth.decryptBuffer(encrypted, encKey);
    assert.strictEqual(decrypted.toString('utf8'), originalText, 'Decrypted buffer must match original plaintext');
  });

  test('Seamless Fallback for Unencrypted Legacy Files', () => {
    const plainBuffer = Buffer.from('LEGACY_RAW_IMAGE_DATA', 'utf8');
    const result = securityAuth.decryptBuffer(plainBuffer, 'any-key');
    assert.strictEqual(result.toString('utf8'), 'LEGACY_RAW_IMAGE_DATA', 'Plain files without WGEN magic header pass through intact');
  });

  // --- 5. UDP Discovery Beacon HMAC Signer ---
  console.log('\n--- 5. Discovery Beacon HMAC Signing & Verification ---');
  test('Sign Beacon and Verify Integrity', () => {
    const secretKey = 'workguard-shared-psk-key';
    const payload = {
      type: 'WORKGUARD_BEACON',
      server_name: 'WorkGuard Secure LAN Server',
      ip: '192.168.1.100',
      port: 3000,
      timestamp: Date.now()
    };

    const signature = securityAuth.signBeaconPayload(payload, secretKey);
    assert(typeof signature === 'string' && signature.length === 64, 'Signature must be 64-char SHA256 hex string');

    const isValid = securityAuth.verifyBeaconPayload(payload, signature, secretKey);
    assert.strictEqual(isValid, true, 'Valid beacon signature must verify true');

    // Tamper test
    const tamperedPayload = { ...payload, port: 9999 };
    const isTamperedValid = securityAuth.verifyBeaconPayload(tamperedPayload, signature, secretKey);
    assert.strictEqual(isTamperedValid, false, 'Tampered beacon payload must be rejected');
  });

  // --- 6. Input Sanitization & Anti-Traversal ---
  console.log('\n--- 6. Input Sanitization & Anti-Path-Traversal ---');
  test('Sanitize Malicious Client ID and Filename', () => {
    const maliciousClient = '../../etc/passwd';
    const safeClient = securityAuth.sanitizeFilename(maliciousClient);
    assert(!safeClient.includes('..'), 'Path traversal dots must be stripped');
    assert(!safeClient.includes('/'), 'Path traversal slashes must be stripped');

    const maliciousProcess = 'cmd.exe & calc.exe | echo 1';
    const safeProcess = securityAuth.sanitizeProcessName(maliciousProcess);
    assert(!safeProcess.includes('&'), 'Command injection & must be stripped');
    assert(!safeProcess.includes('|'), 'Command injection | must be stripped');
  });

  // --- 7. Tamper-Evident Hashed Audit Chain ---
  console.log('\n--- 7. Cryptographic Hashed Audit Log Chain ---');
  test('Compute Log Hash and Chain Verification', () => {
    const prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    const log1 = { timestamp: Date.now(), client_id: 'client-1', event_type: 'POLICY_VIOLATION', details: 'Opened gambling site' };
    const hash1 = securityAuth.computeLogHash(log1, prevHash);
    assert(typeof hash1 === 'string' && hash1.length === 64, 'Audit hash must be 64-char SHA256');

    const log2 = { timestamp: Date.now() + 100, client_id: 'client-1', event_type: 'APP_BLOCKED', details: 'Blocked poker.exe' };
    const hash2 = securityAuth.computeLogHash(log2, hash1);
    assert.notStrictEqual(hash1, hash2, 'Next block hash must differ and chain from previous hash');
  });

  // --- 8. Database Security Config Persistence ---
  console.log('\n--- 8. Database Security Configuration Schema & Storage ---');
  test('Security Config Schema and Settings Retrieval', () => {
    const secConfig = db.getSecurityConfig();
    assert(typeof secConfig.is_password_set === 'boolean', 'is_password_set must be boolean');
    assert(typeof secConfig.agent_secret_key === 'string', 'agent_secret_key must be string');
    assert(typeof secConfig.encryption_enabled === 'boolean', 'encryption_enabled must be boolean');
    assert(typeof secConfig.session_timeout_minutes === 'number', 'session_timeout_minutes must be number');

    const agentKey = db.getAgentSecretKey();
    assert(agentKey && agentKey.length > 0, 'Agent secret key must exist');

    const sessionSecret = db.getSessionSecret();
    assert(sessionSecret && sessionSecret.length >= 32, 'Session secret must be at least 32 characters');
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${total} tests passed (${Math.round((passed/total)*100)}%)`);
  console.log(`========================================\n`);

  if (passed === total) {
    console.log('🎉 All Security & Cryptography Layers Verified Successfully!');
    process.exit(0);
  } else {
    console.error('❌ Some tests failed!');
    process.exit(1);
  }
}

runSecurityTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
