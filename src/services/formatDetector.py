#!/usr/bin/env python3
"""
Format Detection System

This module implements automatic document type identification for banking documents,
determining the optimal processing strategy based on file format and content analysis.
"""

import logging
import os
import mimetypes
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from pathlib import Path
# Try to import magic, but don't fail if not available
try:
    import magic
    MAGIC_AVAILABLE = True
except ImportError:
    MAGIC_AVAILABLE = False
    magic = None
import re

# Import processors for validation
try:
    from .excelProcessor import ExcelProcessor
    from .wordProcessor import WordProcessor
    PROCESSORS_AVAILABLE = True
except ImportError:
    PROCESSORS_AVAILABLE = False


@dataclass
class FormatDetectionResult:
    """Result of format detection analysis"""
    detected_format: str
    confidence: float
    mime_type: str
    file_extension: str
    recommended_processor: str
    content_analysis: Dict[str, Any]
    processing_strategy: str
    metadata: Dict[str, Any]


class FormatDetector:
    """
    Automatic document format detection system that identifies document types
    and recommends optimal processing strategies for banking documents.
    """
    
    def __init__(self, debug: bool = False):
        """
        Initialize the Format Detector.
        
        Args:
            debug: Enable debug logging
        """
        self.debug = debug
        self.logger = self._setup_logger()
        
        # Supported formats and their characteristics
        self.format_definitions = {
            'pdf': {
                'extensions': ['.pdf'],
                'mime_types': ['application/pdf'],
                'magic_signatures': [b'%PDF'],
                'processor': 'enhanced_document_processor',
                'strategy': 'pdf_processing',
                'confidence_base': 0.9
            },
            'excel': {
                'extensions': ['.xlsx', '.xls'],
                'mime_types': [
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.ms-excel'
                ],
                'magic_signatures': [b'PK\x03\x04', b'\xd0\xcf\x11\xe0'],
                'processor': 'excel_processor',
                'strategy': 'structured_data_processing',
                'confidence_base': 0.95
            },
            'csv': {
                'extensions': ['.csv'],
                'mime_types': ['text/csv', 'application/csv'],
                'magic_signatures': [],
                'processor': 'excel_processor',
                'strategy': 'csv_processing',
                'confidence_base': 0.8
            },
            'word': {
                'extensions': ['.docx', '.doc'],
                'mime_types': [
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/msword'
                ],
                'magic_signatures': [b'PK\x03\x04', b'\xd0\xcf\x11\xe0'],
                'processor': 'word_processor',
                'strategy': 'document_processing',
                'confidence_base': 0.85
            },
            'image': {
                'extensions': ['.png', '.jpg', '.jpeg', '.tiff', '.bmp'],
                'mime_types': ['image/png', 'image/jpeg', 'image/tiff', 'image/bmp'],
                'magic_signatures': [b'\x89PNG', b'\xff\xd8\xff', b'II*\x00', b'MM\x00*', b'BM'],
                'processor': 'enhanced_document_processor',
                'strategy': 'image_processing',
                'confidence_base': 0.9
            },
            'text': {
                'extensions': ['.txt'],
                'mime_types': ['text/plain'],
                'magic_signatures': [],
                'processor': 'text_processor',
                'strategy': 'text_processing',
                'confidence_base': 0.6
            }
        }
        
        # Banking content indicators
        self.banking_indicators = {
            'keywords': [
                # Spanish banking terms
                r'\b(?:banco|bank|cuenta|account|saldo|balance|transferencia|transfer)\b',
                r'\b(?:débito|debit|crédito|credit|pago|payment|cargo|charge)\b',
                r'\b(?:extracto|statement|movimiento|movement|transacción|transaction)\b',
                r'\b(?:cajero|atm|comisión|fee|interés|interest)\b',
                # Bank names (common Spanish banks)
                r'\b(?:bbva|santander|caixabank|bankia|sabadell|bankinter|unicaja|kutxabank)\b',
                r'\b(?:ing|openbank|evo|pibank|wizink|revolut|n26)\b'
            ],
            'patterns': [
                # Account numbers
                r'\b\d{4}[\s-]?\d{4}[\s-]?\d{2}[\s-]?\d{10}\b',  # IBAN-like
                r'\b[A-Z]{2}\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{2}[\s-]?\d{10}\b',  # Full IBAN
                # Amounts
                r'[-+]?\$?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?',
                r'[-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*€',
                # Dates
                r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b',
                r'\b\d{2,4}[/-]\d{1,2}[/-]\d{1,2}\b'
            ]
        }
        
        # Initialize magic library for file type detection
        if MAGIC_AVAILABLE:
            try:
                self.magic_mime = magic.Magic(mime=True)
                self.magic_available = True
            except Exception as e:
                self.logger.warning(f"python-magic not available: {e}")
                self.magic_available = False
        else:
            self.magic_available = False
        
        self.logger.info("FormatDetector initialized")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.FormatDetector")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def detect_format(self, file_path: str) -> FormatDetectionResult:
        """
        Detect document format and recommend processing strategy.
        
        Args:
            file_path: Path to the document file
            
        Returns:
            FormatDetectionResult with detection results and recommendations
        """
        if not Path(file_path).exists():
            return FormatDetectionResult(
                detected_format='unknown',
                confidence=0.0,
                mime_type='unknown',
                file_extension='',
                recommended_processor='none',
                content_analysis={'error': 'File not found'},
                processing_strategy='none',
                metadata={'error': f'File not found: {file_path}'}
            )
        
        try:
            self.logger.info(f"Detecting format for: {file_path}")
            
            # Get basic file information
            file_path_obj = Path(file_path)
            file_extension = file_path_obj.suffix.lower()
            file_size = file_path_obj.stat().st_size
            
            # Detect MIME type
            mime_type = self._detect_mime_type(file_path)
            
            # Analyze file signature
            file_signature = self._read_file_signature(file_path)
            
            # Score each format
            format_scores = {}
            for format_name, format_def in self.format_definitions.items():
                score = self._score_format_match(
                    format_name, format_def, file_extension, mime_type, file_signature
                )
                format_scores[format_name] = score
            
            # Get best match
            best_format = max(format_scores.items(), key=lambda x: x[1])
            detected_format = best_format[0]
            base_confidence = best_format[1]
            
            # Analyze content for banking indicators (if possible)
            content_analysis = self._analyze_content_for_banking(file_path, detected_format)
            
            # Adjust confidence based on content analysis
            final_confidence = self._calculate_final_confidence(
                base_confidence, content_analysis, detected_format
            )
            
            # Get processing recommendations
            format_def = self.format_definitions[detected_format]
            recommended_processor = format_def['processor']
            processing_strategy = format_def['strategy']
            
            # Compile metadata
            metadata = {
                'file_size': file_size,
                'file_name': file_path_obj.name,
                'format_scores': format_scores,
                'signature_detected': file_signature[:10].hex() if file_signature else None,
                'magic_available': self.magic_available,
                'content_indicators': content_analysis.get('banking_score', 0),
                'processing_complexity': self._estimate_processing_complexity(detected_format, file_size)
            }
            
            result = FormatDetectionResult(
                detected_format=detected_format,
                confidence=final_confidence,
                mime_type=mime_type,
                file_extension=file_extension,
                recommended_processor=recommended_processor,
                content_analysis=content_analysis,
                processing_strategy=processing_strategy,
                metadata=metadata
            )
            
            self.logger.info(
                f"Format detection completed: {detected_format} "
                f"(confidence: {final_confidence:.2f}, processor: {recommended_processor})"
            )
            
            return result
            
        except Exception as e:
            error_msg = f"Format detection failed: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            return FormatDetectionResult(
                detected_format='unknown',
                confidence=0.0,
                mime_type='unknown',
                file_extension=file_extension if 'file_extension' in locals() else '',
                recommended_processor='none',
                content_analysis={'error': error_msg},
                processing_strategy='none',
                metadata={'error': error_msg}
            )
    
    def _detect_mime_type(self, file_path: str) -> str:
        """Detect MIME type using multiple methods"""
        mime_type = 'unknown'
        
        # Try python-magic first (most accurate)
        if self.magic_available:
            try:
                mime_type = self.magic_mime.from_file(file_path)
                self.logger.debug(f"Magic MIME type: {mime_type}")
                return mime_type
            except Exception as e:
                self.logger.debug(f"Magic MIME detection failed: {e}")
        
        # Fallback to mimetypes module
        try:
            mime_type, _ = mimetypes.guess_type(file_path)
            if mime_type:
                self.logger.debug(f"Mimetypes MIME type: {mime_type}")
                return mime_type
        except Exception as e:
            self.logger.debug(f"Mimetypes detection failed: {e}")
        
        return 'unknown'
    
    def _read_file_signature(self, file_path: str, max_bytes: int = 512) -> bytes:
        """Read file signature (magic bytes) from beginning of file"""
        try:
            with open(file_path, 'rb') as f:
                return f.read(max_bytes)
        except Exception as e:
            self.logger.debug(f"Failed to read file signature: {e}")
            return b''
    
    def _score_format_match(self, format_name: str, format_def: Dict, 
                           file_extension: str, mime_type: str, file_signature: bytes) -> float:
        """Score how well a format matches the file characteristics"""
        score = 0.0
        
        # Extension match (30% weight)
        if file_extension in format_def['extensions']:
            score += 0.3
        
        # MIME type match (40% weight)
        if mime_type in format_def['mime_types']:
            score += 0.4
        elif mime_type != 'unknown':
            # Partial match for similar MIME types
            for expected_mime in format_def['mime_types']:
                if expected_mime.split('/')[0] == mime_type.split('/')[0]:
                    score += 0.2
                    break
        
        # File signature match (30% weight)
        if format_def['magic_signatures'] and file_signature:
            for signature in format_def['magic_signatures']:
                if file_signature.startswith(signature):
                    score += 0.3
                    break
        
        # Apply base confidence
        score *= format_def['confidence_base']
        
        return min(score, 1.0)
    
    def _analyze_content_for_banking(self, file_path: str, detected_format: str) -> Dict[str, Any]:
        """Analyze file content for banking-related indicators"""
        analysis = {
            'banking_score': 0.0,
            'keyword_matches': 0,
            'pattern_matches': 0,
            'content_sample': '',
            'analysis_method': 'none'
        }
        
        try:
            # Different analysis methods based on format
            if detected_format == 'text' or detected_format == 'csv':
                analysis = self._analyze_text_content(file_path)
            elif detected_format == 'pdf':
                analysis = self._analyze_pdf_content(file_path)
            elif detected_format in ['excel', 'word']:
                analysis = self._analyze_structured_content(file_path, detected_format)
            else:
                analysis['analysis_method'] = 'skipped_binary'
            
        except Exception as e:
            self.logger.debug(f"Content analysis failed: {e}")
            analysis['error'] = str(e)
        
        return analysis
    
    def _analyze_text_content(self, file_path: str) -> Dict[str, Any]:
        """Analyze plain text or CSV content for banking indicators"""
        analysis = {
            'banking_score': 0.0,
            'keyword_matches': 0,
            'pattern_matches': 0,
            'content_sample': '',
            'analysis_method': 'text'
        }
        
        try:
            # Read first few KB of text
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read(8192)  # Read first 8KB
            
            analysis['content_sample'] = content[:500]  # Store sample
            content_lower = content.lower()
            
            # Count banking keywords
            keyword_count = 0
            for pattern in self.banking_indicators['keywords']:
                matches = re.findall(pattern, content_lower, re.IGNORECASE)
                keyword_count += len(matches)
            
            analysis['keyword_matches'] = keyword_count
            
            # Count banking patterns
            pattern_count = 0
            for pattern in self.banking_indicators['patterns']:
                matches = re.findall(pattern, content, re.IGNORECASE)
                pattern_count += len(matches)
            
            analysis['pattern_matches'] = pattern_count
            
            # Calculate banking score
            content_length = len(content)
            if content_length > 0:
                keyword_density = keyword_count / (content_length / 100)  # Per 100 chars
                pattern_density = pattern_count / (content_length / 100)
                
                banking_score = min((keyword_density * 0.6) + (pattern_density * 0.4), 1.0)
                analysis['banking_score'] = banking_score
            
        except Exception as e:
            analysis['error'] = str(e)
        
        return analysis
    
    def _analyze_pdf_content(self, file_path: str) -> Dict[str, Any]:
        """Analyze PDF content for banking indicators"""
        analysis = {
            'banking_score': 0.0,
            'keyword_matches': 0,
            'pattern_matches': 0,
            'content_sample': '',
            'analysis_method': 'pdf_text_extraction'
        }
        
        try:
            # Try to extract text from PDF for analysis
            import fitz  # PyMuPDF
            
            doc = fitz.open(file_path)
            text_content = ""
            
            # Extract text from first few pages
            max_pages = min(3, len(doc))
            for page_num in range(max_pages):
                page = doc.load_page(page_num)
                text_content += page.get_text()
            
            doc.close()
            
            if text_content:
                analysis['content_sample'] = text_content[:500]
                
                # Analyze extracted text similar to text content
                content_lower = text_content.lower()
                
                keyword_count = 0
                for pattern in self.banking_indicators['keywords']:
                    matches = re.findall(pattern, content_lower, re.IGNORECASE)
                    keyword_count += len(matches)
                
                pattern_count = 0
                for pattern in self.banking_indicators['patterns']:
                    matches = re.findall(pattern, text_content, re.IGNORECASE)
                    pattern_count += len(matches)
                
                analysis['keyword_matches'] = keyword_count
                analysis['pattern_matches'] = pattern_count
                
                # Calculate banking score
                if len(text_content) > 0:
                    keyword_density = keyword_count / (len(text_content) / 100)
                    pattern_density = pattern_count / (len(text_content) / 100)
                    banking_score = min((keyword_density * 0.6) + (pattern_density * 0.4), 1.0)
                    analysis['banking_score'] = banking_score
            
        except ImportError:
            analysis['error'] = 'PyMuPDF not available for PDF analysis'
        except Exception as e:
            analysis['error'] = str(e)
        
        return analysis
    
    def _analyze_structured_content(self, file_path: str, format_type: str) -> Dict[str, Any]:
        """Analyze structured documents (Excel, Word) for banking indicators"""
        analysis = {
            'banking_score': 0.0,
            'keyword_matches': 0,
            'pattern_matches': 0,
            'content_sample': '',
            'analysis_method': f'{format_type}_structure'
        }
        
        try:
            if format_type == 'excel' and PROCESSORS_AVAILABLE:
                # Use Excel processor for quick analysis
                processor = ExcelProcessor(debug=False)
                if file_path.endswith('.csv'):
                    result = processor.process_csv(file_path)
                else:
                    result = processor.process_excel(file_path)
                
                if result.success:
                    analysis['banking_score'] = 0.8  # High score for successful Excel processing
                    analysis['keyword_matches'] = len(result.transactions)
                    analysis['analysis_method'] = 'excel_processor_validation'
            
            elif format_type == 'word' and PROCESSORS_AVAILABLE:
                # Use Word processor for quick analysis
                processor = WordProcessor(debug=False)
                result = processor.process_word(file_path)
                
                if result.success:
                    banking_keywords = result.metadata.get('banking_keywords_found', 0)
                    analysis['banking_score'] = min(banking_keywords / 10, 1.0)  # Normalize
                    analysis['keyword_matches'] = banking_keywords
                    analysis['analysis_method'] = 'word_processor_validation'
            
        except Exception as e:
            analysis['error'] = str(e)
        
        return analysis
    
    def _calculate_final_confidence(self, base_confidence: float, 
                                  content_analysis: Dict[str, Any], 
                                  detected_format: str) -> float:
        """Calculate final confidence score combining format detection and content analysis"""
        
        # Start with base confidence from format detection
        final_confidence = base_confidence
        
        # Adjust based on banking content analysis
        banking_score = content_analysis.get('banking_score', 0.0)
        
        if banking_score > 0:
            # Boost confidence for documents with banking content
            confidence_boost = banking_score * 0.2  # Up to 20% boost
            final_confidence = min(final_confidence + confidence_boost, 1.0)
        
        # Penalty for analysis errors
        if 'error' in content_analysis:
            final_confidence *= 0.9  # Small penalty for analysis issues
        
        # Format-specific adjustments
        if detected_format == 'csv' and banking_score > 0.5:
            final_confidence = min(final_confidence + 0.1, 1.0)  # CSV with banking data is very reliable
        
        return final_confidence
    
    def _estimate_processing_complexity(self, format_type: str, file_size: int) -> str:
        """Estimate processing complexity based on format and size"""
        
        # Size categories (in bytes)
        if file_size < 1024 * 1024:  # < 1MB
            size_category = 'small'
        elif file_size < 10 * 1024 * 1024:  # < 10MB
            size_category = 'medium'
        else:
            size_category = 'large'
        
        # Complexity by format
        format_complexity = {
            'csv': 'low',
            'excel': 'low',
            'text': 'low',
            'word': 'medium',
            'pdf': 'high',
            'image': 'high'
        }
        
        base_complexity = format_complexity.get(format_type, 'medium')
        
        # Adjust for size
        if size_category == 'large':
            if base_complexity == 'low':
                return 'medium'
            elif base_complexity == 'medium':
                return 'high'
            else:
                return 'very_high'
        
        return base_complexity
    
    def get_supported_formats(self) -> List[str]:
        """Get list of all supported formats"""
        return list(self.format_definitions.keys())
    
    def get_format_info(self, format_name: str) -> Optional[Dict[str, Any]]:
        """Get detailed information about a specific format"""
        return self.format_definitions.get(format_name)
    
    def validate_format_support(self, file_path: str) -> bool:
        """Check if file format is supported for processing"""
        detection_result = self.detect_format(file_path)
        return (detection_result.confidence > 0.5 and 
                detection_result.detected_format != 'unknown')
    
    def recommend_processing_order(self, file_paths: List[str]) -> List[Tuple[str, str, float]]:
        """
        Recommend processing order for multiple files based on complexity and confidence.
        
        Args:
            file_paths: List of file paths to analyze
            
        Returns:
            List of tuples (file_path, recommended_processor, confidence) sorted by processing priority
        """
        file_analyses = []
        
        for file_path in file_paths:
            detection_result = self.detect_format(file_path)
            
            # Calculate priority score (higher = process first)
            priority_score = detection_result.confidence
            
            # Boost priority for simpler formats
            complexity = detection_result.metadata.get('processing_complexity', 'medium')
            complexity_boost = {'low': 0.3, 'medium': 0.1, 'high': 0.0, 'very_high': -0.1}
            priority_score += complexity_boost.get(complexity, 0.0)
            
            # Boost priority for high banking content
            banking_score = detection_result.content_analysis.get('banking_score', 0.0)
            priority_score += banking_score * 0.2
            
            file_analyses.append((
                file_path,
                detection_result.recommended_processor,
                detection_result.confidence,
                priority_score
            ))
        
        # Sort by priority score (descending)
        file_analyses.sort(key=lambda x: x[3], reverse=True)
        
        # Return without priority score
        return [(path, processor, confidence) for path, processor, confidence, _ in file_analyses]