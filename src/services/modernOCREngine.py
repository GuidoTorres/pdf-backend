#!/usr/bin/env python3
"""
Modern OCR Engine using EasyOCR

This module implements a modern OCR system using EasyOCR to replace Tesseract
functionality with improved accuracy, multi-language support, and GPU acceleration.
"""

import logging
import time
import os
from typing import List, Dict, Optional, Tuple, Any, Union
from dataclasses import dataclass
import numpy as np
import cv2
from pathlib import Path
import tempfile

# EasyOCR imports
try:
    import easyocr
    EASYOCR_AVAILABLE = True
except ImportError:
    EASYOCR_AVAILABLE = False

# PDF processing imports
try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False


@dataclass
class OCRResult:
    """Result structure for OCR extraction"""
    text: str
    confidence: float
    bounding_boxes: List[Tuple[List[List[int]], str, float]]  # EasyOCR format: [bbox, text, confidence]
    processing_time: float
    method_used: str
    language_detected: Optional[str] = None
    quality_metrics: Dict[str, float] = None


@dataclass
class OCRExtractionResult:
    """Complete result of OCR extraction process"""
    success: bool
    text: str
    confidence: float
    results_by_page: List[OCRResult]
    total_pages: int
    processing_time: float
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = None


class ModernOCREngine:
    """
    Modern OCR engine using EasyOCR with GPU support, multi-language configuration,
    confidence filtering, and text quality assessment.
    """
    
    def __init__(self, languages: List[str] = None, gpu: bool = True, debug: bool = False):
        """
        Initialize the Modern OCR Engine.
        
        Args:
            languages: List of language codes (default: ['en', 'es'])
            gpu: Enable GPU acceleration if available
            debug: Enable debug logging
        """
        self.languages = languages or ['en', 'es']
        self.gpu = gpu
        self.debug = debug
        self.logger = self._setup_logger()
        
        # Initialize EasyOCR reader
        self.reader = None
        self._initialize_reader()
        
        # Quality thresholds
        self.quality_thresholds = {
            'min_confidence': 0.5,
            'min_text_length': 2,
            'min_word_confidence': 0.3,
            'high_confidence_threshold': 0.8,
            'very_high_confidence_threshold': 0.9
        }
        
        # Image preprocessing settings
        self.preprocessing_settings = {
            'enhance_contrast': True,
            'denoise': True,
            'sharpen': True,
            'binarize': True,
            'resize_factor': 2.0,  # Upscale for better OCR
            'dpi_target': 300
        }
        
        self.logger.info(f"ModernOCREngine initialized with languages: {self.languages}, GPU: {self.gpu}")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.ModernOCREngine")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def _initialize_reader(self):
        """Initialize EasyOCR reader with error handling"""
        if not EASYOCR_AVAILABLE:
            self.logger.error("EasyOCR not available. Please install with: pip install easyocr")
            return
        
        try:
            self.logger.info(f"Initializing EasyOCR reader with languages: {self.languages}")
            self.reader = easyocr.Reader(
                self.languages, 
                gpu=self.gpu,
                verbose=self.debug
            )
            self.logger.info("EasyOCR reader initialized successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to initialize EasyOCR reader: {e}")
            if self.gpu:
                self.logger.info("Retrying without GPU...")
                try:
                    self.reader = easyocr.Reader(self.languages, gpu=False, verbose=self.debug)
                    self.gpu = False
                    self.logger.info("EasyOCR reader initialized without GPU")
                except Exception as e2:
                    self.logger.error(f"Failed to initialize EasyOCR reader without GPU: {e2}")
                    self.reader = None
    
    def extract_text(self, image: np.ndarray) -> OCRResult:
        """
        Extract text from a single image using EasyOCR.
        
        Args:
            image: Input image as numpy array
            
        Returns:
            OCRResult with extracted text and confidence metrics
        """
        if self.reader is None:
            return OCRResult(
                text="",
                confidence=0.0,
                bounding_boxes=[],
                processing_time=0.0,
                method_used="easyocr_failed",
                quality_metrics={'error': 'Reader not initialized'}
            )
        
        start_time = time.time()
        
        try:
            # Preprocess image for better OCR
            processed_image = self._preprocess_image(image)
            
            # Extract text with EasyOCR
            results = self.reader.readtext(processed_image)
            
            # Process results
            text_parts = []
            total_confidence = 0.0
            valid_results = []
            
            for bbox, text, confidence in results:
                # Filter by confidence and text length
                if (confidence >= self.quality_thresholds['min_word_confidence'] and 
                    len(text.strip()) >= self.quality_thresholds['min_text_length']):
                    text_parts.append(text)
                    total_confidence += confidence
                    valid_results.append((bbox, text, confidence))
            
            # Combine text and calculate overall confidence
            combined_text = ' '.join(text_parts)
            overall_confidence = total_confidence / len(valid_results) if valid_results else 0.0
            
            processing_time = time.time() - start_time
            
            # Calculate quality metrics
            quality_metrics = self._calculate_quality_metrics(valid_results, processed_image)
            
            # Detect primary language
            detected_language = self._detect_primary_language(combined_text)
            
            return OCRResult(
                text=combined_text,
                confidence=overall_confidence,
                bounding_boxes=valid_results,
                processing_time=processing_time,
                method_used="easyocr",
                language_detected=detected_language,
                quality_metrics=quality_metrics
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            self.logger.error(f"OCR extraction failed: {e}", exc_info=True)
            
            return OCRResult(
                text="",
                confidence=0.0,
                bounding_boxes=[],
                processing_time=processing_time,
                method_used="easyocr_error",
                quality_metrics={'error': str(e)}
            )
    
    def extract_with_confidence(self, image: np.ndarray) -> OCRResult:
        """
        Extract text with enhanced confidence filtering and quality assessment.
        
        Args:
            image: Input image as numpy array
            
        Returns:
            OCRResult with high-confidence text only
        """
        # Get full OCR result
        full_result = self.extract_text(image)
        
        if not full_result.bounding_boxes:
            return full_result
        
        # Filter for high confidence results only
        high_confidence_results = [
            (bbox, text, conf) for bbox, text, conf in full_result.bounding_boxes
            if conf >= self.quality_thresholds['min_confidence']
        ]
        
        # Recombine high confidence text
        high_confidence_text = ' '.join([text for _, text, _ in high_confidence_results])
        
        # Recalculate confidence
        if high_confidence_results:
            avg_confidence = np.mean([conf for _, _, conf in high_confidence_results])
        else:
            avg_confidence = 0.0
        
        # Update quality metrics
        quality_metrics = full_result.quality_metrics.copy()
        quality_metrics.update({
            'high_confidence_words': len(high_confidence_results),
            'total_words': len(full_result.bounding_boxes),
            'confidence_filter_ratio': len(high_confidence_results) / len(full_result.bounding_boxes)
        })
        
        return OCRResult(
            text=high_confidence_text,
            confidence=avg_confidence,
            bounding_boxes=high_confidence_results,
            processing_time=full_result.processing_time,
            method_used="easyocr_filtered",
            language_detected=full_result.language_detected,
            quality_metrics=quality_metrics
        )
    
    def extract_from_pdf_page(self, pdf_path: str, page_num: int) -> OCRResult:
        """
        Extract text from a specific PDF page using OCR.
        
        Args:
            pdf_path: Path to PDF file
            page_num: Page number (0-indexed)
            
        Returns:
            OCRResult for the specified page
        """
        if not PYMUPDF_AVAILABLE:
            return OCRResult(
                text="",
                confidence=0.0,
                bounding_boxes=[],
                processing_time=0.0,
                method_used="pymupdf_unavailable",
                quality_metrics={'error': 'PyMuPDF not available'}
            )
        
        try:
            # Convert PDF page to image
            doc = fitz.open(pdf_path)
            
            if page_num >= len(doc):
                doc.close()
                return OCRResult(
                    text="",
                    confidence=0.0,
                    bounding_boxes=[],
                    processing_time=0.0,
                    method_used="invalid_page",
                    quality_metrics={'error': f'Page {page_num} not found'}
                )
            
            page = doc.load_page(page_num)
            
            # Render page as image with high DPI for better OCR
            mat = fitz.Matrix(2.0, 2.0)  # 2x zoom for better quality
            pix = page.get_pixmap(matrix=mat)
            img_data = pix.tobytes("png")
            
            doc.close()
            
            # Convert to numpy array
            nparr = np.frombuffer(img_data, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            # Extract text using OCR
            result = self.extract_with_confidence(image)
            result.quality_metrics['pdf_page'] = page_num
            result.quality_metrics['pdf_source'] = os.path.basename(pdf_path)
            
            return result
            
        except Exception as e:
            self.logger.error(f"PDF page OCR failed: {e}", exc_info=True)
            return OCRResult(
                text="",
                confidence=0.0,
                bounding_boxes=[],
                processing_time=0.0,
                method_used="pdf_ocr_error",
                quality_metrics={'error': str(e)}
            )
    
    def extract_from_pdf(self, pdf_path: str, pages: Optional[List[int]] = None) -> OCRExtractionResult:
        """
        Extract text from PDF using OCR on all or specified pages.
        
        Args:
            pdf_path: Path to PDF file
            pages: List of page numbers to process (0-indexed), None for all pages
            
        Returns:
            OCRExtractionResult with results from all processed pages
        """
        if not Path(pdf_path).exists():
            return OCRExtractionResult(
                success=False,
                text="",
                confidence=0.0,
                results_by_page=[],
                total_pages=0,
                processing_time=0.0,
                error_message=f"PDF file not found: {pdf_path}"
            )
        
        start_time = time.time()
        
        try:
            # Get total pages
            doc = fitz.open(pdf_path)
            total_pages = len(doc)
            doc.close()
            
            # Determine pages to process
            if pages is None:
                pages_to_process = list(range(total_pages))
            else:
                pages_to_process = [p for p in pages if 0 <= p < total_pages]
            
            self.logger.info(f"Processing {len(pages_to_process)} pages from {pdf_path}")
            
            # Process each page
            page_results = []
            all_text_parts = []
            all_confidences = []
            
            for page_num in pages_to_process:
                self.logger.debug(f"Processing page {page_num + 1}/{total_pages}")
                
                page_result = self.extract_from_pdf_page(pdf_path, page_num)
                page_results.append(page_result)
                
                if page_result.text.strip():
                    all_text_parts.append(page_result.text)
                    all_confidences.append(page_result.confidence)
            
            # Combine results
            combined_text = '\n\n'.join(all_text_parts)
            overall_confidence = np.mean(all_confidences) if all_confidences else 0.0
            processing_time = time.time() - start_time
            
            # Calculate metadata
            successful_pages = sum(1 for r in page_results if r.confidence > 0)
            total_words = sum(len(r.bounding_boxes) for r in page_results)
            high_confidence_words = sum(
                len([bbox for bbox, text, conf in r.bounding_boxes 
                     if conf >= self.quality_thresholds['high_confidence_threshold']])
                for r in page_results
            )
            
            metadata = {
                'total_pages': total_pages,
                'processed_pages': len(pages_to_process),
                'successful_pages': successful_pages,
                'success_rate': successful_pages / len(pages_to_process) if pages_to_process else 0,
                'total_words_detected': total_words,
                'high_confidence_words': high_confidence_words,
                'average_page_confidence': overall_confidence,
                'languages_detected': list(set(r.language_detected for r in page_results if r.language_detected)),
                'processing_time_per_page': processing_time / len(pages_to_process) if pages_to_process else 0
            }
            
            return OCRExtractionResult(
                success=len(all_text_parts) > 0,
                text=combined_text,
                confidence=overall_confidence,
                results_by_page=page_results,
                total_pages=total_pages,
                processing_time=processing_time,
                metadata=metadata
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_msg = f"PDF OCR extraction failed: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            return OCRExtractionResult(
                success=False,
                text="",
                confidence=0.0,
                results_by_page=[],
                total_pages=0,
                processing_time=processing_time,
                error_message=error_msg
            )
    
    def _preprocess_image(self, image: np.ndarray) -> np.ndarray:
        """
        Preprocess image for optimal OCR performance.
        
        Args:
            image: Input image
            
        Returns:
            Preprocessed image
        """
        try:
            processed = image.copy()
            
            # Convert to grayscale if needed
            if len(processed.shape) == 3:
                processed = cv2.cvtColor(processed, cv2.COLOR_BGR2GRAY)
            
            # Resize image for better OCR (upscale small images)
            height, width = processed.shape
            if height < 300 or width < 300:
                scale_factor = max(300 / height, 300 / width)
                new_width = int(width * scale_factor)
                new_height = int(height * scale_factor)
                processed = cv2.resize(processed, (new_width, new_height), interpolation=cv2.INTER_CUBIC)
            
            # Apply preprocessing based on settings
            if self.preprocessing_settings['denoise']:
                processed = cv2.fastNlMeansDenoising(processed)
            
            if self.preprocessing_settings['enhance_contrast']:
                # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                processed = clahe.apply(processed)
            
            if self.preprocessing_settings['sharpen']:
                # Apply sharpening kernel
                kernel = np.array([[-1, -1, -1],
                                 [-1,  9, -1],
                                 [-1, -1, -1]])
                processed = cv2.filter2D(processed, -1, kernel)
            
            if self.preprocessing_settings['binarize']:
                # Apply adaptive thresholding for better text extraction
                processed = cv2.adaptiveThreshold(
                    processed, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                    cv2.THRESH_BINARY, 11, 2
                )
            
            return processed
            
        except Exception as e:
            self.logger.warning(f"Image preprocessing failed: {e}")
            return image
    
    def _calculate_quality_metrics(self, results: List[Tuple], image: np.ndarray) -> Dict[str, float]:
        """
        Calculate quality metrics for OCR results.
        
        Args:
            results: List of (bbox, text, confidence) tuples
            image: Processed image
            
        Returns:
            Dictionary of quality metrics
        """
        if not results:
            return {
                'word_count': 0,
                'average_confidence': 0.0,
                'high_confidence_ratio': 0.0,
                'text_density': 0.0,
                'image_quality_score': 0.0
            }
        
        # Basic metrics
        word_count = len(results)
        confidences = [conf for _, _, conf in results]
        average_confidence = np.mean(confidences)
        
        # High confidence ratio
        high_confidence_count = sum(1 for conf in confidences 
                                  if conf >= self.quality_thresholds['high_confidence_threshold'])
        high_confidence_ratio = high_confidence_count / word_count
        
        # Text density (coverage of image)
        image_area = image.shape[0] * image.shape[1]
        text_area = 0
        for bbox, _, _ in results:
            # Calculate bounding box area
            bbox_array = np.array(bbox)
            x_coords = bbox_array[:, 0]
            y_coords = bbox_array[:, 1]
            width = max(x_coords) - min(x_coords)
            height = max(y_coords) - min(y_coords)
            text_area += width * height
        
        text_density = text_area / image_area if image_area > 0 else 0.0
        
        # Image quality score (based on contrast and sharpness)
        image_quality_score = self._calculate_image_quality(image)
        
        # Character-level metrics
        total_chars = sum(len(text) for _, text, _ in results)
        avg_word_length = total_chars / word_count if word_count > 0 else 0
        
        # Language consistency (if multiple languages detected)
        detected_languages = set()
        for _, text, _ in results:
            lang = self._detect_text_language(text)
            if lang:
                detected_languages.add(lang)
        
        return {
            'word_count': word_count,
            'character_count': total_chars,
            'average_confidence': average_confidence,
            'confidence_std': np.std(confidences),
            'high_confidence_ratio': high_confidence_ratio,
            'very_high_confidence_ratio': sum(1 for conf in confidences 
                                            if conf >= self.quality_thresholds['very_high_confidence_threshold']) / word_count,
            'text_density': text_density,
            'image_quality_score': image_quality_score,
            'average_word_length': avg_word_length,
            'languages_detected': len(detected_languages),
            'min_confidence': min(confidences),
            'max_confidence': max(confidences)
        }
    
    def _calculate_image_quality(self, image: np.ndarray) -> float:
        """
        Calculate image quality score based on contrast and sharpness.
        
        Args:
            image: Input image (grayscale)
            
        Returns:
            Quality score between 0 and 1
        """
        try:
            # Calculate contrast (standard deviation of pixel intensities)
            contrast = np.std(image) / 255.0
            
            # Calculate sharpness using Laplacian variance
            laplacian = cv2.Laplacian(image, cv2.CV_64F)
            sharpness = np.var(laplacian) / 10000.0  # Normalize
            
            # Combine metrics (weighted average)
            quality_score = 0.6 * min(contrast, 1.0) + 0.4 * min(sharpness, 1.0)
            
            return min(quality_score, 1.0)
            
        except Exception:
            return 0.5  # Default moderate quality
    
    def _detect_primary_language(self, text: str) -> Optional[str]:
        """
        Detect the primary language of extracted text.
        
        Args:
            text: Extracted text
            
        Returns:
            Detected language code or None
        """
        if not text.strip():
            return None
        
        # Simple heuristic based on character patterns
        # This is a basic implementation - could be enhanced with proper language detection
        
        # Spanish indicators
        spanish_chars = set('ñáéíóúü¿¡')
        spanish_words = {'el', 'la', 'de', 'que', 'y', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su', 'por', 'son', 'con', 'para', 'al', 'del', 'los', 'las', 'una', 'como', 'pero', 'sus', 'han', 'fue', 'ser', 'está', 'todo', 'más', 'muy', 'sin', 'sobre', 'también', 'hasta', 'hay', 'donde', 'quien', 'desde', 'todos', 'durante', 'tanto', 'menos', 'según', 'entre'}
        
        # English indicators
        english_words = {'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their'}
        
        text_lower = text.lower()
        words = set(text_lower.split())
        
        # Check for Spanish characters
        if any(char in text_lower for char in spanish_chars):
            return 'es'
        
        # Check word overlap
        spanish_overlap = len(words.intersection(spanish_words))
        english_overlap = len(words.intersection(english_words))
        
        if spanish_overlap > english_overlap:
            return 'es'
        elif english_overlap > spanish_overlap:
            return 'en'
        
        return None
    
    def _detect_text_language(self, text: str) -> Optional[str]:
        """Detect language of a specific text snippet"""
        return self._detect_primary_language(text)
    
    def get_supported_languages(self) -> List[str]:
        """Get list of supported languages"""
        return self.languages.copy()
    
    def is_gpu_available(self) -> bool:
        """Check if GPU acceleration is available and enabled"""
        return self.gpu and self.reader is not None
    
    def get_engine_info(self) -> Dict[str, Any]:
        """Get information about the OCR engine"""
        return {
            'engine': 'EasyOCR',
            'version': getattr(easyocr, '__version__', 'unknown') if EASYOCR_AVAILABLE else 'not_available',
            'languages': self.languages,
            'gpu_enabled': self.gpu,
            'gpu_available': self.is_gpu_available(),
            'reader_initialized': self.reader is not None,
            'quality_thresholds': self.quality_thresholds,
            'preprocessing_settings': self.preprocessing_settings
        }