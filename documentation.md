# Totem Message Service Documentation

## Overview

The **Totem Message Service** is a centralized messaging service that provides real-time communication capabilities for the Totem ecosystem. Built with Node.js, Express, and Socket.IO, it serves as a WebSocket-based API server that handles messaging, user management, blockchain interactions, and various business operations including Company Data Portal (CDP) functionality.

### Key Features

- **Real-time Messaging**: WebSocket-based communication using Socket.IO
- **User Authentication & Management**: User registration, login, and session management
- **Company Data Portal (CDP)**: Business verification and company data management
- **Rewards System**: Token rewards distribution and KAPEX claim functionality
- **Faucet Integration**: Automated token distribution requests
- **Task Management**: Project and task coordination system
- **Blockchain Integration**: Polkadot network connectivity and transaction handling
- **Notification System**: Real-time notifications and status updates
- **Discord Integration**: Webhook-based logging and notifications
- **Stripe Integration**: Payment processing for CDP services

## Installation

### Prerequisites

- Node.js (v14 or higher)
- Yarn or npm package manager
- CouchDB database server
- SSL certificates (for HTTPS)

### Dependencies Installation

1. Clone the repository:
```bash
git clone https://gitlab.com/totem-tech/totem-message-service.git
cd totem-message-service
```

2. Install dependencies:
```bash
yarn install
# or
npm install
```

3. Install git submodules (required for Polkadot.js types):
```bash
git config --file=.gitmodules submodule.src/utils.url https://gitlab.com/totem-tech/common-utils.git
git config --file=.gitmodules submodule.src/utils.branch dev
git submodule sync
git submodule update --init --recursive --remote
```

### SSL Certificate Setup

For development, you can use self-signed certificates in the `sslcert/` directory. For production, obtain valid SSL certificates and specify their paths in environment variables.

## Configuration

### Required Environment Variables

#### Core Configuration
- `PORT` - Server port (default: 3001)
- `PORT_HTTP` - HTTP server port (default: 4001)
- `CertPath` - Path to SSL certificate file (e.g., `./sslcert/fullchain.pem`)
- `KeyPath` - Path to SSL private key file (e.g., `./sslcert/privkey.pem`)
- `HTTPS_ONLY` - Set to `TRUE` to disable HTTP server

#### Database Configuration
- `CouchDB_URL` - CouchDB connection URL with credentials (e.g., `https://adminId:password@127.0.0.1:5984`)
- `CouchDB_DBName_Prefix` - Optional prefix for all database names
- `CouchDB_DBName_Suffix` - Optional suffix for all database names
- `STORAGE_PATH` - Directory path for file storage
- `STORAGE_FILE_LIMIT` - Maximum file size limit in bytes

#### Authentication & Security
- `keyData` - 96-byte hex string for server encryption keys (without 0x prefix)
- `serverName` - Secret name identifier for the server
- `external_serverName` - Name of the external faucet server
- `external_publicKey` - Base64-encoded 32-byte encryption public key from faucet server
- `printSensitiveData` - Set to `YES` to enable printing of sensitive data (development only)

#### Faucet Integration
- `FAUCET_SERVER_URL` - URL of the faucet server (e.g., `https://hostname:port`)
- `FAUCET_TIMEOUT_MS` - Faucet request timeout in milliseconds (default: 300000)

#### Discord Integration
- `DISCORD_WEBHOOK_URL` - Discord webhook URL for logging
- `DISCORD_WEBHOOK_AVATAR_URL` - Avatar image URL for Discord webhook
- `DISCORD_WEBHOOK_USERNAME` - Username for Discord webhook (default: "Messaging Service Logger")
- `DISCORD_WEBHOOK_URL_SUPPORT` - Discord webhook URL for support messages

#### Client Configuration
- `SOCKET_CLIENTS` - Comma-separated list of allowed client URLs (use `ALL` to allow all origins)

### Optional Environment Variables

#### CDP (Company Data Portal)
- `CDP_KEY_DATA` - Encryption key data for CDP functionality
- `CDP_STRIPE_API_KEY` - Stripe API key for CDP payments
- `CDP_STRIPE_CLIENT_API_KEY` - Stripe client-side API key
- `CDP_DISCORD_USERNAME` - Discord username for CDP notifications
- `CDP_DISCORD_WEBHOOK_URL` - Discord webhook URL for CDP events
- `CDP_DISCORD_AVATAR_URL` - Avatar URL for CDP Discord notifications

