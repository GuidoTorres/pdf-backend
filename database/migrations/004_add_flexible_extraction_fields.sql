-- Migration: Add flexible data extraction fields to documents table
-- This migration adds fields to support flexible data extraction with original structure preservation

-- Add fields for flexible data extraction
ALTER TABLE documents 
ADD COLUMN original_structure JSON COMMENT 'Original document structure metadata',
ADD COLUMN column_mappings JSON COMMENT 'Dynamic column mappings for this document',
ADD COLUMN extract_type VARCHAR(50) COMMENT 'Classified extract type (bank_statement, credit_card, etc.)',
ADD COLUMN bank_type VARCHAR(30) COMMENT 'Detected bank type',
ADD COLUMN format_version VARCHAR(20) COMMENT 'Document format version',
ADD COLUMN preservation_metadata JSON COMMENT 'Metadata about data preservation and transformations';

-- Add indexes for better query performance
CREATE INDEX idx_documents_extract_type ON documents(extract_type);
CREATE INDEX idx_documents_bank_type ON documents(bank_type);
CREATE INDEX idx_documents_format_version ON documents(format_version);

-- Add comment to table
ALTER TABLE documents COMMENT = 'Documents table with flexible data extraction support';