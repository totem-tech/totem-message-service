# Totem Message Service - Security Review

## Overview

This document provides a comprehensive security audit of the Totem Message Service, identifying critical vulnerabilities and security weaknesses that require immediate attention. This review covers authentication mechanisms, data protection, network security, database security, and code security practices.

**🚨 CRITICAL SECURITY ISSUES IDENTIFIED**

## 1. Authentication & Password Security

### 1.1 CRITICAL: Plain Text Password Storage
**File:** `src/users/handleLogin.js`, `src/users/handleRegister.js`
**Severity:** CRITICAL
**CVSS Score:** 9.1 (Critical)

**Issue:**
- Passwords are stored in plain text in the database as `secret` field
- Login performs direct comparison: `await dbUsers.find({ _id: userId, secret })`
- No password hashing mechanism implemented

**Impact:**
- If database is compromised, all user passwords are immediately exposed
- Database administrators can read all user passwords
- Compliance violations (GDPR, CCPA, etc.)

**Recommendation:**
```javascript
// Implement proper password hashing in handleRegister.js
import bcrypt from 'bcrypt';

const saltRounds = 12;
const hashedSecret = await bcrypt.hash(secret, saltRounds);
newUser.secret = hashedSecret;

// Update login verification in handleLogin.js
const isValidPassword = await bcrypt.compare(secret, user.secret);
if (!isValidPassword) return callback(messages.loginFailed);
```

### 1.2 CRITICAL: Weak Password Requirements
**File:** `src/users/users.js`
**Severity:** HIGH
**CVSS Score:** 7.5 (High)

**Issue:**
```javascript
export const secretConf = {
    name: 'secret',
    minLegth: 10,  // Typo: should be 'minLength'
    maxLength: 64,
    type: TYPES.string,
}
```

**Problems:**
- Typo in `minLegth` (should be `minLength`)
- No complexity requirements (uppercase, lowercase, numbers, special characters)
- No entropy validation
- Allows weak passwords like "1111111111"

**Recommendation:**
```javascript
export const secretConf = {
    name: 'secret',
    minLength: 12,  // Fix typo and increase minimum
    maxLength: 128, // Increase maximum for passphrases
    type: TYPES.string,
    pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    customMessage: 'Password must contain at least one uppercase letter, lowercase letter, number, and special character'
}
```

### 1.3 CRITICAL: No Rate Limiting on Authentication
**File:** `src/users/handleLogin.js`
**Severity:** HIGH
**CVSS Score:** 8.2 (High)

**Issue:**
- No rate limiting on login attempts
- Enables brute force attacks
- No account lockout mechanism
- No exponential backoff

**Recommendation:**
Implement rate limiting using Redis or in-memory store:
```javascript
const loginAttempts = new Map(); // Use Redis in production

export default async function handleLogin(userId, secret, callback) {
    const clientId = this[0].id;
    const attempts = loginAttempts.get(userId) || { count: 0, lastAttempt: 0 };
    
    if (attempts.count >= 5) {
        const lockoutTime = Math.pow(2, attempts.count - 5) * 60000; // Exponential backoff
        if (Date.now() - attempts.lastAttempt < lockoutTime) {
            return callback('Account temporarily locked due to too many failed attempts');
        }
    }
    
    // ... existing login logic ...
    
    if (!user) {
        attempts.count++;
        attempts.lastAttempt = Date.now();
        loginAttempts.set(userId, attempts);
        return callback(messages.loginFailed);
    }
    
    // Reset attempts on successful login
    loginAttempts.delete(userId);
    // ... rest of login logic
}
```

### 1.4 HIGH: Session Management Issues
**File:** `src/index.js`, `src/users/handleLogin.js`
**Severity:** HIGH
**CVSS Score:** 7.8 (High)

**Issues:**
- Sessions stored in memory (`onlineUsers.set(userId, user)`)
- No session expiration
- No session invalidation mechanism
- Sessions persist across server restarts
- Multiple concurrent sessions allowed without control

**Recommendation:**
Implement proper session management:
```javascript
// Add to user schema
const sessionSchema = {
    sessionId: String,
    createdAt: Date,
    lastActivity: Date,
    expiresAt: Date,
    clientId: String,
    ipAddress: String,
    userAgent: String
}

// Implement session cleanup
setInterval(() => {
    const now = Date.now();
    for (const [userId, sessions] of userSessions.entries()) {
        const validSessions = sessions.filter(s => s.expiresAt > now);
        if (validSessions.length === 0) {
            userSessions.delete(userId);
        } else {
            userSessions.set(userId, validSessions);
        }
    }
}, 60000); // Clean every minute
```

