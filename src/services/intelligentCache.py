#!/usr/bin/env python3
"""
Intelligent Cache System

This module implements an intelligent caching system for document processing results
with hash-based identification, LRU eviction, and performance optimization features.
"""

import os
import time
import json
import hashlib
import logging
import threading
import pickle
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, asdict
from pathlib import Path
import tempfile
from collections import OrderedDict


@dataclass
class CacheEntry:
    """Represents a cache entry with metadata"""
    key: str
    data: Any
    created_at: float
    last_accessed: float
    access_count: int
    file_hash: str
    file_size: int
    processing_time: float
    confidence_score: float
    metadata: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            'key': self.key,
            'data': self.data,
            'created_at': self.created_at,
            'last_accessed': self.last_accessed,
            'access_count': self.access_count,
            'file_hash': self.file_hash,
            'file_size': self.file_size,
            'processing_time': self.processing_time,
            'confidence_score': self.confidence_score,
            'metadata': self.metadata
        }


@dataclass
class CacheStats:
    """Cache performance statistics"""
    total_requests: int
    cache_hits: int
    cache_misses: int
    hit_ratio: float
    total_entries: int
    memory_usage_mb: float
    disk_usage_mb: float
    average_access_time: float
    evictions: int
    oldest_entry_age: float
    newest_entry_age: float


