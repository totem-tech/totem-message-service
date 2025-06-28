# Totem Message Service - Database Documentation

## Overview

The Totem Message Service uses **Apache CouchDB** as its primary database system. CouchDB is a NoSQL document database that stores data in JSON format and provides excellent replication and synchronization capabilities. The service can operate with both local and remote CouchDB instances.

### Database Architecture

- **Database Type**: Apache CouchDB (NoSQL Document Database)
- **Connection Library**: `nano` (Official CouchDB Node.js driver)
- **Custom Wrapper**: `CouchDBStorage` class provides abstraction and additional functionality
- **Data Format**: JSON documents with automatic `_id` and `_rev` fields
- **Migration Support**: Built-in migration from JSON file storage to CouchDB

## Connection Management

### Connection Configuration

The service supports multiple connection strategies:

#### Global Connection (Default)
```javascript
// Primary connection URL
CouchDB_URL=https://admin:password@127.0.0.1:5984
```

#### Database-Specific Connections
```javascript
// Override connection for specific databases
CouchDB_URL_users=https://user_admin:pass@db1.example.com:5984
CouchDB_URL_messages=https://msg_admin:pass@db2.example.com:5984
```

#### Database Name Management
```javascript
// Global prefix/suffix for all database names
CouchDB_DBName_Prefix=prod_
CouchDB_DBName_Suffix=_v1

// Specific database name overrides
CouchDB_DBName_Override_currencies_price_history_daily=currencies_price-history-daily
CouchDB_DBName_Override_gl_accounts=gl-accounts
CouchDB_DBName_Override_newsletter_signup=newsletter-signup
CouchDB_DBName_Override_faucet_requests=faucet-requests
```

### Connection Features

- **Connection Pooling**: Reuses existing connections to the same URL
- **Lazy Initialization**: Connections are established on first database access
- **Error Handling**: Graceful handling of connection failures with startup validation
- **Multi-Database Support**: Single service can connect to multiple CouchDB instances

## Database Collections (Databases)

The service uses the following CouchDB databases:

### Core Collections

| Database Name | Purpose | Key Fields | Indexes |
|---------------|---------|------------|---------|
| `users` | User accounts and authentication | `_id`, `address`, `secret`, `roles`, `socialHandles` | `address`, `roles`, `twitterHandle` |
| `messages` | Chat and messaging system | `_id`, `from`, `to`, `text`, `type`, `tsCreated` | None |
| `notifications` | User notifications | `_id`, `from`, `to`, `type`, `message`, `read`, `deleted` | `tsCreated`, `recipients` |
| `faucet_requests` | Token faucet requests | `_id`, `userId`, `amount`, `currency`, `status` | None |
| `tasks` | Task and project management | `_id`, `title`, `description`, `createdBy`, `isMarket`, `tags` | `createdBy`, `isMarket`, `tags`, `title`, `tsCreated`, `parentId` |

### Business & Financial Collections

| Database Name | Purpose | Key Fields | Indexes |
|---------------|---------|------------|---------|
| `companies` | Company information database | `_id`, `name`, `registrationNumber`, `address` | None |
| `currencies` | Supported currencies and rates | `_id`, `symbol`, `name`, `ratioOfExchange`, `decimals` | None |
| `currencies_price_history_daily` | Daily price history | `_id`, `currency`, `price`, `date` | None |
| `gl_accounts` | General Ledger accounts | `_id`, `name`, `code`, `type` | None |
| `countries` | Countries reference data | `_id`, `name`, `code`, `region` | None |

### CDP (Company Data Portal) Collections

| Database Name | Purpose | Key Fields | Indexes |
|---------------|---------|------------|---------|
| `cdp_access_codes` | Company access codes | `_id`, `accessCode`, `companyId`, `registrationNumber` | `cdp`, `registrationNumber` |
| `cdp_drafts` | Company data drafts | `_id`, `companyId`, `data`, `status` | None |
| `cdp_log` | CDP process logging | `_id`, `registrationNumber`, `stepName`, `type`, `tsCreated` | `create`, `registrationNumber`, `stepIndex`, `stepName`, `tsCreated`, `type` |
| `cdp_reports` | Generated company reports | `_id`, `companyId`, `reportData`, `tsCreated` | None |
| `cdp_stripe_intents` | Stripe payment intents | `_id`, `paymentIntentId`, `metadata` | `companyId`, `registrationNumber` |