#### Rewards System
- `KAPEX_CLAIM_START_DATE` - Start date for KAPEX token claims
- `KAPEX_CLAIM_END_DATE` - End date for KAPEX token claims
- `SignupRewardsDisabled` - Set to `YES` to disable signup rewards
- `ReferralRewardsDisabled` - Set to `YES` to disable referral rewards
- `SocialRewardsDisabled` - Set to `YES` to disable social media rewards
- `ReprocessRewards` - Set to `YES` to reprocess failed rewards on startup
- `RewardsPaymentPaused` - Set to `YES` to pause reward payments

#### Twitter Integration
- `Twitter_Bearer_Token` - Twitter API bearer token for social verification

#### Blockchain Configuration
- `URL_TOTEM_NODE` - Totem blockchain node URL (default: `wss://node.totem.live`)

#### Development & Debugging
- `DEBUG` - Set to `TRUE` to enable verbose debugging
- `BuildMode` - Set to `TRUE` to enable build mode (allows frontend to grab all error messages)
- `EVENT_LOG_DURATION_MS` - Duration for event logging in milliseconds (default: 5000)

## Starting the Service

### Development Mode
```bash
npm run dev
# or
npm start
```

### Production Mode
```bash
npm run prod
```

### Using a Start Script
Create a `start.sh` file in the root directory with your environment variables:

```bash
#!/bin/bash
export PORT=3001
export CertPath="./sslcert/fullchain.pem"
export KeyPath="./sslcert/privkey.pem"
export CouchDB_URL="https://admin:password@127.0.0.1:5984"
export keyData="your-96-byte-hex-key-data"
export serverName="your-server-name"
export external_serverName="faucet-server-name"
export external_publicKey="base64-encoded-public-key"
export FAUCET_SERVER_URL="https://faucet.example.com:3002"
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."

npm run start
```

Make it executable and run:
```bash
chmod +x start.sh
./start.sh
```

## Authentication

The service uses a simple credential-based authentication system:

### User Registration
Users register with a unique `userId`, `secret` (password), and blockchain `address`. Optional referral system is supported.

### User Login
Authentication requires `userId` and `secret`. Successful login returns user roles and blockchain address.

### Session Management
- Sessions are maintained via Socket.IO connections
- Users can have multiple concurrent sessions
- Online status is tracked and broadcasted to other users

## API Endpoints (Socket.IO Events)

All communication with the service happens through Socket.IO WebSocket events. Below are the main event categories and endpoints:

### User Management

| Event | Description | Parameters | Authentication Required |
|-------|-------------|------------|------------------------|
| `login` | User authentication | `userId`, `secret`, `callback` | No |
| `register` | User registration | `userId`, `secret`, `address`, `referredBy?`, `callback` | No |
| `disconnect` | User disconnection | - | No |
| `id-exists` | Check if user ID exists | `userId`, `callback` | No |
| `is-user-online` | Check if user is online | `userId`, `callback` | No |

#### Example: User Login
```javascript
socket.emit('login', 'myUserId', 'mySecret', (error, result) => {
    if (error) {
        console.error('Login failed:', error);
    } else {
        console.log('Login successful:', result);
        // result: { address: '...', roles: [...] }
    }
});
```

### Messaging System

| Event | Description | Parameters | Authentication Required |
|-------|-------------|------------|------------------------|
| `message` | Send a message | `message`, `callback` | Yes |
| `message-get-recent` | Get recent messages | `params`, `callback` | Yes |
| `message-group-name` | Set group chat name | `groupName`, `callback` | Yes |

#### Example: Send Message
```javascript
socket.emit('message', {
    text: 'Hello, world!',
    recipients: ['userId1', 'userId2'],
    type: 'chat'
}, (error, result) => {
    if (error) {
        console.error('Message failed:', error);
    } else {
        console.log('Message sent:', result);
    }
});
```

### Notification System

| Event | Description | Parameters | Authentication Required |
|-------|-------------|------------|------------------------|
| `notification` | Send notification | `notification`, `callback` | Yes |
| `notification-get-recent` | Get recent notifications | `params`, `callback` | Yes |
| `notification-set-status` | Update notification status | `status`, `callback` | Yes |

### Faucet Requests

| Event | Description | Parameters | Authentication Required |
|-------|-------------|------------|------------------------|
| `faucet-request` | Request tokens from faucet | `request`, `callback` | Yes |
| `faucet-status` | Get faucet request status | `requestId`, `callback` | Yes |

#### Example: Faucet Request
```javascript
socket.emit('faucet-request', {
    amount: 1000,
    currency: 'TOTEM',
    address: 'your-wallet-address'
}, (error, result) => {
    if (error) {
        console.error('Faucet request failed:', error);
    } else {
        console.log('Faucet request submitted:', result);
    }
});
```