class IntelligentCache:
    """
    Intelligent caching system for document processing results.
    
    Features:
    - Hash-based document identification
    - LRU eviction policy
    - Memory and disk storage options
    - Performance monitoring
    - Automatic cache validation
    - Configurable size limits
    """
    
    def __init__(self, 
                 max_memory_entries: int = 50,
                 max_disk_entries: int = 200,
                 cache_dir: Optional[str] = None,
                 enable_disk_cache: bool = True,
                 debug: bool = False):
        """
        Initialize the Intelligent Cache.
        
        Args:
            max_memory_entries: Maximum entries in memory cache
            max_disk_entries: Maximum entries in disk cache
            cache_dir: Directory for disk cache (None for temp dir)
            enable_disk_cache: Enable persistent disk caching
            debug: Enable debug logging
        """
        self.max_memory_entries = max_memory_entries
        self.max_disk_entries = max_disk_entries
        self.enable_disk_cache = enable_disk_cache
        self.debug = debug
        
        # Set up logging
        self.logger = self._setup_logger()
        
        # Initialize cache directories
        if cache_dir:
            self.cache_dir = Path(cache_dir)
        else:
            self.cache_dir = Path(tempfile.gettempdir()) / "intelligent_cache"
        
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Memory cache (LRU using OrderedDict)
        self.memory_cache: OrderedDict[str, CacheEntry] = OrderedDict()
        
        # Disk cache index
        self.disk_cache_index: Dict[str, str] = {}  # key -> file_path
        
        # Thread safety
        self.lock = threading.RLock()
        
        # Statistics
        self.stats = CacheStats(
            total_requests=0,
            cache_hits=0,
            cache_misses=0,
            hit_ratio=0.0,
            total_entries=0,
            memory_usage_mb=0.0,
            disk_usage_mb=0.0,
            average_access_time=0.0,
            evictions=0,
            oldest_entry_age=0.0,
            newest_entry_age=0.0
        )
        
        # Load existing disk cache index
        if self.enable_disk_cache:
            self._load_disk_cache_index()
        
        self.logger.info(f"IntelligentCache initialized: memory={max_memory_entries}, disk={max_disk_entries}")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger for the cache system"""
        logger = logging.getLogger(f"{__name__}.IntelligentCache")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def generate_document_hash(self, file_path: str) -> str:
        """
        Generate a unique hash for a document based on content and metadata.
        
        Args:
            file_path: Path to the document file
            
        Returns:
            SHA-256 hash string
        """
        try:
            hasher = hashlib.sha256()
            
            # Hash file content
            with open(file_path, 'rb') as f:
                # Read file in chunks to handle large files efficiently
                for chunk in iter(lambda: f.read(8192), b""):
                    hasher.update(chunk)
            
            # Include file metadata for additional uniqueness
            stat = os.stat(file_path)
            metadata = f"{stat.st_size}_{stat.st_mtime}_{os.path.basename(file_path)}"
            hasher.update(metadata.encode('utf-8'))
            
            return hasher.hexdigest()
            
        except Exception as e:
            self.logger.error(f"Failed to generate hash for {file_path}: {e}")
            # Fallback to filename + timestamp
            return hashlib.sha256(f"{file_path}_{time.time()}".encode()).hexdigest()
    
    def get(self, file_path: str) -> Optional[Any]:
        """
        Retrieve cached result for a document.
        
        Args:
            file_path: Path to the document file
            
        Returns:
            Cached result or None if not found
        """
        start_time = time.time()
        
        with self.lock:
            self.stats.total_requests += 1
            
            # Generate cache key
            cache_key = self.generate_document_hash(file_path)
            
            # Check memory cache first
            if cache_key in self.memory_cache:
                entry = self.memory_cache[cache_key]
                
                # Validate cache entry
                if self._is_cache_valid(file_path, entry):
                    # Update access statistics
                    entry.last_accessed = time.time()
                    entry.access_count += 1
                    
                    # Move to end (most recently used)
                    self.memory_cache.move_to_end(cache_key)
                    
                    self.stats.cache_hits += 1
                    self._update_hit_ratio()
                    
                    access_time = time.time() - start_time
                    self._update_average_access_time(access_time)
                    
                    if self.debug:
                        self.logger.debug(f"Memory cache hit for {file_path}")
                    
                    return entry.data
                else:
                    # Invalid cache entry, remove it
                    del self.memory_cache[cache_key]
                    if self.debug:
                        self.logger.debug(f"Removed invalid memory cache entry for {file_path}")
            
            # Check disk cache if enabled
            if self.enable_disk_cache and cache_key in self.disk_cache_index:
                disk_file = self.disk_cache_index[cache_key]
                
                if os.path.exists(disk_file):
                    try:
                        entry = self._load_from_disk(disk_file)
                        
                        if entry and self._is_cache_valid(file_path, entry):
                            # Update access statistics
                            entry.last_accessed = time.time()
                            entry.access_count += 1
                            
                            # Promote to memory cache
                            self._add_to_memory_cache(cache_key, entry)
                            
                            self.stats.cache_hits += 1
                            self._update_hit_ratio()
                            
                            access_time = time.time() - start_time
                            self._update_average_access_time(access_time)
                            
                            if self.debug:
                                self.logger.debug(f"Disk cache hit for {file_path}")
                            
                            return entry.data
                        else:
                            # Invalid disk cache entry, remove it
                            self._remove_from_disk_cache(cache_key)
                            if self.debug:
                                self.logger.debug(f"Removed invalid disk cache entry for {file_path}")
                    
                    except Exception as e:
                        self.logger.error(f"Failed to load from disk cache: {e}")
                        self._remove_from_disk_cache(cache_key)
            
            # Cache miss
            self.stats.cache_misses += 1
            self._update_hit_ratio()
            
            access_time = time.time() - start_time
            self._update_average_access_time(access_time)
            
            if self.debug:
                self.logger.debug(f"Cache miss for {file_path}")
            
            return None
    
    def put(self, file_path: str, data: Any, processing_time: float = 0.0, 
            confidence_score: float = 1.0, metadata: Optional[Dict[str, Any]] = None):
        """
        Store processing result in cache.
        
        Args:
            file_path: Path to the document file
            data: Processing result to cache
            processing_time: Time taken to process the document
            confidence_score: Confidence score of the result
            metadata: Additional metadata
        """
        with self.lock:
            try:
                # Generate cache key and file info
                cache_key = self.generate_document_hash(file_path)
                file_stat = os.stat(file_path)
                
                # Create cache entry
                entry = CacheEntry(
                    key=cache_key,
                    data=data,
                    created_at=time.time(),
                    last_accessed=time.time(),
                    access_count=1,
                    file_hash=cache_key,
                    file_size=file_stat.st_size,
                    processing_time=processing_time,
                    confidence_score=confidence_score,
                    metadata=metadata or {}
                )
                
                # Add to memory cache
                self._add_to_memory_cache(cache_key, entry)
                
                # Add to disk cache if enabled
                if self.enable_disk_cache:
                    self._add_to_disk_cache(cache_key, entry)
                
                if self.debug:
                    self.logger.debug(f"Cached result for {file_path} (key: {cache_key[:8]}...)")
                
            except Exception as e:
                self.logger.error(f"Failed to cache result for {file_path}: {e}")
    
    def _add_to_memory_cache(self, cache_key: str, entry: CacheEntry):
        """Add entry to memory cache with LRU eviction"""
        # Add/update entry
        self.memory_cache[cache_key] = entry
        
        # Move to end (most recently used)
        self.memory_cache.move_to_end(cache_key)
        
        # Evict oldest entries if over limit
        while len(self.memory_cache) > self.max_memory_entries:
            oldest_key, oldest_entry = self.memory_cache.popitem(last=False)
            self.stats.evictions += 1
            
            if self.debug:
                self.logger.debug(f"Evicted memory cache entry: {oldest_key[:8]}...")
    
    def _add_to_disk_cache(self, cache_key: str, entry: CacheEntry):
        """Add entry to disk cache"""
        try:
            # Create disk file path
            disk_file = self.cache_dir / f"{cache_key}.cache"
            
            # Save entry to disk
            with open(disk_file, 'wb') as f:
                pickle.dump(entry, f)
            
            # Update disk cache index
            self.disk_cache_index[cache_key] = str(disk_file)
            
            # Evict oldest disk entries if over limit
            if len(self.disk_cache_index) > self.max_disk_entries:
                self._evict_oldest_disk_entries()
            
            # Save updated index
            self._save_disk_cache_index()
            
        except Exception as e:
            self.logger.error(f"Failed to add to disk cache: {e}")
    
    def _evict_oldest_disk_entries(self):
        """Evict oldest disk cache entries"""
        try:
            # Get entries with creation times
            entries_with_time = []
            
            for cache_key, disk_file in list(self.disk_cache_index.items()):
                if os.path.exists(disk_file):
                    try:
                        entry = self._load_from_disk(disk_file)
                        if entry:
                            entries_with_time.append((cache_key, entry.created_at))
                    except:
                        # Remove invalid entries
                        self._remove_from_disk_cache(cache_key)
            
            # Sort by creation time (oldest first)
            entries_with_time.sort(key=lambda x: x[1])
            
            # Remove oldest entries until under limit
            entries_to_remove = len(entries_with_time) - self.max_disk_entries + 1
            
            for i in range(min(entries_to_remove, len(entries_with_time))):
                cache_key = entries_with_time[i][0]
                self._remove_from_disk_cache(cache_key)
                self.stats.evictions += 1
                
                if self.debug:
                    self.logger.debug(f"Evicted disk cache entry: {cache_key[:8]}...")
        
        except Exception as e:
            self.logger.error(f"Failed to evict disk cache entries: {e}")
    
    def _remove_from_disk_cache(self, cache_key: str):
        """Remove entry from disk cache"""
        if cache_key in self.disk_cache_index:
            disk_file = self.disk_cache_index[cache_key]
            
            try:
                if os.path.exists(disk_file):
                    os.remove(disk_file)
            except Exception as e:
                self.logger.error(f"Failed to remove disk cache file {disk_file}: {e}")
            
            del self.disk_cache_index[cache_key]
    
    def _load_from_disk(self, disk_file: str) -> Optional[CacheEntry]:
        """Load cache entry from disk"""
        try:
            with open(disk_file, 'rb') as f:
                return pickle.load(f)
        except Exception as e:
            self.logger.error(f"Failed to load from disk cache {disk_file}: {e}")
            return None
    
    def _is_cache_valid(self, file_path: str, entry: CacheEntry) -> bool:
        """
        Validate if cache entry is still valid for the file.
        
        Args:
            file_path: Path to the document file
            entry: Cache entry to validate
            
        Returns:
            True if cache entry is valid
        """
        try:
            # Check if file still exists
            if not os.path.exists(file_path):
                return False
            
            # Check if file hash matches
            current_hash = self.generate_document_hash(file_path)
            if current_hash != entry.file_hash:
                return False
            
            # Check file size
            current_size = os.path.getsize(file_path)
            if current_size != entry.file_size:
                return False
            
            # Cache entry is valid
            return True
            
        except Exception as e:
            self.logger.error(f"Cache validation failed for {file_path}: {e}")
            return False
    
    def _load_disk_cache_index(self):
        """Load disk cache index from file"""
        index_file = self.cache_dir / "cache_index.json"
        
        try:
            if index_file.exists():
                with open(index_file, 'r') as f:
                    self.disk_cache_index = json.load(f)
                
                # Validate index entries
                invalid_keys = []
                for cache_key, disk_file in self.disk_cache_index.items():
                    if not os.path.exists(disk_file):
                        invalid_keys.append(cache_key)
                
                # Remove invalid entries
                for key in invalid_keys:
                    del self.disk_cache_index[key]
                
                if invalid_keys and self.debug:
                    self.logger.debug(f"Removed {len(invalid_keys)} invalid disk cache entries")
        
        except Exception as e:
            self.logger.error(f"Failed to load disk cache index: {e}")
            self.disk_cache_index = {}
    
    def _save_disk_cache_index(self):
        """Save disk cache index to file"""
        index_file = self.cache_dir / "cache_index.json"
        
        try:
            with open(index_file, 'w') as f:
                json.dump(self.disk_cache_index, f, indent=2)
        
        except Exception as e:
            self.logger.error(f"Failed to save disk cache index: {e}")
    
    def _update_hit_ratio(self):
        """Update cache hit ratio"""
        if self.stats.total_requests > 0:
            self.stats.hit_ratio = self.stats.cache_hits / self.stats.total_requests
    
    def _update_average_access_time(self, access_time: float):
        """Update average access time"""
        if self.stats.total_requests == 1:
            self.stats.average_access_time = access_time
        else:
            # Running average
            self.stats.average_access_time = (
                (self.stats.average_access_time * (self.stats.total_requests - 1) + access_time) /
                self.stats.total_requests
            )
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get comprehensive cache statistics"""
        with self.lock:
            # Update current statistics
            self.stats.total_entries = len(self.memory_cache) + len(self.disk_cache_index)
            
            # Calculate memory usage
            memory_usage = 0
            for entry in self.memory_cache.values():
                try:
                    memory_usage += len(pickle.dumps(entry))
                except:
                    pass
            self.stats.memory_usage_mb = memory_usage / (1024 * 1024)
            
            # Calculate disk usage
            disk_usage = 0
            for disk_file in self.disk_cache_index.values():
                try:
                    if os.path.exists(disk_file):
                        disk_usage += os.path.getsize(disk_file)
                except:
                    pass
            self.stats.disk_usage_mb = disk_usage / (1024 * 1024)
            
            # Calculate entry ages
            current_time = time.time()
            entry_ages = []
            
            for entry in self.memory_cache.values():
                entry_ages.append(current_time - entry.created_at)
            
            if entry_ages:
                self.stats.oldest_entry_age = max(entry_ages)
                self.stats.newest_entry_age = min(entry_ages)
            
            return {
                "cache_stats": asdict(self.stats),
                "memory_cache_size": len(self.memory_cache),
                "disk_cache_size": len(self.disk_cache_index),
                "cache_directory": str(self.cache_dir)
            }
    
    def clear_cache(self, memory_only: bool = False):
        """
        Clear cache entries.
        
        Args:
            memory_only: If True, only clear memory cache
        """
        with self.lock:
            # Clear memory cache
            memory_cleared = len(self.memory_cache)
            self.memory_cache.clear()
            
            disk_cleared = 0
            if not memory_only and self.enable_disk_cache:
                # Clear disk cache
                for cache_key in list(self.disk_cache_index.keys()):
                    self._remove_from_disk_cache(cache_key)
                    disk_cleared += 1
                
                # Save empty index
                self._save_disk_cache_index()
            
            self.logger.info(f"Cache cleared: {memory_cleared} memory entries, {disk_cleared} disk entries")
    
    def optimize_cache(self):
        """Optimize cache by removing low-value entries"""
        with self.lock:
            current_time = time.time()
            
            # Remove old, rarely accessed entries from memory
            to_remove = []
            for cache_key, entry in self.memory_cache.items():
                age_hours = (current_time - entry.last_accessed) / 3600
                
                # Remove entries older than 24 hours with low access count
                if age_hours > 24 and entry.access_count < 2:
                    to_remove.append(cache_key)
                # Remove entries older than 7 days regardless of access
                elif age_hours > 168:
                    to_remove.append(cache_key)
            
            for cache_key in to_remove:
                del self.memory_cache[cache_key]
            
            # Optimize disk cache
            if self.enable_disk_cache:
                disk_to_remove = []
                for cache_key, disk_file in self.disk_cache_index.items():
                    try:
                        entry = self._load_from_disk(disk_file)
                        if entry:
                            age_hours = (current_time - entry.last_accessed) / 3600
                            
                            # Remove old disk entries with low confidence or access
                            if (age_hours > 168 and entry.confidence_score < 0.7) or age_hours > 720:  # 30 days
                                disk_to_remove.append(cache_key)
                    except:
                        # Remove corrupted entries
                        disk_to_remove.append(cache_key)
                
                for cache_key in disk_to_remove:
                    self._remove_from_disk_cache(cache_key)
                
                if disk_to_remove:
                    self._save_disk_cache_index()
            
            removed_total = len(to_remove) + len(disk_to_remove) if self.enable_disk_cache else len(to_remove)
            
            if removed_total > 0:
                self.logger.info(f"Cache optimization removed {removed_total} entries")
    
    def __enter__(self):
        """Context manager entry"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        if self.enable_disk_cache:
            self._save_disk_cache_index()


# Convenience function for creating cache instance
def create_intelligent_cache(max_memory_entries: int = 50, 
                           max_disk_entries: int = 200,
                           cache_dir: Optional[str] = None,
                           debug: bool = False) -> IntelligentCache:
    """
    Create an IntelligentCache instance.
    
    Args:
        max_memory_entries: Maximum entries in memory cache
        max_disk_entries: Maximum entries in disk cache
        cache_dir: Directory for disk cache
        debug: Enable debug logging
        
    Returns:
        IntelligentCache instance
    """
    return IntelligentCache(
        max_memory_entries=max_memory_entries,
        max_disk_entries=max_disk_entries,
        cache_dir=cache_dir,
        enable_disk_cache=True,
        debug=debug
    )