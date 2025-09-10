#!/usr/bin/env python3
"""
Parallel Processor

This module implements parallel processing capabilities for document extraction,
enabling concurrent execution of text extraction and table detection operations
to improve processing speed and efficiency.
"""

import os
import time
import logging
import threading
from typing import List, Dict, Optional, Any, Callable, Tuple
from dataclasses import dataclass, asdict
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, Future, as_completed
import multiprocessing as mp
from queue import Queue
import psutil

# Import processing components
from .modernTableDetector import ModernTableDetector, TableExtractionResult
from .modernOCREngine import ModernOCREngine, OCRExtractionResult
from .advancedImagePreprocessor import AdvancedImagePreprocessor


@dataclass
class ParallelTask:
    """Represents a parallel processing task"""
    task_id: str
    task_type: str  # 'text_extraction', 'table_detection', 'ocr_processing'
    file_path: str
    parameters: Dict[str, Any]
    priority: int = 1  # Higher number = higher priority
    created_at: float = None
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = time.time()


@dataclass
class ParallelResult:
    """Result from parallel processing task"""
    task_id: str
    task_type: str
    success: bool
    result: Any
    processing_time: float
    error_message: Optional[str] = None
    memory_usage: Optional[float] = None


@dataclass
class ParallelProcessingStats:
    """Statistics for parallel processing operations"""
    total_tasks: int
    completed_tasks: int
    failed_tasks: int
    total_processing_time: float
    average_task_time: float
    peak_memory_usage: float
    concurrent_tasks_peak: int
    thread_pool_utilization: float


