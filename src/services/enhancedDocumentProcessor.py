#!/usr/bin/env python3
"""
Enhanced Document Processor

This module implements the main entry point for enhanced document processing,
integrating all modern components (ModernTableDetector, ModernOCREngine, 
AdvancedImagePreprocessor, NLPValidator) with intelligent processing strategy
selection and comprehensive quality metrics.

This replaces UnifiedPdfProcessor with improved accuracy, multi-format support,
and advanced quality assessment.
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
import hashlib

# Import modern components
from .modernTableDetector import ModernTableDetector, TableResult, TableExtractionResult
from .modernOCREngine import ModernOCREngine, OCRResult, OCRExtractionResult
from .advancedImagePreprocessor import AdvancedImagePreprocessor, DocumentStructure, PreprocessingResult
from .nlpValidator import NLPValidator, ValidationResult, ClassificationResult, AnomalyResult
from .formatDetector import FormatDetector, FormatDetectionResult
from .excelProcessor import ExcelProcessor
from .wordProcessor import WordProcessor
from .resultCombinationSystem import (
    ResultCombinationSystem, ExtractionResult, CombinedResult,
    create_extraction_result, combine_extraction_results
)

# Legacy imports for fallback
import pandas as pd
import numpy as np

# Resource management
try:
    from ...resource_manager import ResourceManager, MemoryStats
    RESOURCE_MANAGER_AVAILABLE = True
except ImportError:
    RESOURCE_MANAGER_AVAILABLE = False

# AI enhancement
try:
    from ...ai_enhanced_processor import AIEnhancedProcessor, enhance_extraction_result
    AI_ENHANCEMENT_AVAILABLE = True
except ImportError:
    AI_ENHANCEMENT_AVAILABLE = False


@dataclass
class ProcessingStrategy:
    """Strategy configuration for document processing"""
    format_type: str
    primary_method: str
    fallback_methods: List[str]
    quality_threshold: float
    parallel_processing: bool
    preprocessing_required: bool


@dataclass
class QualityMetrics:
    """Comprehensive quality metrics for processing results"""
    overall_confidence: float
    text_quality: float
    table_quality: float
    ocr_quality: float
    validation_score: float
    completeness: float
    consistency: float
    processing_method: str
    component_scores: Dict[str, float]
    anomaly_count: int
    high_confidence_ratio: float


@dataclass
class ProcessingMetadata:
    """Enhanced metadata about the processing operation"""
    processing_time: float
    total_transactions: int
    tables_found: int
    text_regions_found: int
    format_detected: str
    strategy_used: str
    components_used: List[str]
    preprocessing_applied: bool
    fallback_used: bool
    memory_usage: Optional[Dict] = None
    document_structure: Optional[DocumentStructure] = None
    quality_metrics: Optional[QualityMetrics] = None
    recommendations: List[str] = None


@dataclass
class EnhancedProcessingResult:
    """Enhanced result structure for document processing"""
    success: bool
    transactions: List[Dict]
    metadata: ProcessingMetadata
    processing_time: float
    confidence_score: float
    error_message: Optional[str] = None
    provider: str = "enhanced_document_processor"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'success': self.success,
            'transactions': self.transactions,
            'meta': asdict(self.metadata),
            'processing_time': self.processing_time,
            'confidence_score': self.confidence_score,
            'error_message': self.error_message,
            'provider': self.provider
        }


class ProcessingError(Exception):
    """Enhanced exception for processing errors"""
    
    def __init__(self, message: str, error_code: str = "PROCESSING_ERROR", 
                 component: str = None, details: Dict[str, Any] = None):
        super().__init__(message)
        self.error_code = error_code
        self.component = component
        self.details = details or {}
        self.timestamp = time.time()


class EnhancedDocumentProcessor:
    """
    Enhanced document processor that serves as the main entry point for
    intelligent document processing with modern components and quality assessment.
    """
    
    def __init__(self, config_path: Optional[str] = None, debug: bool = False, 
                 temp_dir: Optional[str] = None, enable_caching: bool = True):
        """
        Initialize the Enhanced Document Processor.
        
        Args:
            config_path: Path to configuration file
            debug: Enable debug logging
            temp_dir: Custom temporary directory for file operations
            enable_caching: Enable result caching
        """
        self.debug = debug
        self.config_path = config_path or self._get_default_config_path()
        self.enable_caching = enable_caching
        
        # Set up logging first
        self.logger = self._setup_logger()
        
        # Load configuration
        self.config = self._load_config()
        
        # Initialize resource manager if available
        if RESOURCE_MANAGER_AVAILABLE:
            self.resource_manager = ResourceManager(temp_dir=temp_dir, debug=debug)
        else:
            self.resource_manager = None
            self.logger.warning("ResourceManager not available, using basic temp file handling")
        
        # Initialize modern components
        self._initialize_components()
        
        # Initialize processing strategies
        self._initialize_strategies()
        
        # Initialize caching system
        self.cache = {} if enable_caching else None
        self.cache_size_limit = self.config.get('processing', {}).get('cache_size', 50)
        
        # Initialize result combination system
        self.result_combiner = ResultCombinationSystem(debug=debug)
        
        # Processing statistics
        self.stats = {
            'documents_processed': 0,
            'total_processing_time': 0.0,
            'total_transactions_extracted': 0,
            'errors_encountered': 0,
            'cache_hits': 0,
            'fallback_used': 0,
            'component_usage': {
                'modern_table_detector': 0,
                'modern_ocr_engine': 0,
                'advanced_image_preprocessor': 0,
                'nlp_validator': 0,
                'format_processors': 0
            }
        }
        
        self.logger.info("EnhancedDocumentProcessor initialized successfully")
    
    def _get_default_config_path(self) -> str:
        """Get default configuration file path"""
        return os.path.join(os.path.dirname(__file__), '../../parser_config.json')
    
    def _load_config(self) -> Dict:
        """Load enhanced configuration from file"""
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
        """Get enhanced default configuration"""
        return {
            "primary_tools": {
                "text_extractor": "pymupdf",
                "table_detector": "pdfplumber",
                "ocr_engine": "easyocr",
                "image_processor": "opencv",
                "nlp_validator": "spacy"
            },
            "fallback_tools": {
                "table_detector": "camelot",
                "ocr_engine": "tesseract",
                "image_processor": "pil"
            },
            "processing": {
                "enable_parallel": True,
                "max_workers": 2,
                "enable_caching": True,
                "cache_size": 50,
                "enable_preprocessing": True,
                "enable_nlp_validation": True,
                "enable_result_combination": True
            },
            "quality_thresholds": {
                "min_confidence": 0.7,
                "ocr_threshold": 0.5,
                "table_confidence": 0.8,
                "text_quality": 0.6,
                "validation_threshold": 0.7
            },
            "format_support": {
                "pdf": True,
                "image": True,
                "excel": True,
                "word": True,
                "csv": True
            }
        }
    
    def _setup_logger(self) -> logging.Logger:
        """Set up enhanced logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.EnhancedDocumentProcessor")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def _initialize_components(self):
        """Initialize all modern processing components"""
        try:
            # Initialize format detector
            self.format_detector = FormatDetector(debug=self.debug)
            
            # Initialize modern table detector
            self.table_detector = ModernTableDetector(debug=self.debug)
            
            # Initialize modern OCR engine
            ocr_languages = self.config.get('ocr_languages', ['en', 'es'])
            if isinstance(ocr_languages, str):
                ocr_languages = ocr_languages.replace('+', ',').split(',')
            self.ocr_engine = ModernOCREngine(languages=ocr_languages, debug=self.debug)
            
            # Initialize advanced image preprocessor
            self.image_preprocessor = AdvancedImagePreprocessor(debug=self.debug)
            
            # Initialize NLP validator
            self.nlp_validator = NLPValidator(debug=self.debug)
            
            # Initialize format-specific processors
            self.excel_processor = ExcelProcessor(debug=self.debug)
            self.word_processor = WordProcessor(debug=self.debug)
            
            self.logger.info("All modern components initialized successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to initialize components: {e}")
            raise ProcessingError(f"Component initialization failed: {e}", "INIT_ERROR")
    
    def _initialize_strategies(self):
        """Initialize processing strategies for different document types"""
        self.strategies = {
            'pdf': ProcessingStrategy(
                format_type='pdf',
                primary_method='modern_pipeline',
                fallback_methods=['legacy_pipeline'],
                quality_threshold=0.7,
                parallel_processing=True,
                preprocessing_required=False
            ),
            'image': ProcessingStrategy(
                format_type='image',
                primary_method='ocr_pipeline',
                fallback_methods=['legacy_ocr'],
                quality_threshold=0.5,
                parallel_processing=False,
                preprocessing_required=True
            ),
            'excel': ProcessingStrategy(
                format_type='excel',
                primary_method='structured_data',
                fallback_methods=[],
                quality_threshold=0.9,
                parallel_processing=False,
                preprocessing_required=False
            ),
            'word': ProcessingStrategy(
                format_type='word',
                primary_method='document_extraction',
                fallback_methods=[],
                quality_threshold=0.8,
                parallel_processing=False,
                preprocessing_required=False
            )
        }    

    def process_document(self, file_path: str, file_type: Optional[str] = None) -> EnhancedProcessingResult:
        """
        Process a document from file path with intelligent strategy selection.
        
        Args:
            file_path: Path to the document file
            file_type: Optional file type hint
            
        Returns:
            EnhancedProcessingResult with extracted transactions and comprehensive metadata
        """
        if not os.path.exists(file_path):
            error_msg = f"Document file not found: {file_path}"
            self.logger.error(error_msg)
            return self._create_error_result(error_msg, "FILE_NOT_FOUND")
        
        try:
            self.logger.info(f"Processing document: {file_path}")
            self._send_progress("Initializing enhanced document processing...")
            
            # Check cache first
            if self.enable_caching:
                cached_result = self._check_cache(file_path)
                if cached_result:
                    self.stats['cache_hits'] += 1
                    self.logger.info("Returning cached result")
                    return cached_result
            
            return self._process_document_internal(file_path, file_type)
            
        except Exception as e:
            self.stats['errors_encountered'] += 1
            error_msg = f"Failed to process document {file_path}: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return self._create_error_result(error_msg, "PROCESSING_ERROR", {"file_path": file_path})
    
    def process_from_buffer(self, buffer: bytes, filename: str = "document") -> EnhancedProcessingResult:
        """
        Process a document from memory buffer with intelligent strategy selection.
        
        Args:
            buffer: Document content as bytes
            filename: Original filename for reference
            
        Returns:
            EnhancedProcessingResult with extracted transactions and comprehensive metadata
        """
        if not buffer:
            error_msg = "Document buffer is empty"
            self.logger.error(error_msg)
            return self._create_error_result(error_msg, "INVALID_INPUT")
        
        try:
            self.logger.info(f"Processing document from buffer: {filename} ({len(buffer)} bytes)")
            self._send_progress("Creating temporary file from buffer...")
            
            # Create temporary file from buffer
            if self.resource_manager:
                with self.resource_manager.temp_file_context(buffer, self._get_file_extension(filename), 'enhanced_proc_') as temp_path:
                    return self._process_document_internal(temp_path, original_filename=filename)
            else:
                # Fallback temp file handling
                with tempfile.NamedTemporaryFile(suffix=self._get_file_extension(filename), delete=False) as tmp:
                    tmp.write(buffer)
                    temp_path = tmp.name
                
                try:
                    return self._process_document_internal(temp_path, original_filename=filename)
                finally:
                    try:
                        os.unlink(temp_path)
                    except:
                        pass
                
        except Exception as e:
            self.stats['errors_encountered'] += 1
            error_msg = f"Failed to process document from buffer: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return self._create_error_result(error_msg, "PROCESSING_ERROR", {"filename": filename})
    
    def _process_document_internal(self, file_path: str, file_type: Optional[str] = None, 
                                 original_filename: Optional[str] = None) -> EnhancedProcessingResult:
        """
        Internal document processing logic with intelligent strategy selection.
        
        Args:
            file_path: Path to document file (may be temporary)
            file_type: Optional file type hint
            original_filename: Original filename if processing from buffer
            
        Returns:
            EnhancedProcessingResult with processing results
        """
        start_time = time.time()
        memory_start = self._get_memory_usage()
        
        try:
            # Step 1: Detect document format
            self._send_progress("Detecting document format...")
            detected_format = self.format_detector.detect_format(file_path)
            self.logger.info(f"Detected format: {detected_format.detected_format} (confidence: {detected_format.confidence:.2f})")
            
            # Step 2: Select processing strategy
            strategy = self._select_processing_strategy(detected_format)
            self.logger.info(f"Selected strategy: {strategy.primary_method} for {strategy.format_type}")
            
            # Step 3: Execute processing strategy
            self._send_progress(f"Processing with {strategy.primary_method} strategy...")
            result = self._execute_processing_strategy(file_path, detected_format, strategy)
            
            # Step 4: Apply NLP validation if enabled and applicable
            if (self.config.get('processing', {}).get('enable_nlp_validation', True) and 
                result.success and result.transactions):
                self._send_progress("Applying NLP validation...")
                result = self._apply_nlp_validation(result)
            
            # Step 5: Calculate comprehensive quality metrics
            self._send_progress("Calculating quality metrics...")
            quality_metrics = self._calculate_comprehensive_quality_metrics(result)
            
            # Step 6: Generate recommendations
            recommendations = self._generate_recommendations(result, quality_metrics, strategy)
            
            # Step 7: Finalize results
            processing_time = time.time() - start_time
            memory_end = self._get_memory_usage()
            
            # Update statistics
            self.stats['documents_processed'] += 1
            self.stats['total_processing_time'] += processing_time
            self.stats['total_transactions_extracted'] += len(result.transactions)
            
            # Create enhanced metadata
            metadata = ProcessingMetadata(
                processing_time=processing_time,
                total_transactions=len(result.transactions),
                tables_found=getattr(result, 'tables_found', 0),
                text_regions_found=getattr(result, 'text_regions_found', 0),
                format_detected=detected_format.detected_format,
                strategy_used=strategy.primary_method,
                components_used=getattr(result, 'components_used', []),
                preprocessing_applied=getattr(result, 'preprocessing_applied', False),
                fallback_used=getattr(result, 'fallback_used', False),
                memory_usage=memory_end,
                document_structure=getattr(result, 'document_structure', None),
                quality_metrics=quality_metrics,
                recommendations=recommendations
            )
            
            enhanced_result = EnhancedProcessingResult(
                success=result.success,
                transactions=result.transactions,
                metadata=metadata,
                processing_time=processing_time,
                confidence_score=quality_metrics.overall_confidence,
                error_message=result.error_message
            )
            
            # Cache result if enabled
            if self.enable_caching and enhanced_result.success:
                self._cache_result(file_path, enhanced_result)
            
            self.logger.info(
                f"Enhanced processing completed: {len(result.transactions)} transactions "
                f"in {processing_time:.2f}s with {quality_metrics.overall_confidence:.2f} confidence"
            )
            
            return enhanced_result
            
        except Exception as e:
            processing_time = time.time() - start_time
            self.stats['errors_encountered'] += 1
            
            error_msg = f"Internal processing error: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            return self._create_error_result(error_msg, "PROCESSING_ERROR", {
                "file_path": file_path,
                "original_filename": original_filename,
                "processing_time": processing_time
            })
    
    def _select_processing_strategy(self, detected_format: FormatDetectionResult) -> ProcessingStrategy:
        """
        Select the optimal processing strategy based on document characteristics.
        
        Args:
            detected_format: Detected document format information
            
        Returns:
            ProcessingStrategy for the document
        """
        format_type = detected_format.detected_format.lower()
        
        # Get base strategy
        if format_type in self.strategies:
            strategy = self.strategies[format_type]
        else:
            # Default to PDF strategy for unknown formats
            strategy = self.strategies['pdf']
            self.logger.warning(f"Unknown format {format_type}, using PDF strategy")
        
        # Adjust strategy based on document characteristics
        if detected_format.metadata:
            # Adjust quality threshold based on document quality
            if detected_format.metadata.get('is_scanned', False):
                strategy.preprocessing_required = True
                strategy.quality_threshold *= 0.8  # Lower threshold for scanned docs
            
            # Adjust parallel processing based on document size
            page_count = detected_format.metadata.get('page_count', 1)
            if page_count > 10:
                strategy.parallel_processing = True
            elif page_count == 1:
                strategy.parallel_processing = False
        
        return strategy
    
    def _execute_processing_strategy(self, file_path: str, detected_format: FormatDetectionResult, 
                                   strategy: ProcessingStrategy) -> Any:
        """
        Execute the selected processing strategy.
        
        Args:
            file_path: Path to document file
            detected_format: Detected document format
            strategy: Processing strategy to execute
            
        Returns:
            Processing result from the strategy
        """
        format_type = detected_format.detected_format.lower()
        
        try:
            if format_type == 'pdf':
                return self._process_pdf_strategy(file_path, strategy)
            elif format_type in ['jpg', 'jpeg', 'png', 'tiff', 'bmp']:
                return self._process_image_strategy(file_path, strategy)
            elif format_type in ['xlsx', 'xls', 'csv']:
                return self._process_excel_strategy(file_path, strategy)
            elif format_type in ['docx', 'doc']:
                return self._process_word_strategy(file_path, strategy)
            else:
                # Fallback to PDF processing
                self.logger.warning(f"Unsupported format {format_type}, falling back to PDF processing")
                return self._process_pdf_strategy(file_path, strategy)
                
        except Exception as e:
            # Try fallback methods if primary method fails
            if strategy.fallback_methods:
                self.logger.warning(f"Primary method failed: {e}, trying fallback methods")
                self.stats['fallback_used'] += 1
                return self._execute_fallback_strategy(file_path, detected_format, strategy)
            else:
                raise e
    
    def _process_pdf_strategy(self, file_path: str, strategy: ProcessingStrategy) -> Any:
        """Process PDF document with modern pipeline and result combination"""
        
        # Check if multiple methods should be used for better accuracy
        use_multiple_methods = (
            strategy.parallel_processing and 
            self.config.get('processing', {}).get('enable_result_combination', True)
        )
        
        if use_multiple_methods:
            return self._process_pdf_with_multiple_methods(file_path, strategy)
        else:
            return self._process_pdf_single_method(file_path, strategy)
    
    def _process_pdf_with_multiple_methods(self, file_path: str, strategy: ProcessingStrategy) -> Any:
        """Process PDF using multiple extraction methods and combine results"""
        self.logger.info("Processing PDF with multiple methods for enhanced accuracy")
        
        extraction_results = []
        
        # Method 1: Table detection with pdfplumber
        try:
            self._send_progress("Extracting with table detector...")
            start_time = time.time()
            
            table_result = self.table_detector.extract_tables_with_confidence(file_path)
            processing_time = time.time() - start_time
            
            if table_result.success and table_result.tables:
                transactions = []
                for table in table_result.tables:
                    if table.confidence >= strategy.quality_threshold:
                        table_transactions = self._convert_table_to_transactions(table.data, table.confidence)
                        transactions.extend(table_transactions)
                
                # Create extraction result
                table_extraction = create_extraction_result(
                    method='pdfplumber',
                    transactions=transactions,
                    confidence=table_result.overall_confidence,
                    processing_time=processing_time,
                    metadata={'tables_found': len(table_result.tables)},
                    quality_metrics={'table_quality': table_result.overall_confidence}
                )
                extraction_results.append(table_extraction)
                self.stats['component_usage']['modern_table_detector'] += 1
                
        except Exception as e:
            self.logger.warning(f"Table detection method failed: {e}")
        
        # Method 2: OCR with image preprocessing (if document appears to be scanned)
        try:
            self._send_progress("Extracting with OCR method...")
            start_time = time.time()
            
            # Convert PDF to images
            images = self.image_preprocessor.convert_pdf_to_images(file_path)
            processing_time = time.time() - start_time
            
            if images:
                ocr_transactions = []
                total_confidence = 0.0
                
                for i, image in enumerate(images):
                    # Preprocess image
                    enhanced_image = self.image_preprocessor.enhance_for_ocr(image)
                    
                    # Extract text with OCR
                    ocr_result = self.ocr_engine.extract_text(enhanced_image)
                    
                    if ocr_result.text.strip():
                        page_transactions = self._convert_text_to_transactions(ocr_result.text, ocr_result.confidence)
                        ocr_transactions.extend(page_transactions)
                        total_confidence += ocr_result.confidence
                
                if ocr_transactions:
                    avg_confidence = total_confidence / len(images)
                    
                    # Create extraction result
                    ocr_extraction = create_extraction_result(
                        method='easyocr',
                        transactions=ocr_transactions,
                        confidence=avg_confidence,
                        processing_time=processing_time,
                        metadata={'pages_processed': len(images)},
                        quality_metrics={'ocr_quality': avg_confidence}
                    )
                    extraction_results.append(ocr_extraction)
                    self.stats['component_usage']['modern_ocr_engine'] += 1
                    self.stats['component_usage']['advanced_image_preprocessor'] += 1
                    
        except Exception as e:
            self.logger.warning(f"OCR method failed: {e}")
        
        # Method 3: Direct text extraction with PyMuPDF (if available)
        try:
            self._send_progress("Extracting with direct text method...")
            start_time = time.time()
            
            # Use PyMuPDF for direct text extraction
            import fitz  # PyMuPDF
            
            doc = fitz.open(file_path)
            all_text = ""
            
            for page in doc:
                all_text += page.get_text() + "\n"
            
            doc.close()
            processing_time = time.time() - start_time
            
            if all_text.strip():
                text_transactions = self._convert_text_to_transactions(all_text, 0.9)  # High confidence for direct text
                
                if text_transactions:
                    # Create extraction result
                    text_extraction = create_extraction_result(
                        method='pymupdf',
                        transactions=text_transactions,
                        confidence=0.9,
                        processing_time=processing_time,
                        metadata={'text_length': len(all_text)},
                        quality_metrics={'text_quality': 0.9}
                    )
                    extraction_results.append(text_extraction)
                    
        except Exception as e:
            self.logger.warning(f"Direct text extraction failed: {e}")
        
        # Combine results using the result combination system
        if extraction_results:
            self._send_progress("Combining extraction results...")
            combined_result = self.result_combiner.combine_results(extraction_results)
            
            # Create enhanced result object
            class CombinedPDFProcessingResult:
                def __init__(self, combined: CombinedResult):
                    self.success = len(combined.transactions) > 0
                    self.transactions = combined.transactions
                    self.error_message = None if self.success else "No transactions found after combination"
                    self.components_used = list(combined.method_contributions.keys())
                    self.preprocessing_applied = 'easyocr' in combined.method_contributions
                    self.document_structure = None
                    self.tables_found = sum(1 for r in extraction_results if r.method == 'pdfplumber')
                    self.text_regions_found = 0
                    self.fallback_used = False
                    
                    # Enhanced metadata from combination
                    self.combination_metadata = {
                        'quality_assessment': combined.quality_assessment,
                        'cross_validation': combined.cross_validation,
                        'method_contributions': combined.method_contributions,
                        'conflict_resolutions': combined.conflict_resolutions,
                        'recommendations': combined.recommendations
                    }
            
            return CombinedPDFProcessingResult(combined_result)
        
        else:
            # Fallback to single method if all methods failed
            self.logger.warning("All extraction methods failed, falling back to single method")
            return self._process_pdf_single_method(file_path, strategy)
    
    def _process_pdf_single_method(self, file_path: str, strategy: ProcessingStrategy) -> Any:
        """Process PDF document with single method (original implementation)"""
        self.stats['component_usage']['modern_table_detector'] += 1
        
        # Step 1: Extract tables with modern detector
        self._send_progress("Extracting tables with modern detector...")
        table_result = self.table_detector.extract_tables_with_confidence(file_path)
        
        transactions = []
        components_used = ['modern_table_detector']
        preprocessing_applied = False
        document_structure = None
        
        if table_result.success and table_result.tables:
            # Process tables directly
            self.logger.info(f"Found {len(table_result.tables)} tables, processing with AI")
            
            # Convert tables to transaction format (simplified for now)
            for table in table_result.tables:
                if table.confidence >= strategy.quality_threshold:
                    # Convert table data to transactions
                    table_transactions = self._convert_table_to_transactions(table.data, table.confidence)
                    transactions.extend(table_transactions)
        
        else:
            # Fallback to OCR if no tables found
            self._send_progress("No tables found, applying OCR...")
            self.stats['component_usage']['modern_ocr_engine'] += 1
            self.stats['component_usage']['advanced_image_preprocessor'] += 1
            components_used.extend(['advanced_image_preprocessor', 'modern_ocr_engine'])
            preprocessing_applied = True
            
            # Convert PDF to images and preprocess
            images = self.image_preprocessor.convert_pdf_to_images(file_path)
            
            if images:
                # Detect document structure from first page
                structure_result = self.image_preprocessor.detect_document_structure(images[0])
                document_structure = structure_result
                
                # Process each page with OCR
                for i, image in enumerate(images):
                    # Preprocess image
                    enhanced_image = self.image_preprocessor.enhance_for_ocr(image)
                    
                    # Extract text with OCR
                    ocr_result = self.ocr_engine.extract_text(enhanced_image)
                    
                    if ocr_result.text.strip():
                        # Convert OCR text to transactions (simplified)
                        ocr_transactions = self._convert_text_to_transactions(ocr_result.text, ocr_result.confidence)
                        transactions.extend(ocr_transactions)
        
        # Create result object
        class PDFProcessingResult:
            def __init__(self):
                self.success = len(transactions) > 0
                self.transactions = transactions
                self.error_message = None if self.success else "No transactions found"
                self.components_used = components_used
                self.preprocessing_applied = preprocessing_applied
                self.document_structure = document_structure
                self.tables_found = len(table_result.tables) if table_result.success else 0
                self.text_regions_found = len(document_structure.text_regions) if document_structure else 0
                self.fallback_used = False
        
        return PDFProcessingResult()
    
    def _process_image_strategy(self, file_path: str, strategy: ProcessingStrategy) -> Any:
        """Process image document with OCR pipeline"""
        self.stats['component_usage']['advanced_image_preprocessor'] += 1
        self.stats['component_usage']['modern_ocr_engine'] += 1
        
        # Step 1: Load and preprocess image
        self._send_progress("Loading and preprocessing image...")
        import cv2
        image = cv2.imread(file_path)
        
        if image is None:
            raise ProcessingError(f"Could not load image: {file_path}", "IMAGE_LOAD_ERROR")
        
        # Detect document structure
        document_structure = self.image_preprocessor.detect_document_structure(image)
        
        # Enhance image for OCR
        enhanced_image = self.image_preprocessor.enhance_for_ocr(image)
        
        # Step 2: Extract text with OCR
        self._send_progress("Extracting text with modern OCR...")
        ocr_result = self.ocr_engine.extract_text(enhanced_image)
        
        # Convert to transactions
        transactions = []
        if ocr_result.text.strip():
            transactions = self._convert_text_to_transactions(ocr_result.text, ocr_result.confidence)
        
        # Create result object
        class ImageProcessingResult:
            def __init__(self):
                self.success = len(transactions) > 0
                self.transactions = transactions
                self.error_message = None if self.success else "No text found in image"
                self.components_used = ['advanced_image_preprocessor', 'modern_ocr_engine']
                self.preprocessing_applied = True
                self.document_structure = document_structure
                self.tables_found = len(document_structure.table_regions) if document_structure else 0
                self.text_regions_found = len(document_structure.text_regions) if document_structure else 0
                self.fallback_used = False
        
        return ImageProcessingResult()
    
    def _process_excel_strategy(self, file_path: str, strategy: ProcessingStrategy) -> Any:
        """Process Excel/CSV document with structured data pipeline"""
        self.stats['component_usage']['format_processors'] += 1
        
        self._send_progress("Processing Excel/CSV with structured data pipeline...")
        
        # Use Excel processor
        result = self.excel_processor.process_excel(file_path)
        
        # Create result object
        class ExcelProcessingResult:
            def __init__(self):
                self.success = result.success
                self.transactions = result.transactions
                self.error_message = result.error_message
                self.components_used = ['excel_processor']
                self.preprocessing_applied = False
                self.document_structure = None
                self.tables_found = 1 if result.success else 0
                self.text_regions_found = 0
                self.fallback_used = False
        
        return ExcelProcessingResult()
    
    def _process_word_strategy(self, file_path: str, strategy: ProcessingStrategy) -> Any:
        """Process Word document with document extraction pipeline"""
        self.stats['component_usage']['format_processors'] += 1
        
        self._send_progress("Processing Word document with extraction pipeline...")
        
        # Use Word processor
        result = self.word_processor.process_word(file_path)
        
        # Create result object
        class WordProcessingResult:
            def __init__(self):
                self.success = result.success
                self.transactions = result.transactions
                self.error_message = result.error_message
                self.components_used = ['word_processor']
                self.preprocessing_applied = False
                self.document_structure = None
                self.tables_found = len(result.tables) if hasattr(result, 'tables') else 0
                self.text_regions_found = 0
                self.fallback_used = False
        
        return WordProcessingResult()
    
    def _execute_fallback_strategy(self, file_path: str, detected_format: FormatDetectionResult, 
                                 strategy: ProcessingStrategy) -> Any:
        """Execute fallback processing strategy"""
        self.logger.info("Executing fallback strategy")
        
        # For now, implement basic fallback to legacy processing
        # This would integrate with the existing UnifiedPdfProcessor
        try:
            # Import legacy processor
            from ...unified_pdf_processor import UnifiedPdfProcessor
            
            with UnifiedPdfProcessor(self.config_path, self.debug) as legacy_processor:
                legacy_result = legacy_processor.process_document(file_path)
                
                # Convert legacy result to our format
                class FallbackProcessingResult:
                    def __init__(self):
                        self.success = legacy_result.success
                        self.transactions = legacy_result.transactions
                        self.error_message = legacy_result.error_message
                        self.components_used = ['legacy_processor']
                        self.preprocessing_applied = False
                        self.document_structure = None
                        self.tables_found = legacy_result.metadata.get('tables_found', 0)
                        self.text_regions_found = 0
                        self.fallback_used = True
                
                return FallbackProcessingResult()
                
        except Exception as e:
            self.logger.error(f"Fallback strategy also failed: {e}")
            raise ProcessingError(f"All processing strategies failed: {e}", "ALL_STRATEGIES_FAILED")
    
    def _apply_nlp_validation(self, result: Any) -> Any:
        """Apply NLP validation to extracted transactions"""
        self.stats['component_usage']['nlp_validator'] += 1
        
        validated_transactions = []
        
        for transaction in result.transactions:
            try:
                # Validate transaction with NLP
                validation_result = self.nlp_validator.validate_with_context(transaction)
                
                # Update transaction with validation results
                transaction['validation'] = {
                    'is_valid': validation_result.is_valid,
                    'confidence': validation_result.confidence,
                    'quality_score': validation_result.quality_score,
                    'anomalies': validation_result.anomalies,
                    'suggestions': validation_result.suggestions
                }
                
                # Add extracted entities
                if validation_result.entities:
                    transaction['entities'] = [
                        {
                            'text': entity.text,
                            'label': entity.label,
                            'confidence': entity.confidence,
                            'normalized_value': entity.normalized_value
                        }
                        for entity in validation_result.entities
                    ]
                
                # Add transaction type classification
                if validation_result.transaction_type:
                    transaction['transaction_type'] = validation_result.transaction_type
                
                validated_transactions.append(transaction)
                
            except Exception as e:
                self.logger.warning(f"NLP validation failed for transaction: {e}")
                # Keep original transaction if validation fails
                validated_transactions.append(transaction)
        
        # Update result with validated transactions
        result.transactions = validated_transactions
        if not hasattr(result, 'components_used'):
            result.components_used = []
        result.components_used.append('nlp_validator')
        
        return result
    
    def _calculate_comprehensive_quality_metrics(self, result: Any) -> QualityMetrics:
        """Calculate comprehensive quality metrics for the processing result"""
        
        if not result.success or not result.transactions:
            return QualityMetrics(
                overall_confidence=0.0,
                text_quality=0.0,
                table_quality=0.0,
                ocr_quality=0.0,
                validation_score=0.0,
                completeness=0.0,
                consistency=0.0,
                processing_method=getattr(result, 'components_used', ['unknown'])[0],
                component_scores={},
                anomaly_count=0,
                high_confidence_ratio=0.0
            )
        
        # Check if this result comes from the combination system
        if hasattr(result, 'combination_metadata') and result.combination_metadata:
            # Use enhanced quality assessment from combination system
            combo_quality = result.combination_metadata['quality_assessment']
            
            return QualityMetrics(
                overall_confidence=combo_quality.overall_confidence,
                text_quality=combo_quality.field_confidence.get('description', 0.8),
                table_quality=combo_quality.method_scores.get('pdfplumber', 0.0),
                ocr_quality=combo_quality.method_scores.get('easyocr', 0.0),
                validation_score=combo_quality.field_confidence.get('amount', 0.8),
                completeness=combo_quality.completeness_score,
                consistency=combo_quality.consistency_score,
                processing_method='result_combination',
                component_scores=combo_quality.method_scores,
                anomaly_count=int(combo_quality.anomaly_score * len(result.transactions)),
                high_confidence_ratio=combo_quality.reliability_indicators.get('method_agreement', 0.0) / 100.0
            )
        
        # Fallback to original quality calculation for single-method results
        
        # Calculate component-specific scores
        component_scores = {}
        
        # Text quality (based on OCR confidence if available)
        text_quality = 0.8  # Default for non-OCR methods
        if 'modern_ocr_engine' in getattr(result, 'components_used', []):
            # Calculate based on OCR results
            ocr_confidences = []
            for transaction in result.transactions:
                if 'ocr_confidence' in transaction:
                    ocr_confidences.append(transaction['ocr_confidence'])
            text_quality = np.mean(ocr_confidences) if ocr_confidences else 0.5
        component_scores['text_quality'] = text_quality
        
        # Table quality (based on table detection confidence)
        table_quality = 0.0
        if hasattr(result, 'tables_found') and result.tables_found > 0:
            table_quality = 0.9  # High quality for successfully detected tables
        component_scores['table_quality'] = table_quality
        
        # OCR quality
        ocr_quality = text_quality if 'modern_ocr_engine' in getattr(result, 'components_used', []) else 1.0
        component_scores['ocr_quality'] = ocr_quality
        
        # Validation score (based on NLP validation results)
        validation_score = 0.8  # Default
        validation_scores = []
        anomaly_count = 0
        
        for transaction in result.transactions:
            if 'validation' in transaction:
                validation_scores.append(transaction['validation']['quality_score'])
                anomaly_count += len(transaction['validation'].get('anomalies', []))
        
        if validation_scores:
            validation_score = np.mean(validation_scores)
        component_scores['validation_score'] = validation_score
        
        # Completeness (percentage of transactions with all required fields)
        required_fields = ['date', 'amount', 'description']
        complete_transactions = 0
        
        for transaction in result.transactions:
            if all(field in transaction and transaction[field] for field in required_fields):
                complete_transactions += 1
        
        completeness = complete_transactions / len(result.transactions) if result.transactions else 0.0
        
        # Consistency (based on data format consistency)
        consistency = self._calculate_consistency_score(result.transactions)
        
        # High confidence ratio
        high_confidence_transactions = 0
        for transaction in result.transactions:
            transaction_confidence = transaction.get('confidence', 0.5)
            if 'validation' in transaction:
                transaction_confidence = max(transaction_confidence, transaction['validation']['confidence'])
            if transaction_confidence >= 0.8:
                high_confidence_transactions += 1
        
        high_confidence_ratio = high_confidence_transactions / len(result.transactions) if result.transactions else 0.0
        
        # Overall confidence (weighted average)
        weights = {
            'text_quality': 0.25,
            'table_quality': 0.20,
            'ocr_quality': 0.15,
            'validation_score': 0.20,
            'completeness': 0.15,
            'consistency': 0.05
        }
        
        overall_confidence = (
            text_quality * weights['text_quality'] +
            table_quality * weights['table_quality'] +
            ocr_quality * weights['ocr_quality'] +
            validation_score * weights['validation_score'] +
            completeness * weights['completeness'] +
            consistency * weights['consistency']
        )
        
        return QualityMetrics(
            overall_confidence=overall_confidence,
            text_quality=text_quality,
            table_quality=table_quality,
            ocr_quality=ocr_quality,
            validation_score=validation_score,
            completeness=completeness,
            consistency=consistency,
            processing_method=getattr(result, 'components_used', ['unknown'])[0],
            component_scores=component_scores,
            anomaly_count=anomaly_count,
            high_confidence_ratio=high_confidence_ratio
        )
    
    def _calculate_consistency_score(self, transactions: List[Dict]) -> float:
        """Calculate consistency score based on data format patterns"""
        if not transactions:
            return 0.0
        
        # Check date format consistency
        date_formats = set()
        amount_formats = set()
        
        for transaction in transactions:
            if 'date' in transaction and transaction['date']:
                # Simple date format detection
                date_str = str(transaction['date'])
                if '/' in date_str:
                    date_formats.add('slash')
                elif '-' in date_str:
                    date_formats.add('dash')
                else:
                    date_formats.add('other')
            
            if 'amount' in transaction and transaction['amount']:
                # Simple amount format detection
                amount_str = str(transaction['amount'])
                if '$' in amount_str:
                    amount_formats.add('dollar')
                elif '€' in amount_str:
                    amount_formats.add('euro')
                else:
                    amount_formats.add('plain')
        
        # Consistency is higher when fewer format variations are used
        date_consistency = 1.0 / len(date_formats) if date_formats else 1.0
        amount_consistency = 1.0 / len(amount_formats) if amount_formats else 1.0
        
        return (date_consistency + amount_consistency) / 2.0
    
    def _generate_recommendations(self, result: Any, quality_metrics: QualityMetrics, 
                                strategy: ProcessingStrategy) -> List[str]:
        """Generate recommendations for improving processing quality"""
        recommendations = []
        
        # Quality-based recommendations
        if quality_metrics.overall_confidence < 0.7:
            recommendations.append("Consider manual review due to low overall confidence")
        
        if quality_metrics.text_quality < 0.6:
            recommendations.append("Text quality is low - consider image preprocessing or different OCR settings")
        
        if quality_metrics.completeness < 0.8:
            recommendations.append("Some transactions are missing required fields - manual verification recommended")
        
        if quality_metrics.anomaly_count > 0:
            recommendations.append(f"Found {quality_metrics.anomaly_count} anomalies - review flagged transactions")
        
        # Component-specific recommendations
        if 'modern_ocr_engine' in getattr(result, 'components_used', []):
            if quality_metrics.ocr_quality < 0.5:
                recommendations.append("OCR quality is poor - consider higher resolution scan or manual entry")
        
        if hasattr(result, 'fallback_used') and result.fallback_used:
            recommendations.append("Fallback processing was used - results may be less accurate")
        
        # Processing strategy recommendations
        if strategy.format_type == 'pdf' and quality_metrics.table_quality == 0.0:
            recommendations.append("No tables detected in PDF - consider if document contains structured data")
        
        return recommendations
    
    def _convert_table_to_transactions(self, table_df: pd.DataFrame, confidence: float) -> List[Dict]:
        """Convert table DataFrame to transaction format (simplified implementation)"""
        transactions = []
        
        if table_df.empty:
            return transactions
        
        # Simple heuristic to identify transaction columns
        # This would be more sophisticated in a real implementation
        date_col = None
        amount_col = None
        desc_col = None
        
        for col in table_df.columns:
            col_lower = str(col).lower()
            if any(word in col_lower for word in ['date', 'fecha', 'datum']):
                date_col = col
            elif any(word in col_lower for word in ['amount', 'monto', 'importe', 'valor']):
                amount_col = col
            elif any(word in col_lower for word in ['description', 'descripcion', 'concepto', 'detail']):
                desc_col = col
        
        # Convert rows to transactions
        for _, row in table_df.iterrows():
            transaction = {
                'confidence': confidence,
                'extraction_method': 'table_detection'
            }
            
            if date_col and pd.notna(row[date_col]):
                transaction['date'] = str(row[date_col])
            
            if amount_col and pd.notna(row[amount_col]):
                transaction['amount'] = str(row[amount_col])
            
            if desc_col and pd.notna(row[desc_col]):
                transaction['description'] = str(row[desc_col])
            
            # Only add transaction if it has at least one meaningful field
            if any(key in transaction for key in ['date', 'amount', 'description']):
                transactions.append(transaction)
        
        return transactions
    
    def _convert_text_to_transactions(self, text: str, confidence: float) -> List[Dict]:
        """Convert OCR text to transaction format (simplified implementation)"""
        transactions = []
        
        if not text.strip():
            return transactions
        
        # Simple pattern matching for transaction-like data
        # This would be more sophisticated in a real implementation
        lines = text.split('\n')
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Look for patterns that might be transactions
            # This is a very basic implementation
            if any(char.isdigit() for char in line) and len(line) > 10:
                transaction = {
                    'description': line,
                    'confidence': confidence,
                    'extraction_method': 'ocr_text',
                    'raw_text': line
                }
                transactions.append(transaction)
        
        return transactions
    
    def _check_cache(self, file_path: str) -> Optional[EnhancedProcessingResult]:
        """Check if result is cached"""
        if not self.cache:
            return None
        
        file_hash = self._get_file_hash(file_path)
        if file_hash in self.cache:
            cached_result = self.cache[file_hash]
            # Update metadata to indicate cache hit
            cached_result.metadata.recommendations = cached_result.metadata.recommendations or []
            cached_result.metadata.recommendations.append("Result retrieved from cache")
            return cached_result
        
        return None
    
    def _cache_result(self, file_path: str, result: EnhancedProcessingResult):
        """Cache processing result"""
        if not self.cache:
            return
        
        file_hash = self._get_file_hash(file_path)
        
        # Manage cache size
        if len(self.cache) >= self.cache_size_limit:
            # Remove oldest entry (simple FIFO)
            oldest_key = next(iter(self.cache))
            del self.cache[oldest_key]
        
        self.cache[file_hash] = result
    
    def _get_file_hash(self, file_path: str) -> str:
        """Get hash of file for caching"""
        try:
            with open(file_path, 'rb') as f:
                file_content = f.read()
                return hashlib.md5(file_content).hexdigest()
        except Exception:
            # Fallback to path-based hash
            return hashlib.md5(file_path.encode()).hexdigest()
    
    def _get_file_extension(self, filename: str) -> str:
        """Get file extension from filename"""
        return Path(filename).suffix or '.pdf'
    
    def _get_memory_usage(self) -> Optional[Dict]:
        """Get current memory usage"""
        if self.resource_manager:
            return self.resource_manager.get_memory_usage()
        return None
    
    def _send_progress(self, step: str):
        """Send progress update to stdout"""
        progress_msg = {"status": "progress", "step": step}
        print(json.dumps(progress_msg))
        sys.stdout.flush()
        
        if self.debug:
            self.logger.debug(f"Progress: {step}")
    
    def _create_error_result(self, error_message: str, error_code: str = "PROCESSING_ERROR", 
                           details: Dict[str, Any] = None) -> EnhancedProcessingResult:
        """Create a standardized error result"""
        metadata = ProcessingMetadata(
            processing_time=0.0,
            total_transactions=0,
            tables_found=0,
            text_regions_found=0,
            format_detected="unknown",
            strategy_used="none",
            components_used=[],
            preprocessing_applied=False,
            fallback_used=False,
            quality_metrics=QualityMetrics(
                overall_confidence=0.0,
                text_quality=0.0,
                table_quality=0.0,
                ocr_quality=0.0,
                validation_score=0.0,
                completeness=0.0,
                consistency=0.0,
                processing_method="error",
                component_scores={},
                anomaly_count=0,
                high_confidence_ratio=0.0
            ),
            recommendations=[f"Error occurred: {error_code}"]
        )
        
        return EnhancedProcessingResult(
            success=False,
            transactions=[],
            metadata=metadata,
            processing_time=0.0,
            confidence_score=0.0,
            error_message=error_message
        )
    
    def get_supported_formats(self) -> List[str]:
        """Get list of supported document formats"""
        return ['pdf', 'jpg', 'jpeg', 'png', 'tiff', 'bmp', 'xlsx', 'xls', 'csv', 'docx', 'doc']
    
    def get_processing_stats(self) -> Dict[str, Any]:
        """Get comprehensive processing statistics"""
        stats = {
            **self.stats,
            'cache_size': len(self.cache) if self.cache else 0,
            'cache_hit_rate': self.stats['cache_hits'] / max(self.stats['documents_processed'], 1),
            'fallback_rate': self.stats['fallback_used'] / max(self.stats['documents_processed'], 1),
            'average_processing_time': self.stats['total_processing_time'] / max(self.stats['documents_processed'], 1),
            'average_transactions_per_document': self.stats['total_transactions_extracted'] / max(self.stats['documents_processed'], 1)
        }
        
        if self.resource_manager:
            stats['memory_usage'] = self.resource_manager.get_memory_usage()
            stats['tracked_temp_files'] = self.resource_manager.get_tracked_files_count()
        
        return stats
    
    def cleanup_resources(self):
        """Clean up all resources and temporary files"""
        try:
            if self.resource_manager:
                cleaned_files = self.resource_manager.cleanup_all_temp_files()
                self.logger.info(f"Cleaned up {cleaned_files} temporary files")
            
            # Clear cache
            if self.cache:
                self.cache.clear()
                self.logger.info("Cleared processing cache")
                
        except Exception as e:
            self.logger.error(f"Error during resource cleanup: {e}")
    
    def __enter__(self):
        """Context manager entry"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit with automatic cleanup"""
        self.cleanup_resources()


