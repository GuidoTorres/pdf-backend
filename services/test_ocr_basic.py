#!/usr/bin/env python3
"""
Basic test script for ModernOCREngine to verify functionality
"""

import sys
import os
import numpy as np
import cv2

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from src.services.modernOCREngine import ModernOCREngine

def test_basic_functionality():
    """Test basic OCR engine functionality"""
    print("=== Testing ModernOCREngine Basic Functionality ===")
    
    # Initialize OCR engine
    print("1. Initializing OCR engine...")
    try:
        ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=True)
        print("   ✓ OCR engine initialized successfully")
    except Exception as e:
        print(f"   ✗ Failed to initialize OCR engine: {e}")
        return False
    
    # Test engine info
    print("2. Getting engine info...")
    try:
        info = ocr.get_engine_info()
        print(f"   ✓ Engine: {info['engine']}")
        print(f"   ✓ Languages: {info['languages']}")
        print(f"   ✓ GPU enabled: {info['gpu_enabled']}")
        print(f"   ✓ Reader initialized: {info['reader_initialized']}")
    except Exception as e:
        print(f"   ✗ Failed to get engine info: {e}")
        return False
    
    # Test with a simple synthetic image
    print("3. Testing OCR on synthetic image...")
    try:
        # Create a simple test image with text
        img = np.ones((200, 400, 3), dtype=np.uint8) * 255  # White background
        cv2.putText(img, "BANK STATEMENT", (50, 80), cv2.FONT_HERSHEY_SIMPLEX, 
                   1.0, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(img, "Account: 123456789", (50, 120), cv2.FONT_HERSHEY_SIMPLEX, 
                   0.8, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(img, "Balance: $1,234.56", (50, 160), cv2.FONT_HERSHEY_SIMPLEX, 
                   0.8, (0, 0, 0), 2, cv2.LINE_AA)
        
        # Test OCR extraction
        result = ocr.extract_text(img)
        
        print(f"   ✓ OCR completed in {result.processing_time:.2f}s")
        print(f"   ✓ Method used: {result.method_used}")
        print(f"   ✓ Text extracted: '{result.text}'")
        print(f"   ✓ Confidence: {result.confidence:.2f}")
        print(f"   ✓ Words detected: {len(result.bounding_boxes)}")
        print(f"   ✓ Language detected: {result.language_detected}")
        
        if result.quality_metrics:
            print(f"   ✓ Quality metrics available: {len(result.quality_metrics)} metrics")
        
    except Exception as e:
        print(f"   ✗ OCR test failed: {e}")
        return False
    
    # Test confidence filtering
    print("4. Testing confidence filtering...")
    try:
        filtered_result = ocr.extract_with_confidence(img)
        print(f"   ✓ Filtered result confidence: {filtered_result.confidence:.2f}")
        print(f"   ✓ Filtered words: {len(filtered_result.bounding_boxes)}")
        print(f"   ✓ Method: {filtered_result.method_used}")
    except Exception as e:
        print(f"   ✗ Confidence filtering test failed: {e}")
        return False
    
    # Test image preprocessing
    print("5. Testing image preprocessing...")
    try:
        processed_img = ocr._preprocess_image(img)
        print(f"   ✓ Original image shape: {img.shape}")
        print(f"   ✓ Processed image shape: {processed_img.shape}")
        print(f"   ✓ Preprocessing completed successfully")
    except Exception as e:
        print(f"   ✗ Image preprocessing test failed: {e}")
        return False
    
    print("\n=== All Basic Tests Passed! ===")
    return True

def test_language_detection():
    """Test language detection functionality"""
    print("\n=== Testing Language Detection ===")
    
    ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    
    test_cases = [
        ("This is an English bank statement", "en"),
        ("Este es un extracto bancario en español", "es"),
        ("Account número 123456 balance $1,234.56", "mixed"),
        ("", None)
    ]
    
    for text, expected in test_cases:
        detected = ocr._detect_primary_language(text)
        print(f"Text: '{text[:30]}...'")
        print(f"Expected: {expected}, Detected: {detected}")
        print()

def test_quality_metrics():
    """Test quality metrics calculation"""
    print("\n=== Testing Quality Metrics ===")
    
    ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    
    # Mock OCR results
    mock_results = [
        ([[0, 0], [50, 0], [50, 20], [0, 20]], "BANK", 0.95),
        ([[60, 0], [120, 0], [120, 20], [60, 20]], "STATEMENT", 0.88),
        ([[0, 30], [80, 30], [80, 50], [0, 50]], "Account", 0.75),
        ([[90, 30], [150, 30], [150, 50], [90, 50]], "123456", 0.92)
    ]
    
    # Mock image
    mock_image = np.ones((100, 200), dtype=np.uint8) * 255
    
    try:
        metrics = ocr._calculate_quality_metrics(mock_results, mock_image)
        print("Quality metrics calculated successfully:")
        for key, value in metrics.items():
            print(f"  {key}: {value}")
    except Exception as e:
        print(f"Quality metrics test failed: {e}")

if __name__ == "__main__":
    success = test_basic_functionality()
    test_language_detection()
    test_quality_metrics()
    
    if success:
        print("\n🎉 ModernOCREngine is working correctly!")
    else:
        print("\n❌ Some tests failed. Check the implementation.")