"""
Resource Manager for handling temporary files and memory monitoring.

This module provides a centralized way to manage temporary files with automatic cleanup
and memory monitoring capabilities for the PDF processing system.
"""

import os
import tempfile
import shutil
import psutil
import logging
import threading
import time
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
from contextlib import contextmanager
from pathlib import Path


@dataclass
class MemoryStats:
    """Memory usage statistics."""
    total_memory: float  # Total system memory in MB
    available_memory: float  # Available system memory in MB
    used_memory: float  # Used system memory in MB
    process_memory: float  # Current process memory usage in MB
    memory_percent: float  # Memory usage percentage


class ResourceManager:
    """
    Manages temporary files and system resources with automatic cleanup.
    
    This class provides context managers for automatic cleanup of temporary files
    and methods for monitoring memory usage during PDF processing operations.
    """
    
    def __init__(self, temp_dir: Optional[str] = None, debug: bool = False):
        """
        Initialize the ResourceManager.
        
        Args:
            temp_dir: Custom temporary directory path. If None, uses system temp.
            debug: Enable debug logging.
        """
        self.temp_dir = temp_dir or tempfile.gettempdir()
        self.debug = debug
        self._temp_files: List[str] = []
        self._lock = threading.Lock()
        self._logger = self._setup_logger()
        
        # Ensure temp directory exists
        os.makedirs(self.temp_dir, exist_ok=True)
        
        if self.debug:
            self._logger.debug(f"ResourceManager initialized with temp_dir: {self.temp_dir}")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger for the ResourceManager."""
        logger = logging.getLogger(f"{__name__}.ResourceManager")
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def create_temp_file(self, content: bytes, suffix: str = '.tmp', prefix: str = 'pdf_proc_') -> str:
        """
        Create a temporary file with the given content.
        
        Args:
            content: Binary content to write to the file.
            suffix: File suffix/extension.
            prefix: File prefix.
            
        Returns:
            Path to the created temporary file.
            
        Raises:
            OSError: If file creation fails.
        """
        try:
            # Create temporary file
            fd, temp_path = tempfile.mkstemp(
                suffix=suffix,
                prefix=prefix,
                dir=self.temp_dir
            )
            
            # Write content and close file descriptor
            with os.fdopen(fd, 'wb') as temp_file:
                temp_file.write(content)
            
            # Track the file for cleanup
            with self._lock:
                self._temp_files.append(temp_path)
            
            if self.debug:
                self._logger.debug(f"Created temp file: {temp_path} ({len(content)} bytes)")
            
            return temp_path
            
        except Exception as e:
            self._logger.error(f"Failed to create temp file: {e}")
            raise OSError(f"Failed to create temporary file: {e}")
    
    def create_temp_file_from_path(self, source_path: str, suffix: str = None) -> str:
        """
        Create a temporary file by copying from an existing file.
        
        Args:
            source_path: Path to the source file to copy.
            suffix: File suffix. If None, uses source file extension.
            
        Returns:
            Path to the created temporary file.
            
        Raises:
            FileNotFoundError: If source file doesn't exist.
            OSError: If file creation or copying fails.
        """
        if not os.path.exists(source_path):
            raise FileNotFoundError(f"Source file not found: {source_path}")
        
        # Determine suffix from source file if not provided
        if suffix is None:
            suffix = Path(source_path).suffix or '.tmp'
        
        try:
            # Read source file content
            with open(source_path, 'rb') as source_file:
                content = source_file.read()
            
            # Create temp file with content
            temp_path = self.create_temp_file(content, suffix=suffix)
            
            if self.debug:
                self._logger.debug(f"Copied {source_path} to temp file: {temp_path}")
            
            return temp_path
            
        except Exception as e:
            self._logger.error(f"Failed to copy file to temp: {e}")
            raise OSError(f"Failed to copy file to temporary location: {e}")
    
    def cleanup_temp_file(self, file_path: str) -> bool:
        """
        Clean up a specific temporary file.
        
        Args:
            file_path: Path to the temporary file to remove.
            
        Returns:
            True if file was successfully removed, False otherwise.
        """
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                
                # Remove from tracking list
                with self._lock:
                    if file_path in self._temp_files:
                        self._temp_files.remove(file_path)
                
                if self.debug:
                    self._logger.debug(f"Cleaned up temp file: {file_path}")
                
                return True
            else:
                if self.debug:
                    self._logger.debug(f"Temp file already removed: {file_path}")
                return True
                
        except Exception as e:
            self._logger.error(f"Failed to cleanup temp file {file_path}: {e}")
            return False
    
    def cleanup_all_temp_files(self) -> int:
        """
        Clean up all tracked temporary files.
        
        Returns:
            Number of files successfully cleaned up.
        """
        cleaned_count = 0
        
        with self._lock:
            temp_files_copy = self._temp_files.copy()
            self._temp_files.clear()
        
        for file_path in temp_files_copy:
            if self.cleanup_temp_file(file_path):
                cleaned_count += 1
        
        if self.debug:
            self._logger.debug(f"Cleaned up {cleaned_count}/{len(temp_files_copy)} temp files")
        
        return cleaned_count
    
    def get_memory_usage(self) -> MemoryStats:
        """
        Get current memory usage statistics.
        
        Returns:
            MemoryStats object with current memory information.
        """
        try:
            # System memory info
            memory = psutil.virtual_memory()
            
            # Current process memory info
            process = psutil.Process()
            process_memory_info = process.memory_info()
            
            stats = MemoryStats(
                total_memory=memory.total / (1024 * 1024),  # Convert to MB
                available_memory=memory.available / (1024 * 1024),
                used_memory=memory.used / (1024 * 1024),
                process_memory=process_memory_info.rss / (1024 * 1024),
                memory_percent=memory.percent
            )
            
            if self.debug:
                self._logger.debug(
                    f"Memory usage - Process: {stats.process_memory:.1f}MB, "
                    f"System: {stats.memory_percent:.1f}% ({stats.used_memory:.1f}MB/{stats.total_memory:.1f}MB)"
                )
            
            return stats
            
        except Exception as e:
            self._logger.error(f"Failed to get memory usage: {e}")
            # Return default stats on error
            return MemoryStats(0, 0, 0, 0, 0)
    
    def get_tracked_files_count(self) -> int:
        """
        Get the number of currently tracked temporary files.
        
        Returns:
            Number of tracked temporary files.
        """
        with self._lock:
            return len(self._temp_files)
    
    def get_tracked_files(self) -> List[str]:
        """
        Get a copy of the list of tracked temporary files.
        
        Returns:
            List of temporary file paths currently being tracked.
        """
        with self._lock:
            return self._temp_files.copy()
    
    @contextmanager
    def temp_file_context(self, content: bytes, suffix: str = '.tmp', prefix: str = 'pdf_proc_'):
        """
        Context manager for temporary file creation with automatic cleanup.
        
        Args:
            content: Binary content to write to the file.
            suffix: File suffix/extension.
            prefix: File prefix.
            
        Yields:
            Path to the temporary file.
            
        Example:
            with resource_manager.temp_file_context(pdf_content, '.pdf') as temp_path:
                # Use temp_path for processing
                process_pdf(temp_path)
            # File is automatically cleaned up here
        """
        temp_path = None
        try:
            temp_path = self.create_temp_file(content, suffix, prefix)
            yield temp_path
        finally:
            if temp_path:
                self.cleanup_temp_file(temp_path)
    
    @contextmanager
    def temp_file_from_path_context(self, source_path: str, suffix: str = None):
        """
        Context manager for temporary file creation from existing file with automatic cleanup.
        
        Args:
            source_path: Path to the source file to copy.
            suffix: File suffix. If None, uses source file extension.
            
        Yields:
            Path to the temporary file.
            
        Example:
            with resource_manager.temp_file_from_path_context('/path/to/file.pdf') as temp_path:
                # Use temp_path for processing
                process_pdf(temp_path)
            # File is automatically cleaned up here
        """
        temp_path = None
        try:
            temp_path = self.create_temp_file_from_path(source_path, suffix)
            yield temp_path
        finally:
            if temp_path:
                self.cleanup_temp_file(temp_path)
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit with automatic cleanup."""
        self.cleanup_all_temp_files()
    
    def __del__(self):
        """Destructor to ensure cleanup on object deletion."""
        try:
            self.cleanup_all_temp_files()
        except:
            # Ignore errors during cleanup in destructor
            pass


# Convenience function for creating a ResourceManager instance
def create_resource_manager(temp_dir: Optional[str] = None, debug: bool = False) -> ResourceManager:
    """
    Create a ResourceManager instance.
    
    Args:
        temp_dir: Custom temporary directory path.
        debug: Enable debug logging.
        
    Returns:
        ResourceManager instance.
    """
    return ResourceManager(temp_dir=temp_dir, debug=debug)