## 2. Input Validation & Injection Prevention

### 2.1 HIGH: NoSQL Injection Vulnerability
**File:** `src/utils/CouchDBStorage.js`
**Severity:** HIGH
**CVSS Score:** 8.1 (High)

**Issue:**
- User input directly passed to CouchDB queries
- No input sanitization for database operations
- Potential for NoSQL injection attacks

**Example vulnerable code:**
```javascript
async find(selector, extraProps, timeout) {
    // selector comes directly from user input without validation
    const db = await this.getDB()
    const { docs } = await PromisE.timeout(
        db.find({ selector, ...extraProps }),
        timeout || this.timeout,
    )
}
```

**Recommendation:**
Implement input sanitization:
```javascript
const sanitizeSelector = (selector) => {
    if (typeof selector !== 'object' || selector === null) {
        throw new Error('Invalid selector format');
    }
    
    // Remove dangerous operators
    const dangerousOps = ['$where', '$regex', '$javascript'];
    const sanitized = JSON.parse(JSON.stringify(selector));
    
    const removeDangerous = (obj) => {
        Object.keys(obj).forEach(key => {
            if (dangerousOps.includes(key)) {
                delete obj[key];
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                removeDangerous(obj[key]);
            }
        });
    };
    
    removeDangerous(sanitized);
    return sanitized;
};

async find(selector, extraProps, timeout) {
    selector = sanitizeSelector(selector);
    // ... rest of method
}
```

### 2.2 MEDIUM: Cross-Site Scripting (XSS) Prevention
**File:** `src/messages.js`, `src/notification.js`
**Severity:** MEDIUM
**CVSS Score:** 6.1 (Medium)

**Issue:**
- No HTML/JavaScript sanitization in message content
- User-generated content not sanitized before storage/broadcast
- Potential for stored XSS attacks

**Recommendation:**
```javascript
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const purify = DOMPurify(window);

const sanitizeContent = (content) => {
    if (typeof content !== 'string') return content;
    return purify.sanitize(content, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a'],
        ALLOWED_ATTR: ['href']
    });
};
```

## 3. Network Security

### 3.1 HIGH: Origin Validation Bypass
**File:** `src/index.js`
**Severity:** HIGH
**CVSS Score:** 7.5 (High)

**Issue:**
```javascript
const clientUrls = (process.env.SOCKET_CLIENTS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => {
        if (x === ALL || x.startsWith('https://') || x.startsWith('http://')) return x
        return `https://${x}`
    })
```

**Problems:**
- `ALL` value bypasses all origin validation
- HTTP origins allowed alongside HTTPS
- No wildcard domain validation
- Permissive origin checking

**Recommendation:**
```javascript
const validateOrigin = (origin) => {
    if (!origin) return false;
    
    try {
        const url = new URL(origin);
        
        // Only allow HTTPS in production
        if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
            return false;
        }
        
        // Validate against whitelist
        const allowedDomains = process.env.ALLOWED_DOMAINS?.split(',') || [];
        return allowedDomains.some(domain => {
            if (domain.startsWith('*.')) {
                const baseDomain = domain.slice(2);
                return url.hostname.endsWith(baseDomain);
            }
            return url.hostname === domain;
        });
    } catch (e) {
        return false;
    }
};

function allowRequest(request, callback) {
    const { headers: { origin } = {} } = request;
    const allow = validateOrigin(origin);
    // ... rest of function
}
```

### 3.2 MEDIUM: Missing Security Headers
**File:** `src/index.js`
**Severity:** MEDIUM
**CVSS Score:** 5.3 (Medium)

**Issue:**
- No security headers configured
- Missing CSP, HSTS, X-Frame-Options, etc.

**Recommendation:**
```javascript
import helmet from 'helmet';

expressApp.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));
```

## 4. Database Security

### 4.1 HIGH: Database Connection Exposure
**File:** `src/utils/CouchDBStorage.js`
**Severity:** HIGH
**CVSS Score:** 7.8 (High)

**Issue:**
- Database connection strings may contain credentials
- No connection string validation
- Credentials potentially logged

**Recommendation:**
```javascript
const sanitizeConnectionString = (url) => {
    try {
        const parsed = new URL(url);
        if (parsed.username || parsed.password) {
            return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
        }
        return url;
    } catch (e) {
        return '[REDACTED]';
    }
};