class ParallelProcessor:
    """
    Parallel processor for document extraction operations.
    
    This class manages concurrent execution of text extraction, table detection,
    and OCR operations to improve processing speed while managing resource usage.
    """
    
    def __init__(self, max_workers: int = None, debug: bool = False, 
                 enable_process_pool: bool = False):
        """
        Initialize the Parallel Processor.
        
        Args:
            max_workers: Maximum number of worker threads/processes
            debug: Enable debug logging
            enable_process_pool: Use process pool instead of thread pool for CPU-intensive tasks
        """
        self.debug = debug
        self.logger = self._setup_logger()
        
        # Determine optimal worker count
        if max_workers is None:
            cpu_count = mp.cpu_count()
            # Use 2 workers for I/O bound tasks, but don't exceed CPU count
            self.max_workers = min(2, cpu_count)
        else:
            self.max_workers = max_workers
        
        self.enable_process_pool = enable_process_pool
        
        # Initialize thread pool for I/O bound tasks
        self.thread_pool = ThreadPoolExecutor(max_workers=self.max_workers)
        
        # Initialize process pool for CPU-intensive tasks if enabled
        if enable_process_pool:
            self.process_pool = ProcessPoolExecutor(max_workers=self.max_workers)
        else:
            self.process_pool = None
        
        # Task management
        self.active_tasks: Dict[str, Future] = {}
        self.task_results: Dict[str, ParallelResult] = {}
        self.task_lock = threading.Lock()
        
        # Statistics
        self.stats = ParallelProcessingStats(
            total_tasks=0,
            completed_tasks=0,
            failed_tasks=0,
            total_processing_time=0.0,
            average_task_time=0.0,
            peak_memory_usage=0.0,
            concurrent_tasks_peak=0,
            thread_pool_utilization=0.0
        )
        
        # Resource monitoring
        self.memory_monitor = MemoryMonitor(debug=debug)
        
        self.logger.info(f"ParallelProcessor initialized with {self.max_workers} workers")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger for the ParallelProcessor"""
        logger = logging.getLogger(f"{__name__}.ParallelProcessor")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def process_pdf_parallel(self, file_path: str, 
                           enable_text_extraction: bool = True,
                           enable_table_detection: bool = True,
                           enable_ocr: bool = False) -> Dict[str, ParallelResult]:
        """
        Process PDF with parallel text extraction and table detection.
        
        Args:
            file_path: Path to PDF file
            enable_text_extraction: Enable parallel text extraction
            enable_table_detection: Enable parallel table detection
            enable_ocr: Enable parallel OCR processing
            
        Returns:
            Dictionary of task results
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"PDF file not found: {file_path}")
        
        self.logger.info(f"Starting parallel processing for: {file_path}")
        start_time = time.time()
        
        # Create parallel tasks
        tasks = []
        
        if enable_text_extraction:
            task = ParallelTask(
                task_id=f"text_{int(time.time() * 1000)}",
                task_type="text_extraction",
                file_path=file_path,
                parameters={"method": "pymupdf"},
                priority=2
            )
            tasks.append(task)
        
        if enable_table_detection:
            task = ParallelTask(
                task_id=f"table_{int(time.time() * 1000)}",
                task_type="table_detection",
                file_path=file_path,
                parameters={"method": "pdfplumber"},
                priority=3
            )
            tasks.append(task)
        
        if enable_ocr:
            task = ParallelTask(
                task_id=f"ocr_{int(time.time() * 1000)}",
                task_type="ocr_processing",
                file_path=file_path,
                parameters={"method": "easyocr", "preprocess": True},
                priority=1
            )
            tasks.append(task)
        
        # Execute tasks in parallel
        results = self._execute_parallel_tasks(tasks)
        
        # Update statistics
        processing_time = time.time() - start_time
        self.stats.total_processing_time += processing_time
        
        self.logger.info(f"Parallel processing completed in {processing_time:.2f}s")
        
        return results
    
    def _execute_parallel_tasks(self, tasks: List[ParallelTask]) -> Dict[str, ParallelResult]:
        """
        Execute a list of tasks in parallel.
        
        Args:
            tasks: List of parallel tasks to execute
            
        Returns:
            Dictionary mapping task IDs to results
        """
        if not tasks:
            return {}
        
        # Sort tasks by priority (higher priority first)
        tasks.sort(key=lambda t: t.priority, reverse=True)
        
        # Submit tasks to appropriate executor
        futures = {}
        
        with self.task_lock:
            for task in tasks:
                if task.task_type in ['text_extraction', 'table_detection']:
                    # I/O bound tasks use thread pool
                    future = self.thread_pool.submit(self._execute_task, task)
                elif task.task_type == 'ocr_processing' and self.process_pool:
                    # CPU-intensive OCR tasks use process pool if available
                    future = self.process_pool.submit(self._execute_task, task)
                else:
                    # Fallback to thread pool
                    future = self.thread_pool.submit(self._execute_task, task)
                
                futures[task.task_id] = future
                self.active_tasks[task.task_id] = future
                self.stats.total_tasks += 1
        
        # Update peak concurrent tasks
        self.stats.concurrent_tasks_peak = max(
            self.stats.concurrent_tasks_peak, 
            len(futures)
        )
        
        # Collect results as they complete
        results = {}
        
        for future in as_completed(futures.values()):
            try:
                result = future.result()
                results[result.task_id] = result
                
                # Update statistics
                with self.task_lock:
                    if result.success:
                        self.stats.completed_tasks += 1
                    else:
                        self.stats.failed_tasks += 1
                    
                    # Remove from active tasks
                    if result.task_id in self.active_tasks:
                        del self.active_tasks[result.task_id]
                
                # Update memory peak
                if result.memory_usage:
                    self.stats.peak_memory_usage = max(
                        self.stats.peak_memory_usage,
                        result.memory_usage
                    )
                
            except Exception as e:
                self.logger.error(f"Task execution failed: {e}")
                # Find the task ID for this future
                task_id = None
                for tid, fut in futures.items():
                    if fut == future:
                        task_id = tid
                        break
                
                if task_id:
                    error_result = ParallelResult(
                        task_id=task_id,
                        task_type="unknown",
                        success=False,
                        result=None,
                        processing_time=0.0,
                        error_message=str(e)
                    )
                    results[task_id] = error_result
                    
                    with self.task_lock:
                        self.stats.failed_tasks += 1
                        if task_id in self.active_tasks:
                            del self.active_tasks[task_id]
        
        # Calculate average task time
        if self.stats.completed_tasks > 0:
            self.stats.average_task_time = (
                self.stats.total_processing_time / self.stats.completed_tasks
            )
        
        return results
    
    def _execute_task(self, task: ParallelTask) -> ParallelResult:
        """
        Execute a single parallel task.
        
        Args:
            task: Task to execute
            
        Returns:
            ParallelResult with execution results
        """
        start_time = time.time()
        memory_start = self.memory_monitor.get_current_usage()
        
        try:
            self.logger.debug(f"Executing task {task.task_id} ({task.task_type})")
            
            result = None
            
            if task.task_type == "text_extraction":
                result = self._execute_text_extraction(task)
            elif task.task_type == "table_detection":
                result = self._execute_table_detection(task)
            elif task.task_type == "ocr_processing":
                result = self._execute_ocr_processing(task)
            else:
                raise ValueError(f"Unknown task type: {task.task_type}")
            
            processing_time = time.time() - start_time
            memory_end = self.memory_monitor.get_current_usage()
            memory_used = memory_end - memory_start
            
            return ParallelResult(
                task_id=task.task_id,
                task_type=task.task_type,
                success=True,
                result=result,
                processing_time=processing_time,
                memory_usage=memory_used
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            self.logger.error(f"Task {task.task_id} failed: {e}")
            
            return ParallelResult(
                task_id=task.task_id,
                task_type=task.task_type,
                success=False,
                result=None,
                processing_time=processing_time,
                error_message=str(e)
            )
    
    def _execute_text_extraction(self, task: ParallelTask) -> Any:
        """Execute text extraction task"""
        method = task.parameters.get("method", "pymupdf")
        
        if method == "pymupdf":
            import fitz  # PyMuPDF
            
            doc = fitz.open(task.file_path)
            text_content = ""
            
            for page in doc:
                text_content += page.get_text() + "\n"
            
            doc.close()
            
            return {
                "text": text_content,
                "method": method,
                "page_count": len(doc) if 'doc' in locals() else 0,
                "text_length": len(text_content)
            }
        
        else:
            raise ValueError(f"Unsupported text extraction method: {method}")
    
    def _execute_table_detection(self, task: ParallelTask) -> Any:
        """Execute table detection task"""
        method = task.parameters.get("method", "pdfplumber")
        
        if method == "pdfplumber":
            # Initialize table detector
            table_detector = ModernTableDetector(debug=self.debug)
            
            # Extract tables
            result = table_detector.extract_tables_with_confidence(task.file_path)
            
            return {
                "tables": result.tables if result.success else [],
                "method": method,
                "success": result.success,
                "confidence": result.overall_confidence,
                "table_count": len(result.tables) if result.success else 0
            }
        
        else:
            raise ValueError(f"Unsupported table detection method: {method}")
    
    def _execute_ocr_processing(self, task: ParallelTask) -> Any:
        """Execute OCR processing task"""
        method = task.parameters.get("method", "easyocr")
        preprocess = task.parameters.get("preprocess", True)
        
        if method == "easyocr":
            # Initialize components
            ocr_engine = ModernOCREngine(debug=self.debug)
            
            if preprocess:
                image_preprocessor = AdvancedImagePreprocessor(debug=self.debug)
                
                # Convert PDF to images and preprocess
                images = image_preprocessor.convert_pdf_to_images(task.file_path)
                
                ocr_results = []
                for image in images:
                    enhanced_image = image_preprocessor.enhance_for_ocr(image)
                    ocr_result = ocr_engine.extract_text(enhanced_image)
                    ocr_results.append(ocr_result)
                
                # Combine results
                combined_text = " ".join([r.text for r in ocr_results if r.text])
                avg_confidence = sum([r.confidence for r in ocr_results]) / len(ocr_results) if ocr_results else 0.0
                
                return {
                    "text": combined_text,
                    "method": method,
                    "confidence": avg_confidence,
                    "pages_processed": len(images),
                    "preprocessing_applied": True
                }
            else:
                # Direct OCR without preprocessing
                result = ocr_engine.extract_from_pdf_page(task.file_path, 0)
                
                return {
                    "text": result.text,
                    "method": method,
                    "confidence": result.confidence,
                    "pages_processed": 1,
                    "preprocessing_applied": False
                }
        
        else:
            raise ValueError(f"Unsupported OCR method: {method}")
    
    def get_active_task_count(self) -> int:
        """Get number of currently active tasks"""
        with self.task_lock:
            return len(self.active_tasks)
    
    def get_processing_stats(self) -> Dict[str, Any]:
        """Get comprehensive processing statistics"""
        return {
            "parallel_stats": asdict(self.stats),
            "active_tasks": self.get_active_task_count(),
            "memory_stats": self.memory_monitor.get_stats(),
            "thread_pool_stats": {
                "max_workers": self.max_workers,
                "active_threads": getattr(self.thread_pool, '_threads', 0)
            }
        }
    
    def shutdown(self, wait: bool = True):
        """
        Shutdown the parallel processor and clean up resources.
        
        Args:
            wait: Whether to wait for active tasks to complete
        """
        self.logger.info("Shutting down ParallelProcessor...")
        
        # Shutdown thread pool
        self.thread_pool.shutdown(wait=wait)
        
        # Shutdown process pool if enabled
        if self.process_pool:
            self.process_pool.shutdown(wait=wait)
        
        # Clear active tasks
        with self.task_lock:
            self.active_tasks.clear()
        
        self.logger.info("ParallelProcessor shutdown complete")
    
    def __enter__(self):
        """Context manager entry"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit with automatic shutdown"""
        self.shutdown()


class MemoryMonitor:
    """Monitor memory usage during parallel processing"""
    
    def __init__(self, debug: bool = False):
        self.debug = debug
        self.logger = logging.getLogger(f"{__name__}.MemoryMonitor")
        self.peak_usage = 0.0
        self.measurements = []
    
    def get_current_usage(self) -> float:
        """Get current process memory usage in MB"""
        try:
            process = psutil.Process()
            memory_mb = process.memory_info().rss / (1024 * 1024)
            
            # Update peak usage
            self.peak_usage = max(self.peak_usage, memory_mb)
            
            # Store measurement
            self.measurements.append({
                'timestamp': time.time(),
                'memory_mb': memory_mb
            })
            
            # Keep only recent measurements (last 100)
            if len(self.measurements) > 100:
                self.measurements = self.measurements[-100:]
            
            return memory_mb
            
        except Exception as e:
            if self.debug:
                self.logger.error(f"Failed to get memory usage: {e}")
            return 0.0
    
    def get_stats(self) -> Dict[str, float]:
        """Get memory usage statistics"""
        if not self.measurements:
            return {"current": 0.0, "peak": 0.0, "average": 0.0}
        
        current = self.measurements[-1]['memory_mb']
        average = sum(m['memory_mb'] for m in self.measurements) / len(self.measurements)
        
        return {
            "current": current,
            "peak": self.peak_usage,
            "average": average,
            "measurement_count": len(self.measurements)
        }


# Convenience function for parallel PDF processing
def process_pdf_parallel(file_path: str, max_workers: int = 2, debug: bool = False) -> Dict[str, Any]:
    """
    Convenience function for parallel PDF processing.
    
    Args:
        file_path: Path to PDF file
        max_workers: Maximum number of worker threads
        debug: Enable debug logging
        
    Returns:
        Dictionary with processing results and statistics
    """
    with ParallelProcessor(max_workers=max_workers, debug=debug) as processor:
        results = processor.process_pdf_parallel(
            file_path=file_path,
            enable_text_extraction=True,
            enable_table_detection=True,
            enable_ocr=False  # OCR is expensive, enable only when needed
        )
        
        stats = processor.get_processing_stats()
        
        return {
            "results": results,
            "statistics": stats
        }