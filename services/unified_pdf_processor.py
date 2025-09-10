#!/usr/bin/env python3
"""
Unified PDF Processor

This module consolidates all PDF processing logic into a single, unified processor
that integrates ResourceManager, TransactionExtractorService, and ValidationService
with comprehensive error handling and consistent logging.

This replaces the fragmented logic across docling_processor.py and docling_worker.py
with a clean, maintainable architecture.
"""

import os
import sys
import json
import time
import logging
import tempfile
from typing import List, Dict, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from pathlib import Path
import uuid

# PDF processing libraries
import camelot
import pandas as pd
import fitz  # PyMuPDF
import pytesseract
from PIL import Image
import io

# Internal services
from resource_manager import ResourceManager, MemoryStats
from transaction_extractor_service import TransactionExtractorService, ExtractionResult, ExtractionMethod
from transaction_validation_service import TransactionValidationService
from ai_enhanced_processor import AIEnhancedProcessor, enhance_extraction_result


@dataclass
class ProcessingResult:
    """Unified result structure for PDF processing"""
    success: bool
    transactions: List[Dict]
    metadata: Dict[str, Any]
    processing_time: float
    error_message: Optional[str] = None
    provider: str = "unified_pdf_processor"
    originalTransactions: Optional[List[Dict]] = None
    originalTable: Optional[Dict] = None  # New field for GROQ extracted original table
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        result = {
            'success': self.success,
            'transactions': self.transactions,
            'meta': self.metadata,  # Keep 'meta' for backward compatibility
            'processing_time': self.processing_time,
            'error_message': self.error_message,
            'provider': self.provider
        }
        
        # Include originalTransactions if available
        if self.originalTransactions is not None:
            result['originalTransactions'] = self.originalTransactions
            
        # Include originalTable if available  
        if self.originalTable is not None:
            result['originalTable'] = self.originalTable
            
        return result


@dataclass
class ProcessingMetadata:
    """Metadata about the processing operation"""
    processing_time: float
    total_transactions: int
    tables_found: int
    is_scanned: bool
    extraction_method: str
    file_size: int = 0
    page_count: int = 0
    memory_usage: Optional[MemoryStats] = None
    bank_type: Optional[str] = None
    quality_stats: Optional[Dict[str, float]] = None


class ProcessingError(Exception):
    """Custom exception for processing errors"""
    
    def __init__(self, message: str, error_code: str = "PROCESSING_ERROR", details: Dict[str, Any] = None):
        super().__init__(message)
        self.error_code = error_code
        self.details = details or {}
        self.timestamp = time.time()


