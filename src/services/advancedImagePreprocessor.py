#!/usr/bin/env python3
"""
Advanced Image Preprocessor using OpenCV

This module implements advanced image preprocessing capabilities using OpenCV
to replace basic PIL functionality with adaptive image enhancement filters,
document structure detection, and automatic orientation correction.
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
import math

# PDF processing imports
try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False


@dataclass
class DocumentStructure:
    """Structure information about a document image"""
    orientation: float  # Rotation angle in degrees
    skew_angle: float   # Skew correction angle
    text_regions: List[Tuple[int, int, int, int]]  # Bounding boxes of text regions
    table_regions: List[Tuple[int, int, int, int]]  # Bounding boxes of table regions
    image_quality: float  # Overall image quality score (0-1)
    has_borders: bool   # Whether document has clear borders
    layout_type: str    # 'single_column', 'multi_column', 'table', 'mixed'
    confidence: float   # Confidence in structure detection


@dataclass
class PreprocessingResult:
    """Result of image preprocessing operation"""
    processed_image: np.ndarray
    original_image: np.ndarray
    transformations_applied: List[str]
    quality_improvement: float  # Quality score improvement (0-1)
    processing_time: float
    metadata: Dict[str, Any]


class AdvancedImagePreprocessor:
    """
    Advanced image preprocessor using OpenCV for document image enhancement.
    
    Features:
    - Adaptive image enhancement filters (contrast, sharpening, noise reduction, binarization)
    - Document structure detection and automatic orientation correction
    - PDF to image conversion with optimal DPI settings for OCR
    - Intelligent preprocessing pipeline based on image characteristics
    """
    
    def __init__(self, debug: bool = False):
        """
        Initialize the Advanced Image Preprocessor.
        
        Args:
            debug: Enable debug logging
        """
        self.debug = debug
        self.logger = self._setup_logger()
        
        # Preprocessing settings
        self.settings = {
            'target_dpi': 300,          # Optimal DPI for OCR
            'min_image_size': 300,      # Minimum dimension for processing
            'max_image_size': 3000,     # Maximum dimension to prevent memory issues
            'noise_reduction_strength': 10,  # Denoising strength
            'contrast_enhancement': True,    # Enable contrast enhancement
            'sharpening_strength': 1.0,     # Sharpening kernel strength
            'binarization_method': 'adaptive',  # 'adaptive', 'otsu', 'manual'
            'skew_detection_threshold': 0.5,    # Minimum angle for skew correction
            'orientation_detection': True,      # Enable orientation detection
            'border_removal': True,            # Remove document borders
            'preserve_aspect_ratio': True      # Maintain aspect ratio during resize
        }
        
        # Quality assessment thresholds
        self.quality_thresholds = {
            'min_contrast': 50,         # Minimum contrast for good quality
            'min_sharpness': 100,       # Minimum sharpness (Laplacian variance)
            'max_noise_level': 30,      # Maximum acceptable noise level
            'min_brightness': 50,       # Minimum brightness
            'max_brightness': 200       # Maximum brightness
        }
        
        self.logger.info("AdvancedImagePreprocessor initialized with OpenCV")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.AdvancedImagePreprocessor")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def enhance_for_ocr(self, image: np.ndarray) -> np.ndarray:
        """
        Apply comprehensive image enhancement pipeline optimized for OCR.
        
        Args:
            image: Input image as numpy array
            
        Returns:
            Enhanced image optimized for OCR
        """
        if image is None or image.size == 0:
            self.logger.error("Invalid input image")
            return image
        
        try:
            self.logger.debug("Starting OCR enhancement pipeline")
            start_time = time.time()
            
            # Create working copy
            enhanced = image.copy()
            transformations = []
            
            # Convert to grayscale if needed
            if len(enhanced.shape) == 3:
                enhanced = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY)
                transformations.append("grayscale_conversion")
            
            # Resize image if needed for optimal OCR
            enhanced = self._resize_for_ocr(enhanced)
            if enhanced.shape != image.shape[:2]:
                transformations.append("resize_for_ocr")
            
            # Detect and correct orientation
            if self.settings['orientation_detection']:
                orientation_angle = self._detect_orientation(enhanced)
                if abs(orientation_angle) > 1.0:  # Only correct significant rotations
                    enhanced = self._rotate_image(enhanced, orientation_angle)
                    transformations.append(f"orientation_correction_{orientation_angle:.1f}deg")
            
            # Detect and correct skew
            skew_angle = self._detect_skew(enhanced)
            if abs(skew_angle) > self.settings['skew_detection_threshold']:
                enhanced = self._correct_skew(enhanced, skew_angle)
                transformations.append(f"skew_correction_{skew_angle:.1f}deg")
            
            # Remove borders if present
            if self.settings['border_removal']:
                border_removed = self._remove_borders(enhanced)
                if not np.array_equal(border_removed, enhanced):
                    enhanced = border_removed
                    transformations.append("border_removal")
            
            # Apply noise reduction
            enhanced = self._apply_noise_reduction(enhanced)
            transformations.append("noise_reduction")
            
            # Enhance contrast
            if self.settings['contrast_enhancement']:
                enhanced = self._enhance_contrast(enhanced)
                transformations.append("contrast_enhancement")
            
            # Apply sharpening
            enhanced = self._apply_sharpening(enhanced)
            transformations.append("sharpening")
            
            # Apply binarization for final OCR optimization
            enhanced = self._apply_binarization(enhanced)
            transformations.append(f"binarization_{self.settings['binarization_method']}")
            
            processing_time = time.time() - start_time
            self.logger.debug(f"OCR enhancement completed in {processing_time:.2f}s with {len(transformations)} transformations")
            
            return enhanced
            
        except Exception as e:
            self.logger.error(f"OCR enhancement failed: {e}", exc_info=True)
            return image
    
    def detect_document_structure(self, image: np.ndarray) -> DocumentStructure:
        """
        Detect document structure including orientation, text regions, and layout.
        
        Args:
            image: Input image as numpy array
            
        Returns:
            DocumentStructure with detected information
        """
        if image is None or image.size == 0:
            return DocumentStructure(
                orientation=0.0, skew_angle=0.0, text_regions=[], table_regions=[],
                image_quality=0.0, has_borders=False, layout_type='unknown', confidence=0.0
            )
        
        try:
            self.logger.debug("Starting document structure detection")
            start_time = time.time()
            
            # Convert to grayscale if needed
            gray = image.copy()
            if len(gray.shape) == 3:
                gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)
            
            # Detect orientation
            orientation = self._detect_orientation(gray)
            
            # Detect skew
            skew_angle = self._detect_skew(gray)
            
            # Detect text regions
            text_regions = self._detect_text_regions(gray)
            
            # Detect table regions
            table_regions = self._detect_table_regions(gray)
            
            # Assess image quality
            image_quality = self._assess_image_quality(gray)
            
            # Detect borders
            has_borders = self._detect_borders(gray)
            
            # Determine layout type
            layout_type = self._determine_layout_type(text_regions, table_regions, gray.shape)
            
            # Calculate overall confidence
            confidence = self._calculate_structure_confidence(
                orientation, skew_angle, text_regions, table_regions, image_quality
            )
            
            processing_time = time.time() - start_time
            self.logger.debug(f"Structure detection completed in {processing_time:.2f}s")
            
            return DocumentStructure(
                orientation=orientation,
                skew_angle=skew_angle,
                text_regions=text_regions,
                table_regions=table_regions,
                image_quality=image_quality,
                has_borders=has_borders,
                layout_type=layout_type,
                confidence=confidence
            )
            
        except Exception as e:
            self.logger.error(f"Document structure detection failed: {e}", exc_info=True)
            return DocumentStructure(
                orientation=0.0, skew_angle=0.0, text_regions=[], table_regions=[],
                image_quality=0.0, has_borders=False, layout_type='error', confidence=0.0
            )
    
    def apply_adaptive_filters(self, image: np.ndarray) -> np.ndarray:
        """
        Apply adaptive filters based on image characteristics.
        
        Args:
            image: Input image as numpy array
            
        Returns:
            Image with adaptive filters applied
        """
        if image is None or image.size == 0:
            return image
        
        try:
            # Assess image characteristics
            quality_metrics = self._assess_detailed_quality(image)
            
            # Create working copy
            filtered = image.copy()
            
            # Convert to grayscale if needed
            if len(filtered.shape) == 3:
                filtered = cv2.cvtColor(filtered, cv2.COLOR_BGR2GRAY)
            
            # Apply filters based on image characteristics
            
            # Low contrast - enhance contrast more aggressively
            if quality_metrics['contrast'] < self.quality_thresholds['min_contrast']:
                filtered = self._enhance_contrast_aggressive(filtered)
                self.logger.debug("Applied aggressive contrast enhancement")
            
            # High noise - apply stronger denoising
            if quality_metrics['noise_level'] > self.quality_thresholds['max_noise_level']:
                filtered = self._apply_strong_denoising(filtered)
                self.logger.debug("Applied strong denoising")
            
            # Low sharpness - apply sharpening
            if quality_metrics['sharpness'] < self.quality_thresholds['min_sharpness']:
                filtered = self._apply_adaptive_sharpening(filtered)
                self.logger.debug("Applied adaptive sharpening")
            
            # Poor brightness - adjust brightness
            if (quality_metrics['brightness'] < self.quality_thresholds['min_brightness'] or 
                quality_metrics['brightness'] > self.quality_thresholds['max_brightness']):
                filtered = self._adjust_brightness(filtered, quality_metrics['brightness'])
                self.logger.debug("Applied brightness adjustment")
            
            return filtered
            
        except Exception as e:
            self.logger.error(f"Adaptive filtering failed: {e}", exc_info=True)
            return image
    
    def convert_pdf_to_images(self, pdf_path: str, dpi: Optional[int] = None) -> List[np.ndarray]:
        """
        Convert PDF pages to images with optimal DPI settings for OCR.
        
        Args:
            pdf_path: Path to PDF file
            dpi: Target DPI (defaults to settings['target_dpi'])
            
        Returns:
            List of images as numpy arrays
        """
        if not PYMUPDF_AVAILABLE:
            self.logger.error("PyMuPDF not available for PDF conversion")
            return []
        
        if not Path(pdf_path).exists():
            self.logger.error(f"PDF file not found: {pdf_path}")
            return []
        
        target_dpi = dpi or self.settings['target_dpi']
        
        try:
            self.logger.info(f"Converting PDF to images at {target_dpi} DPI: {pdf_path}")
            start_time = time.time()
            
            images = []
            doc = fitz.open(pdf_path)
            
            # Calculate zoom factor for target DPI
            # PyMuPDF default is 72 DPI
            zoom_factor = target_dpi / 72.0
            mat = fitz.Matrix(zoom_factor, zoom_factor)
            
            for page_num in range(len(doc)):
                try:
                    self.logger.debug(f"Converting page {page_num + 1}/{len(doc)}")
                    
                    page = doc.load_page(page_num)
                    pix = page.get_pixmap(matrix=mat)
                    
                    # Convert to numpy array
                    img_data = pix.tobytes("png")
                    nparr = np.frombuffer(img_data, np.uint8)
                    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    
                    if image is not None:
                        images.append(image)
                    else:
                        self.logger.warning(f"Failed to decode page {page_num + 1}")
                    
                except Exception as e:
                    self.logger.error(f"Failed to convert page {page_num + 1}: {e}")
                    continue
            
            doc.close()
            
            processing_time = time.time() - start_time
            self.logger.info(f"Converted {len(images)} pages in {processing_time:.2f}s")
            
            return images
            
        except Exception as e:
            self.logger.error(f"PDF to image conversion failed: {e}", exc_info=True)
            return []
    
    def process_with_structure_detection(self, image: np.ndarray) -> PreprocessingResult:
        """
        Process image with full structure detection and adaptive enhancement.
        
        Args:
            image: Input image as numpy array
            
        Returns:
            PreprocessingResult with processed image and metadata
        """
        if image is None or image.size == 0:
            return PreprocessingResult(
                processed_image=image,
                original_image=image,
                transformations_applied=[],
                quality_improvement=0.0,
                processing_time=0.0,
                metadata={'error': 'Invalid input image'}
            )
        
        try:
            start_time = time.time()
            original_image = image.copy()
            
            # Detect document structure
            structure = self.detect_document_structure(image)
            
            # Apply adaptive filters based on structure
            processed = self.apply_adaptive_filters(image)
            
            # Apply structure-based corrections
            if abs(structure.orientation) > 1.0:
                processed = self._rotate_image(processed, structure.orientation)
            
            if abs(structure.skew_angle) > self.settings['skew_detection_threshold']:
                processed = self._correct_skew(processed, structure.skew_angle)
            
            # Final OCR enhancement
            processed = self.enhance_for_ocr(processed)
            
            # Calculate quality improvement
            original_quality = self._assess_image_quality(original_image)
            processed_quality = self._assess_image_quality(processed)
            quality_improvement = processed_quality - original_quality
            
            processing_time = time.time() - start_time
            
            # Compile transformations applied
            transformations = [
                'structure_detection',
                'adaptive_filtering',
                'ocr_enhancement'
            ]
            
            if abs(structure.orientation) > 1.0:
                transformations.append(f'orientation_correction_{structure.orientation:.1f}deg')
            
            if abs(structure.skew_angle) > self.settings['skew_detection_threshold']:
                transformations.append(f'skew_correction_{structure.skew_angle:.1f}deg')
            
            metadata = {
                'document_structure': structure,
                'original_quality': original_quality,
                'processed_quality': processed_quality,
                'processing_time': processing_time,
                'image_dimensions': processed.shape,
                'structure_confidence': structure.confidence
            }
            
            return PreprocessingResult(
                processed_image=processed,
                original_image=original_image,
                transformations_applied=transformations,
                quality_improvement=quality_improvement,
                processing_time=processing_time,
                metadata=metadata
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            self.logger.error(f"Structure-based processing failed: {e}", exc_info=True)
            
            return PreprocessingResult(
                processed_image=image,
                original_image=image,
                transformations_applied=[],
                quality_improvement=0.0,
                processing_time=processing_time,
                metadata={'error': str(e)}
            )
    
    # Private helper methods
    
    def _resize_for_ocr(self, image: np.ndarray) -> np.ndarray:
        """Resize image to optimal dimensions for OCR"""
        height, width = image.shape[:2]
        
        # Check if resize is needed
        min_dim = min(height, width)
        max_dim = max(height, width)
        
        if min_dim >= self.settings['min_image_size'] and max_dim <= self.settings['max_image_size']:
            return image
        
        # Calculate new dimensions
        if min_dim < self.settings['min_image_size']:
            # Upscale
            scale_factor = self.settings['min_image_size'] / min_dim
        elif max_dim > self.settings['max_image_size']:
            # Downscale
            scale_factor = self.settings['max_image_size'] / max_dim
        else:
            return image
        
        new_width = int(width * scale_factor)
        new_height = int(height * scale_factor)
        
        # Use appropriate interpolation
        interpolation = cv2.INTER_CUBIC if scale_factor > 1 else cv2.INTER_AREA
        
        return cv2.resize(image, (new_width, new_height), interpolation=interpolation)
    
    def _detect_orientation(self, image: np.ndarray) -> float:
        """Detect document orientation angle"""
        try:
            # Use Hough line detection to find dominant lines
            edges = cv2.Canny(image, 50, 150, apertureSize=3)
            lines = cv2.HoughLines(edges, 1, np.pi/180, threshold=100)
            
            if lines is None:
                return 0.0
            
            # Analyze line angles
            angles = []
            for line in lines:
                rho, theta = line[0]
                angle = theta * 180 / np.pi
                
                # Convert to rotation angle
                if angle > 90:
                    angle = angle - 180
                
                angles.append(angle)
            
            if not angles:
                return 0.0
            
            # Find most common angle (mode)
            angles = np.array(angles)
            hist, bins = np.histogram(angles, bins=36, range=(-90, 90))
            most_common_idx = np.argmax(hist)
            orientation = (bins[most_common_idx] + bins[most_common_idx + 1]) / 2
            
            return float(orientation)
            
        except Exception as e:
            self.logger.debug(f"Orientation detection failed: {e}")
            return 0.0
    
    def _detect_skew(self, image: np.ndarray) -> float:
        """Detect skew angle using Hough transform"""
        try:
            # Apply edge detection
            edges = cv2.Canny(image, 50, 150, apertureSize=3)
            
            # Detect lines
            lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=100, minLineLength=100, maxLineGap=10)
            
            if lines is None:
                return 0.0
            
            # Calculate angles of detected lines
            angles = []
            for line in lines:
                x1, y1, x2, y2 = line[0]
                angle = math.atan2(y2 - y1, x2 - x1) * 180 / np.pi
                angles.append(angle)
            
            if not angles:
                return 0.0
            
            # Find median angle (more robust than mean)
            median_angle = np.median(angles)
            
            # Normalize to [-45, 45] range
            if median_angle > 45:
                median_angle -= 90
            elif median_angle < -45:
                median_angle += 90
            
            return float(median_angle)
            
        except Exception as e:
            self.logger.debug(f"Skew detection failed: {e}")
            return 0.0
    
    def _rotate_image(self, image: np.ndarray, angle: float) -> np.ndarray:
        """Rotate image by specified angle"""
        try:
            height, width = image.shape[:2]
            center = (width // 2, height // 2)
            
            # Get rotation matrix
            rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
            
            # Calculate new dimensions to avoid cropping
            cos_angle = abs(rotation_matrix[0, 0])
            sin_angle = abs(rotation_matrix[0, 1])
            new_width = int((height * sin_angle) + (width * cos_angle))
            new_height = int((height * cos_angle) + (width * sin_angle))
            
            # Adjust translation
            rotation_matrix[0, 2] += (new_width / 2) - center[0]
            rotation_matrix[1, 2] += (new_height / 2) - center[1]
            
            # Apply rotation
            rotated = cv2.warpAffine(image, rotation_matrix, (new_width, new_height), 
                                   flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, 
                                   borderValue=255)
            
            return rotated
            
        except Exception as e:
            self.logger.debug(f"Image rotation failed: {e}")
            return image
    
    def _correct_skew(self, image: np.ndarray, skew_angle: float) -> np.ndarray:
        """Correct skew by rotating image"""
        return self._rotate_image(image, -skew_angle)  # Negative to correct
    
    def _remove_borders(self, image: np.ndarray) -> np.ndarray:
        """Remove document borders if present"""
        try:
            # Find contours
            edges = cv2.Canny(image, 50, 150)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if not contours:
                return image
            
            # Find largest contour (likely the document border)
            largest_contour = max(contours, key=cv2.contourArea)
            
            # Get bounding rectangle
            x, y, w, h = cv2.boundingRect(largest_contour)
            
            # Check if this looks like a border (covers most of the image)
            image_area = image.shape[0] * image.shape[1]
            contour_area = w * h
            
            if contour_area / image_area > 0.8:  # Covers more than 80% of image
                # Crop to remove border
                margin = 10  # Small margin to avoid cutting text
                x = max(0, x + margin)
                y = max(0, y + margin)
                w = min(image.shape[1] - x, w - 2 * margin)
                h = min(image.shape[0] - y, h - 2 * margin)
                
                return image[y:y+h, x:x+w]
            
            return image
            
        except Exception as e:
            self.logger.debug(f"Border removal failed: {e}")
            return image
    
    def _apply_noise_reduction(self, image: np.ndarray) -> np.ndarray:
        """Apply noise reduction using Non-local Means Denoising"""
        try:
            return cv2.fastNlMeansDenoising(image, None, self.settings['noise_reduction_strength'], 7, 21)
        except Exception as e:
            self.logger.debug(f"Noise reduction failed: {e}")
            return image
    
    def _enhance_contrast(self, image: np.ndarray) -> np.ndarray:
        """Enhance contrast using CLAHE"""
        try:
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            return clahe.apply(image)
        except Exception as e:
            self.logger.debug(f"Contrast enhancement failed: {e}")
            return image
    
    def _apply_sharpening(self, image: np.ndarray) -> np.ndarray:
        """Apply sharpening filter"""
        try:
            # Unsharp masking
            gaussian = cv2.GaussianBlur(image, (0, 0), 2.0)
            sharpened = cv2.addWeighted(image, 1.0 + self.settings['sharpening_strength'], 
                                      gaussian, -self.settings['sharpening_strength'], 0)
            return sharpened
        except Exception as e:
            self.logger.debug(f"Sharpening failed: {e}")
            return image
    
    def _apply_binarization(self, image: np.ndarray) -> np.ndarray:
        """Apply binarization based on method setting"""
        try:
            method = self.settings['binarization_method']
            
            if method == 'adaptive':
                return cv2.adaptiveThreshold(image, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                           cv2.THRESH_BINARY, 11, 2)
            elif method == 'otsu':
                _, binary = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                return binary
            else:  # manual threshold
                _, binary = cv2.threshold(image, 127, 255, cv2.THRESH_BINARY)
                return binary
                
        except Exception as e:
            self.logger.debug(f"Binarization failed: {e}")
            return image
    
    def _detect_text_regions(self, image: np.ndarray) -> List[Tuple[int, int, int, int]]:
        """Detect text regions in the image"""
        try:
            # Use MSER (Maximally Stable Extremal Regions) for text detection
            mser = cv2.MSER_create()
            regions, _ = mser.detectRegions(image)
            
            text_regions = []
            for region in regions:
                # Get bounding rectangle for each region
                x, y, w, h = cv2.boundingRect(region.reshape(-1, 1, 2))
                
                # Filter regions by size (likely text regions)
                if 10 < w < image.shape[1] * 0.8 and 5 < h < image.shape[0] * 0.1:
                    text_regions.append((x, y, x + w, y + h))
            
            return text_regions
            
        except Exception as e:
            self.logger.debug(f"Text region detection failed: {e}")
            return []
    
    def _detect_table_regions(self, image: np.ndarray) -> List[Tuple[int, int, int, int]]:
        """Detect table regions in the image"""
        try:
            # Detect horizontal and vertical lines
            horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
            vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
            
            # Apply morphological operations to detect lines
            horizontal_lines = cv2.morphologyEx(image, cv2.MORPH_OPEN, horizontal_kernel)
            vertical_lines = cv2.morphologyEx(image, cv2.MORPH_OPEN, vertical_kernel)
            
            # Combine lines
            table_mask = cv2.addWeighted(horizontal_lines, 0.5, vertical_lines, 0.5, 0.0)
            
            # Find contours of table regions
            contours, _ = cv2.findContours(table_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            table_regions = []
            for contour in contours:
                x, y, w, h = cv2.boundingRect(contour)
                
                # Filter by size (likely table regions)
                if w > 100 and h > 50:
                    table_regions.append((x, y, x + w, y + h))
            
            return table_regions
            
        except Exception as e:
            self.logger.debug(f"Table region detection failed: {e}")
            return []
    
    def _assess_image_quality(self, image: np.ndarray) -> float:
        """Assess overall image quality (0-1 scale)"""
        try:
            # Calculate various quality metrics
            contrast = np.std(image) / 255.0
            
            # Sharpness using Laplacian variance
            laplacian = cv2.Laplacian(image, cv2.CV_64F)
            sharpness = np.var(laplacian) / 10000.0
            
            # Brightness
            brightness = np.mean(image) / 255.0
            
            # Noise level (inverse of smoothness)
            blur = cv2.GaussianBlur(image, (5, 5), 0)
            noise = np.mean(np.abs(image.astype(float) - blur.astype(float))) / 255.0
            
            # Combine metrics (weighted average)
            quality = (0.3 * min(contrast, 1.0) + 
                      0.3 * min(sharpness, 1.0) + 
                      0.2 * (1.0 - abs(brightness - 0.5) * 2) +  # Optimal brightness around 0.5
                      0.2 * (1.0 - min(noise, 1.0)))
            
            return max(0.0, min(1.0, quality))
            
        except Exception as e:
            self.logger.debug(f"Quality assessment failed: {e}")
            return 0.5  # Default moderate quality
    
    def _assess_detailed_quality(self, image: np.ndarray) -> Dict[str, float]:
        """Assess detailed quality metrics"""
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
            
            # Contrast
            contrast = np.std(gray)
            
            # Sharpness
            laplacian = cv2.Laplacian(gray, cv2.CV_64F)
            sharpness = np.var(laplacian)
            
            # Brightness
            brightness = np.mean(gray)
            
            # Noise level
            blur = cv2.GaussianBlur(gray, (5, 5), 0)
            noise_level = np.mean(np.abs(gray.astype(float) - blur.astype(float)))
            
            return {
                'contrast': contrast,
                'sharpness': sharpness,
                'brightness': brightness,
                'noise_level': noise_level
            }
            
        except Exception as e:
            self.logger.debug(f"Detailed quality assessment failed: {e}")
            return {
                'contrast': 50.0,
                'sharpness': 100.0,
                'brightness': 127.0,
                'noise_level': 15.0
            }
    
    def _detect_borders(self, image: np.ndarray) -> bool:
        """Detect if image has clear borders"""
        try:
            edges = cv2.Canny(image, 50, 150)
            
            # Check edges near image borders
            h, w = image.shape
            border_width = 20
            
            # Count edge pixels near borders
            top_edges = np.sum(edges[:border_width, :])
            bottom_edges = np.sum(edges[-border_width:, :])
            left_edges = np.sum(edges[:, :border_width])
            right_edges = np.sum(edges[:, -border_width:])
            
            total_border_edges = top_edges + bottom_edges + left_edges + right_edges
            border_pixels = 2 * border_width * (h + w)
            
            # If more than 10% of border pixels are edges, likely has borders
            return bool((total_border_edges / border_pixels) > 0.1)
            
        except Exception as e:
            self.logger.debug(f"Border detection failed: {e}")
            return False
    
    def _determine_layout_type(self, text_regions: List[Tuple[int, int, int, int]], 
                              table_regions: List[Tuple[int, int, int, int]], 
                              image_shape: Tuple[int, int]) -> str:
        """Determine document layout type"""
        try:
            if not text_regions and not table_regions:
                return 'unknown'
            
            if table_regions and not text_regions:
                return 'table'
            
            if text_regions and not table_regions:
                # Analyze text region distribution
                if len(text_regions) > 20:  # Many small text regions
                    # Check if they form columns
                    x_coords = [region[0] for region in text_regions]
                    if len(set(x_coords)) > len(x_coords) * 0.3:  # Varied x positions
                        return 'multi_column'
                    else:
                        return 'single_column'
                else:
                    return 'single_column'
            
            # Both text and tables present
            return 'mixed'
            
        except Exception as e:
            self.logger.debug(f"Layout type determination failed: {e}")
            return 'unknown'
    
    def _calculate_structure_confidence(self, orientation: float, skew_angle: float,
                                      text_regions: List, table_regions: List,
                                      image_quality: float) -> float:
        """Calculate confidence in structure detection"""
        try:
            confidence_factors = []
            
            # Orientation confidence (based on how clear the angle is)
            if abs(orientation) < 1.0:
                confidence_factors.append(0.9)  # Very confident in no rotation needed
            elif abs(orientation) < 5.0:
                confidence_factors.append(0.8)  # Confident in small rotation
            else:
                confidence_factors.append(0.6)  # Less confident in large rotation
            
            # Skew confidence
            if abs(skew_angle) < 0.5:
                confidence_factors.append(0.9)
            elif abs(skew_angle) < 2.0:
                confidence_factors.append(0.8)
            else:
                confidence_factors.append(0.6)
            
            # Region detection confidence
            if text_regions or table_regions:
                confidence_factors.append(0.8)
            else:
                confidence_factors.append(0.4)
            
            # Image quality factor
            confidence_factors.append(image_quality)
            
            return np.mean(confidence_factors)
            
        except Exception as e:
            self.logger.debug(f"Confidence calculation failed: {e}")
            return 0.5
    
    def _enhance_contrast_aggressive(self, image: np.ndarray) -> np.ndarray:
        """Apply aggressive contrast enhancement"""
        try:
            # Use CLAHE with higher clip limit
            clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(image)
            
            # Additional histogram equalization
            equalized = cv2.equalizeHist(enhanced)
            
            # Blend original and equalized
            return cv2.addWeighted(enhanced, 0.7, equalized, 0.3, 0)
            
        except Exception as e:
            self.logger.debug(f"Aggressive contrast enhancement failed: {e}")
            return image
    
    def _apply_strong_denoising(self, image: np.ndarray) -> np.ndarray:
        """Apply strong noise reduction"""
        try:
            # Use stronger parameters for heavy denoising
            return cv2.fastNlMeansDenoising(image, None, 20, 7, 21)
        except Exception as e:
            self.logger.debug(f"Strong denoising failed: {e}")
            return image
    
    def _apply_adaptive_sharpening(self, image: np.ndarray) -> np.ndarray:
        """Apply adaptive sharpening based on image characteristics"""
        try:
            # Create sharpening kernel
            kernel = np.array([[-1, -1, -1],
                              [-1,  9, -1],
                              [-1, -1, -1]])
            
            # Apply sharpening
            sharpened = cv2.filter2D(image, -1, kernel)
            
            # Blend with original to avoid over-sharpening
            return cv2.addWeighted(image, 0.6, sharpened, 0.4, 0)
            
        except Exception as e:
            self.logger.debug(f"Adaptive sharpening failed: {e}")
            return image
    
    def _adjust_brightness(self, image: np.ndarray, current_brightness: float) -> np.ndarray:
        """Adjust image brightness to optimal level"""
        try:
            target_brightness = 127  # Mid-range brightness
            adjustment = target_brightness - current_brightness
            
            # Apply brightness adjustment
            adjusted = cv2.convertScaleAbs(image, alpha=1.0, beta=adjustment)
            
            return adjusted
            
        except Exception as e:
            self.logger.debug(f"Brightness adjustment failed: {e}")
            return image
    
    def get_preprocessing_info(self) -> Dict[str, Any]:
        """Get information about the preprocessor"""
        return {
            'processor': 'AdvancedImagePreprocessor',
            'opencv_version': cv2.__version__,
            'pymupdf_available': PYMUPDF_AVAILABLE,
            'settings': self.settings,
            'quality_thresholds': self.quality_thresholds,
            'supported_operations': [
                'enhance_for_ocr',
                'detect_document_structure',
                'apply_adaptive_filters',
                'convert_pdf_to_images',
                'process_with_structure_detection'
            ]
        }