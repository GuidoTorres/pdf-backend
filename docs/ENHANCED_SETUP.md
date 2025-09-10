# Enhanced Document Extraction Environment Setup

This document describes the enhanced document extraction environment with modern tools and improved capabilities.

## Overview

The enhanced system replaces legacy tools with modern alternatives while maintaining fallback compatibility:

| Function             | Primary Tool    | Fallback Tool | Improvement                               |
| -------------------- | --------------- | ------------- | ----------------------------------------- |
| Text Extraction      | PyMuPDF         | -             | Maintained (fast and reliable)            |
| Table Detection      | **pdfplumber**  | Camelot       | Better precision, more robust             |
| OCR Engine           | **EasyOCR**     | Tesseract     | Higher accuracy, multi-language support   |
| Image Processing     | **OpenCV**      | PIL           | Advanced filters, better preprocessing    |
| NLP Validation       | **spaCy**       | Basic rules   | Entity extraction, intelligent validation |
| Excel/CSV Processing | **pandas**      | -             | Enhanced data manipulation                |
| Word Documents       | **python-docx** | -             | Direct document processing                |

## Installation

### Automatic Setup

Run the automated setup script:

```bash
cd backend
python3 setup_enhanced_environment.py
```

This script will:

- ✅ Check Python version compatibility
- ✅ Install all required dependencies
- ✅ Download spaCy Spanish language model
- ✅ Validate tool availability
- ✅ Test configuration system

### Manual Setup

If you prefer manual installation:

```bash
# Install primary tools
pip install pdfplumber>=0.10.0
pip install easyocr>=1.7.0
pip install opencv-python>=4.8.0
pip install spacy>=3.7.0
pip install pandas>=2.1.0
pip install openpyxl>=3.1.0
pip install python-docx>=0.8.11

# Download spaCy Spanish model
python3 -m spacy download es_core_news_sm

# Install from requirements.txt (includes legacy tools)
pip install -r requirements.txt
```

## Configuration

### Configuration Files

The system uses JSON-based configuration:

- **`config/processor_config.json`**: Main configuration file
- **`config/processor_config.py`**: Configuration management classes

### Configuration Structure

```json
{
  "primary_tools": {
    "text_extractor": "pymupdf",
    "table_detector": "pdfplumber",
    "ocr_engine": "easyocr",
    "image_processor": "opencv",
    "nlp_validator": "spacy"
  },
  "fallback_tools": {
    "table_detector": "camelot",
    "ocr_engine": "tesseract",
    "image_processor": "pil"
  },
  "processing": {
    "enable_parallel": true,
    "max_workers": 2,
    "enable_caching": true,
    "cache_size": 50,
    "enable_fallback": true
  },
  "quality_thresholds": {
    "min_confidence": 0.7,
    "ocr_threshold": 0.5,
    "table_confidence": 0.8
  }
}
```

### Using Configuration in Code

```python
from config import get_config, ConfigManager

# Get global configuration
config = get_config()

# Use configuration manager for advanced features
config_manager = ConfigManager()
table_detector = config_manager.get_tool_config('table_detector', primary=True)
is_available = config_manager.is_tool_available('pdfplumber')
```

## Tool-Specific Features

### pdfplumber (Table Detection)

- **Advantages**: Better handling of complex table structures
- **Configuration**: Adjustable line detection strategies
- **Fallback**: Automatic fallback to Camelot if needed

### EasyOCR (OCR Engine)

- **Advantages**: Higher accuracy, GPU support, multi-language
- **Languages**: English and Spanish configured by default
- **Fallback**: Tesseract for compatibility

### OpenCV (Image Processing)

- **Features**: Advanced preprocessing, noise reduction, contrast enhancement
- **DPI**: Configurable DPI settings for optimal OCR
- **Fallback**: PIL for basic operations

### spaCy (NLP Validation)

- **Model**: Spanish language model (es_core_news_sm)
- **Features**: Entity extraction, transaction classification
- **Use Cases**: Banking term recognition, anomaly detection

## Validation and Testing

### Configuration Validation

```bash
python3 test_config.py
```

This will test:

- ✅ Configuration loading
- ✅ Tool selection (primary/fallback)
- ✅ Tool availability checking
- ✅ Configuration validation
- ✅ Global configuration access

### Environment Validation

```bash
python3 setup_enhanced_environment.py
```

This provides comprehensive validation:

- ✅ Python version check
- ✅ Dependency installation
- ✅ Import testing
- ✅ spaCy model testing
- ✅ Configuration validation

## Dependencies

### New Primary Dependencies

```
pdfplumber>=0.10.0          # Modern table detection
easyocr>=1.7.0              # Modern OCR engine
opencv-python>=4.8.0        # Advanced image preprocessing
spacy>=3.7.0                # NLP validation
pandas>=2.1.0               # Enhanced data manipulation
openpyxl>=3.1.0             # Excel file processing
python-docx>=0.8.11         # Word document processing
```

### Legacy Dependencies (Fallback)

```
PyMuPDF>=1.23.0             # Text extraction (primary)
camelot-py[cv]>=0.11.0      # Table detection fallback
pytesseract>=0.3.10         # OCR fallback
Pillow>=9.0.0               # Image manipulation fallback
```

### Core Dependencies

```
Flask>=2.0.0                # Web server
groq>=0.4.0                 # AI/LLM API client
psutil>=5.8.0               # System monitoring
numpy>=1.21.0,<2.0.0        # Numerical computing
```

## Troubleshooting

### Common Issues

1. **spaCy NumPy Warning**: This is a known compatibility issue but doesn't affect functionality
2. **PATH Warnings**: Scripts installed outside PATH - functionality is not affected
3. **GPU Support**: EasyOCR will automatically use GPU if available, CPU otherwise

### Verification Commands

```bash
# Test individual imports
python3 -c "import pdfplumber; print('✅ pdfplumber')"
python3 -c "import easyocr; print('✅ easyocr')"
python3 -c "import cv2; print('✅ opencv')"
python3 -c "import spacy; print('✅ spacy')"

# Test spaCy model
python3 -c "import spacy; nlp = spacy.load('es_core_news_sm'); print('✅ spaCy model')"

# Test configuration
python3 -c "from config import get_config; print('✅ Configuration system')"
```

## Migration from Legacy System

The enhanced system is designed to be backward compatible:

1. **Gradual Migration**: Primary tools are used first, with automatic fallback
2. **Configuration Control**: Enable/disable features via configuration
3. **Performance Monitoring**: Built-in metrics to compare old vs new performance
4. **Fallback Safety**: Legacy tools remain available as fallback options

## Next Steps

After successful setup, you can proceed to implement the enhanced document processor components:

1. **ModernTableDetector** (Task 2)
2. **ModernOCREngine** (Task 3)
3. **AdvancedImagePreprocessor** (Task 4)
4. **NLPValidator** (Task 5)

Each component will use the configuration system established in this setup phase.