class UnifiedPdfProcessor:
    """
    Unified PDF processor that consolidates all processing logic.
    
    This class serves as the single entry point for PDF processing,
    coordinating between resource management, extraction, and validation services.
    """
    
    def __init__(self, config_path: Optional[str] = None, debug: bool = False, temp_dir: Optional[str] = None):
        """
        Initialize the Unified PDF Processor.
        
        Args:
            config_path: Path to configuration file
            debug: Enable debug logging
            temp_dir: Custom temporary directory for file operations
        """
        self.debug = debug
        self.config_path = config_path or self._get_default_config_path()
        
        # Set up logging first
        self.logger = self._setup_logger()
        
        # Load config after logger is set up
        self.config = self._load_config()
        
        # Initialize services
        self.resource_manager = ResourceManager(temp_dir=temp_dir, debug=debug)
        self.extractor_service = TransactionExtractorService(config_path, debug)
        self.validation_service = TransactionValidationService(config_path, debug)
        
        # Processing statistics
        self.stats = {
            'documents_processed': 0,
            'total_processing_time': 0.0,
            'total_transactions_extracted': 0,
            'errors_encountered': 0
        }
        
        self.logger.info("UnifiedPdfProcessor initialized successfully")
    
    def _get_default_config_path(self) -> str:
        """Get default configuration file path"""
        return os.path.join(os.path.dirname(__file__), 'parser_config.json')
    
    def _load_config(self) -> Dict:
        """Load configuration from file"""
        try:
            if os.path.exists(self.config_path):
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    if self.debug:
                        self.logger.debug(f"Loaded config from {self.config_path}")
                    return config
            else:
                self.logger.warning(f"Config file not found: {self.config_path}, using defaults")
                return self._get_default_config()
        except Exception as e:
            self.logger.error(f"Failed to load config: {e}")
            return self._get_default_config()
    
    def _get_default_config(self) -> Dict:
        """Get default configuration"""
        return {
            "ocr_languages": "eng+spa",
            "table_extraction": {
                "flavors": ["lattice", "stream"],
                "stream_row_tolerance": 10
            },
            "processing": {
                "max_table_rows_for_ai": 50,
                "text_min_length_for_ocr": 100
            }
        }
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.UnifiedPdfProcessor")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def process_document(self, pdf_path: str) -> ProcessingResult:
        """
        Process a PDF document from file path.
        
        Args:
            pdf_path: Path to the PDF file
            
        Returns:
            ProcessingResult with extracted transactions and metadata
        """
        if not os.path.exists(pdf_path):
            error_msg = f"PDF file not found: {pdf_path}"
            self.logger.error(error_msg)
            return self._create_error_result(error_msg, "FILE_NOT_FOUND")
        
        try:
            self.logger.info(f"Processing document: {pdf_path}")
            self._send_progress("Initializing document processing...")
            
            return self._process_pdf_internal(pdf_path)
            
        except Exception as e:
            self.stats['errors_encountered'] += 1
            error_msg = f"Failed to process document {pdf_path}: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return self._create_error_result(error_msg, "PROCESSING_ERROR", {"file_path": pdf_path})
    
    def process_from_buffer(self, pdf_buffer: bytes, filename: str = "document.pdf") -> ProcessingResult:
        """
        Process a PDF document from memory buffer.
        
        Args:
            pdf_buffer: PDF content as bytes
            filename: Original filename for reference
            
        Returns:
            ProcessingResult with extracted transactions and metadata
        """
        if not pdf_buffer:
            error_msg = "PDF buffer is empty"
            self.logger.error(error_msg)
            return self._create_error_result(error_msg, "INVALID_INPUT")
        
        try:
            self.logger.info(f"Processing document from buffer: {filename} ({len(pdf_buffer)} bytes)")
            self._send_progress("Creating temporary file from buffer...")
            
            # Create temporary file from buffer
            with self.resource_manager.temp_file_context(pdf_buffer, '.pdf', 'unified_proc_') as temp_path:
                return self._process_pdf_internal(temp_path, original_filename=filename)
                
        except Exception as e:
            self.stats['errors_encountered'] += 1
            error_msg = f"Failed to process document from buffer: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return self._create_error_result(error_msg, "PROCESSING_ERROR", {"filename": filename})
    
    def _process_pdf_internal(self, pdf_path: str, original_filename: Optional[str] = None) -> ProcessingResult:
        """
        Internal PDF processing logic.
        
        Args:
            pdf_path: Path to PDF file (may be temporary)
            original_filename: Original filename if processing from buffer
            
        Returns:
            ProcessingResult with processing results
        """
        start_time = time.time()
        memory_start = self.resource_manager.get_memory_usage()
        
        # Extract file size and page count at the beginning
        file_size = 0
        page_count = 0
        
        try:
            # Get file size
            file_size = os.path.getsize(pdf_path)
            self.logger.debug(f"File size: {file_size} bytes ({file_size / (1024*1024):.2f} MB)")
            
            # Get page count using PyMuPDF
            doc = fitz.open(pdf_path)
            page_count = len(doc)
            doc.close()
            self.logger.debug(f"Page count: {page_count}")
            
        except Exception as e:
            self.logger.warning(f"Failed to extract file metadata: {e}")
            # Continue processing even if we can't get metadata
        
        try:
            # Step 1: Extract tables using Camelot
            self._send_progress("Analyzing PDF structure with table extraction...")
            tables, table_extraction_time = self._extract_tables(pdf_path)
            
            extraction_result = None
            is_scanned = False
            
            if tables:
                # Step 2: Process tables with AI
                self._send_progress(f"Found {len(tables)} tables. Extracting transactions with AI...")
                self.logger.info(f"Processing {len(tables)} tables with AI extraction")
                
                extraction_result = self.extractor_service.extract_from_tables(tables)
                
            else:
                # Step 3: Fallback to text extraction
                self._send_progress("No tables found. Extracting raw text...")
                self.logger.info("No tables found, falling back to text extraction")
                
                text_content, is_scanned = self._extract_text(pdf_path)
                extraction_result = self.extractor_service.extract_from_text(text_content)
            
            # Step 4: Finalize results
            self._send_progress("Finalizing results...")
            
            processing_time = time.time() - start_time
            memory_end = self.resource_manager.get_memory_usage()
            
            # Update statistics
            self.stats['documents_processed'] += 1
            self.stats['total_processing_time'] += processing_time
            self.stats['total_transactions_extracted'] += len(extraction_result.transactions)
            
            # Create metadata
            metadata = ProcessingMetadata(
                processing_time=processing_time,
                total_transactions=len(extraction_result.transactions),
                tables_found=len(tables) if tables else 0,
                is_scanned=is_scanned,
                extraction_method=extraction_result.method.value,
                file_size=file_size,
                page_count=page_count,
                memory_usage=memory_end,
                quality_stats=self._calculate_quality_stats(extraction_result.transactions)
            )
            
            result = ProcessingResult(
                success=extraction_result.success,
                transactions=extraction_result.transactions,
                metadata=asdict(metadata),
                processing_time=processing_time,
                error_message=extraction_result.error_message,
                originalTransactions=extraction_result.original_data,
                originalTable=extraction_result.original_table
            )
            
            self.logger.info(
                f"Processing completed successfully: {len(extraction_result.transactions)} transactions "
                f"in {processing_time:.2f}s using {extraction_result.method.value}"
            )
            
            return result
            
        except Exception as e:
            processing_time = time.time() - start_time
            self.stats['errors_encountered'] += 1
            
            error_msg = f"Internal processing error: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            return ProcessingResult(
                success=False,
                transactions=[],
                metadata={
                    "processing_time": processing_time,
                    "error": error_msg,
                    "file_path": pdf_path,
                    "original_filename": original_filename,
                    "file_size": file_size,
                    "page_count": page_count
                },
                processing_time=processing_time,
                error_message=error_msg
            )
    
    def _extract_tables(self, pdf_path: str) -> Tuple[List[pd.DataFrame], float]:
        """
        Extract tables from PDF using Camelot.
        
        Args:
            pdf_path: Path to PDF file
            
        Returns:
            Tuple of (list of DataFrames, extraction time)
        """
        start_time = time.time()
        tables = []
        
        try:
            # Try lattice method first
            self.logger.debug("Attempting Camelot 'lattice' extraction")
            try:
                camelot_tables = camelot.read_pdf(pdf_path, flavor='lattice', pages='all')
                tables = [table.df for table in camelot_tables]
                self.logger.debug(f"Camelot 'lattice' found {len(tables)} tables")
            except Exception as e:
                self.logger.debug(f"Camelot 'lattice' failed: {e}")
                tables = []
            
            # Try stream method if lattice failed
            if not tables:
                self._send_progress("Lattice failed, trying 'stream' method...")
                self.logger.debug("Attempting Camelot 'stream' extraction")
                try:
                    row_tol = self.config.get("table_extraction", {}).get("stream_row_tolerance", 10)
                    camelot_tables = camelot.read_pdf(pdf_path, flavor='stream', pages='all', row_tol=row_tol)
                    tables = [table.df for table in camelot_tables]
                    self.logger.debug(f"Camelot 'stream' found {len(tables)} tables")
                except Exception as e:
                    self.logger.debug(f"Camelot 'stream' failed: {e}")
                    tables = []
            
        except Exception as e:
            self.logger.warning(f"Table extraction failed: {e}")
            tables = []
        
        extraction_time = time.time() - start_time
        return tables, extraction_time
    
    def _extract_text(self, pdf_path: str) -> Tuple[str, bool]:
        """
        Extract text from PDF, with OCR fallback for scanned documents.
        
        Args:
            pdf_path: Path to PDF file
            
        Returns:
            Tuple of (extracted text, is_scanned)
        """
        try:
            # First, try direct text extraction
            doc = fitz.open(pdf_path)
            raw_text = ""
            for page in doc:
                raw_text += page.get_text()
            doc.close()
            
            self.logger.debug(f"Direct text extraction: {len(raw_text)} characters")
            
            # Check if we got meaningful text
            min_text_length = self.config.get("processing", {}).get("text_min_length_for_ocr", 100)
            if len(raw_text.strip()) >= min_text_length:
                return raw_text, False
            
            # Fallback to OCR for scanned documents
            self.logger.info("PDF appears to be scanned, applying OCR")
            ocr_text = self._extract_text_with_ocr(pdf_path)
            return ocr_text, True
            
        except Exception as e:
            self.logger.error(f"Text extraction failed: {e}")
            return "", False
    
    def _extract_text_with_ocr(self, pdf_path: str) -> str:
        """
        Extract text using OCR for scanned documents with optimizations.
        
        Args:
            pdf_path: Path to PDF file
            
        Returns:
            OCR-extracted text
        """
        self._send_progress("PDF is scanned. Performing optimized OCR...")
        text = ""
        
        try:
            doc = fitz.open(pdf_path)
            ocr_lang = self.config.get("ocr_languages", "eng+spa")
            
            # Optimized Tesseract configuration for speed
            custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,/-+$€£¥₹ '
            
            for page_num in range(len(doc)):
                self._send_progress(f"OCR on page {page_num + 1}/{len(doc)}...")
                
                page = doc.load_page(page_num)
                
                # Optimize image resolution for speed vs accuracy balance
                # Use lower DPI for faster processing
                mat = fitz.Matrix(1.5, 1.5)  # Reduced from default 2.0 for speed
                pix = page.get_pixmap(matrix=mat)
                img_bytes = pix.tobytes("png")
                img = Image.open(io.BytesIO(img_bytes))
                
                # Convert to grayscale for faster processing
                if img.mode != 'L':
                    img = img.convert('L')
                
                # Apply basic image preprocessing for better OCR
                # Resize if image is too large (for speed)
                max_dimension = 2000
                if max(img.size) > max_dimension:
                    ratio = max_dimension / max(img.size)
                    new_size = tuple(int(dim * ratio) for dim in img.size)
                    img = img.resize(new_size, Image.Resampling.LANCZOS)
                
                # Use optimized Tesseract config
                page_text = pytesseract.image_to_string(
                    img, 
                    lang=ocr_lang,
                    config=custom_config
                )
                text += page_text + "\n"
                
            doc.close()
            
            self.logger.debug(f"OCR extraction completed: {len(text)} characters")
            
        except Exception as e:
            self.logger.error(f"OCR extraction failed: {e}")
            text = ""
        
        return text
    
    def _calculate_quality_stats(self, transactions: List[Dict]) -> Dict[str, float]:
        """Calculate quality statistics for extracted transactions"""
        if not transactions:
            return {"average_quality": 0.0, "high_quality_count": 0, "low_quality_count": 0}
        
        quality_scores = [t.get('quality_score', 0.0) for t in transactions]
        
        return {
            "average_quality": sum(quality_scores) / len(quality_scores),
            "high_quality_count": sum(1 for score in quality_scores if score >= 0.8),
            "low_quality_count": sum(1 for score in quality_scores if score < 0.5),
            "min_quality": min(quality_scores),
            "max_quality": max(quality_scores)
        }
    
    def _send_progress(self, step: str):
        """Send progress update to stdout (matching existing pattern)"""
        progress_msg = {"status": "progress", "step": step}
        print(json.dumps(progress_msg))
        sys.stdout.flush()
        
        if self.debug:
            self.logger.debug(f"Progress: {step}")
    
    def _create_error_result(self, error_message: str, error_code: str = "PROCESSING_ERROR", 
                           details: Dict[str, Any] = None) -> ProcessingResult:
        """Create a standardized error result"""
        return ProcessingResult(
            success=False,
            transactions=[],
            metadata={
                "error_code": error_code,
                "error_details": details or {},
                "processing_time": 0.0,
                "total_transactions": 0,
                "tables_found": 0,
                "is_scanned": False,
                "extraction_method": "none"
            },
            processing_time=0.0,
            error_message=error_message
        )
    
    def cleanup_resources(self):
        """Clean up all resources and temporary files"""
        try:
            cleaned_files = self.resource_manager.cleanup_all_temp_files()
            self.logger.info(f"Cleaned up {cleaned_files} temporary files")
        except Exception as e:
            self.logger.error(f"Error during resource cleanup: {e}")
    
    def get_processing_stats(self) -> Dict[str, Any]:
        """Get processing statistics"""
        return {
            **self.stats,
            "memory_usage": self.resource_manager.get_memory_usage(),
            "tracked_temp_files": self.resource_manager.get_tracked_files_count()
        }
    
    def __enter__(self):
        """Context manager entry"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit with automatic cleanup"""
        self.cleanup_resources()


