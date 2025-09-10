#!/usr/bin/env python3
"""
Simple comparison test between ModernOCREngine (EasyOCR) and Tesseract
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

def create_test_images():
    """Create test images with banking content"""
    images = []
    
    # Test image 1: Clear banking statement
    img1 = np.ones((300, 500, 3), dtype=np.uint8) * 255
    cv2.putText(img1, "BANK STATEMENT", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    cv2.putText(img1, "Account Number: 1234567890", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img1, "Date: 2024-01-15", (50, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img1, "Balance: $2,345.67", (50, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img1, "Transaction: ATM Withdrawal", (50, 220), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img1, "Amount: -$100.00", (50, 260), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    images.append(("Clear Banking Statement", img1))
    
    # Test image 2: Spanish banking content
    img2 = np.ones((300, 500, 3), dtype=np.uint8) * 255
    cv2.putText(img2, "EXTRACTO BANCARIO", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    cv2.putText(img2, "Numero de Cuenta: 9876543210", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img2, "Fecha: 15/01/2024", (50, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img2, "Saldo: €1,234.56", (50, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img2, "Transaccion: Transferencia", (50, 220), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img2, "Importe: +€500.00", (50, 260), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    images.append(("Spanish Banking Statement", img2))
    
    # Test image 3: Slightly blurry image
    img3 = img1.copy()
    img3 = cv2.GaussianBlur(img3, (3, 3), 0)
    images.append(("Slightly Blurry Statement", img3))
    
    # Test image 4: Low contrast image
    img4 = cv2.convertScaleAbs(img1, alpha=0.7, beta=30)
    images.append(("Low Contrast Statement", img4))
    
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
        
        # Extract text
        text = pytesseract.image_to_string(pil_image, config='--oem 3 --psm 6')
        
        # Get confidence
        try:
            data = pytesseract.image_to_data(pil_image, output_type=pytesseract.Output.DICT)
            confidences = [int(conf) for conf in data['conf'] if int(conf) > 0]
            avg_confidence = np.mean(confidences) / 100.0 if confidences else 0.0
        except:
            avg_confidence = 0.5
        
        processing_time = time.time() - start_time
        
        return {
            'text': text.strip(),
            'confidence': avg_confidence,
            'processing_time': processing_time,
            'method': 'tesseract'
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

def run_comparison():
    """Run OCR comparison between EasyOCR and Tesseract"""
    print("=== OCR Engine Comparison: EasyOCR vs Tesseract ===\n")
    
    # Initialize Modern OCR Engine
    print("Initializing EasyOCR...")
    modern_ocr = ModernOCREngine(languages=['en', 'es'], gpu=False, debug=False)
    print("EasyOCR initialized successfully!\n")
    
    # Create test images
    test_images = create_test_images()
    
    results = []
    
    for image_name, image in test_images:
        print(f"Testing: {image_name}")
        print("-" * 50)
        
        # Test EasyOCR
        print("EasyOCR Results:")
        easyocr_result = modern_ocr.extract_with_confidence(image)
        print(f"  Text: {easyocr_result.text}")
        print(f"  Confidence: {easyocr_result.confidence:.2f}")
        print(f"  Processing Time: {easyocr_result.processing_time:.2f}s")
        print(f"  Words Detected: {len(easyocr_result.bounding_boxes)}")
        print(f"  Language Detected: {easyocr_result.language_detected}")
        
        # Test Tesseract
        print("\nTesseract Results:")
        tesseract_result = test_tesseract_ocr(image)
        print(f"  Text: {tesseract_result['text']}")
        print(f"  Confidence: {tesseract_result['confidence']:.2f}")
        print(f"  Processing Time: {tesseract_result['processing_time']:.2f}s")
        print(f"  Method: {tesseract_result['method']}")
        
        # Compare results
        print("\nComparison:")
        easyocr_words = len(easyocr_result.text.split())
        tesseract_words = len(tesseract_result['text'].split())
        
        print(f"  Word Count - EasyOCR: {easyocr_words}, Tesseract: {tesseract_words}")
        
        if easyocr_result.confidence > tesseract_result['confidence']:
            print(f"  🏆 EasyOCR has higher confidence ({easyocr_result.confidence:.2f} vs {tesseract_result['confidence']:.2f})")
        elif tesseract_result['confidence'] > easyocr_result.confidence:
            print(f"  🏆 Tesseract has higher confidence ({tesseract_result['confidence']:.2f} vs {easyocr_result.confidence:.2f})")
        else:
            print(f"  🤝 Similar confidence levels")
        
        if easyocr_result.processing_time < tesseract_result['processing_time']:
            print(f"  ⚡ EasyOCR is faster ({easyocr_result.processing_time:.2f}s vs {tesseract_result['processing_time']:.2f}s)")
        elif tesseract_result['processing_time'] < easyocr_result.processing_time:
            print(f"  ⚡ Tesseract is faster ({tesseract_result['processing_time']:.2f}s vs {easyocr_result.processing_time:.2f}s)")
        else:
            print(f"  ⏱️ Similar processing times")
        
        # Store results for summary
        results.append({
            'image_name': image_name,
            'easyocr': {
                'text_length': len(easyocr_result.text),
                'confidence': easyocr_result.confidence,
                'time': easyocr_result.processing_time,
                'words': easyocr_words
            },
            'tesseract': {
                'text_length': len(tesseract_result['text']),
                'confidence': tesseract_result['confidence'],
                'time': tesseract_result['processing_time'],
                'words': tesseract_words
            }
        })
        
        print("\n" + "="*70 + "\n")
    
    # Print summary
    print_summary(results)

def print_summary(results):
    """Print comparison summary"""
    print("=== COMPARISON SUMMARY ===")
    
    if not results:
        print("No results to summarize")
        return
    
    # Calculate averages
    avg_easyocr_confidence = np.mean([r['easyocr']['confidence'] for r in results])
    avg_tesseract_confidence = np.mean([r['tesseract']['confidence'] for r in results])
    avg_easyocr_time = np.mean([r['easyocr']['time'] for r in results])
    avg_tesseract_time = np.mean([r['tesseract']['time'] for r in results])
    avg_easyocr_words = np.mean([r['easyocr']['words'] for r in results])
    avg_tesseract_words = np.mean([r['tesseract']['words'] for r in results])
    
    print(f"\nAverage Performance:")
    print(f"  Confidence - EasyOCR: {avg_easyocr_confidence:.2f}, Tesseract: {avg_tesseract_confidence:.2f}")
    print(f"  Processing Time - EasyOCR: {avg_easyocr_time:.2f}s, Tesseract: {avg_tesseract_time:.2f}s")
    print(f"  Words Detected - EasyOCR: {avg_easyocr_words:.1f}, Tesseract: {avg_tesseract_words:.1f}")
    
    # Determine winners
    print(f"\nOverall Winners:")
    if avg_easyocr_confidence > avg_tesseract_confidence:
        print(f"  🏆 Confidence: EasyOCR ({avg_easyocr_confidence:.2f} vs {avg_tesseract_confidence:.2f})")
    elif avg_tesseract_confidence > avg_easyocr_confidence:
        print(f"  🏆 Confidence: Tesseract ({avg_tesseract_confidence:.2f} vs {avg_easyocr_confidence:.2f})")
    else:
        print(f"  🤝 Confidence: Tie")
    
    if avg_easyocr_time < avg_tesseract_time:
        print(f"  ⚡ Speed: EasyOCR ({avg_easyocr_time:.2f}s vs {avg_tesseract_time:.2f}s)")
    elif avg_tesseract_time < avg_easyocr_time:
        print(f"  ⚡ Speed: Tesseract ({avg_tesseract_time:.2f}s vs {avg_easyocr_time:.2f}s)")
    else:
        print(f"  ⏱️ Speed: Tie")
    
    if avg_easyocr_words > avg_tesseract_words:
        print(f"  📝 Word Detection: EasyOCR ({avg_easyocr_words:.1f} vs {avg_tesseract_words:.1f})")
    elif avg_tesseract_words > avg_easyocr_words:
        print(f"  📝 Word Detection: Tesseract ({avg_tesseract_words:.1f} vs {avg_easyocr_words:.1f})")
    else:
        print(f"  📝 Word Detection: Tie")
    
    # Calculate improvement percentages
    if avg_tesseract_confidence > 0:
        confidence_improvement = ((avg_easyocr_confidence - avg_tesseract_confidence) / avg_tesseract_confidence) * 100
        print(f"\nEasyOCR Improvements:")
        print(f"  Confidence: {confidence_improvement:+.1f}%")
    
    if avg_tesseract_time > 0:
        speed_ratio = avg_tesseract_time / avg_easyocr_time
        print(f"  Speed: {speed_ratio:.1f}x {'faster' if speed_ratio > 1 else 'slower'}")
    
    print(f"\n✅ Comparison completed successfully!")

if __name__ == "__main__":
    run_comparison()