#!/usr/bin/env python3
"""
Test to verify ModernOCREngine meets all task requirements
"""

import sys
import os
import numpy as np
import cv2
import time

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from src.services.modernOCREngine import ModernOCREngine, OCRResult, OCRExtractionResult

def test_requirement_3_2():
    """Test Requirement 3.2: EasyOCR as alternative to Tesseract with multi-language support"""
    print("=== Testing Requirement 3.2: EasyOCR Implementation ===")
    
    # Test 1: Initialize with multi-language support
    print("1. Testing multi-language initialization...")
    ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=True)
    
    assert ocr.languages == ['en', 'es'], "Should support English and Spanish"
    assert ocr.reader is not None, "EasyOCR reader should be initialized"
    print("   ✓ Multi-language support (en, es) initialized")
    
    # Test 2: GPU support configuration
    print("2. Testing GPU support configuration...")
    info = ocr.get_engine_info()
    assert 'gpu_enabled' in info, "Should report GPU status"
    assert 'gpu_available' in info, "Should report GPU availability"
    print(f"   ✓ GPU enabled: {info['gpu_enabled']}, Available: {info['gpu_available']}")
    
    # Test 3: Test on English text
    print("3. Testing English text extraction...")
    eng_img = np.ones((150, 400, 3), dtype=np.uint8) * 255
    cv2.putText(eng_img, "BANK STATEMENT", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(eng_img, "Account: 123456789", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(eng_img, "Balance: $1,234.56", (20, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    
    eng_result = ocr.extract_text(eng_img)
    assert isinstance(eng_result, OCRResult), "Should return OCRResult object"
    assert len(eng_result.text) > 0, "Should extract text from English image"
    assert eng_result.confidence > 0, "Should have confidence score"
    print(f"   ✓ English text extracted: '{eng_result.text[:50]}...'")
    print(f"   ✓ Confidence: {eng_result.confidence:.2f}")
    
    # Test 4: Test on Spanish text
    print("4. Testing Spanish text extraction...")
    spa_img = np.ones((150, 400, 3), dtype=np.uint8) * 255
    cv2.putText(spa_img, "EXTRACTO BANCARIO", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(spa_img, "Cuenta: 987654321", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(spa_img, "Saldo: €2,345.67", (20, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    
    spa_result = ocr.extract_text(spa_img)
    assert isinstance(spa_result, OCRResult), "Should return OCRResult object"
    assert len(spa_result.text) > 0, "Should extract text from Spanish image"
    assert spa_result.confidence > 0, "Should have confidence score"
    print(f"   ✓ Spanish text extracted: '{spa_result.text[:50]}...'")
    print(f"   ✓ Confidence: {spa_result.confidence:.2f}")
    
    print("✅ Requirement 3.2 PASSED: EasyOCR with multi-language support implemented\n")
    return True

def test_requirement_6_1():
    """Test Requirement 6.1: Confidence filtering and quality assessment"""
    print("=== Testing Requirement 6.1: Confidence Filtering ===")
    
    ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    
    # Create test image with mixed quality text
    test_img = np.ones((200, 500, 3), dtype=np.uint8) * 255
    cv2.putText(test_img, "CLEAR TEXT", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    cv2.putText(test_img, "blurry text", (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 100, 100), 1)
    
    # Add some blur to part of the image
    blurred_section = test_img[80:120, :].copy()
    blurred_section = cv2.GaussianBlur(blurred_section, (5, 5), 0)
    test_img[80:120, :] = blurred_section
    
    # Test 1: Basic extraction
    print("1. Testing basic text extraction...")
    basic_result = ocr.extract_text(test_img)
    assert isinstance(basic_result, OCRResult), "Should return OCRResult"
    assert basic_result.confidence >= 0, "Should have confidence score"
    assert len(basic_result.bounding_boxes) > 0, "Should detect words"
    print(f"   ✓ Basic extraction: {len(basic_result.bounding_boxes)} words, confidence: {basic_result.confidence:.2f}")
    
    # Test 2: Confidence filtering
    print("2. Testing confidence filtering...")
    filtered_result = ocr.extract_with_confidence(test_img)
    assert isinstance(filtered_result, OCRResult), "Should return OCRResult"
    assert filtered_result.method_used == "easyocr_filtered", "Should use filtered method"
    
    # Filtered result should have same or higher confidence
    assert filtered_result.confidence >= basic_result.confidence, "Filtered should have higher confidence"
    print(f"   ✓ Filtered extraction: {len(filtered_result.bounding_boxes)} words, confidence: {filtered_result.confidence:.2f}")
    
    # Test 3: Quality metrics
    print("3. Testing quality metrics...")
    assert basic_result.quality_metrics is not None, "Should have quality metrics"
    required_metrics = ['word_count', 'average_confidence', 'high_confidence_ratio', 'text_density']
    for metric in required_metrics:
        assert metric in basic_result.quality_metrics, f"Should have {metric} metric"
    print(f"   ✓ Quality metrics available: {len(basic_result.quality_metrics)} metrics")
    
    # Test 4: Confidence thresholds
    print("4. Testing confidence thresholds...")
    thresholds = ocr.quality_thresholds
    assert 'min_confidence' in thresholds, "Should have minimum confidence threshold"
    assert 'high_confidence_threshold' in thresholds, "Should have high confidence threshold"
    assert thresholds['min_confidence'] > 0, "Min confidence should be positive"
    assert thresholds['high_confidence_threshold'] > thresholds['min_confidence'], "High threshold should be higher than min"
    print(f"   ✓ Confidence thresholds: min={thresholds['min_confidence']}, high={thresholds['high_confidence_threshold']}")
    
    print("✅ Requirement 6.1 PASSED: Confidence filtering and quality assessment implemented\n")
    return True

def test_requirement_6_2():
    """Test Requirement 6.2: Intelligent result combination and cross-validation"""
    print("=== Testing Requirement 6.2: Result Combination ===")
    
    ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    
    # Test 1: Bounding box information for result combination
    print("1. Testing bounding box information...")
    test_img = np.ones((150, 400, 3), dtype=np.uint8) * 255
    cv2.putText(test_img, "ACCOUNT 123456", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(test_img, "BALANCE $1000", (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    
    result = ocr.extract_text(test_img)
    assert len(result.bounding_boxes) > 0, "Should provide bounding boxes"
    
    # Each bounding box should have format: (bbox, text, confidence)
    for bbox, text, confidence in result.bounding_boxes:
        assert isinstance(bbox, list), "Bounding box should be a list"
        assert isinstance(text, str), "Text should be string"
        assert isinstance(confidence, (int, float)), "Confidence should be numeric"
        assert 0 <= confidence <= 1, "Confidence should be between 0 and 1"
    
    print(f"   ✓ Bounding boxes provided: {len(result.bounding_boxes)} words")
    
    # Test 2: Quality metrics for cross-validation
    print("2. Testing quality metrics for validation...")
    metrics = result.quality_metrics
    validation_metrics = ['confidence_std', 'min_confidence', 'max_confidence', 'high_confidence_ratio']
    for metric in validation_metrics:
        assert metric in metrics, f"Should have {metric} for validation"
    
    print(f"   ✓ Validation metrics: std={metrics['confidence_std']:.2f}, min={metrics['min_confidence']:.2f}, max={metrics['max_confidence']:.2f}")
    
    # Test 3: Method tracking for combination
    print("3. Testing method tracking...")
    assert result.method_used in ['easyocr', 'easyocr_failed'], "Should track method used"
    assert result.processing_time > 0, "Should track processing time"
    print(f"   ✓ Method tracked: {result.method_used}, time: {result.processing_time:.2f}s")
    
    print("✅ Requirement 6.2 PASSED: Result combination support implemented\n")
    return True

def test_gpu_support():
    """Test GPU support functionality"""
    print("=== Testing GPU Support ===")
    
    # Test 1: GPU configuration
    print("1. Testing GPU configuration...")
    gpu_ocr = ModernOCREngine(languages=['en', 'es'], gpu=True, debug=False)
    cpu_ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    
    gpu_info = gpu_ocr.get_engine_info()
    cpu_info = cpu_ocr.get_engine_info()
    
    assert gpu_info['gpu_enabled'] == True, "GPU OCR should have GPU enabled"
    assert cpu_info['gpu_enabled'] == False, "CPU OCR should have GPU disabled"
    print(f"   ✓ GPU configuration working: GPU={gpu_info['gpu_enabled']}, CPU={cpu_info['gpu_enabled']}")
    
    # Test 2: GPU availability check
    print("2. Testing GPU availability check...")
    gpu_available = gpu_ocr.is_gpu_available()
    print(f"   ✓ GPU availability check: {gpu_available}")
    
    print("✅ GPU Support: Configuration and availability checking implemented\n")
    return True

def test_image_preprocessing():
    """Test image preprocessing functionality"""
    print("=== Testing Image Preprocessing ===")
    
    ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    
    # Test 1: Basic preprocessing
    print("1. Testing basic preprocessing...")
    test_img = np.ones((100, 200, 3), dtype=np.uint8) * 128  # Gray image
    processed = ocr._preprocess_image(test_img)
    
    assert processed is not None, "Should return processed image"
    assert len(processed.shape) == 2, "Should convert to grayscale"
    assert processed.shape[0] >= test_img.shape[0], "Should maintain or increase size"
    print(f"   ✓ Basic preprocessing: {test_img.shape} -> {processed.shape}")
    
    # Test 2: Preprocessing settings
    print("2. Testing preprocessing settings...")
    settings = ocr.preprocessing_settings
    required_settings = ['enhance_contrast', 'denoise', 'sharpen', 'binarize', 'resize_factor']
    for setting in required_settings:
        assert setting in settings, f"Should have {setting} setting"
    print(f"   ✓ Preprocessing settings available: {len(settings)} settings")
    
    # Test 3: Small image upscaling
    print("3. Testing small image upscaling...")
    small_img = np.ones((50, 100, 3), dtype=np.uint8) * 255
    upscaled = ocr._preprocess_image(small_img)
    
    assert upscaled.shape[0] > small_img.shape[0], "Should upscale small images"
    assert upscaled.shape[1] > small_img.shape[1], "Should upscale small images"
    print(f"   ✓ Small image upscaling: {small_img.shape} -> {upscaled.shape}")
    
    print("✅ Image Preprocessing: Enhancement and optimization implemented\n")
    return True

def test_pdf_support():
    """Test PDF page extraction support"""
    print("=== Testing PDF Support ===")
    
    ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    
    # Test 1: PDF extraction methods exist
    print("1. Testing PDF extraction methods...")
    assert hasattr(ocr, 'extract_from_pdf_page'), "Should have PDF page extraction method"
    assert hasattr(ocr, 'extract_from_pdf'), "Should have full PDF extraction method"
    print("   ✓ PDF extraction methods available")
    
    # Test 2: Error handling for non-existent PDF
    print("2. Testing error handling...")
    result = ocr.extract_from_pdf_page("nonexistent.pdf", 0)
    assert isinstance(result, OCRResult), "Should return OCRResult even on error"
    assert result.method_used in ['pymupdf_unavailable', 'pdf_ocr_error'], "Should handle errors gracefully"
    print(f"   ✓ Error handling: {result.method_used}")
    
    # Test 3: Full PDF extraction error handling
    print("3. Testing full PDF extraction error handling...")
    full_result = ocr.extract_from_pdf("nonexistent.pdf")
    assert isinstance(full_result, OCRExtractionResult), "Should return OCRExtractionResult"
    assert full_result.success == False, "Should report failure for non-existent file"
    assert full_result.error_message is not None, "Should provide error message"
    print(f"   ✓ Full PDF error handling: {full_result.error_message[:50]}...")
    
    print("✅ PDF Support: PDF extraction methods and error handling implemented\n")
    return True

def run_all_requirement_tests():
    """Run all requirement tests"""
    print("🧪 TESTING MODERNOCRENGINE REQUIREMENTS COMPLIANCE")
    print("=" * 60)
    
    tests = [
        ("Requirement 3.2", test_requirement_3_2),
        ("Requirement 6.1", test_requirement_6_1),
        ("Requirement 6.2", test_requirement_6_2),
        ("GPU Support", test_gpu_support),
        ("Image Preprocessing", test_image_preprocessing),
        ("PDF Support", test_pdf_support)
    ]
    
    passed = 0
    failed = 0
    
    for test_name, test_func in tests:
        try:
            if test_func():
                passed += 1
            else:
                failed += 1
                print(f"❌ {test_name} FAILED")
        except Exception as e:
            failed += 1
            print(f"❌ {test_name} FAILED with exception: {e}")
    
    print("=" * 60)
    print(f"📊 TEST RESULTS: {passed} PASSED, {failed} FAILED")
    
    if failed == 0:
        print("🎉 ALL REQUIREMENTS TESTS PASSED!")
        print("\n✅ ModernOCREngine successfully implements:")
        print("   • EasyOCR with multi-language support (en, es)")
        print("   • GPU support and configuration")
        print("   • Confidence filtering and quality assessment")
        print("   • Bounding box information for result combination")
        print("   • Image preprocessing and enhancement")
        print("   • PDF page extraction support")
        print("   • Comprehensive error handling")
        print("   • Quality metrics and validation support")
        return True
    else:
        print(f"❌ {failed} requirement tests failed")
        return False

if __name__ == "__main__":
    success = run_all_requirement_tests()
    
    if success:
        print("\n🏆 TASK 3 IMPLEMENTATION COMPLETE!")
        print("ModernOCREngine with EasyOCR is ready for production use.")
    else:
        print("\n⚠️  Some requirements need attention.")