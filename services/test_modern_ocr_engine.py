#!/usr/bin/env python3
"""
Unit tests for ModernOCREngine comparing EasyOCR vs Tesseract accuracy

This test suite compares the performance of the new ModernOCREngine (EasyOCR)
against the legacy Tesseract implementation on sample images and documents.
"""

import pytest
import os
import sys
import time
import numpy as np
import cv2
from pathlib import Path
from typing import List, Dict, Any, Optional
import tempfile
import logging

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Import the classes to test
from src.services.modernOCREngine import ModernOCREngine, OCRResult, OCRExtractionResult

# Import legacy Tesseract for comparison
try:
    import pytesseract
    from PIL import Image
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    print("Warning: Tesseract not available for comparison tests")

# Import image processing libraries
try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False


class LegacyOCREngine:
    """Legacy OCR engine using Tesseract for comparison"""
    
    def __init__(self, languages: List[str] = None, debug: bool = False):
        self.languages = languages or ['eng', 'spa']  # Tesseract language codes
        self.debug = debug
        self.logger = logging.getLogger(f"{__name__}.LegacyOCREngine")
        
        # Tesseract configuration
        self.config = '--oem 3 --psm 6'  # Use LSTM OCR Engine Mode with uniform text block
    
    def extract_text(self, image: np.ndarray) -> Dict[str, Any]:
        """Extract text using Tesseract (legacy method)"""
        if not TESSERACT_AVAILABLE:
            return {
                'text': '',
                'confidence': 0.0,
                'method': 'tesseract_unavailable',
                'processing_time': 0.0
            }
        
        start_time = time.time()
        
        try:
            # Convert numpy array to PIL Image
            if len(image.shape) == 3:
                pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            else:
                pil_image = Image.fromarray(image)
            
            # Extract text
            text = pytesseract.image_to_string(pil_image, config=self.config)
            
            # Get confidence data
            try:
                data = pytesseract.image_to_data(pil_image, output_type=pytesseract.Output.DICT, config=self.config)
                confidences = [int(conf) for conf in data['conf'] if int(conf) > 0]
                avg_confidence = np.mean(confidences) / 100.0 if confidences else 0.0
            except:
                avg_confidence = 0.5  # Default confidence if data extraction fails
            
            processing_time = time.time() - start_time
            
            return {
                'text': text.strip(),
                'confidence': avg_confidence,
                'method': 'tesseract',
                'processing_time': processing_time,
                'word_count': len(text.split()) if text.strip() else 0
            }
            
        except Exception as e:
            processing_time = time.time() - start_time
            self.logger.error(f"Tesseract extraction failed: {e}")
            
            return {
                'text': '',
                'confidence': 0.0,
                'method': 'tesseract_error',
                'processing_time': processing_time,
                'error': str(e)
            }


@pytest.fixture
def modern_ocr():
    """Fixture for ModernOCREngine"""
    return ModernOCREngine(languages=['en', 'es'], gpu=False, debug=True)  # Disable GPU for consistent testing


@pytest.fixture
def legacy_ocr():
    """Fixture for LegacyOCREngine"""
    return LegacyOCREngine(languages=['eng', 'spa'], debug=True)


@pytest.fixture
def sample_images():
    """Fixture providing sample images for testing"""
    images = []
    
    # Create synthetic banking document images
    images.extend(create_synthetic_banking_images())
    
    # Look for real sample images in pdf directory
    pdf_dir = Path(__file__).parent / "pdf"
    if pdf_dir.exists():
        # Convert PDFs to images for testing
        for pdf_file in pdf_dir.glob("*.pdf"):
            pdf_images = convert_pdf_to_images(str(pdf_file))
            images.extend(pdf_images[:2])  # Take first 2 pages of each PDF
    
    return images


