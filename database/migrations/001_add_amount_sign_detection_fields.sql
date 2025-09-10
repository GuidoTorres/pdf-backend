-- =====================================================
-- Amount Sign Detection Migration
-- Add fields to support original credit/debit/amount values
-- and sign detection method tracking
-- =====================================================

USE stamentai;

-- Add new columns to documents table for amount sign detection
ALTER TABLE documents ADD COLUMN original_credit DECIMAL(10,2) NULL COMMENT 'Original credit amount from PDF';
ALTER TABLE documents ADD COLUMN original_debit DECIMAL(10,2) NULL COMMENT 'Original debit amount from PDF';
ALTER TABLE documents ADD COLUMN original_amount DECIMAL(10,2) NULL COMMENT 'Original amount value from PDF';
ALTER TABLE documents ADD COLUMN sign_detection_method VARCHAR(20) NULL COMMENT 'Method used for sign detection: columns, heuristics, hybrid';

-- Add index for sign detection method for performance
ALTER TABLE documents ADD INDEX idx_documents_sign_detection_method (sign_detection_method);

-- Verify the changes
DESCRIBE documents;

-- Show confirmation message
SELECT 
    'Amount sign detection fields added successfully!' as status,
    DATABASE() as current_database,
    NOW() as migration_timestamp;

COMMIT;