#!/usr/bin/env python3
"""
Unit tests for AdvancedImagePreprocessor

Tests the OpenCV-based image preprocessing functionality including
adaptive filters, document structure detection, and OCR optimization.
"""

import unittest
import numpy as np
import cv2
import tempfile
import os
from pathlib import Path
import sys

# Add the src directory to the path to import our modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

try:
    from services.advancedImagePreprocessor import AdvancedImagePreprocessor, DocumentStructure, PreprocessingResult
    PREPROCESSOR_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Could not import AdvancedImagePreprocessor: {e}")
    PREPROCESSOR_AVAILABLE = False

try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False


class TestAdvancedImagePreprocessor(unittest.TestCase):
    """Test cases for AdvancedImagePreprocessor"""
    
    def setUp(self):
        """Set up test fixtures"""
        if not PREPROCESSOR_AVAILABLE:
            self.skipTest("AdvancedImagePreprocessor not available")
        
        self.preprocessor = AdvancedImagePreprocessor(debug=True)
        
        # Create test images
        self.test_image_gray = self._create_test_image_gray()
        self.test_image_color = self._create_test_image_color()
        self.test_image_noisy = self._create_noisy_image()
        self.test_image_skewed = self._create_skewed_image()
        self.test_image_low_contrast = self._create_low_contrast_image()
    
    def _create_test_image_gray(self) -> np.ndarray:
        """Create a test grayscale image with text-like patterns"""
        image = np.ones((400, 600), dtype=np.uint8) * 255  # White background
        
        # Add some text-like rectangles
        cv2.rectangle(image, (50, 50), (550, 80), 0, -1)    # Header
        cv2.rectangle(image, (50, 100), (300, 120), 0, -1)  # Line 1
        cv2.rectangle(image, (50, 140), (400, 160), 0, -1)  # Line 2
        cv2.rectangle(image, (50, 180), (250, 200), 0, -1)  # Line 3
        
        # Add a table-like structure
        for i in range(3):
            for j in range(4):
                x = 50 + j * 120
                y = 250 + i * 40
                cv2.rectangle(image, (x, y), (x + 100, y + 30), 0, 2)
        
        return image
    
    def _create_test_image_color(self) -> np.ndarray:
        """Create a test color image"""
        image = np.ones((400, 600, 3), dtype=np.uint8) * 255
        
        # Add colored rectangles
        cv2.rectangle(image, (50, 50), (550, 80), (0, 0, 0), -1)
        cv2.rectangle(image, (50, 100), (300, 120), (100, 100, 100), -1)
        
        return image
    
    def _create_noisy_image(self) -> np.ndarray:
        """Create a noisy test image"""
        image = self._create_test_image_gray()
        
        # Add random noise
        noise = np.random.randint(0, 50, image.shape, dtype=np.uint8)
        noisy_image = cv2.add(image, noise)
        
        return noisy_image
    
    def _create_skewed_image(self) -> np.ndarray:
        """Create a skewed test image"""
        image = self._create_test_image_gray()
        
        # Apply small rotation to simulate skew
        height, width = image.shape
        center = (width // 2, height // 2)
        rotation_matrix = cv2.getRotationMatrix2D(center, 3.0, 1.0)  # 3 degree skew
        
        skewed = cv2.warpAffine(image, rotation_matrix, (width, height), 
                               borderMode=cv2.BORDER_CONSTANT, borderValue=255)
        
        return skewed
    
    def _create_low_contrast_image(self) -> np.ndarray:
        """Create a low contrast test image"""
        image = self._create_test_image_gray()
        
        # Reduce contrast by compressing dynamic range
        low_contrast = cv2.convertScaleAbs(image, alpha=0.3, beta=100)
        
        return low_contrast
    
    def test_initialization(self):
        """Test preprocessor initialization"""
        self.assertIsInstance(self.preprocessor, AdvancedImagePreprocessor)
        self.assertIsInstance(self.preprocessor.settings, dict)
        self.assertIsInstance(self.preprocessor.quality_thresholds, dict)
        
        # Check default settings
        self.assertEqual(self.preprocessor.settings['target_dpi'], 300)
        self.assertTrue(self.preprocessor.settings['contrast_enhancement'])
    
    def test_enhance_for_ocr_grayscale(self):
        """Test OCR enhancement on grayscale image"""
        enhanced = self.preprocessor.enhance_for_ocr(self.test_image_gray)
        
        self.assertIsInstance(enhanced, np.ndarray)
        self.assertEqual(len(enhanced.shape), 2)  # Should be grayscale
        self.assertGreater(enhanced.shape[0], 0)
        self.assertGreater(enhanced.shape[1], 0)
    
    def test_enhance_for_ocr_color(self):
        """Test OCR enhancement on color image"""
        enhanced = self.preprocessor.enhance_for_ocr(self.test_image_color)
        
        self.assertIsInstance(enhanced, np.ndarray)
        self.assertEqual(len(enhanced.shape), 2)  # Should be converted to grayscale
        self.assertGreater(enhanced.shape[0], 0)
        self.assertGreater(enhanced.shape[1], 0)
    
    def test_enhance_for_ocr_invalid_input(self):
        """Test OCR enhancement with invalid input"""
        # Test with None
        result = self.preprocessor.enhance_for_ocr(None)
        self.assertIsNone(result)
        
        # Test with empty array
        empty_array = np.array([])
        result = self.preprocessor.enhance_for_ocr(empty_array)
        self.assertEqual(result.size, 0)
    
    def test_detect_document_structure(self):
        """Test document structure detection"""
        structure = self.preprocessor.detect_document_structure(self.test_image_gray)
        
        self.assertIsInstance(structure, DocumentStructure)
        self.assertIsInstance(structure.orientation, float)
        self.assertIsInstance(structure.skew_angle, float)
        self.assertIsInstance(structure.text_regions, list)
        self.assertIsInstance(structure.table_regions, list)
        self.assertIsInstance(structure.image_quality, float)
        self.assertIsInstance(structure.has_borders, bool)
        self.assertIsInstance(structure.layout_type, str)
        self.assertIsInstance(structure.confidence, float)
        
        # Check value ranges
        self.assertGreaterEqual(structure.image_quality, 0.0)
        self.assertLessEqual(structure.image_quality, 1.0)
        self.assertGreaterEqual(structure.confidence, 0.0)
        self.assertLessEqual(structure.confidence, 1.0)
    
    def test_detect_document_structure_skewed(self):
        """Test structure detection on skewed image"""
        structure = self.preprocessor.detect_document_structure(self.test_image_skewed)
        
        self.assertIsInstance(structure, DocumentStructure)
        # Should detect some skew
        self.assertNotEqual(structure.skew_angle, 0.0)
    
    def test_apply_adaptive_filters(self):
        """Test adaptive filtering"""
        # Test on noisy image
        filtered = self.preprocessor.apply_adaptive_filters(self.test_image_noisy)
        
        self.assertIsInstance(filtered, np.ndarray)
        self.assertEqual(filtered.shape[:2], self.test_image_noisy.shape[:2])
        
        # Test on low contrast image
        filtered_contrast = self.preprocessor.apply_adaptive_filters(self.test_image_low_contrast)
        
        self.assertIsInstance(filtered_contrast, np.ndarray)
        self.assertEqual(filtered_contrast.shape[:2], self.test_image_low_contrast.shape[:2])
    
    def test_process_with_structure_detection(self):
        """Test full processing with structure detection"""
        result = self.preprocessor.process_with_structure_detection(self.test_image_gray)
        
        self.assertIsInstance(result, PreprocessingResult)
        self.assertIsInstance(result.processed_image, np.ndarray)
        self.assertIsInstance(result.original_image, np.ndarray)
        self.assertIsInstance(result.transformations_applied, list)
        self.assertIsInstance(result.quality_improvement, float)
        self.assertIsInstance(result.processing_time, float)
        self.assertIsInstance(result.metadata, dict)
        
        # Check that processing was applied
        self.assertGreater(len(result.transformations_applied), 0)
        self.assertGreater(result.processing_time, 0.0)
    
    def test_resize_for_ocr(self):
        """Test image resizing for OCR"""
        # Test small image (should be upscaled)
        small_image = cv2.resize(self.test_image_gray, (100, 100))
        resized = self.preprocessor._resize_for_ocr(small_image)
        
        self.assertGreater(resized.shape[0], small_image.shape[0])
        self.assertGreater(resized.shape[1], small_image.shape[1])
        
        # Test large image (should be downscaled)
        large_image = cv2.resize(self.test_image_gray, (4000, 4000))
        resized_large = self.preprocessor._resize_for_ocr(large_image)
        
        self.assertLess(resized_large.shape[0], large_image.shape[0])
        self.assertLess(resized_large.shape[1], large_image.shape[1])
    
    def test_detect_orientation(self):
        """Test orientation detection"""
        orientation = self.preprocessor._detect_orientation(self.test_image_gray)
        
        self.assertIsInstance(orientation, float)
        self.assertGreaterEqual(orientation, -90.0)
        self.assertLessEqual(orientation, 90.0)
    
    def test_detect_skew(self):
        """Test skew detection"""
        skew = self.preprocessor._detect_skew(self.test_image_skewed)
        
        self.assertIsInstance(skew, float)
        # Should detect some skew in the skewed image
        self.assertNotEqual(skew, 0.0)
    
    def test_assess_image_quality(self):
        """Test image quality assessment"""
        quality = self.preprocessor._assess_image_quality(self.test_image_gray)
        
        self.assertIsInstance(quality, float)
        self.assertGreaterEqual(quality, 0.0)
        self.assertLessEqual(quality, 1.0)
        
        # Low contrast image should have lower quality
        low_quality = self.preprocessor._assess_image_quality(self.test_image_low_contrast)
        self.assertLess(low_quality, quality)
    
    def test_assess_detailed_quality(self):
        """Test detailed quality assessment"""
        metrics = self.preprocessor._assess_detailed_quality(self.test_image_gray)
        
        self.assertIsInstance(metrics, dict)
        self.assertIn('contrast', metrics)
        self.assertIn('sharpness', metrics)
        self.assertIn('brightness', metrics)
        self.assertIn('noise_level', metrics)
        
        # All metrics should be numeric
        for key, value in metrics.items():
            self.assertIsInstance(value, (int, float))
    
    def test_detect_text_regions(self):
        """Test text region detection"""
        regions = self.preprocessor._detect_text_regions(self.test_image_gray)
        
        self.assertIsInstance(regions, list)
        # Should detect some text regions in our test image
        self.assertGreater(len(regions), 0)
        
        # Each region should be a tuple of 4 coordinates
        for region in regions:
            self.assertIsInstance(region, tuple)
            self.assertEqual(len(region), 4)
            self.assertIsInstance(region[0], (int, np.integer))
            self.assertIsInstance(region[1], (int, np.integer))
            self.assertIsInstance(region[2], (int, np.integer))
            self.assertIsInstance(region[3], (int, np.integer))
    
    def test_detect_table_regions(self):
        """Test table region detection"""
        regions = self.preprocessor._detect_table_regions(self.test_image_gray)
        
        self.assertIsInstance(regions, list)
        # Each region should be a tuple of 4 coordinates
        for region in regions:
            self.assertIsInstance(region, tuple)
            self.assertEqual(len(region), 4)
    
    def test_noise_reduction(self):
        """Test noise reduction"""
        denoised = self.preprocessor._apply_noise_reduction(self.test_image_noisy)
        
        self.assertIsInstance(denoised, np.ndarray)
        self.assertEqual(denoised.shape, self.test_image_noisy.shape)
        
        # Denoised image should have less variation (lower std dev)
        original_std = np.std(self.test_image_noisy)
        denoised_std = np.std(denoised)
        self.assertLessEqual(denoised_std, original_std)
    
    def test_contrast_enhancement(self):
        """Test contrast enhancement"""
        enhanced = self.preprocessor._enhance_contrast(self.test_image_low_contrast)
        
        self.assertIsInstance(enhanced, np.ndarray)
        self.assertEqual(enhanced.shape, self.test_image_low_contrast.shape)
        
        # Enhanced image should have higher contrast (higher std dev)
        original_std = np.std(self.test_image_low_contrast)
        enhanced_std = np.std(enhanced)
        self.assertGreaterEqual(enhanced_std, original_std)
    
    def test_sharpening(self):
        """Test image sharpening"""
        sharpened = self.preprocessor._apply_sharpening(self.test_image_gray)
        
        self.assertIsInstance(sharpened, np.ndarray)
        self.assertEqual(sharpened.shape, self.test_image_gray.shape)
    
    def test_binarization(self):
        """Test image binarization"""
        # Test adaptive binarization
        self.preprocessor.settings['binarization_method'] = 'adaptive'
        binary_adaptive = self.preprocessor._apply_binarization(self.test_image_gray)
        
        self.assertIsInstance(binary_adaptive, np.ndarray)
        self.assertEqual(binary_adaptive.shape, self.test_image_gray.shape)
        
        # Binary image should only have values 0 and 255
        unique_values = np.unique(binary_adaptive)
        self.assertTrue(all(val in [0, 255] for val in unique_values))
        
        # Test Otsu binarization
        self.preprocessor.settings['binarization_method'] = 'otsu'
        binary_otsu = self.preprocessor._apply_binarization(self.test_image_gray)
        
        self.assertIsInstance(binary_otsu, np.ndarray)
        unique_values_otsu = np.unique(binary_otsu)
        self.assertTrue(all(val in [0, 255] for val in unique_values_otsu))
    
    def test_border_detection(self):
        """Test border detection"""
        has_borders = self.preprocessor._detect_borders(self.test_image_gray)
        
        self.assertIsInstance(has_borders, bool)
    
    def test_layout_type_determination(self):
        """Test layout type determination"""
        text_regions = [(50, 50, 100, 70), (50, 100, 150, 120)]
        table_regions = [(50, 200, 300, 350)]
        
        layout_type = self.preprocessor._determine_layout_type(
            text_regions, table_regions, self.test_image_gray.shape
        )
        
        self.assertIsInstance(layout_type, str)
        self.assertIn(layout_type, ['single_column', 'multi_column', 'table', 'mixed', 'unknown'])
    
    def test_rotate_image(self):
        """Test image rotation"""
        rotated = self.preprocessor._rotate_image(self.test_image_gray, 45.0)
        
        self.assertIsInstance(rotated, np.ndarray)
        # Rotated image should be larger due to rotation
        self.assertGreaterEqual(rotated.shape[0], self.test_image_gray.shape[0])
        self.assertGreaterEqual(rotated.shape[1], self.test_image_gray.shape[1])
    
    def test_get_preprocessing_info(self):
        """Test getting preprocessor information"""
        info = self.preprocessor.get_preprocessing_info()
        
        self.assertIsInstance(info, dict)
        self.assertIn('processor', info)
        self.assertIn('opencv_version', info)
        self.assertIn('settings', info)
        self.assertIn('quality_thresholds', info)
        self.assertIn('supported_operations', info)
        
        self.assertEqual(info['processor'], 'AdvancedImagePreprocessor')
        self.assertIsInstance(info['supported_operations'], list)
    
    @unittest.skipUnless(PYMUPDF_AVAILABLE, "PyMuPDF not available")
    def test_convert_pdf_to_images_no_file(self):
        """Test PDF conversion with non-existent file"""
        images = self.preprocessor.convert_pdf_to_images("nonexistent.pdf")
        
        self.assertIsInstance(images, list)
        self.assertEqual(len(images), 0)
    
    def test_performance_benchmarks(self):
        """Test performance of key operations"""
        import time
        
        # Test OCR enhancement performance
        start_time = time.time()
        enhanced = self.preprocessor.enhance_for_ocr(self.test_image_gray)
        ocr_time = time.time() - start_time
        
        self.assertLess(ocr_time, 5.0)  # Should complete within 5 seconds
        self.assertIsInstance(enhanced, np.ndarray)
        
        # Test structure detection performance
        start_time = time.time()
        structure = self.preprocessor.detect_document_structure(self.test_image_gray)
        structure_time = time.time() - start_time
        
        self.assertLess(structure_time, 3.0)  # Should complete within 3 seconds
        self.assertIsInstance(structure, DocumentStructure)
        
        print(f"Performance benchmarks:")
        print(f"  OCR enhancement: {ocr_time:.3f}s")
        print(f"  Structure detection: {structure_time:.3f}s")


class TestAdvancedImagePreprocessorIntegration(unittest.TestCase):
    """Integration tests for AdvancedImagePreprocessor"""
    
    def setUp(self):
        """Set up integration test fixtures"""
        if not PREPROCESSOR_AVAILABLE:
            self.skipTest("AdvancedImagePreprocessor not available")
        
        self.preprocessor = AdvancedImagePreprocessor(debug=True)
    
    def test_full_pipeline_integration(self):
        """Test complete preprocessing pipeline"""
        # Create a complex test image
        test_image = np.ones((600, 800), dtype=np.uint8) * 255
        
        # Add various elements
        cv2.rectangle(test_image, (50, 50), (750, 100), 0, -1)  # Header
        
        # Add table structure
        for i in range(4):
            for j in range(3):
                x = 100 + j * 200
                y = 150 + i * 50
                cv2.rectangle(test_image, (x, y), (x + 180, y + 40), 0, 2)
                cv2.putText(test_image, f"Cell {i},{j}", (x + 10, y + 25), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, 0, 1)
        
        # Add some noise
        noise = np.random.randint(0, 30, test_image.shape, dtype=np.uint8)
        noisy_image = cv2.add(test_image, noise)
        
        # Apply slight rotation
        height, width = noisy_image.shape
        center = (width // 2, height // 2)
        rotation_matrix = cv2.getRotationMatrix2D(center, 2.0, 1.0)
        rotated_image = cv2.warpAffine(noisy_image, rotation_matrix, (width, height), 
                                     borderMode=cv2.BORDER_CONSTANT, borderValue=255)
        
        # Process with full pipeline
        result = self.preprocessor.process_with_structure_detection(rotated_image)
        
        # Verify results
        self.assertIsInstance(result, PreprocessingResult)
        self.assertIsInstance(result.processed_image, np.ndarray)
        self.assertGreater(len(result.transformations_applied), 0)
        self.assertGreater(result.processing_time, 0.0)
        
        # Check that structure was detected
        structure = result.metadata.get('document_structure')
        self.assertIsInstance(structure, DocumentStructure)
        self.assertGreater(structure.confidence, 0.0)
        
        # Check quality improvement
        self.assertIsInstance(result.quality_improvement, float)
        
        print(f"Integration test results:")
        print(f"  Transformations applied: {len(result.transformations_applied)}")
        print(f"  Processing time: {result.processing_time:.3f}s")
        print(f"  Quality improvement: {result.quality_improvement:.3f}")
        print(f"  Structure confidence: {structure.confidence:.3f}")
        print(f"  Layout type: {structure.layout_type}")


def run_tests():
    """Run all tests"""
    if not PREPROCESSOR_AVAILABLE:
        print("AdvancedImagePreprocessor not available. Skipping tests.")
        return
    
    # Create test suite
    test_suite = unittest.TestSuite()
    
    # Add test cases
    test_suite.addTest(unittest.makeSuite(TestAdvancedImagePreprocessor))
    test_suite.addTest(unittest.makeSuite(TestAdvancedImagePreprocessorIntegration))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(test_suite)
    
    # Print summary
    print(f"\nTest Summary:")
    print(f"  Tests run: {result.testsRun}")
    print(f"  Failures: {len(result.failures)}")
    print(f"  Errors: {len(result.errors)}")
    print(f"  Success rate: {((result.testsRun - len(result.failures) - len(result.errors)) / result.testsRun * 100):.1f}%")
    
    return result.wasSuccessful()


if __name__ == '__main__':
    success = run_tests()
    exit(0 if success else 1)