def create_synthetic_banking_images() -> List[np.ndarray]:
    """Create synthetic banking document images for testing"""
    images = []
    
    try:
        # Create simple text images with banking content
        banking_texts = [
            "BANK STATEMENT\nAccount: 1234567890\nDate: 2024-01-15\nBalance: $1,234.56",
            "TRANSACTION HISTORY\n2024-01-15 ATM WITHDRAWAL -$50.00\n2024-01-16 DIRECT DEPOSIT +$2,500.00",
            "EXTRACTO BANCARIO\nCuenta: 9876543210\nFecha: 15/01/2024\nSaldo: €2,345.67",
            "HISTORIAL DE TRANSACCIONES\n15/01/2024 RETIRO CAJERO -€75.00\n16/01/2024 TRANSFERENCIA +€1,500.00"
        ]
        
        for i, text in enumerate(banking_texts):
            # Create image with text
            img = np.ones((400, 600, 3), dtype=np.uint8) * 255  # White background
            
            # Add text to image using OpenCV
            lines = text.split('\n')
            y_offset = 50
            for line in lines:
                cv2.putText(img, line, (20, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 
                           0.7, (0, 0, 0), 2, cv2.LINE_AA)
                y_offset += 40
            
            # Add some noise and variations to make it more realistic
            if i % 2 == 0:
                # Add slight blur
                img = cv2.GaussianBlur(img, (3, 3), 0)
            else:
                # Add slight noise
                noise = np.random.normal(0, 10, img.shape).astype(np.uint8)
                img = cv2.add(img, noise)
            
            images.append(img)
    
    except Exception as e:
        print(f"Warning: Could not create synthetic images: {e}")
    
    return images


def convert_pdf_to_images(pdf_path: str, max_pages: int = 3) -> List[np.ndarray]:
    """Convert PDF pages to images for OCR testing"""
    if not PYMUPDF_AVAILABLE:
        return []
    
    images = []
    try:
        doc = fitz.open(pdf_path)
        for page_num in range(min(len(doc), max_pages)):
            page = doc.load_page(page_num)
            mat = fitz.Matrix(2.0, 2.0)  # 2x zoom for better quality
            pix = page.get_pixmap(matrix=mat)
            img_data = pix.tobytes("png")
            
            # Convert to numpy array
            nparr = np.frombuffer(img_data, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            images.append(image)
        
        doc.close()
    except Exception as e:
        print(f"Warning: Could not convert PDF {pdf_path}: {e}")
    
    return images


class TestModernOCREngine:
    """Test suite for ModernOCREngine"""
    
    def test_initialization(self, modern_ocr):
        """Test that ModernOCREngine initializes correctly"""
        assert modern_ocr is not None
        assert modern_ocr.languages == ['en', 'es']
        assert hasattr(modern_ocr, 'quality_thresholds')
        assert hasattr(modern_ocr, 'preprocessing_settings')
        
        # Test engine info
        info = modern_ocr.get_engine_info()
        assert info['engine'] == 'EasyOCR'
        assert info['languages'] == ['en', 'es']
    
    def test_supported_languages(self, modern_ocr):
        """Test supported languages functionality"""
        languages = modern_ocr.get_supported_languages()
        assert isinstance(languages, list)
        assert 'en' in languages
        assert 'es' in languages
    
    def test_extract_text_empty_image(self, modern_ocr):
        """Test OCR on empty/blank image"""
        # Create blank white image
        blank_image = np.ones((200, 300, 3), dtype=np.uint8) * 255
        
        result = modern_ocr.extract_text(blank_image)
        
        assert isinstance(result, OCRResult)
        assert result.method_used in ['easyocr', 'easyocr_failed']
        assert result.processing_time >= 0
        # Blank image should have low confidence and little/no text
        assert result.confidence <= 0.5
    
    def test_extract_text_with_content(self, modern_ocr, sample_images):
        """Test OCR on images with actual content"""
        if not sample_images:
            pytest.skip("No sample images available for testing")
        
        for i, image in enumerate(sample_images[:3]):  # Test first 3 images
            print(f"\nTesting image {i+1}")
            
            result = modern_ocr.extract_text(image)
            
            assert isinstance(result, OCRResult)
            assert result.processing_time > 0
            
            if result.text.strip():  # If text was found
                assert result.confidence > 0
                assert len(result.bounding_boxes) > 0
                assert result.quality_metrics is not None
                
                print(f"  Text found: '{result.text[:50]}...'")
                print(f"  Confidence: {result.confidence:.2f}")
                print(f"  Words detected: {len(result.bounding_boxes)}")
                print(f"  Language detected: {result.language_detected}")
    
    def test_extract_with_confidence_filtering(self, modern_ocr, sample_images):
        """Test confidence filtering functionality"""
        if not sample_images:
            pytest.skip("No sample images available for testing")
        
        image = sample_images[0]
        
        # Get full result
        full_result = modern_ocr.extract_text(image)
        
        # Get filtered result
        filtered_result = modern_ocr.extract_with_confidence(image)
        
        # Filtered result should have same or higher confidence
        if full_result.text.strip() and filtered_result.text.strip():
            assert filtered_result.confidence >= full_result.confidence
            
            # Filtered result should have same or fewer words
            assert len(filtered_result.bounding_boxes) <= len(full_result.bounding_boxes)
            
            print(f"Full result: {len(full_result.bounding_boxes)} words, confidence: {full_result.confidence:.2f}")
            print(f"Filtered result: {len(filtered_result.bounding_boxes)} words, confidence: {filtered_result.confidence:.2f}")
    
    @pytest.mark.skipif(not PYMUPDF_AVAILABLE, reason="PyMuPDF not available")
    def test_extract_from_pdf_page(self, modern_ocr):
        """Test PDF page extraction"""
        # Look for sample PDFs
        pdf_dir = Path(__file__).parent / "pdf"
        sample_pdfs = list(pdf_dir.glob("*.pdf")) if pdf_dir.exists() else []
        
        if not sample_pdfs:
            pytest.skip("No sample PDF files available for testing")
        
        pdf_path = str(sample_pdfs[0])
        
        # Test first page
        result = modern_ocr.extract_from_pdf_page(pdf_path, 0)
        
        assert isinstance(result, OCRResult)
        assert result.processing_time > 0
        assert 'pdf_page' in result.quality_metrics
        assert 'pdf_source' in result.quality_metrics
        
        print(f"PDF page OCR result: {len(result.text)} characters, confidence: {result.confidence:.2f}")
    
    @pytest.mark.skipif(not PYMUPDF_AVAILABLE, reason="PyMuPDF not available")
    def test_extract_from_pdf_full(self, modern_ocr):
        """Test full PDF extraction"""
        pdf_dir = Path(__file__).parent / "pdf"
        sample_pdfs = list(pdf_dir.glob("*.pdf")) if pdf_dir.exists() else []
        
        if not sample_pdfs:
            pytest.skip("No sample PDF files available for testing")
        
        pdf_path = str(sample_pdfs[0])
        
        # Test full PDF (limit to first 2 pages for speed)
        result = modern_ocr.extract_from_pdf(pdf_path, pages=[0, 1])
        
        assert isinstance(result, OCRExtractionResult)
        assert result.processing_time > 0
        assert result.total_pages > 0
        assert len(result.results_by_page) <= 2
        assert result.metadata is not None
        
        print(f"Full PDF OCR: {result.total_pages} pages, success: {result.success}")
        print(f"Combined text length: {len(result.text)} characters")
        print(f"Average confidence: {result.confidence:.2f}")
    
    def test_image_preprocessing(self, modern_ocr):
        """Test image preprocessing functionality"""
        # Create a low-quality image
        low_quality_image = np.random.randint(0, 256, (100, 200), dtype=np.uint8)
        
        # Test preprocessing
        processed = modern_ocr._preprocess_image(low_quality_image)
        
        assert processed is not None
        assert processed.shape[0] >= low_quality_image.shape[0]  # Should be same or larger
        assert processed.shape[1] >= low_quality_image.shape[1]
        
        # Processed image should be grayscale
        assert len(processed.shape) == 2
    
    def test_quality_metrics_calculation(self, modern_ocr):
        """Test quality metrics calculation"""
        # Create mock OCR results
        mock_results = [
            ([[0, 0], [50, 0], [50, 20], [0, 20]], "BANK", 0.95),
            ([[60, 0], [120, 0], [120, 20], [60, 20]], "STATEMENT", 0.88),
            ([[0, 30], [80, 30], [80, 50], [0, 50]], "Account", 0.75),
            ([[90, 30], [150, 30], [150, 50], [90, 50]], "123456", 0.92)
        ]
        
        # Create mock image
        mock_image = np.ones((100, 200), dtype=np.uint8) * 255
        
        metrics = modern_ocr._calculate_quality_metrics(mock_results, mock_image)
        
        assert isinstance(metrics, dict)
        assert 'word_count' in metrics
        assert 'average_confidence' in metrics
        assert 'high_confidence_ratio' in metrics
        assert 'text_density' in metrics
        assert 'image_quality_score' in metrics
        
        assert metrics['word_count'] == 4
        assert 0 <= metrics['average_confidence'] <= 1
        assert 0 <= metrics['high_confidence_ratio'] <= 1
        
        print(f"Quality metrics: {metrics}")
    
    def test_language_detection(self, modern_ocr):
        """Test language detection functionality"""
        # Test English text
        english_text = "This is a bank statement with account number 123456789"
        english_lang = modern_ocr._detect_primary_language(english_text)
        
        # Test Spanish text
        spanish_text = "Este es un extracto bancario con número de cuenta 987654321"
        spanish_lang = modern_ocr._detect_primary_language(spanish_text)
        
        # Test mixed text
        mixed_text = "Account número 123456 balance $1,234.56"
        mixed_lang = modern_ocr._detect_primary_language(mixed_text)
        
        print(f"English detection: {english_lang}")
        print(f"Spanish detection: {spanish_lang}")
        print(f"Mixed detection: {mixed_lang}")
        
        # Language detection should return valid codes or None
        assert english_lang in [None, 'en', 'es']
        assert spanish_lang in [None, 'en', 'es']
        assert mixed_lang in [None, 'en', 'es']


class TestOCRComparison:
    """Test class for comparing Modern OCR vs Legacy Tesseract"""
    
    @pytest.mark.skipif(not TESSERACT_AVAILABLE, reason="Tesseract not available")
    def test_accuracy_comparison(self, modern_ocr, legacy_ocr, sample_images):
        """Compare OCR accuracy between EasyOCR and Tesseract"""
        if not sample_images:
            pytest.skip("No sample images available for testing")
        
        comparison_results = []
        
        for i, image in enumerate(sample_images[:5]):  # Test first 5 images
            print(f"\n=== Testing Image {i+1} ===")
            
            # Test modern OCR
            modern_result = modern_ocr.extract_with_confidence(image)
            
            # Test legacy OCR
            legacy_result = legacy_ocr.extract_text(image)
            
            # Compare results
            comparison = {
                'image_index': i,
                'modern_text_length': len(modern_result.text),
                'legacy_text_length': len(legacy_result['text']),
                'modern_confidence': modern_result.confidence,
                'legacy_confidence': legacy_result['confidence'],
                'modern_words': len(modern_result.bounding_boxes),
                'legacy_words': legacy_result.get('word_count', 0),
                'modern_time': modern_result.processing_time,
                'legacy_time': legacy_result['processing_time'],
                'modern_method': modern_result.method_used,
                'legacy_method': legacy_result['method']
            }
            
            comparison_results.append(comparison)
            
            # Print detailed comparison
            print(f"Modern OCR:")
            print(f"  Text: '{modern_result.text[:100]}...'")
            print(f"  Length: {comparison['modern_text_length']} chars")
            print(f"  Confidence: {comparison['modern_confidence']:.2f}")
            print(f"  Words: {comparison['modern_words']}")
            print(f"  Time: {comparison['modern_time']:.2f}s")
            
            print(f"Legacy OCR:")
            print(f"  Text: '{legacy_result['text'][:100]}...'")
            print(f"  Length: {comparison['legacy_text_length']} chars")
            print(f"  Confidence: {comparison['legacy_confidence']:.2f}")
            print(f"  Words: {comparison['legacy_words']}")
            print(f"  Time: {comparison['legacy_time']:.2f}s")
        
        # Analyze overall performance
        self._analyze_comparison_results(comparison_results)
        
        # Assert that modern OCR performs reasonably
        avg_modern_confidence = np.mean([r['modern_confidence'] for r in comparison_results])
        avg_legacy_confidence = np.mean([r['legacy_confidence'] for r in comparison_results])
        
        print(f"\nOverall average confidence - Modern: {avg_modern_confidence:.2f}, Legacy: {avg_legacy_confidence:.2f}")
        
        # Modern OCR should have reasonable performance
        assert avg_modern_confidence > 0.3, "Modern OCR should have reasonable confidence"
    
    @pytest.mark.skipif(not TESSERACT_AVAILABLE, reason="Tesseract not available")
    def test_performance_comparison(self, modern_ocr, legacy_ocr, sample_images):
        """Compare processing performance between OCR engines"""
        if not sample_images:
            pytest.skip("No sample images available for testing")
        
        modern_times = []
        legacy_times = []
        
        # Test on multiple images
        for image in sample_images[:3]:
            # Modern OCR timing
            start_time = time.time()
            modern_result = modern_ocr.extract_text(image)
            modern_time = time.time() - start_time
            modern_times.append(modern_time)
            
            # Legacy OCR timing
            start_time = time.time()
            legacy_result = legacy_ocr.extract_text(image)
            legacy_time = time.time() - start_time
            legacy_times.append(legacy_time)
        
        avg_modern_time = np.mean(modern_times)
        avg_legacy_time = np.mean(legacy_times)
        
        print(f"\nPerformance Comparison:")
        print(f"Modern OCR average time: {avg_modern_time:.2f}s")
        print(f"Legacy OCR average time: {avg_legacy_time:.2f}s")
        print(f"Speed ratio (legacy/modern): {avg_legacy_time/avg_modern_time:.2f}x")
        
        # Both should complete in reasonable time
        assert avg_modern_time < 30.0, "Modern OCR should complete within 30 seconds"
        assert avg_legacy_time < 30.0, "Legacy OCR should complete within 30 seconds"
    
    @pytest.mark.skipif(not TESSERACT_AVAILABLE, reason="Tesseract not available")
    def test_multilingual_comparison(self, modern_ocr, legacy_ocr):
        """Test multilingual OCR capabilities"""
        # Create images with different languages
        test_texts = [
            ("English banking text: Account 123456, Balance $1,234.56", "en"),
            ("Texto bancario español: Cuenta 987654, Saldo €2,345.67", "es"),
            ("Mixed: Account número 555666, Balance/Saldo $999.99", "mixed")
        ]
        
        results = []
        
        for text_content, expected_lang in test_texts:
            # Create image with text
            img = np.ones((200, 600, 3), dtype=np.uint8) * 255
            cv2.putText(img, text_content, (10, 100), cv2.FONT_HERSHEY_SIMPLEX, 
                       0.6, (0, 0, 0), 2, cv2.LINE_AA)
            
            # Test both OCR engines
            modern_result = modern_ocr.extract_with_confidence(img)
            legacy_result = legacy_ocr.extract_text(img)
            
            result = {
                'expected_lang': expected_lang,
                'original_text': text_content,
                'modern_text': modern_result.text,
                'legacy_text': legacy_result['text'],
                'modern_confidence': modern_result.confidence,
                'legacy_confidence': legacy_result['confidence'],
                'modern_detected_lang': modern_result.language_detected
            }
            
            results.append(result)
            
            print(f"\nMultilingual test ({expected_lang}):")
            print(f"Original: {text_content}")
            print(f"Modern:   {modern_result.text}")
            print(f"Legacy:   {legacy_result['text']}")
            print(f"Modern confidence: {modern_result.confidence:.2f}")
            print(f"Legacy confidence: {legacy_result['confidence']:.2f}")
            print(f"Detected language: {modern_result.language_detected}")
        
        # Assert that at least some text was extracted
        successful_modern = sum(1 for r in results if r['modern_text'].strip())
        successful_legacy = sum(1 for r in results if r['legacy_text'].strip())
        
        assert successful_modern > 0, "Modern OCR should extract text from at least one multilingual sample"
        assert successful_legacy > 0, "Legacy OCR should extract text from at least one multilingual sample"
    
    def _analyze_comparison_results(self, results: List[Dict]):
        """Analyze and print detailed comparison results"""
        print("\n" + "="*60)
        print("OCR COMPARISON ANALYSIS")
        print("="*60)
        
        if not results:
            print("No results to analyze")
            return
        
        # Calculate averages
        avg_modern_confidence = np.mean([r['modern_confidence'] for r in results])
        avg_legacy_confidence = np.mean([r['legacy_confidence'] for r in results])
        avg_modern_time = np.mean([r['modern_time'] for r in results])
        avg_legacy_time = np.mean([r['legacy_time'] for r in results])
        avg_modern_words = np.mean([r['modern_words'] for r in results])
        avg_legacy_words = np.mean([r['legacy_words'] for r in results])
        
        print(f"\nAVERAGE PERFORMANCE:")
        print(f"Confidence - Modern: {avg_modern_confidence:.2f}, Legacy: {avg_legacy_confidence:.2f}")
        print(f"Processing Time - Modern: {avg_modern_time:.2f}s, Legacy: {avg_legacy_time:.2f}s")
        print(f"Words Detected - Modern: {avg_modern_words:.1f}, Legacy: {avg_legacy_words:.1f}")
        
        # Calculate improvements
        if avg_legacy_confidence > 0:
            confidence_improvement = ((avg_modern_confidence - avg_legacy_confidence) / avg_legacy_confidence) * 100
            print(f"Confidence Improvement: {confidence_improvement:+.1f}%")
        
        if avg_legacy_time > 0:
            speed_ratio = avg_legacy_time / avg_modern_time
            print(f"Speed Ratio (Legacy/Modern): {speed_ratio:.2f}x")
        
        if avg_legacy_words > 0:
            word_detection_improvement = ((avg_modern_words - avg_legacy_words) / avg_legacy_words) * 100
            print(f"Word Detection Improvement: {word_detection_improvement:+.1f}%")
        
        # Success rates
        modern_success_rate = sum(1 for r in results if r['modern_confidence'] > 0.5) / len(results)
        legacy_success_rate = sum(1 for r in results if r['legacy_confidence'] > 0.5) / len(results)
        
        print(f"\nSUCCESS RATES (>50% confidence):")
        print(f"Modern OCR: {modern_success_rate:.1%}")
        print(f"Legacy OCR: {legacy_success_rate:.1%}")
        
        # Quality distribution
        print(f"\nQUALITY DISTRIBUTION:")
        modern_high_quality = sum(1 for r in results if r['modern_confidence'] > 0.8)
        modern_medium_quality = sum(1 for r in results if 0.5 < r['modern_confidence'] <= 0.8)
        modern_low_quality = sum(1 for r in results if r['modern_confidence'] <= 0.5)
        
        legacy_high_quality = sum(1 for r in results if r['legacy_confidence'] > 0.8)
        legacy_medium_quality = sum(1 for r in results if 0.5 < r['legacy_confidence'] <= 0.8)
        legacy_low_quality = sum(1 for r in results if r['legacy_confidence'] <= 0.5)
        
        print(f"Modern - High: {modern_high_quality}, Medium: {modern_medium_quality}, Low: {modern_low_quality}")
        print(f"Legacy - High: {legacy_high_quality}, Medium: {legacy_medium_quality}, Low: {legacy_low_quality}")


class TestOCRRobustness:
    """Test OCR robustness with various image conditions"""
    
    def test_low_quality_images(self, modern_ocr):
        """Test OCR on low quality images"""
        # Create various low-quality test images
        test_images = []
        
        # Blurry image
        clear_img = np.ones((200, 400, 3), dtype=np.uint8) * 255
        cv2.putText(clear_img, "BANK STATEMENT 123456", (20, 100), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
        blurry_img = cv2.GaussianBlur(clear_img, (15, 15), 0)
        test_images.append(("blurry", blurry_img))
        
        # Noisy image
        noise = np.random.normal(0, 25, clear_img.shape).astype(np.uint8)
        noisy_img = cv2.add(clear_img, noise)
        test_images.append(("noisy", noisy_img))
        
        # Low contrast image
        low_contrast_img = cv2.convertScaleAbs(clear_img, alpha=0.5, beta=50)
        test_images.append(("low_contrast", low_contrast_img))
        
        # Small image
        small_img = cv2.resize(clear_img, (100, 50))
        test_images.append(("small", small_img))
        
        results = []
        for condition, img in test_images:
            result = modern_ocr.extract_with_confidence(img)
            results.append((condition, result))
            
            print(f"\n{condition.upper()} IMAGE:")
            print(f"  Text: '{result.text}'")
            print(f"  Confidence: {result.confidence:.2f}")
            print(f"  Processing time: {result.processing_time:.2f}s")
        
        # At least some images should produce results
        successful_extractions = sum(1 for _, result in results if result.text.strip())
        assert successful_extractions > 0, "Should successfully extract text from at least one low-quality image"
    
    def test_different_text_orientations(self, modern_ocr):
        """Test OCR with rotated text"""
        # Create base image
        base_img = np.ones((300, 400, 3), dtype=np.uint8) * 255
        cv2.putText(base_img, "ACCOUNT: 123456789", (50, 150), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
        
        # Test different rotations
        rotations = [0, 90, 180, 270]
        results = []
        
        for angle in rotations:
            if angle == 0:
                rotated_img = base_img
            else:
                # Rotate image
                center = (base_img.shape[1] // 2, base_img.shape[0] // 2)
                rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
                rotated_img = cv2.warpAffine(base_img, rotation_matrix, 
                                           (base_img.shape[1], base_img.shape[0]),
                                           borderValue=(255, 255, 255))
            
            result = modern_ocr.extract_text(rotated_img)
            results.append((angle, result))
            
            print(f"\nROTATION {angle}°:")
            print(f"  Text: '{result.text}'")
            print(f"  Confidence: {result.confidence:.2f}")
        
        # At least the 0° rotation should work well
        normal_result = next(result for angle, result in results if angle == 0)
        assert normal_result.confidence > 0.3, "Normal orientation should have reasonable confidence"


if __name__ == "__main__":
    # Run tests with verbose output
    pytest.main([__file__, "-v", "-s", "--tb=short"])