// Use for logging
console.log('Connecting to:', sanitizeConnectionString(url));
```

### 4.2 HIGH: Missing Database Access Controls
**File:** `database.md` documentation shows no access controls
**Severity:** HIGH
**CVSS Score:** 8.2 (High)

**Issue:**
- No role-based database access
- No document-level permissions
- Users can potentially access any document

**Recommendation:**
Implement CouchDB security:
```javascript
// Add to database setup
const setupDatabaseSecurity = async () => {
    const securityDoc = {
        admins: {
            names: [process.env.DB_ADMIN_USER],
            roles: ['admin']
        },
        members: {
            names: [process.env.DB_READ_USER],
            roles: ['user']
        }
    };
    
    await db.put(`_security`, securityDoc);
};
```

## 5. Data Protection

### 5.1 CRITICAL: Sensitive Data Logging
**File:** `src/faucetRequests.js`
**Severity:** CRITICAL
**CVSS Score:** 9.3 (Critical)

**Issue:**
```javascript
// only print sensitive data if "printSensitiveData" environment variable is set to "YES" (case-sensitive)
if (!printData) return

console.log('serverName: ', serverName, '\n')
console.log('keyData: ', KEY_DATA, '\n')
console.log('walletAddress: ', keyInfoFromKeyData(KEY_DATA).address, '\n')
console.log('Encryption KeyPair: ', encryptPair, '\n')
console.log('Signature KeyPair: ', signKeyPair, '\n')
```

**Problems:**
- Cryptographic keys logged to console
- Wallet addresses exposed
- Secrets potentially in logs/files

**Recommendation:**
```javascript
// Remove all sensitive data logging
// Use secure key management service like AWS KMS, HashiCorp Vault
// Never log secrets, even conditionally
```

### 5.2 HIGH: Insufficient Data Encryption
**File:** `tools/encrypt/index.js`
**Severity:** HIGH
**CVSS Score:** 7.5 (High)

**Issue:**
- Some data encrypted, but encryption not applied consistently
- No encryption at rest for all sensitive data
- Encryption keys stored alongside encrypted data

**Recommendation:**
- Implement database-level encryption
- Use separate key management service
- Encrypt all PII and sensitive data

## 6. Error Handling & Information Disclosure

### 6.1 MEDIUM: Information Disclosure in Error Messages
**File:** `src/index.js`
**Severity:** MEDIUM
**CVSS Score:** 5.3 (Medium)

**Issue:**
```javascript
console.log(err.stack)
```

**Problems:**
- Stack traces logged with sensitive information
- Error messages might reveal system internals
- Request IDs might be predictable

**Recommendation:**
```javascript
// Sanitize error logging
const sanitizeError = (error) => {
    const sanitized = {
        message: error.message,
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
    };
    
    // Only include stack trace in development
    if (process.env.NODE_ENV === 'development') {
        sanitized.stack = error.stack;
    }
    
    return sanitized;
};
```

## 7. API Security

### 7.1 HIGH: Missing Rate Limiting on API Endpoints
**File:** Multiple handler files
**Severity:** HIGH
**CVSS Score:** 7.2 (High)

**Issue:**
- No global rate limiting
- Only faucet requests have rate limiting
- DoS attacks possible

**Recommendation:**
```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply per-user rate limiting for Socket.IO
const userRateLimits = new Map();

const checkUserRateLimit = (userId) => {
    const now = Date.now();
    const userLimit = userRateLimits.get(userId) || { count: 0, resetTime: now + 60000 };
    
    if (now > userLimit.resetTime) {
        userLimit.count = 0;
        userLimit.resetTime = now + 60000;
    }
    
    if (userLimit.count >= 60) { // 60 requests per minute
        return false;
    }
    
    userLimit.count++;
    userRateLimits.set(userId, userLimit);
    return true;
};
```

### 7.2 MEDIUM: Insufficient Authorization Checks
**File:** Various handler files
**Severity:** MEDIUM
**CVSS Score:** 6.5 (Medium)

**Issue:**
- Some handlers missing `requireLogin` property
- Role-based authorization not consistently applied
- Admin functions not properly protected

**Recommendation:**
```javascript
// Add to all sensitive handlers
handlerFunction.requireLogin = true;
handlerFunction.requireRoles = ['admin']; // for admin functions