### Rewards & Incentives Collections

| Database Name | Purpose | Key Fields | Indexes |
|---------------|---------|------------|---------|
| `rewards` | User rewards tracking | `_id`, `userId`, `type`, `amount`, `status` | None |
| `kapex-payouts` | KAPEX token payouts | `_id`, `userId`, `amount`, `tsCreated` | None |
| `crowdloan` | Crowdloan participation | `_id`, `userId`, `amount`, `contribution` | None |

### System Collections

| Database Name | Purpose | Key Fields | Indexes |
|---------------|---------|------------|---------|
| `translations` | Multi-language text storage | `_id`, `language`, `texts` | None |
| `newsletter_signup` | Newsletter subscriptions | `_id`, `email`, `tsCreated` | None |
| `projects` | Project information | `_id`, `name`, `description`, `status` | None |

## Document Schemas

### Users Collection Schema
```json
{
  "_id": "user123",
  "_rev": "1-abc123...",
  "id": "user123",
  "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  "secret": "hashed_password",
  "roles": ["user"],
  "socialHandles": {
    "twitter": {
      "handle": "username",
      "verified": true
    }
  },
  "referredBy": "user456",
  "tsCreated": "2023-01-01T00:00:00.000Z",
  "tsUpdated": "2023-01-01T00:00:00.000Z",
  "settings": {
    "onlineStatus": "online"
  }
}
```

### Messages Collection Schema
```json
{
  "_id": "msg_uuid",
  "_rev": "1-def456...",
  "from": "user123",
  "to": ["user456", "user789"],
  "text": "Hello, world!",
  "type": "chat",
  "tsCreated": "2023-01-01T00:00:00.000Z",
  "groupName": "Project Team",
  "data": {}
}
```

### Notifications Collection Schema
```json
{
  "_id": "notif_uuid",
  "_rev": "1-ghi789...",
  "from": "system",
  "to": ["user123"],
  "type": "reward",
  "childType": "kapex_claim",
  "message": "Your KAPEX tokens have been processed",
  "data": {
    "amount": 100,
    "transactionId": "tx_123"
  },
  "read": [],
  "deleted": [],
  "tsCreated": "2023-01-01T00:00:00.000Z"
}
```

### Tasks Collection Schema
```json
{
  "_id": "task_uuid",
  "_rev": "1-jkl012...",
  "title": "Design new logo",
  "description": "Create a modern logo for the project",
  "createdBy": "user123",
  "assignedTo": ["user456"],
  "status": "open",
  "isMarket": true,
  "tags": ["design", "logo", "graphics"],
  "budget": 500,
  "currency": "USD",
  "deadline": "2023-12-31T23:59:59.000Z",
  "parentId": null,
  "tsCreated": "2023-01-01T00:00:00.000Z"
}
```

## Indexes and Performance Optimization

### Automatic Index Creation

The service automatically creates indexes on startup to optimize query performance:

#### Users Collection Indexes
```javascript
// Address-based queries (blockchain integration)
{ index: { fields: ['address'] }, name: 'address-index' }

// Role-based queries (permissions)
{ index: { fields: ['roles'] }, name: 'roles-index' }
```

#### CDP Collections Indexes
```javascript
// CDP Access Codes
{ index: { fields: ['cdp'] }, name: 'cdp-index' }
{ index: { fields: ['registrationNumber'] }, name: 'registrationNumber-index' }

// CDP Logging
{ index: { fields: ['create'] }, name: 'create-index' }
{ index: { fields: ['registrationNumber'] }, name: 'registrationNumber-index' }
{ index: { fields: ['stepIndex'] }, name: 'stepIndex-index' }
{ index: { fields: ['stepName'] }, name: 'stepName-index' }
{ index: { fields: ['tsCreated'] }, name: 'tsCreated-index' }
{ index: { fields: ['type'] }, name: 'type-index' }

// Stripe Integration
{ index: { fields: ['metadata.companyId'] }, name: 'companyId-index' }
{ index: { fields: ['metadata.registrationNumber'] }, name: 'registrationNumber-index' }
```

