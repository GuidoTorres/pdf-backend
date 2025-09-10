#!/usr/bin/env python3
"""
Test script to verify the configuration system is working correctly.
"""

from config.processor_config import ConfigManager, get_config


def test_config_loading():
    """Test configuration loading."""
    print("Testing configuration loading...")
    
    try:
        config_manager = ConfigManager()
        config = config_manager.get_config()
        
        print(f"✅ Configuration loaded successfully")
        print(f"   Primary tools: {list(config.primary_tools.keys())}")
        print(f"   Fallback tools: {list(config.fallback_tools.keys())}")
        print(f"   Processing settings: {config.processing}")
        
        return True
    except Exception as e:
        print(f"❌ Configuration loading failed: {e}")
        return False


def test_tool_selection():
    """Test tool selection functionality."""
    print("\nTesting tool selection...")
    
    try:
        config_manager = ConfigManager()
        
        # Test primary tools
        table_detector = config_manager.get_tool_config('table_detector', primary=True)
        ocr_engine = config_manager.get_tool_config('ocr_engine', primary=True)
        
        print(f"✅ Primary table detector: {table_detector}")
        print(f"✅ Primary OCR engine: {ocr_engine}")
        
        # Test fallback tools
        fallback_table = config_manager.get_tool_config('table_detector', primary=False)
        fallback_ocr = config_manager.get_tool_config('ocr_engine', primary=False)
        
        print(f"✅ Fallback table detector: {fallback_table}")
        print(f"✅ Fallback OCR engine: {fallback_ocr}")
        
        return True
    except Exception as e:
        print(f"❌ Tool selection failed: {e}")
        return False


def test_tool_availability():
    """Test tool availability checking."""
    print("\nTesting tool availability...")
    
    try:
        config_manager = ConfigManager()
        
        tools_to_check = ['pdfplumber', 'easyocr', 'opencv', 'spacy', 'camelot', 'tesseract']
        
        for tool in tools_to_check:
            available = config_manager.is_tool_available(tool)
            status = "✅" if available else "❌"
            print(f"   {status} {tool}")
        
        return True
    except Exception as e:
        print(f"❌ Tool availability check failed: {e}")
        return False


def test_validation():
    """Test configuration validation."""
    print("\nTesting configuration validation...")
    
    try:
        config_manager = ConfigManager()
        validation_result = config_manager.validate_configuration()
        
        print(f"✅ Validation completed")
        print(f"   Valid: {validation_result['valid']}")
        print(f"   Missing tools: {len(validation_result['missing_tools'])}")
        print(f"   Warnings: {len(validation_result['warnings'])}")
        
        if validation_result['missing_tools']:
            print(f"   Missing: {validation_result['missing_tools']}")
        
        if validation_result['warnings']:
            print(f"   Warnings: {validation_result['warnings']}")
        
        return validation_result['valid']
    except Exception as e:
        print(f"❌ Configuration validation failed: {e}")
        return False


def test_global_config():
    """Test global configuration access."""
    print("\nTesting global configuration access...")
    
    try:
        config = get_config()
        print(f"✅ Global config access working")
        print(f"   spaCy model: {config.spacy_config['model']}")
        print(f"   EasyOCR languages: {config.easyocr_config['languages']}")
        print(f"   Processing workers: {config.processing['max_workers']}")
        
        return True
    except Exception as e:
        print(f"❌ Global config access failed: {e}")
        return False


def main():
    """Main test function."""
    print("🧪 Configuration System Test")
    print("=" * 40)
    
    tests = [
        test_config_loading,
        test_tool_selection,
        test_tool_availability,
        test_validation,
        test_global_config
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        if test():
            passed += 1
    
    print("\n" + "=" * 40)
    print(f"Tests passed: {passed}/{total}")
    
    if passed == total:
        print("🎉 All configuration tests passed!")
        return True
    else:
        print("❌ Some configuration tests failed!")
        return False


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)