### Company Data Portal (CDP)

| Event | Description | Parameters | Authentication Required |
|-------|-------------|------------|------------------------|
| `cdp-company-search` | Search for companies | `searchParams`, `callback` | Yes |
| `cdp-draft` | Create/update company draft | `draftData`, `callback` | Yes |
| `cdp-verify` | Verify company data | `verificationData`, `callback` | Yes |
| `cdp-report` | Generate company report | `reportParams`, `callback` | Yes |
| `cdp-set-access-code` | Set company access code | `accessCode`, `callback` | Yes |
| `cdp-validate-access-code` | Validate access code | `accessCode`, `callback` | Yes |
| `cdp-calc-cdp-payment-amount` | Calculate payment amount | `params`, `callback` | Yes |
| `cdp-finalize-payment` | Finalize payment process | `paymentData`, `callback` | Yes |
| `cdp-stripe-create-intent` | Create Stripe payment intent | `paymentParams`, `callback` | Yes |
| `cdp-stripe-check-paid` | Check payment status | `paymentId`, `callback` | Yes |

### Rewards System

| Event | Description | Parameters | Authentication Required |
|-------|-------------|------------|------------------------|
| `rewards-get-data` | Get user rewards data | `callback` | Yes |
| `rewards-claim-kapex` | Claim KAPEX tokens | `claimData`, `callback` | Yes |
| `rewards-get-kapex-payouts` | Get KAPEX payout history | `callback` | Yes |

### Task Management

| Event | Description | Parameters | Authentication Required |
|-------|-------------|------------|------------------------|
| `task` | Create/update task | `taskData`, `callback` | Yes |
| `task-get-by-id` | Get task by ID | `taskId`, `callback` | Yes |
| `task-get-by-parent-id` | Get tasks by parent ID | `parentId`, `callback` | Yes |
| `task-market-search` | Search task marketplace | `searchParams`, `callback` | Yes |
| `task-market-apply` | Apply for task | `applicationData`, `callback` | Yes |
| `task-market-apply-response` | Respond to task application | `responseData`, `callback` | Yes |

### System & Utilities

| Event | Description | Parameters | Authentication Required |
|-------|-------------|------------|------------------------|
| `events-meta` | Get all events metadata | `callback` | No |
| `countries` | Get countries list | `callback` | No |
| `company` | Get company data | `companyId`, `callback` | No |
| `company-search` | Search companies | `searchParams`, `callback` | No |
| `newsletter-signup` | Newsletter subscription | `emailData`, `callback` | No |
| `gl-accounts` | Get GL accounts | `callback` | Yes |

### Currency & Pricing

| Event | Description | Parameters | Authentication Required |
|-------|-------------|------------|------------------------|
| `currency-get-rate` | Get currency exchange rate | `currencyPair`, `callback` | No |
| `currency-get-supported` | Get supported currencies | `callback` | No |

## Error Handling

The service implements comprehensive error handling:

- **Authentication Errors**: Invalid credentials, reserved user IDs
- **Validation Errors**: Invalid parameters, missing required fields
- **Runtime Errors**: Database connection issues, external service failures
- **Maintenance Mode**: Service temporarily unavailable

All errors are returned as the first parameter in callback functions following Node.js conventions.

## Maintenance Mode

Administrators can activate maintenance mode to prevent non-essential operations:

```javascript
// Only available to users with 'admin' role
socket.emit('maintenance-mode', true, (error, result) => {
    console.log('Maintenance mode activated:', result);
});
```

## Security Considerations

1. **SSL/TLS**: All connections must use HTTPS in production
2. **Client Origin Validation**: Configure `SOCKET_CLIENTS` to restrict allowed origins
3. **Rate Limiting**: Built-in request limits for faucet and other sensitive operations
4. **Data Encryption**: Sensitive data is encrypted using NaCl cryptography
5. **Discord Logging**: All significant events are logged to Discord webhooks

## Monitoring & Logging

- **Console Logging**: Comprehensive server-side logging
- **Discord Integration**: Real-time notifications for errors and important events
- **Event Tracking**: All user events are logged with timestamps and client information
- **Online User Tracking**: Real-time tracking of connected users

## Feature Management

### Temporarily Disabling Features

For lean deployments (such as P2P chat-only usage), you can temporarily disable specific features by commenting out their registration in `src/index.js`. This allows easy re-integration later by uncommenting the same lines.

#### Disabling CDP (Company Data Portal)

**Step 1: Comment out CDP imports**
```javascript
// src/index.js (around line 24)
// import cdpEventHandlers, { setup as setupCDP } from './cdp'
```

