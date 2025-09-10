#!/usr/bin/env python3
"""
Format Processor Integration

This module provides a unified interface for processing different document formats
using the appropriate specialized processors based on automatic format detection.
"""

import logging
import time
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass
from pathlib import Path

# Import all processors
from .formatDetector import FormatDetector, FormatDetectionResult
from .excelProcessor import ExcelProcessor, ExcelProcessingResult
from .wordProcessor import WordProcessor, WordProcessingResult


@dataclass
class UnifiedProcessingResult:
    """Unified result structure for all document types"""
    success: bool
    document_type: str
    transactions: List[Dict[str, Any]]
    processing_method: str
    confidence: float
    processing_time: float
    metadata: Dict[str, Any]
    error_message: Optional[str] = None


class FormatProcessorIntegration:
    """
    Unified document processor that automatically detects format and uses
    the appropriate specialized processor for optimal results.
    """
    
    def __init__(self, debug: bool = False):
        """
        Initialize the integrated processor.
        
        Args:
            debug: Enable debug logging
        """
        self.debug = debug
        self.logger = self._setup_logger()
        
        # Initialize all processors
        self.format_detector = FormatDetector(debug=debug)
        self.excel_processor = ExcelProcessor(debug=debug)
        self.word_processor = WordProcessor(debug=debug)
        
        # Processing statistics
        self.processing_stats = {
            'total_processed': 0,
            'successful_processed': 0,
            'format_distribution': {},
            'average_processing_time': 0.0,
            'average_confidence': 0.0
        }
        
        self.logger.info("FormatProcessorIntegration initialized with all processors")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.FormatProcessorIntegration")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def process_document(self, file_path: str, force_format: Optional[str] = None) -> UnifiedProcessingResult:
        """
        Process a document using automatic format detection and appropriate processor.
        
        Args:
            file_path: Path to the document file
            force_format: Force a specific format instead of auto-detection
            
        Returns:
            UnifiedProcessingResult with processing results
        """
        if not Path(file_path).exists():
            return UnifiedProcessingResult(
                success=False,
                document_type='unknown',
                transactions=[],
                processing_method='none',
                confidence=0.0,
                processing_time=0.0,
                metadata={'error': 'File not found'},
                error_message=f"File not found: {file_path}"
            )
        
        start_time = time.time()
        
        try:
            self.logger.info(f"Processing document: {file_path}")
            
            # Step 1: Detect format (unless forced)
            if force_format:
                self.logger.info(f"Using forced format: {force_format}")
                detected_format = force_format
                format_confidence = 1.0
                format_metadata = {'forced_format': True}
            else:
                detection_result = self.format_detector.detect_format(file_path)
                detected_format = detection_result.detected_format
                format_confidence = detection_result.confidence
                format_metadata = detection_result.metadata
                
                self.logger.info(
                    f"Detected format: {detected_format} "
                    f"(confidence: {format_confidence:.2f})"
                )
            
            # Step 2: Process with appropriate processor
            processing_result = self._process_with_format_processor(
                file_path, detected_format, format_metadata
            )
            
            # Step 3: Create unified result
            processing_time = time.time() - start_time
            
            # Convert format-specific results to unified format
            unified_result = self._create_unified_result(
                processing_result, detected_format, format_confidence, 
                processing_time, format_metadata
            )
            
            # Update statistics
            self._update_processing_stats(unified_result)
            
            self.logger.info(
                f"Document processing completed: {unified_result.success} "
                f"({len(unified_result.transactions)} transactions, "
                f"{processing_time:.2f}s)"
            )
            
            return unified_result
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_msg = f"Document processing failed: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            return UnifiedProcessingResult(
                success=False,
                document_type='unknown',
                transactions=[],
                processing_method='error',
                confidence=0.0,
                processing_time=processing_time,
                metadata={'error': error_msg},
                error_message=error_msg
            )
    
    def _process_with_format_processor(self, file_path: str, format_type: str, 
                                     format_metadata: Dict[str, Any]) -> Union[ExcelProcessingResult, WordProcessingResult, Dict]:
        """Process document with the appropriate format-specific processor"""
        
        if format_type in ['excel', 'csv']:
            if format_type == 'csv' or file_path.endswith('.csv'):
                return self.excel_processor.process_csv(file_path)
            else:
                return self.excel_processor.process_excel(file_path)
        
        elif format_type == 'word':
            return self.word_processor.process_word(file_path)
        
        elif format_type == 'pdf':
            # For PDF, we would use the enhanced document processor
            # For now, return a placeholder result
            return {
                'success': False,
                'error_message': 'PDF processing requires enhanced document processor (not implemented in this task)',
                'processing_method': 'pdf_placeholder'
            }
        
        elif format_type == 'image':
            # For images, we would use the enhanced document processor with OCR
            return {
                'success': False,
                'error_message': 'Image processing requires enhanced document processor with OCR (not implemented in this task)',
                'processing_method': 'image_placeholder'
            }
        
        else:
            return {
                'success': False,
                'error_message': f'Unsupported format: {format_type}',
                'processing_method': 'unsupported'
            }
    
    def _create_unified_result(self, processing_result: Any, detected_format: str, 
                             format_confidence: float, processing_time: float,
                             format_metadata: Dict[str, Any]) -> UnifiedProcessingResult:
        """Convert format-specific results to unified result structure"""
        
        # Handle different result types
        if isinstance(processing_result, ExcelProcessingResult):
            # Convert Excel transactions to unified format
            transactions = []
            for trans in processing_result.transactions:
                unified_trans = {
                    'date': trans.date,
                    'description': trans.description,
                    'amount': trans.amount,
                    'balance': trans.balance,
                    'reference': trans.reference,
                    'transaction_type': trans.transaction_type,
                    'confidence': trans.confidence,
                    'source': 'excel_processor'
                }
                transactions.append(unified_trans)
            
            metadata = {
                'format_detection': format_metadata,
                'processing_details': processing_result.metadata,
                'column_mapping': processing_result.column_mapping.__dict__,
                'total_rows': processing_result.total_rows,
                'processed_rows': processing_result.processed_rows
            }
            
            return UnifiedProcessingResult(
                success=processing_result.success,
                document_type=detected_format,
                transactions=transactions,
                processing_method='excel_processor',
                confidence=min(format_confidence, processing_result.column_mapping.confidence),
                processing_time=processing_time,
                metadata=metadata,
                error_message=processing_result.error_message
            )
        
        elif isinstance(processing_result, WordProcessingResult):
            # Convert Word transactions to unified format
            transactions = []
            for trans in processing_result.transactions:
                unified_trans = {
                    'date': trans.get('date'),
                    'description': trans.get('description'),
                    'amount': trans.get('amount'),
                    'balance': trans.get('balance'),
                    'reference': trans.get('reference'),
                    'transaction_type': trans.get('transaction_type'),
                    'confidence': trans.get('confidence', 0.5),
                    'source': 'word_processor'
                }
                transactions.append(unified_trans)
            
            metadata = {
                'format_detection': format_metadata,
                'processing_details': processing_result.metadata,
                'text_length': len(processing_result.text_content),
                'tables_found': len(processing_result.tables)
            }
            
            return UnifiedProcessingResult(
                success=processing_result.success,
                document_type=detected_format,
                transactions=transactions,
                processing_method='word_processor',
                confidence=format_confidence * 0.8,  # Word processing is less reliable
                processing_time=processing_time,
                metadata=metadata,
                error_message=processing_result.error_message
            )
        
        elif isinstance(processing_result, dict):
            # Handle placeholder/error results
            return UnifiedProcessingResult(
                success=processing_result.get('success', False),
                document_type=detected_format,
                transactions=[],
                processing_method=processing_result.get('processing_method', 'unknown'),
                confidence=0.0,
                processing_time=processing_time,
                metadata={'format_detection': format_metadata},
                error_message=processing_result.get('error_message')
            )
        
        else:
            # Unknown result type
            return UnifiedProcessingResult(
                success=False,
                document_type=detected_format,
                transactions=[],
                processing_method='unknown',
                confidence=0.0,
                processing_time=processing_time,
                metadata={'format_detection': format_metadata},
                error_message='Unknown processing result type'
            )
    
    def _update_processing_stats(self, result: UnifiedProcessingResult):
        """Update processing statistics"""
        self.processing_stats['total_processed'] += 1
        
        if result.success:
            self.processing_stats['successful_processed'] += 1
        
        # Update format distribution
        format_type = result.document_type
        if format_type not in self.processing_stats['format_distribution']:
            self.processing_stats['format_distribution'][format_type] = 0
        self.processing_stats['format_distribution'][format_type] += 1
        
        # Update averages
        total = self.processing_stats['total_processed']
        current_avg_time = self.processing_stats['average_processing_time']
        current_avg_conf = self.processing_stats['average_confidence']
        
        self.processing_stats['average_processing_time'] = (
            (current_avg_time * (total - 1) + result.processing_time) / total
        )
        
        self.processing_stats['average_confidence'] = (
            (current_avg_conf * (total - 1) + result.confidence) / total
        )
    
    def process_multiple_documents(self, file_paths: List[str]) -> List[UnifiedProcessingResult]:
        """
        Process multiple documents with optimized order based on complexity.
        
        Args:
            file_paths: List of file paths to process
            
        Returns:
            List of UnifiedProcessingResult objects
        """
        self.logger.info(f"Processing {len(file_paths)} documents")
        
        # Get recommended processing order
        processing_order = self.format_detector.recommend_processing_order(file_paths)
        
        results = []
        for file_path, recommended_processor, confidence in processing_order:
            self.logger.info(f"Processing {file_path} (confidence: {confidence:.2f})")
            result = self.process_document(file_path)
            results.append(result)
        
        return results
    
    def get_processing_statistics(self) -> Dict[str, Any]:
        """Get processing statistics"""
        stats = self.processing_stats.copy()
        
        if stats['total_processed'] > 0:
            stats['success_rate'] = stats['successful_processed'] / stats['total_processed']
        else:
            stats['success_rate'] = 0.0
        
        return stats
    
    def get_supported_formats(self) -> List[str]:
        """Get list of all supported formats"""
        return self.format_detector.get_supported_formats()
    
    def validate_file_support(self, file_path: str) -> bool:
        """Check if file is supported for processing"""
        return self.format_detector.validate_format_support(file_path)
    
    def reset_statistics(self):
        """Reset processing statistics"""
        self.processing_stats = {
            'total_processed': 0,
            'successful_processed': 0,
            'format_distribution': {},
            'average_processing_time': 0.0,
            'average_confidence': 0.0
        }
        self.logger.info("Processing statistics reset")