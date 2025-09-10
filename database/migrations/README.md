# Database Migrations

This directory contains database migration scripts for the StamentAI application.

## Amount Sign Detection Migration

### Overview

The amount sign detection feature requires additional database fields to store original credit/debit/amount values from PDFs and track the sign detection method used.

### Migration Files

- `001_add_amount_sign_detection_fields.sql` - Adds new columns to the documents table
- `../migrate-amount-sign-detection.js` - Node.js script to run the migration
- `../run-migration.js` - Generic migration runner utility

### New Fields Added

| Field                   | Type          | Description                                                  |
| ----------------------- | ------------- | ------------------------------------------------------------ |
| `original_credit`       | DECIMAL(10,2) | Original credit amount extracted from PDF                    |
| `original_debit`        | DECIMAL(10,2) | Original debit amount extracted from PDF                     |
| `original_amount`       | DECIMAL(10,2) | Original amount value from PDF                               |
| `sign_detection_method` | VARCHAR(20)   | Method used for sign detection (columns, heuristics, hybrid) |

### Running the Migration

#### Option 1: Using the dedicated migration script

```bash
cd backend/database
node migrate-amount-sign-detection.js
```

#### Option 2: Using the generic migration runner

```bash
cd backend/database
node run-migration.js 001_add_amount_sign_detection_fields.sql
```

#### Option 3: Manual SQL execution

```bash
mysql -u stamentai_user -p stamentai < migrations/001_add_amount_sign_detection_fields.sql
```

### Environment Variables

Make sure these environment variables are set:

- `DB_HOST` - Database host (default: localhost)
- `DB_USER` - Database user (default: stamentai_user)
- `DB_PASSWORD` - Database password (default: StamentAI2024!)
- `DB_NAME` - Database name (default: stamentai)

### Verification

After running the migration, you can verify the changes:

```sql
USE stamentai;
DESCRIBE documents;
```

You should see the new fields in the documents table structure.

### Rollback

If you need to rollback this migration:

```sql
USE stamentai;
ALTER TABLE documents
DROP COLUMN IF EXISTS original_credit,
DROP COLUMN IF EXISTS original_debit,
DROP COLUMN IF EXISTS original_amount,
DROP COLUMN IF EXISTS sign_detection_method,
DROP INDEX IF EXISTS idx_documents_sign_detection_method;
```

### Model Updates

The Document model (`backend/src/models/Document.js`) has been updated to include:

1. New field definitions with proper validation
2. Index for `sign_detection_method` field
3. Helper methods:
   - `updateAmountSignData(amountSignData)` - Update amount sign detection fields
   - `getAmountSignData()` - Get current amount sign detection data

### Usage in Code

```javascript
// Update amount sign data
await document.updateAmountSignData({
  original_credit: 1500.0,
  original_debit: null,
  original_amount: 1500.0,
  sign_detection_method: "columns",
});

// Get amount sign data
const amountSignData = document.getAmountSignData();
console.log(amountSignData);
// {
//   original_credit: 1500.00,
//   original_debit: null,
//   original_amount: 1500.00,
//   sign_detection_method: 'columns'
// }
```