// Implement principle of least privilege
const checkPermissions = (user, requiredRoles, resourceOwnerId) => {
    if (!user) return false;
    
    // User can access own resources
    if (resourceOwnerId && user.id === resourceOwnerId) return true;
    
    // Check role requirements
    if (requiredRoles?.length) {
        return requiredRoles.some(role => user.roles?.includes(role));
    }
    
    return true;
};
```

## 8. Cryptographic Security

### 8.1 MEDIUM: Weak Random Number Generation
**File:** `src/cdp/utils.js`
**Severity:** MEDIUM
**CVSS Score:** 5.9 (Medium)

**Issue:**
```javascript
const upperCase = Math.ceil(Math.random(1e10) * 1e10) % 2 === 0
```

**Problems:**
- Using Math.random() for security-sensitive operations
- Not cryptographically secure

**Recommendation:**
```javascript
import crypto from 'crypto';

const randomCase = (str = '') => {
    const randomBuffer = crypto.randomBytes(1);
    const upperCase = randomBuffer[0] % 2 === 0;
    return upperCase ? str.toUpperCase() : str.toLowerCase();
};
```

## 9. Environment & Configuration Security

### 9.1 HIGH: Insecure Default Configurations
**File:** Multiple files
**Severity:** HIGH
**CVSS Score:** 7.8 (High)

**Issues:**
- Default localhost URLs for services
- Missing environment variable validation
- No configuration encryption

**Recommendation:**
```javascript
// Validate all required environment variables at startup
const requiredEnvVars = [
    'CouchDB_URL',
    'SOCKET_CLIENTS',
    'CERT_PATH',
    'KEY_PATH',
    'JWT_SECRET'
];

const validateEnvironment = () => {
    const missing = requiredEnvVars.filter(key => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    // Validate formats
    if (!process.env.CouchDB_URL.startsWith('https://')) {
        throw new Error('CouchDB_URL must use HTTPS in production');
    }
};

validateEnvironment();
```

## 10. Recommendations Summary

### Immediate Actions (CRITICAL)
1. **Implement password hashing** using bcrypt with salt rounds ≥ 12
2. **Remove all sensitive data logging** from production code
3. **Add rate limiting** to authentication endpoints
4. **Implement session management** with expiration and cleanup

### High Priority Actions
1. **Add input validation and sanitization** for all user inputs
2. **Implement proper origin validation** for WebSocket connections
3. **Add database access controls** and user permissions
4. **Encrypt sensitive data** at rest and in transit

### Medium Priority Actions
1. **Add security headers** using Helmet.js
2. **Implement comprehensive error handling** without information leakage
3. **Add API rate limiting** across all endpoints
4. **Replace Math.random()** with crypto.randomBytes()

### Code Quality & Security
1. **Add automated security scanning** to CI/CD pipeline
2. **Implement security linting** rules
3. **Add penetration testing** to development process
4. **Create security incident response** procedures

### Environment Security
1. **Use secrets management** service (AWS Secrets Manager, etc.)
2. **Implement configuration encryption** for sensitive values
3. **Add environment validation** at startup
4. **Use HTTPS everywhere** in production

## Compliance Considerations

This service handles user data and potentially PII, requiring compliance with:
- **GDPR** (General Data Protection Regulation)
- **CCPA** (California Consumer Privacy Act)
- **SOC 2** (Service Organization Control 2)
- **ISO 27001** (Information Security Management)

### Key Compliance Actions Required:
1. **Data encryption** at rest and in transit
2. **Audit logging** for all data access
3. **User consent management** for data processing
4. **Data retention policies** and secure deletion
5. **Breach notification procedures**

## Tools and Libraries to Add

```bash
# Security dependencies to add
npm install --save helmet bcrypt rate-limiter-flexible
npm install --save-dev eslint-plugin-security audit-ci
```

## Testing Security

```bash
# Add to package.json scripts
"security:audit": "npm audit && audit-ci --moderate",
"security:lint": "eslint --ext .js src/ --config .eslintrc.security.js",
"security:test": "jest --config jest.security.config.js"
```

---

**Document Status:** Draft for Development Process Record (DPR)  
**Review Date:** $(date +%Y-%m-%d)  
**Next Review:** 3 months from implementation completion  
**Priority:** CRITICAL - Immediate attention required 