# Convenience functions for backward compatibility
def process_enhanced_document(file_path: str, config_path: Optional[str] = None, 
                            debug: bool = False) -> Dict[str, Any]:
    """
    Convenience function to process a document with enhanced processor.
    
    Args:
        file_path: Path to document file
        config_path: Optional configuration file path
        debug: Enable debug logging
        
    Returns:
        Processing result as dictionary
    """
    with EnhancedDocumentProcessor(config_path, debug) as processor:
        result = processor.process_document(file_path)
        return result.to_dict()


def process_enhanced_buffer(buffer: bytes, filename: str = "document", 
                          config_path: Optional[str] = None, debug: bool = False) -> Dict[str, Any]:
    """
    Convenience function to process a document from memory buffer.
    
    Args:
        buffer: Document content as bytes
        filename: Original filename
        config_path: Optional configuration file path
        debug: Enable debug logging
        
    Returns:
        Processing result as dictionary
    """
    with EnhancedDocumentProcessor(config_path, debug) as processor:
        result = processor.process_from_buffer(buffer, filename)
        return result.to_dict()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Enhanced Document Processor")
    parser.add_argument('file_path', nargs='?', help='Path to document file to process')
    parser.add_argument('--config', type=str, help='Path to configuration file')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    parser.add_argument('--stats', action='store_true', help='Show processing statistics')
    parser.add_argument('--formats', action='store_true', help='Show supported formats')
    parser.add_argument('--stdin', action='store_true', help='Read document from stdin')
    
    args = parser.parse_args()
    
    try:
        with EnhancedDocumentProcessor(args.config, args.debug) as processor:
            if args.formats:
                print("Supported formats:")
                for fmt in processor.get_supported_formats():
                    print(f"  - {fmt}")
                sys.exit(0)
            
            result = None
            
            if args.stdin:
                # Read from stdin
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(sys.stdin.buffer.read())
                    temp_path = tmp.name
                
                try:
                    result = processor.process_document(temp_path)
                finally:
                    try:
                        os.unlink(temp_path)
                    except:
                        pass
            elif args.file_path:
                # Direct file processing
                result = processor.process_document(args.file_path)
            else:
                raise ValueError("Must specify a document file path or use --stdin")
            
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
            "meta": {},
            "confidence_score": 0.0,
            "provider": "enhanced_document_processor"
        }
        print("___RESULT_START___")
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
        print("___RESULT_END___")
        sys.exit(1)