#### Tasks Collection Indexes
```javascript
{ index: { fields: ['isMarket', 'createdBy'] }, name: 'createdBy-index' }
{ index: { fields: ['isMarket', 'description'] }, name: 'isMarket-index' }
{ index: { fields: ['isMarket', 'tags'] }, name: 'tags-index' }
{ index: { fields: ['isMarket', 'title'] }, name: 'title-index' }
{ index: { fields: ['isMarket', 'tsCreated'] }, name: 'tsCreated-index' }
{ index: { fields: ['parentId'] }, name: 'parentId-index' }
```

### Design Documents and Views

#### Users Collection Views
```javascript
// Case-insensitive Twitter handle search
Design Document: _design/lowercase
View: twitterHandle
Map Function: function (doc) {
  if(!(doc.socialHandles || {}).twitter) return
  emit(doc.socialHandles.twitter.handle.toLowerCase(), null)
}
```

#### Tasks Collection Views
```javascript
// Market task search functionality
Design Document: _design/search
View: search-market
Map Function: Extracts searchable keywords from title, description, and tags
Reduce Function: Groups document IDs by keyword
```

#### Notifications Collection Views
```javascript
// Recent notifications for users
Design Document: _design/get-recent
View: not-deleted
Purpose: Retrieve user notifications sorted by timestamp
```

## CouchDBStorage Wrapper

### Key Features

The custom `CouchDBStorage` class provides:

1. **Connection Management**: Automatic connection handling and pooling
2. **Middleware Support**: Data transformation on save/retrieve operations
3. **Field Filtering**: Retrieve only specified document fields
4. **Automatic Sorting**: Sort document properties alphabetically
5. **Bulk Operations**: Efficient batch insert/update operations
6. **Index Management**: Automatic index creation and management
7. **View Creation**: Design document and view management

### Common Operations

#### Document Retrieval
```javascript
// Get single document
const user = await dbUsers.get('user123')

// Get multiple documents
const users = await dbUsers.getAll(['user123', 'user456'])

// Search with criteria
const onlineUsers = await dbUsers.search({
  'settings.onlineStatus': 'online'
})
```

#### Document Storage
```javascript
// Save single document
await dbUsers.set('user123', userData)

// Bulk save
await dbUsers.setAll([user1, user2, user3])
```

#### Querying
```javascript
// Find first matching document
const user = await dbUsers.find({ address: '5GrwvaEF...' })

// Search with pagination
const results = await dbUsers.search(
  { roles: { $in: ['admin', 'support'] } },
  25,  // limit
  0,   // skip
  true // return as Map
)
```

## Data Migration

### JSON to CouchDB Migration

The service supports migrating data from JSON file storage to CouchDB:

#### Configuration
```bash
# Specify files to migrate
export MigrateFiles="users.json,messages.json,currencies.json"
npm start
```

#### Migration Process
1. **File Reading**: Load data from JSON files
2. **Data Transformation**: Convert arrays to objects where needed
3. **Type Conversion**: Parse strings to integers for numeric fields
4. **Batch Processing**: Insert data in batches of 999 documents
5. **Cleanup**: Remove successfully migrated entries from JSON files
6. **Post-Processing**: Update caches and regenerate indexes

#### Special Handling
```javascript
// Array wrapping for specific collections
const arrKeys = {
  'faucet-requests': 'requests',
  'translations': 'texts',
}

// Database-specific transformations
switch (dbName) {
  case 'currencies':
    // Convert string fields to integers
    ['ratioOfExchange', 'decimals', 'sequence'].forEach(key =>
      value[key] = parseInt(value[key])
    )
    break
}
```

## Query Patterns and Best Practices

### Efficient Querying

#### Use Indexes
```javascript
// Good: Uses address index
const user = await dbUsers.find({ address: walletAddress })

// Bad: Full table scan
const user = await dbUsers.find({ 'socialHandles.twitter.handle': twitterHandle })
```

