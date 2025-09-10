"""
Configuration module for the enhanced document processor.
"""

from .processor_config import (
    ProcessorConfig,
    ConfigManager,
    get_config_manager,
    get_config
)

__all__ = [
    'ProcessorConfig',
    'ConfigManager', 
    'get_config_manager',
    'get_config'
]