**Step 2: Comment out CDP event handlers**
```javascript
// src/index.js (around line 134)
const allEventHandlers = {
    // CDP
    // ...cdpEventHandlers,
    
    // ... rest of handlers
}
```

**Step 3: Comment out CDP setup**
```javascript
// src/index.js (around line 489)
// [setupCDP, [expressApp], 'Failed to setup CDP', true],
```

#### Disabling Rewards System

**Step 1: Comment out rewards imports**
```javascript
// src/index.js (around line 44)
// import rewardsHandlers from './rewards'
```

**Step 2: Comment out rewards event handlers**
```javascript
// src/index.js (around line 175)
const allEventHandlers = {
    // rewards related handlers
    // ...rewardsHandlers,
    
    // ... rest of handlers
}
```

#### Disabling Faucet Integration

**Step 1: Comment out faucet imports**
```javascript
// src/index.js (around line 30)
// import { handleFaucetRequest, handleFaucetStatus } from './faucetRequests'
```

**Step 2: Comment out faucet event handlers**
```javascript
// src/index.js (around line 148)
const allEventHandlers = {
    // Faucet request
    // 'faucet-request': handleFaucetRequest,
    // 'faucet-status': handleFaucetStatus,
    
    // ... rest of handlers
}
```

#### Disabling Task Management

**Step 1: Comment out task imports**
```javascript
// src/index.js (around line 47)
// import {
//     handleTask,
//     handleTaskGetById,
//     handleTaskGetByParentId,
//     handleTaskMarketApply,
//     handleTaskMarketApplyResponse,
//     handleTaskMarketSearch,
// } from './task'
```

**Step 2: Comment out task event handlers**
```javascript
// src/index.js (around line 180)
const allEventHandlers = {
    // Task 
    // 'task': handleTask,
    // 'task-get-by-id': handleTaskGetById,
    // 'task-get-by-parent-id': handleTaskGetByParentId,
    // 'task-market-apply': handleTaskMarketApply,
    // 'task-market-apply-response': handleTaskMarketApplyResponse,
    // 'task-market-search': handleTaskMarketSearch,
    
    // ... rest of handlers
}
```

#### Minimal Chat-Only Configuration

For a minimal P2P chat service, keep only these essential features:
- **User Management** (`userEventHandlers`)
- **Messaging** (`handleMessage`, `handleMessageGetRecent`, `handleMessageGroupName`)
- **Notifications** (`handleNotification*`)
- **System** (`systemEventHandlers`)
- **Language** (`languageHandlers`)

Example minimal `allEventHandlers` object:
```javascript
const allEventHandlers = {
    // Language
    ...languageHandlers,

    // Chat/Messages
    'message': handleMessage,
    'message-get-recent': handleMessageGetRecent,
    'message-group-name': handleMessageGroupName,

    // Notification
    'notification': handleNotification,
    'notification-get-recent': handleNotificationGetRecent,
    'notification-set-status': handleNotificationSetStatus,

    // system & status endpoints
    ...systemEventHandlers,

    // User & connection
    ...userEventHandlers,
}
```

### Re-enabling Features

To re-enable any disabled feature:

1. **Uncomment the import statements**
2. **Uncomment the event handler registrations**
3. **Uncomment any setup function calls**
4. **Restart the service**

The modular design ensures that features can be enabled/disabled independently without affecting core functionality.

### Feature Dependencies

Before disabling features, note these dependencies:

- **Rewards System** depends on **Faucet Integration** for token distribution
- **CDP** is standalone and can be safely disabled
- **Task Management** is standalone and can be safely disabled
- **Notifications** are used by other features but can be disabled if not needed

## Development Tools

The service includes several development and administrative tools:

### Available Scripts

- `npm run tools-company` - Import company data
- `npm run tools-encrypt` - Encrypt data files
- `npm run tools-export` - Export database contents
- `npm run tools-script` - Run administrative scripts

### Database Migration

Use the `MigrateFiles` environment variable to migrate JSON file storage to CouchDB:

```bash
export MigrateFiles="file1.json,file2.json"
npm start
```

## Support

For technical support or issues:

- **Email**: support@totemaccounting.com (or support@company-passport.agency for CDP)
- **Discord**: Use the support chat channels
- **Documentation**: Refer to individual handler files for detailed parameter specifications

## Version Information

- **Current Version**: 1.20.0000
- **Node.js**: Requires v14+
- **Socket.IO**: v3.0.4
- **Polkadot.js**: v0.100.1

---

*This documentation is generated from codebase analysis. For the most up-to-date information, refer to the source code and inline documentation.* 