# Convenience functions for backward compatibility and standalone usage
def process_pdf_document(pdf_path: str, config_path: Optional[str] = None, debug: bool = False) -> Dict[str, Any]:
    """
    Convenience function to process a PDF document.
    
    Args:
        pdf_path: Path to PDF file
        config_path: Optional configuration file path
        debug: Enable debug logging
        
    Returns:
        Processing result as dictionary
    """
    with UnifiedPdfProcessor(config_path, debug) as processor:
        result = processor.process_document(pdf_path)
        return result.to_dict()


def process_pdf_buffer(pdf_buffer: bytes, filename: str = "document.pdf", 
                      config_path: Optional[str] = None, debug: bool = False) -> Dict[str, Any]:
    """
    Convenience function to process a PDF from memory buffer.
    
    Args:
        pdf_buffer: PDF content as bytes
        filename: Original filename
        config_path: Optional configuration file path
        debug: Enable debug logging
        
    Returns:
        Processing result as dictionary
    """
    with UnifiedPdfProcessor(config_path, debug) as processor:
        result = processor.process_from_buffer(pdf_buffer, filename)
        return result.to_dict()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Unified PDF Processor")
    parser.add_argument('pdf_path', nargs='?', help='Path to PDF file to process')
    parser.add_argument('--config', type=str, help='Path to configuration file')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    parser.add_argument('--stats', action='store_true', help='Show processing statistics')
    parser.add_argument('--stdin', action='store_true', help='Read PDF from stdin (for backward compatibility)')
    
    args = parser.parse_args()
    
    try:
        with UnifiedPdfProcessor(args.config, args.debug) as processor:
            result = None
            
            if args.stdin:
                # Backward compatibility: read from stdin
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(sys.stdin.buffer.read())
                    temp_pdf_path = tmp.name
                
                try:
                    result = processor.process_document(temp_pdf_path)
                finally:
                    # Clean up temp file
                    try:
                        os.unlink(temp_pdf_path)
                    except:
                        pass
            elif args.pdf_path:
                # Direct file processing
                result = processor.process_document(args.pdf_path)
            else:
                raise ValueError("Must specify a PDF file path or use --stdin")
            
            if args.stats:
                stats = processor.get_processing_stats()
                print("Processing Statistics:")
                print(json.dumps(stats, indent=2))
                print()
            
            print("___RESULT_START___")
            print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
            print("___RESULT_END___")
            
    except Exception as e:
        error_result = {
            "success": False,
            "error_message": str(e),
            "transactions": [],
            "meta": {}
        }
        print("___RESULT_START___")
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
        print("___RESULT_END___")
        sys.exit(1)