# Amount Sign Detection Schema Changes

## Overview

This document summarizes all database schema and model changes made to support the amount sign detection feature.

## Database Schema Changes

### New Columns Added to `documents` Table

| Column Name             | Type          | Constraints | Description                                                  |
| ----------------------- | ------------- | ----------- | ------------------------------------------------------------ |
| `original_credit`       | DECIMAL(10,2) | NULL        | Original credit amount extracted from PDF                    |
| `original_debit`        | DECIMAL(10,2) | NULL        | Original debit amount extracted from PDF                     |
| `original_amount`       | DECIMAL(10,2) | NULL        | Original amount value from PDF                               |
| `sign_detection_method` | VARCHAR(20)   | NULL        | Method used for sign detection (columns, heuristics, hybrid) |

### New Index Added

- `idx_documents_sign_detection_method` on `sign_detection_method` column for performance optimization

## Model Changes

### Document Model (`backend/src/models/Document.js`)

#### New Field Definitions

```javascript
original_credit: {
  type: DataTypes.DECIMAL(10, 2),
  allowNull: true,
  comment: 'Original credit amount from PDF',
},
original_debit: {
  type: DataTypes.DECIMAL(10, 2),
  allowNull: true,
  comment: 'Original debit amount from PDF',
},
original_amount: {
  type: DataTypes.DECIMAL(10, 2),
  allowNull: true,
  comment: 'Original amount value from PDF',
},
sign_detection_method: {
  type: DataTypes.STRING(20),
  allowNull: true,
  comment: 'Method used for sign detection: columns, heuristics, hybrid',
  validate: {
    isIn: [['columns', 'heuristics', 'hybrid']],
  },
},
```

#### New Helper Methods

1. **`updateAmountSignData(amountSignData)`**

   - Updates amount sign detection fields
   - Parameters: Object with optional fields (original_credit, original_debit, original_amount, sign_detection_method)
   - Returns: Promise resolving to updated document instance

2. **`getAmountSignData()`**
   - Retrieves current amount sign detection data
   - Returns: Object with all amount sign detection fields

## Migration Files

### Created Files

1. **`backend/database/migrations/001_add_amount_sign_detection_fields.sql`**

   - SQL migration script to add new columns and index

2. **`backend/database/run-migration.js`**

   - Generic migration runner utility

3. **`backend/database/migrate-amount-sign-detection.js`**

   - Specific migration script for amount sign detection feature

4. **`backend/database/migrations/README.md`**
   - Documentation for migration process

### Updated Files

1. **`backend/database/setup.sql`**
   - Updated to include new fields for fresh installations

## Usage Examples

### Updating Amount Sign Data

```javascript
// Update document with amount sign detection data
await document.updateAmountSignData({
  original_credit: 1500.0,
  original_debit: null,
  original_amount: 1500.0,
  sign_detection_method: "columns",
});
```

### Retrieving Amount Sign Data

```javascript
// Get current amount sign detection data
const amountSignData = document.getAmountSignData();
console.log(amountSignData);
// Output:
// {
//   original_credit: 1500.00,
//   original_debit: null,
//   original_amount: 1500.00,
//   sign_detection_method: 'columns'
// }
```

### Querying by Sign Detection Method

```javascript
// Find documents using specific sign detection method
const documentsWithColumns = await Document.findAll({
  where: {
    sign_detection_method: "columns",
  },
});
```

## Testing

### Test File

- **`backend/test_document_model_amount_sign.js`**
  - Comprehensive test suite for new fields and methods
  - Validates model definition, field validation, and helper methods
  - All tests pass successfully

### Test Results

```
✅ Test 1: Model definition - All required fields defined
✅ Test 2: Field validation - sign_detection_method validation works
✅ Test 3: Helper methods - Both methods exist
✅ Test 4: Helper method functionality - Methods work correctly
```

## Migration Instructions

### For Existing Databases

```bash
# Option 1: Use dedicated migration script
node backend/database/migrate-amount-sign-detection.js

# Option 2: Use generic migration runner
node backend/database/run-migration.js 001_add_amount_sign_detection_fields.sql
```

### For New Installations

The updated `setup.sql` file includes all new fields, so no additional migration is needed.

## Rollback Instructions

If rollback is needed:

```sql
USE stamentai;
ALTER TABLE documents
DROP COLUMN IF EXISTS original_credit,
DROP COLUMN IF EXISTS original_debit,
DROP COLUMN IF EXISTS original_amount,
DROP COLUMN IF EXISTS sign_detection_method,
DROP INDEX IF EXISTS idx_documents_sign_detection_method;
```

## Requirements Satisfied

This implementation satisfies **Requirement 4.2** from the specification:

> "WHEN se almacena una transacción en la base de datos THEN SHALL incluir los campos credit_amount y debit_amount"

The database now supports storing original credit/debit amounts and tracking the sign detection method used, enabling proper debugging and validation of the amount sign detection feature.
