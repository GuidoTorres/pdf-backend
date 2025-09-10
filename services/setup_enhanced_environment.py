#!/usr/bin/env python3
"""
Setup script for the enhanced document extraction environment.
This script validates the installation and configuration of all required tools.
"""

import sys
import subprocess
from pathlib import Path
from config.processor_config import ConfigManager


def check_python_version():
    """Check if Python version is compatible."""
    print("Checking Python version...")
    if sys.version_info < (3, 8):
        print("❌ Python 3.8 or higher is required")
        return False
    print(f"✅ Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
    return True


def install_requirements():
    """Install requirements from requirements.txt."""
    print("\nInstalling requirements...")
    requirements_path = Path(__file__).parent / "requirements.txt"
    
    if not requirements_path.exists():
        print("❌ requirements.txt not found")
        return False
    
    try:
        subprocess.run([
            sys.executable, "-m", "pip", "install", "-r", str(requirements_path)
        ], check=True, capture_output=True, text=True)
        print("✅ Requirements installed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to install requirements: {e}")
        print(f"Error output: {e.stderr}")
        return False


def download_spacy_model():
    """Download the Spanish spaCy model."""
    print("\nDownloading spaCy Spanish model...")
    try:
        subprocess.run([
            sys.executable, "-m", "spacy", "download", "es_core_news_sm"
        ], check=True, capture_output=True, text=True)
        print("✅ spaCy Spanish model downloaded successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to download spaCy model: {e}")
        print(f"Error output: {e.stderr}")
        return False


def validate_configuration():
    """Validate the processor configuration."""
    print("\nValidating configuration...")
    
    try:
        config_manager = ConfigManager()
        validation_result = config_manager.validate_configuration()
        
        print(f"Configuration valid: {'✅' if validation_result['valid'] else '❌'}")
        
        # Print primary tools status
        print("\nPrimary tools:")
        for tool_type, info in validation_result['primary_tools_available'].items():
            status = "✅" if info['available'] else "❌"
            print(f"  {status} {tool_type}: {info['tool']}")
        
        # Print fallback tools status
        print("\nFallback tools:")
        for tool_type, info in validation_result['fallback_tools_available'].items():
            status = "✅" if info['available'] else "⚠️"
            print(f"  {status} {tool_type}: {info['tool']}")
        
        # Print spaCy model status
        if 'spacy_model_available' in validation_result:
            status = "✅" if validation_result['spacy_model_available'] else "❌"
            print(f"\nspaCy model: {status}")
        
        # Print warnings
        if validation_result['warnings']:
            print("\nWarnings:")
            for warning in validation_result['warnings']:
                print(f"  ⚠️ {warning}")
        
        # Print missing tools
        if validation_result['missing_tools']:
            print("\nMissing tools:")
            for missing in validation_result['missing_tools']:
                print(f"  ❌ {missing}")
            
            print("\nInstallation commands:")
            install_commands = config_manager.get_installation_commands()
            for tool, command in install_commands.items():
                print(f"  {command}")
        
        return validation_result['valid']
        
    except Exception as e:
        print(f"❌ Configuration validation failed: {e}")
        return False


def test_imports():
    """Test importing key modules."""
    print("\nTesting imports...")
    
    test_modules = [
        ('pdfplumber', 'pdfplumber'),
        ('easyocr', 'easyocr'),
        ('opencv', 'cv2'),
        ('spacy', 'spacy'),
        ('pandas', 'pandas'),
        ('openpyxl', 'openpyxl'),
        ('python-docx', 'docx'),
        ('PyMuPDF', 'fitz'),
        ('camelot', 'camelot'),
        ('pytesseract', 'pytesseract'),
        ('PIL', 'PIL'),
        ('groq', 'groq')
    ]
    
    all_imports_successful = True
    
    for name, module in test_modules:
        try:
            __import__(module)
            print(f"  ✅ {name}")
        except ImportError as e:
            print(f"  ❌ {name}: {e}")
            all_imports_successful = False
    
    return all_imports_successful


def test_spacy_model():
    """Test loading the spaCy Spanish model."""
    print("\nTesting spaCy Spanish model...")
    
    try:
        import spacy
        nlp = spacy.load("es_core_news_sm")
        
        # Test with a simple Spanish sentence
        doc = nlp("El banco procesó la transacción de 1000 euros.")
        entities = [(ent.text, ent.label_) for ent in doc.ents]
        
        print(f"  ✅ spaCy model loaded successfully")
        print(f"  ✅ Detected entities: {entities}")
        return True
        
    except Exception as e:
        print(f"  ❌ spaCy model test failed: {e}")
        return False


def main():
    """Main setup function."""
    print("🚀 Enhanced Document Extraction Environment Setup")
    print("=" * 50)
    
    success = True
    
    # Check Python version
    if not check_python_version():
        success = False
    
    # Install requirements
    if not install_requirements():
        success = False
    
    # Download spaCy model
    if not download_spacy_model():
        success = False
    
    # Test imports
    if not test_imports():
        success = False
    
    # Test spaCy model
    if not test_spacy_model():
        success = False
    
    # Validate configuration
    if not validate_configuration():
        success = False
    
    print("\n" + "=" * 50)
    if success:
        print("🎉 Setup completed successfully!")
        print("The enhanced document extraction environment is ready to use.")
    else:
        print("❌ Setup completed with errors.")
        print("Please review the errors above and fix them before proceeding.")
    
    return success


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)