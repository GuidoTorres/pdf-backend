#!/usr/bin/env python3
"""
Test to demonstrate EasyOCR strengths vs Tesseract on challenging images
"""

import sys
import os
import numpy as np
import cv2
import time

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from src.services.modernOCREngine import ModernOCREngine

# Try to import Tesseract for comparison
try:
    import pytesseract
    from PIL import Image
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    print("Warning: Tesseract not available for comparison")

def create_challenging_images():
    """Create challenging test images where EasyOCR should excel"""
    images = []
    
    # Test 1: Very noisy image
    img1 = np.ones((200, 400, 3), dtype=np.uint8) * 255
    cv2.putText(img1, "Account: 123456789", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(img1, "Balance: $1,234.56", (20, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    # Add heavy noise
    noise = np.random.normal(0, 50, img1.shape).astype(np.uint8)
    img1 = cv2.add(img1, noise)
    images.append(("Heavy Noise", img1))
    
    # Test 2: Very blurry image
    img2 = np.ones((200, 400, 3), dtype=np.uint8) * 255
    cv2.putText(img2, "Transaction History", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img2, "2024-01-15 ATM -$50", (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.putText(img2, "2024-01-16 DEP +$500", (20, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    # Add heavy blur
    img2 = cv2.GaussianBlur(img2, (15, 15), 0)
    images.append(("Heavy Blur", img2))
    
    # Test 3: Low resolution image
    img3 = np.ones((80, 160, 3), dtype=np.uint8) * 255
    cv2.putText(img3, "BANK", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
    cv2.putText(img3, "ACC:123", (10, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    cv2.putText(img3, "$999", (10, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    images.append(("Low Resolution", img3))
    
    # Test 4: Rotated text
    img4 = np.ones((300, 400, 3), dtype=np.uint8) * 255
    cv2.putText(img4, "STATEMENT", (50, 150), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    cv2.putText(img4, "Account: 987654321", (50, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    # Rotate 15 degrees
    center = (img4.shape[1] // 2, img4.shape[0] // 2)
    rotation_matrix = cv2.getRotationMatrix2D(center, 15, 1.0)
    img4 = cv2.warpAffine(img4, rotation_matrix, (img4.shape[1], img4.shape[0]), borderValue=(255, 255, 255))
    images.append(("Rotated Text", img4))
    
    # Test 5: Mixed fonts and sizes (simulated)
    img5 = np.ones((250, 450, 3), dtype=np.uint8) * 255
    cv2.putText(img5, "BANK STATEMENT", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
    cv2.putText(img5, "Account Number:", (20, 80), cv2.FONT_HERSHEY_COMPLEX, 0.6, (0, 0, 0), 1)
    cv2.putText(img5, "1234567890", (200, 80), cv2.FONT_HERSHEY_PLAIN, 0.8, (0, 0, 0), 2)
    cv2.putText(img5, "Current Balance:", (20, 120), cv2.FONT_HERSHEY_COMPLEX, 0.6, (0, 0, 0), 1)
    cv2.putText(img5, "$2,345.67", (200, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(img5, "Last Transaction:", (20, 160), cv2.FONT_HERSHEY_COMPLEX, 0.5, (0, 0, 0), 1)
    cv2.putText(img5, "ATM Withdrawal -$100.00", (20, 190), cv2.FONT_HERSHEY_PLAIN, 0.6, (0, 0, 0), 1)
    images.append(("Mixed Fonts", img5))
    
    # Test 6: Very low contrast
    img6 = np.ones((200, 400, 3), dtype=np.uint8) * 240  # Light gray background
    cv2.putText(img6, "EXTRACTO BANCARIO", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 2)  # Light gray text
    cv2.putText(img6, "Cuenta: 555666777", (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 2)
    cv2.putText(img6, "Saldo: €1,500.00", (20, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 2)
    images.append(("Very Low Contrast", img6))
    
    return images

def test_tesseract_ocr(image):
    """Test Tesseract OCR on image"""
    if not TESSERACT_AVAILABLE:
        return {
            'text': '',
            'confidence': 0.0,
            'processing_time': 0.0,
            'method': 'tesseract_unavailable'
        }
    
    start_time = time.time()
    
    try:
        # Convert to PIL Image
        if len(image.shape) == 3:
            pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        else:
            pil_image = Image.fromarray(image)
        
        # Try different PSM modes for challenging images
        configs = [
            '--oem 3 --psm 6',  # Uniform block of text
            '--oem 3 --psm 8',  # Single word
            '--oem 3 --psm 7',  # Single text line
            '--oem 3 --psm 13'  # Raw line (no specific layout)
        ]
        
        best_result = {'text': '', 'confidence': 0.0}
        
        for config in configs:
            try:
                text = pytesseract.image_to_string(pil_image, config=config)
                if text.strip():
                    # Get confidence
                    try:
                        data = pytesseract.image_to_data(pil_image, output_type=pytesseract.Output.DICT, config=config)
                        confidences = [int(conf) for conf in data['conf'] if int(conf) > 0]
                        avg_confidence = np.mean(confidences) / 100.0 if confidences else 0.0
                    except:
                        avg_confidence = 0.3
                    
                    if avg_confidence > best_result['confidence']:
                        best_result = {'text': text.strip(), 'confidence': avg_confidence}
            except:
                continue
        
        processing_time = time.time() - start_time
        
        return {
            'text': best_result['text'],
            'confidence': best_result['confidence'],
            'processing_time': processing_time,
            'method': 'tesseract_multi_psm'
        }
        
    except Exception as e:
        processing_time = time.time() - start_time
        return {
            'text': '',
            'confidence': 0.0,
            'processing_time': processing_time,
            'method': 'tesseract_error',
            'error': str(e)
        }

def run_challenging_comparison():
    """Run OCR comparison on challenging images"""
    print("=== EasyOCR vs Tesseract: Challenging Images Test ===\n")
    
    # Initialize Modern OCR Engine
    print("Initializing EasyOCR...")
    modern_ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    print("EasyOCR initialized successfully!\n")
    
    # Create challenging test images
    test_images = create_challenging_images()
    
    results = []
    easyocr_wins = 0
    tesseract_wins = 0
    ties = 0
    
    for image_name, image in test_images:
        print(f"Testing: {image_name}")
        print("-" * 50)
        
        # Test EasyOCR
        print("EasyOCR Results:")
        easyocr_result = modern_ocr.extract_with_confidence(image)
        print(f"  Text: '{easyocr_result.text}'")
        print(f"  Confidence: {easyocr_result.confidence:.2f}")
        print(f"  Processing Time: {easyocr_result.processing_time:.2f}s")
        print(f"  Words Detected: {len(easyocr_result.bounding_boxes)}")
        print(f"  Language: {easyocr_result.language_detected}")
        
        # Test Tesseract
        print("\nTesseract Results:")
        tesseract_result = test_tesseract_ocr(image)
        print(f"  Text: '{tesseract_result['text']}'")
        print(f"  Confidence: {tesseract_result['confidence']:.2f}")
        print(f"  Processing Time: {tesseract_result['processing_time']:.2f}s")
        print(f"  Method: {tesseract_result['method']}")
        
        # Determine winner for this test
        easyocr_score = calculate_score(easyocr_result.text, easyocr_result.confidence)
        tesseract_score = calculate_score(tesseract_result['text'], tesseract_result['confidence'])
        
        print(f"\nScores (text_length * confidence):")
        print(f"  EasyOCR: {easyocr_score:.2f}")
        print(f"  Tesseract: {tesseract_score:.2f}")
        
        if easyocr_score > tesseract_score * 1.1:  # 10% margin for clear win
            print(f"  🏆 Winner: EasyOCR")
            easyocr_wins += 1
        elif tesseract_score > easyocr_score * 1.1:
            print(f"  🏆 Winner: Tesseract")
            tesseract_wins += 1
        else:
            print(f"  🤝 Tie")
            ties += 1
        
        # Store results
        results.append({
            'image_name': image_name,
            'easyocr': {
                'text': easyocr_result.text,
                'confidence': easyocr_result.confidence,
                'time': easyocr_result.processing_time,
                'score': easyocr_score
            },
            'tesseract': {
                'text': tesseract_result['text'],
                'confidence': tesseract_result['confidence'],
                'time': tesseract_result['processing_time'],
                'score': tesseract_score
            }
        })
        
        print("\n" + "="*70 + "\n")
    
    # Print final summary
    print_challenging_summary(results, easyocr_wins, tesseract_wins, ties)

def calculate_score(text, confidence):
    """Calculate a combined score based on text length and confidence"""
    text_length = len(text.strip())
    if text_length == 0:
        return 0.0
    return text_length * confidence

def print_challenging_summary(results, easyocr_wins, tesseract_wins, ties):
    """Print summary of challenging image tests"""
    print("=== CHALLENGING IMAGES SUMMARY ===")
    
    total_tests = len(results)
    print(f"\nTest Results ({total_tests} tests):")
    print(f"  🏆 EasyOCR wins: {easyocr_wins}")
    print(f"  🏆 Tesseract wins: {tesseract_wins}")
    print(f"  🤝 Ties: {ties}")
    
    if easyocr_wins > tesseract_wins:
        print(f"\n🎉 Overall Winner: EasyOCR ({easyocr_wins}/{total_tests} wins)")
    elif tesseract_wins > easyocr_wins:
        print(f"\n🎉 Overall Winner: Tesseract ({tesseract_wins}/{total_tests} wins)")
    else:
        print(f"\n🤝 Overall Result: Tie")
    
    # Calculate averages for successful extractions only
    easyocr_successful = [r for r in results if len(r['easyocr']['text'].strip()) > 0]
    tesseract_successful = [r for r in results if len(r['tesseract']['text'].strip()) > 0]
    
    if easyocr_successful:
        avg_easyocr_confidence = np.mean([r['easyocr']['confidence'] for r in easyocr_successful])
        avg_easyocr_time = np.mean([r['easyocr']['time'] for r in easyocr_successful])
        print(f"\nEasyOCR (successful extractions: {len(easyocr_successful)}/{total_tests}):")
        print(f"  Average confidence: {avg_easyocr_confidence:.2f}")
        print(f"  Average time: {avg_easyocr_time:.2f}s")
    
    if tesseract_successful:
        avg_tesseract_confidence = np.mean([r['tesseract']['confidence'] for r in tesseract_successful])
        avg_tesseract_time = np.mean([r['tesseract']['time'] for r in tesseract_successful])
        print(f"\nTesseract (successful extractions: {len(tesseract_successful)}/{total_tests}):")
        print(f"  Average confidence: {avg_tesseract_confidence:.2f}")
        print(f"  Average time: {avg_tesseract_time:.2f}s")
    
    # Show specific strengths
    print(f"\n📊 Detailed Analysis:")
    for result in results:
        image_name = result['image_name']
        easyocr_success = len(result['easyocr']['text'].strip()) > 0
        tesseract_success = len(result['tesseract']['text'].strip()) > 0
        
        if easyocr_success and not tesseract_success:
            print(f"  ✅ EasyOCR excelled on: {image_name}")
        elif tesseract_success and not easyocr_success:
            print(f"  ✅ Tesseract excelled on: {image_name}")
        elif easyocr_success and tesseract_success:
            if result['easyocr']['score'] > result['tesseract']['score'] * 1.2:
                print(f"  🏆 EasyOCR significantly better on: {image_name}")
            elif result['tesseract']['score'] > result['easyocr']['score'] * 1.2:
                print(f"  🏆 Tesseract significantly better on: {image_name}")
        else:
            print(f"  ❌ Both failed on: {image_name}")

def demonstrate_easyocr_features():
    """Demonstrate specific EasyOCR features"""
    print("\n=== EasyOCR Specific Features Demo ===")
    
    ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    
    # Test multilingual detection
    print("\n1. Multilingual Text Detection:")
    mixed_img = np.ones((150, 400, 3), dtype=np.uint8) * 255
    cv2.putText(mixed_img, "Account número 123456", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(mixed_img, "Balance saldo $1,234.56", (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    
    result = ocr.extract_with_confidence(mixed_img)
    print(f"  Text: {result.text}")
    print(f"  Detected Language: {result.language_detected}")
    print(f"  Confidence: {result.confidence:.2f}")
    
    # Test bounding box information
    print(f"\n2. Detailed Bounding Box Information:")
    print(f"  Total words detected: {len(result.bounding_boxes)}")
    for i, (bbox, text, conf) in enumerate(result.bounding_boxes[:3]):  # Show first 3
        print(f"    Word {i+1}: '{text}' (confidence: {conf:.2f})")
    
    # Test quality metrics
    print(f"\n3. Quality Metrics:")
    if result.quality_metrics:
        key_metrics = ['word_count', 'average_confidence', 'high_confidence_ratio', 'text_density']
        for metric in key_metrics:
            if metric in result.quality_metrics:
                print(f"  {metric}: {result.quality_metrics[metric]:.2f}")

if __name__ == "__main__":
    run_challenging_comparison()
    demonstrate_easyocr_features()