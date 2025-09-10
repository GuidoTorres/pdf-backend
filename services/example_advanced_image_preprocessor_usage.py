#!/usr/bin/env python3
"""
Example usage of AdvancedImagePreprocessor

This script demonstrates how to use the AdvancedImagePreprocessor
for document image enhancement and OCR optimization.
"""

import sys
import os
import numpy as np
import cv2
from pathlib import Path

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

try:
    from services.advancedImagePreprocessor import AdvancedImagePreprocessor
    PREPROCESSOR_AVAILABLE = True
except ImportError as e:
    print(f"Error: Could not import AdvancedImagePreprocessor: {e}")
    PREPROCESSOR_AVAILABLE = False


def create_sample_document_image():
    """Create a sample document image for demonstration"""
    # Create a document-like image
    image = np.ones((800, 600), dtype=np.uint8) * 255  # White background
    
    # Add title
    cv2.rectangle(image, (50, 50), (550, 100), 0, -1)
    cv2.putText(image, "BANK STATEMENT", (60, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, 255, 2)
    
    # Add some text lines
    lines = [
        "Account Number: 1234567890",
        "Statement Period: Jan 1 - Jan 31, 2024",
        "Account Holder: John Doe",
        "",
        "TRANSACTIONS:",
    ]
    
    y_pos = 150
    for line in lines:
        if line:
            cv2.putText(image, line, (60, y_pos), cv2.FONT_HERSHEY_SIMPLEX, 0.6, 0, 1)
        y_pos += 30
    
    # Add a table structure
    table_data = [
        ["Date", "Description", "Amount", "Balance"],
        ["01/01", "Opening Balance", "", "1,000.00"],
        ["01/05", "ATM Withdrawal", "-200.00", "800.00"],
        ["01/10", "Direct Deposit", "+2,500.00", "3,300.00"],
        ["01/15", "Online Purchase", "-45.99", "3,254.01"],
        ["01/20", "Transfer", "-500.00", "2,754.01"],
    ]
    
    # Draw table
    start_y = 300
    row_height = 35
    col_widths = [80, 200, 100, 100]
    
    for i, row in enumerate(table_data):
        y = start_y + i * row_height
        x = 60
        
        for j, cell in enumerate(row):
            # Draw cell border
            cv2.rectangle(image, (x, y), (x + col_widths[j], y + row_height), 0, 1)
            
            # Add text
            if cell:
                font_scale = 0.5 if i == 0 else 0.4
                thickness = 2 if i == 0 else 1
                cv2.putText(image, cell, (x + 5, y + 25), cv2.FONT_HERSHEY_SIMPLEX, 
                           font_scale, 0, thickness)
            
            x += col_widths[j]
    
    return image


def demonstrate_basic_usage():
    """Demonstrate basic usage of AdvancedImagePreprocessor"""
    print("=== Basic Usage Demonstration ===")
    
    # Initialize preprocessor
    preprocessor = AdvancedImagePreprocessor(debug=True)
    
    # Create sample image
    sample_image = create_sample_document_image()
    print(f"Created sample image: {sample_image.shape}")
    
    # 1. Basic OCR enhancement
    print("\n1. Applying OCR enhancement...")
    enhanced_image = preprocessor.enhance_for_ocr(sample_image)
    print(f"Enhanced image shape: {enhanced_image.shape}")
    
    # 2. Document structure detection
    print("\n2. Detecting document structure...")
    structure = preprocessor.detect_document_structure(sample_image)
    print(f"Structure detected:")
    print(f"  - Orientation: {structure.orientation:.2f} degrees")
    print(f"  - Skew angle: {structure.skew_angle:.2f} degrees")
    print(f"  - Text regions: {len(structure.text_regions)}")
    print(f"  - Table regions: {len(structure.table_regions)}")
    print(f"  - Image quality: {structure.image_quality:.3f}")
    print(f"  - Layout type: {structure.layout_type}")
    print(f"  - Confidence: {structure.confidence:.3f}")
    
    # 3. Adaptive filtering
    print("\n3. Applying adaptive filters...")
    filtered_image = preprocessor.apply_adaptive_filters(sample_image)
    print(f"Filtered image shape: {filtered_image.shape}")
    
    # 4. Full processing pipeline
    print("\n4. Running full processing pipeline...")
    result = preprocessor.process_with_structure_detection(sample_image)
    print(f"Processing result:")
    print(f"  - Transformations applied: {len(result.transformations_applied)}")
    print(f"  - Processing time: {result.processing_time:.3f}s")
    print(f"  - Quality improvement: {result.quality_improvement:.3f}")
    print(f"  - Transformations: {result.transformations_applied}")
    
    return preprocessor, sample_image, result


def demonstrate_pdf_conversion():
    """Demonstrate PDF to image conversion"""
    print("\n=== PDF Conversion Demonstration ===")
    
    preprocessor = AdvancedImagePreprocessor(debug=True)
    
    # Look for sample PDF files
    pdf_files = list(Path("pdf").glob("*.pdf")) if Path("pdf").exists() else []
    
    if pdf_files:
        pdf_path = str(pdf_files[0])
        print(f"Converting PDF: {pdf_path}")
        
        # Convert PDF to images
        images = preprocessor.convert_pdf_to_images(pdf_path, dpi=300)
        print(f"Converted {len(images)} pages")
        
        if images:
            # Process first page
            first_page = images[0]
            print(f"First page shape: {first_page.shape}")
            
            # Apply preprocessing
            enhanced = preprocessor.enhance_for_ocr(first_page)
            print(f"Enhanced first page shape: {enhanced.shape}")
            
            return images
    else:
        print("No PDF files found in 'pdf' directory")
        return []


def demonstrate_quality_assessment():
    """Demonstrate image quality assessment features"""
    print("\n=== Quality Assessment Demonstration ===")
    
    preprocessor = AdvancedImagePreprocessor(debug=True)
    
    # Create images with different quality characteristics
    base_image = create_sample_document_image()
    
    # Create noisy image
    noise = np.random.randint(0, 50, base_image.shape, dtype=np.uint8)
    noisy_image = cv2.add(base_image, noise)
    
    # Create low contrast image
    low_contrast = cv2.convertScaleAbs(base_image, alpha=0.3, beta=100)
    
    # Create blurred image
    blurred_image = cv2.GaussianBlur(base_image, (15, 15), 0)
    
    images = {
        "Original": base_image,
        "Noisy": noisy_image,
        "Low Contrast": low_contrast,
        "Blurred": blurred_image
    }
    
    print("Quality assessment results:")
    for name, img in images.items():
        quality = preprocessor._assess_image_quality(img)
        detailed = preprocessor._assess_detailed_quality(img)
        
        print(f"\n{name}:")
        print(f"  Overall quality: {quality:.3f}")
        print(f"  Contrast: {detailed['contrast']:.1f}")
        print(f"  Sharpness: {detailed['sharpness']:.1f}")
        print(f"  Brightness: {detailed['brightness']:.1f}")
        print(f"  Noise level: {detailed['noise_level']:.1f}")


def demonstrate_preprocessing_settings():
    """Demonstrate different preprocessing settings"""
    print("\n=== Preprocessing Settings Demonstration ===")
    
    # Create preprocessor with custom settings
    preprocessor = AdvancedImagePreprocessor(debug=True)
    
    # Show current settings
    print("Current settings:")
    for key, value in preprocessor.settings.items():
        print(f"  {key}: {value}")
    
    print("\nQuality thresholds:")
    for key, value in preprocessor.quality_thresholds.items():
        print(f"  {key}: {value}")
    
    # Modify settings for different scenarios
    sample_image = create_sample_document_image()
    
    # Scenario 1: High quality processing
    print("\nScenario 1: High quality processing")
    preprocessor.settings['target_dpi'] = 600
    preprocessor.settings['sharpening_strength'] = 1.5
    preprocessor.settings['binarization_method'] = 'adaptive'
    
    enhanced_hq = preprocessor.enhance_for_ocr(sample_image)
    print(f"High quality result shape: {enhanced_hq.shape}")
    
    # Scenario 2: Fast processing
    print("\nScenario 2: Fast processing")
    preprocessor.settings['target_dpi'] = 150
    preprocessor.settings['contrast_enhancement'] = False
    preprocessor.settings['orientation_detection'] = False
    
    enhanced_fast = preprocessor.enhance_for_ocr(sample_image)
    print(f"Fast processing result shape: {enhanced_fast.shape}")


def main():
    """Main demonstration function"""
    if not PREPROCESSOR_AVAILABLE:
        print("AdvancedImagePreprocessor is not available. Please check dependencies.")
        return
    
    print("Advanced Image Preprocessor Demonstration")
    print("=" * 50)
    
    try:
        # Basic usage
        preprocessor, sample_image, result = demonstrate_basic_usage()
        
        # PDF conversion (if PDFs available)
        pdf_images = demonstrate_pdf_conversion()
        
        # Quality assessment
        demonstrate_quality_assessment()
        
        # Settings demonstration
        demonstrate_preprocessing_settings()
        
        # Show preprocessor info
        print("\n=== Preprocessor Information ===")
        info = preprocessor.get_preprocessing_info()
        print(f"Processor: {info['processor']}")
        print(f"OpenCV version: {info['opencv_version']}")
        print(f"PyMuPDF available: {info['pymupdf_available']}")
        print(f"Supported operations: {len(info['supported_operations'])}")
        
        print("\n=== Demonstration Complete ===")
        print("The AdvancedImagePreprocessor is ready for use!")
        
    except Exception as e:
        print(f"Error during demonstration: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()