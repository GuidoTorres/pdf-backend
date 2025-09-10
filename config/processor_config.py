"""
Configuration management for the enhanced document processor.
Handles primary and fallback tool configurations.
"""

import json
import os
from typing import Dict, Any, Optional
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ProcessorConfig:
    """Configuration class for the enhanced document processor."""
    
    # Tool configurations
    primary_tools: Dict[str, str]
    fallback_tools: Dict[str, str]
    
    # Processing settings
    processing: Dict[str, Any]
    quality_thresholds: Dict[str, float]
    
    # Tool-specific configurations
    spacy_config: Dict[str, Any]
    easyocr_config: Dict[str, Any]
    opencv_config: Dict[str, Any]
    pdfplumber_config: Dict[str, Any]


class ConfigManager:
    """Manages configuration loading and validation for the document processor."""
    
    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize the configuration manager.
        
        Args:
            config_path: Path to the configuration file. If None, uses default path.
        """
        if config_path is None:
            # Default to config file in the same directory
            current_dir = Path(__file__).parent
            config_path = current_dir / "processor_config.json"
        
        self.config_path = Path(config_path)
        self._config: Optional[ProcessorConfig] = None
    
    def load_config(self) -> ProcessorConfig:
        """
        Load configuration from the JSON file.
        
        Returns:
            ProcessorConfig: The loaded configuration object.
            
        Raises:
            FileNotFoundError: If the configuration file doesn't exist.
            ValueError: If the configuration is invalid.
        """
        if not self.config_path.exists():
            raise FileNotFoundError(f"Configuration file not found: {self.config_path}")
        
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
            
            # Validate required sections
            required_sections = [
                'primary_tools', 'fallback_tools', 'processing', 
                'quality_thresholds', 'spacy_config', 'easyocr_config',
                'opencv_config', 'pdfplumber_config'
            ]
            
            for section in required_sections:
                if section not in config_data:
                    raise ValueError(f"Missing required configuration section: {section}")
            
            self._config = ProcessorConfig(**config_data)
            return self._config
            
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in configuration file: {e}")
        except Exception as e:
            raise ValueError(f"Error loading configuration: {e}")
    
    def get_config(self) -> ProcessorConfig:
        """
        Get the current configuration, loading it if necessary.
        
        Returns:
            ProcessorConfig: The current configuration object.
        """
        if self._config is None:
            self._config = self.load_config()
        return self._config
    
    def get_tool_config(self, tool_type: str, primary: bool = True) -> str:
        """
        Get the configured tool for a specific type.
        
        Args:
            tool_type: Type of tool (e.g., 'table_detector', 'ocr_engine')
            primary: Whether to get primary (True) or fallback (False) tool
            
        Returns:
            str: The configured tool name
            
        Raises:
            ValueError: If the tool type is not configured
        """
        config = self.get_config()
        
        if primary:
            tools = config.primary_tools
        else:
            tools = config.fallback_tools
        
        if tool_type not in tools:
            available_tools = list(tools.keys())
            raise ValueError(
                f"Tool type '{tool_type}' not configured. "
                f"Available: {available_tools}"
            )
        
        return tools[tool_type]
    
    def is_tool_available(self, tool_name: str) -> bool:
        """
        Check if a specific tool is available (can be imported).
        
        Args:
            tool_name: Name of the tool to check
            
        Returns:
            bool: True if the tool is available, False otherwise
        """
        tool_imports = {
            'pdfplumber': 'pdfplumber',
            'easyocr': 'easyocr',
            'opencv': 'cv2',
            'spacy': 'spacy',
            'camelot': 'camelot',
            'tesseract': 'pytesseract',
            'pymupdf': 'fitz',
            'pil': 'PIL'
        }
        
        if tool_name not in tool_imports:
            return False
        
        try:
            __import__(tool_imports[tool_name])
            return True
        except ImportError:
            return False
    
    def validate_configuration(self) -> Dict[str, Any]:
        """
        Validate the current configuration and check tool availability.
        
        Returns:
            Dict[str, Any]: Validation results with available/unavailable tools
        """
        config = self.get_config()
        
        validation_result = {
            'valid': True,
            'primary_tools_available': {},
            'fallback_tools_available': {},
            'missing_tools': [],
            'warnings': []
        }
        
        # Check primary tools
        for tool_type, tool_name in config.primary_tools.items():
            available = self.is_tool_available(tool_name)
            validation_result['primary_tools_available'][tool_type] = {
                'tool': tool_name,
                'available': available
            }
            
            if not available:
                validation_result['missing_tools'].append(f"Primary {tool_type}: {tool_name}")
                validation_result['valid'] = False
        
        # Check fallback tools
        for tool_type, tool_name in config.fallback_tools.items():
            available = self.is_tool_available(tool_name)
            validation_result['fallback_tools_available'][tool_type] = {
                'tool': tool_name,
                'available': available
            }
            
            if not available:
                validation_result['warnings'].append(f"Fallback {tool_type}: {tool_name} not available")
        
        # Check spaCy model availability
        if self.is_tool_available('spacy'):
            try:
                import spacy
                model_name = config.spacy_config.get('model', 'es_core_news_sm')
                try:
                    spacy.load(model_name)
                    validation_result['spacy_model_available'] = True
                except OSError:
                    validation_result['spacy_model_available'] = False
                    validation_result['missing_tools'].append(f"spaCy model: {model_name}")
                    validation_result['valid'] = False
            except ImportError:
                validation_result['spacy_model_available'] = False
        
        return validation_result
    
    def get_installation_commands(self) -> Dict[str, str]:
        """
        Get installation commands for missing tools.
        
        Returns:
            Dict[str, str]: Tool names mapped to their installation commands
        """
        return {
            'pdfplumber': 'pip install pdfplumber>=0.10.0',
            'easyocr': 'pip install easyocr>=1.7.0',
            'opencv': 'pip install opencv-python>=4.8.0',
            'spacy': 'pip install spacy>=3.7.0',
            'pandas': 'pip install pandas>=2.1.0',
            'openpyxl': 'pip install openpyxl>=3.1.0',
            'python-docx': 'pip install python-docx>=0.8.11',
            'spacy_model': 'python -m spacy download es_core_news_sm'
        }


# Global configuration instance
_config_manager = None

def get_config_manager() -> ConfigManager:
    """Get the global configuration manager instance."""
    global _config_manager
    if _config_manager is None:
        _config_manager = ConfigManager()
    return _config_manager

def get_config() -> ProcessorConfig:
    """Get the current processor configuration."""
    return get_config_manager().get_config()