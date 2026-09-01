const crypto = require('crypto');

/**
 * WorkGuard Core Security & Cryptography Engine
 * Provides defense-in-depth primitives using native Node.js crypto:
 * - PBKDF2 Password Hashing (100k rounds, SHA-512)
 * - Cryptographic Signed Session Tokens
 * - Timing-Safe Pre-Shared Key (PSK) Verification
 * - AES-256-GCM File Cryptography for Storage at Rest
 * - HMAC-SHA256 Beacon Signatures
 * - In-Memory Sliding-Window Rate Limiting
 * - Input & Path Traversal Sanitization
 */

class SecurityEngine {
  constructor() {
    // Default fallback salt / secret if not configured in database
    this.systemSecret = crypto.randomBytes(32).toString('hex');
  }

  // --- 1. Password Hashing (PBKDF2 SHA-512) ---
  hashPassword(password, existingSalt = null) {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string');
    }
    const salt = existingSalt || crypto.randomBytes(32).toString('hex');
    const iterations = 100000;
    const keylen = 64;
    const digest = 'sha512';
    
    const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
    return { hash, salt };
  }

  verifyPassword(password, expectedHash, salt) {
    if (!password || !expectedHash || !salt) return false;
    try {
      const { hash } = this.hashPassword(password, salt);
      const hashBuf = Buffer.from(hash, 'hex');
      const expectedBuf = Buffer.from(expectedHash, 'hex');
      if (hashBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(hashBuf, expectedBuf);
    } catch (e) {
      return false;
    }
  }

  // --- 2. Cryptographic Signed Session Tokens ---
  generateSessionToken(payload, secret = this.systemSecret, expiresInSeconds = 86400) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const body = { ...payload, exp, iat: Math.floor(Date.now() / 1000) };

    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Body = Buffer.from(JSON.stringify(body)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${b64Header}.${b64Body}`)
      .digest('base64url');

    return `${b64Header}.${b64Body}.${signature}`;
  }

  verifySessionToken(token, secret = this.systemSecret) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [b64Header, b64Body, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${b64Header}.${b64Body}`)
      .digest('base64url');

    try {
      const sigBuf = Buffer.from(signature, 'base64url');
      const expSigBuf = Buffer.from(expectedSig, 'base64url');
      if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
        return null;
      }

      const body = JSON.parse(Buffer.from(b64Body, 'base64url').toString('utf8'));
      if (body.exp && Math.floor(Date.now() / 1000) > body.exp) {
        return null; // Expired
      }
      return body;
    } catch (e) {
      return null;
    }
  }

  // --- 3. Timing-Safe Pre-Shared Key (Agent Auth) ---
  verifyAgentKey(providedKey, expectedKey) {
    if (!providedKey || !expectedKey) return false;
    try {
      const pHash = crypto.createHash('sha256').update(String(providedKey)).digest();
      const eHash = crypto.createHash('sha256').update(String(expectedKey)).digest();
      return crypto.timingSafeEqual(pHash, eHash);
    } catch (e) {
      return false;
    }
  }

  // --- 4. AES-256-GCM Screenshot Cryptography (At-Rest Storage) ---
  deriveKey(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest();
  }

  encryptBuffer(buffer, secret) {
    if (!buffer || buffer.length === 0) return buffer;
    const key = this.deriveKey(secret);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: Magic Header (4 bytes 'WGEN') + IV (16 bytes) + Tag (16 bytes) + Encrypted Data
    const magic = Buffer.from('WGEN', 'utf8');
    return Buffer.concat([magic, iv, tag, encrypted]);
  }

  decryptBuffer(buffer, secret) {
    if (!buffer || buffer.length < 36) return buffer; // Not encrypted or too short
    
    const magic = buffer.subarray(0, 4).toString('utf8');
    if (magic !== 'WGEN') {
      // Not encrypted with WorkGuard AES-GCM; return as-is (e.g. legacy plain JPEG)
      return buffer;
    }

    try {
      const key = this.deriveKey(secret);
      const iv = buffer.subarray(4, 20);
      const tag = buffer.subarray(20, 36);
      const encrypted = buffer.subarray(36);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch (err) {
      console.error('[SecurityEngine] Decryption failed:', err.message);
      return buffer; // Fallback
    }
  }

  isBufferEncrypted(buffer) {
    if (!buffer || buffer.length < 4) return false;
    return buffer.subarray(0, 4).toString('utf8') === 'WGEN';
  }

  // --- 5. HMAC-SHA256 UDP Beacon Signer ---
  signBeaconPayload(payloadObj, secret) {
    const serialized = JSON.stringify(payloadObj);
    return crypto.createHmac('sha256', secret).update(serialized).digest('hex');
  }

  verifyBeaconPayload(payloadObj, signature, secret) {
    if (!payloadObj || !signature || !secret) return false;
    try {
      const expected = this.signBeaconPayload(payloadObj, secret);
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch (e) {
      return false;
    }
  }

  // --- 6. Sliding-Window Rate Limiter ---
  createRateLimiter(options = {}) {
    const windowMs = options.windowMs || 60000; // 1 minute
    const maxRequests = options.maxRequests || 100;
    const hits = new Map(); // ip/key -> [{ timestamp }]

    return (req, res, next) => {
      const key = req.ip || req.connection.remoteAddress || 'unknown';
      const now = Date.now();

      let timestamps = hits.get(key) || [];
      // Filter out timestamps outside window
      timestamps = timestamps.filter(ts => now - ts < windowMs);

      if (timestamps.length >= maxRequests) {
        return res.status(429).json({
          success: false,
          error: 'Too many requests. Please slow down.',
          retryAfterMs: windowMs - (now - timestamps[0])
        });
      }

      timestamps.push(now);
      hits.set(key, timestamps);

      // Periodic cleanup if map grows
      if (hits.size > 5000) {
        for (const [k, v] of hits.entries()) {
          const valid = v.filter(ts => now - ts < windowMs);
          if (valid.length === 0) hits.delete(k);
          else hits.set(k, valid);
        }
      }

      next();
    };
  }

  // --- 7. Input & Path Sanitization ---
  sanitizeFilename(name) {
    if (!name || typeof name !== 'string') return 'unknown';
    // Strip path traversal characters, drive letters, and invalid filename characters
    return name
      .replace(/^(\.\.[\/\\])+/g, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .trim() || 'unnamed';
  }

  sanitizeProcessName(name) {
    if (!name || typeof name !== 'string') return '';
    // Allow only alphanumeric, dash, underscore, and .exe
    return name.replace(/[^a-zA-Z0-9_\-\.]/g, '').trim();
  }

  sanitizeText(str, maxLength = 250) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/[<>]/g, '')
      .trim()
      .substring(0, maxLength);
  }

  // --- 8. Tamper-Evident Hashed Audit Log Chain ---
  computeLogHash(logEntry, prevHash = '0000000000000000000000000000000000000000000000000000000000000000') {
    const str = `${prevHash}|${logEntry.timestamp}|${logEntry.client_id}|${logEntry.event_type}|${logEntry.details}`;
    return crypto.createHash('sha256').update(str).digest('hex');
  }
}

module.exports = new SecurityEngine();