#### Pagination
```javascript
// Retrieve large datasets with pagination
const limit = 25
const skip = pageNumber * limit
const results = await collection.search(selector, limit, skip)
```

#### Field Selection
```javascript
// Only retrieve needed fields
const users = await dbUsers.getAll(userIds, false, 25, 0, {
  fields: ['_id', 'address', 'roles']
})
```

### Common Query Examples

#### User Management
```javascript
// Find support users
const supportUsers = await dbUsers.search({
  roles: { $all: ['support'] }
})

// Check if user exists
const exists = await dbUsers.find({ _id: userId })
```

#### Messaging
```javascript
// Get recent messages for user
const messages = await chatMessages.search({
  $or: [
    { from: userId },
    { to: { $in: [userId] } }
  ],
  tsCreated: { $gte: lastTimestamp }
})
```

#### Task Marketplace
```javascript
// Search market tasks
const tasks = await tasks.search({
  isMarket: true,
  status: 'open',
  tags: { $in: searchTags }
})
```

## Middleware and Data Processing

### Document Middleware

Each collection can have middleware functions that process documents during save/retrieve operations:

#### CDP Access Codes Middleware
```javascript
const accessCodesMiddleware = (docs = [], save) => {
  if (save) return
  // Remove sensitive data when retrieving
  docs.forEach(doc => delete doc.encrypted)
  return docs
}
```

#### Automatic Features
- **Property Sorting**: Documents are sorted alphabetically by property names
- **Timestamp Management**: Automatic `tsCreated` and `tsUpdated` fields
- **Data Sanitization**: Remove sensitive fields during retrieval
- **Validation**: Input validation before saving

## Database Maintenance

### Regular Maintenance Tasks

1. **Index Optimization**: Regularly monitor and optimize index usage
2. **View Updates**: Keep design documents and views updated
3. **Compaction**: Regular database compaction to reclaim disk space
4. **Replication**: Set up replication for backup and disaster recovery
5. **Monitoring**: Monitor database performance and connection health

### Backup and Recovery

#### Backup Strategy
- **Continuous Replication**: Real-time backup to secondary CouchDB instance
- **Periodic Snapshots**: Regular full database backups
- **Export Tools**: Use built-in export functionality for data migration

#### Recovery Procedures
- **Point-in-Time Recovery**: Restore from specific backup timestamp
- **Selective Recovery**: Restore individual databases or documents
- **Cross-Platform Migration**: Export/import between different CouchDB instances

## Security Considerations

### Authentication and Authorization
- **Admin Credentials**: Use strong credentials for CouchDB admin access
- **Database Permissions**: Implement per-database access controls
- **SSL/TLS**: Use encrypted connections for remote databases
- **Network Security**: Restrict database access to authorized servers only

### Data Protection
- **Field-Level Security**: Middleware removes sensitive data during retrieval
- **Audit Logging**: CDP operations are logged for compliance
- **Data Encryption**: Application-level encryption for sensitive fields
- **Access Control**: Role-based access to database operations

## Troubleshooting

### Common Issues

#### Connection Problems
```javascript
// Check connection status
const connection = await getConnection()
console.log('CouchDB connection status:', connection.info)
```

#### Index Issues
```javascript
// Verify index creation
const db = await collection.getDB()
const indexes = await db.listIndexes()
console.log('Available indexes:', indexes)
```

#### Performance Issues
- Monitor index usage with CouchDB's `_stats` endpoint
- Use `explain()` to analyze query execution plans
- Check for missing indexes on frequently queried fields
- Optimize document size and structure

### Debugging Tips

1. **Enable Debug Logging**: Set `DEBUG=TRUE` to see detailed database operations
2. **Check Index Usage**: Use CouchDB's built-in monitoring tools
3. **Monitor Connection Pool**: Watch for connection leaks or timeouts
4. **Validate Document Structure**: Ensure documents conform to expected schemas
5. **Test Middleware**: Verify middleware functions don't corrupt data

---

*This database documentation covers the complete CouchDB integration in the Totem Message Service. For specific implementation details, refer to the source code in `src/utils/CouchDBStorage.js` and individual collection files.* 