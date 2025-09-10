#!/usr/bin/env python3
"""
Optimized Document Processor

This module integrates parallel processing, intelligent caching, and performance
monitoring into the enhanced document processor for maximum efficiency and speed.
"""

import os
import time
import logging
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict

# Import optimization components
from .parallelProcessor import ParallelProcessor, ParallelTask, ParallelResult
from .intelligentCache import IntelligentCache, CacheEntry
from .performanceMonitor import PerformanceMonitor, PerformanceMetrics

# Import existing components
from .enhancedDocumentProcessor import (
    EnhancedDocumentProcessor, EnhancedProcessingResult, ProcessingMetadata,
    QualityMetrics, ProcessingError
)
from .formatDetector import FormatDetectionResult


@dataclass
class OptimizedProcessingResult(EnhancedProcessingResult):
    """Extended processing result with optimization metrics"""
    parallel_processing_used: bool = False
    cache_hit: bool = False
    memory_optimized: bool = False
    optimization_stats: Optional[Dict[str, Any]] = None


class OptimizedDocumentProcessor(EnhancedDocumentProcessor):
    """
    Optimized document processor that integrates parallel processing,
    intelligent caching, and performance monitoring for maximum efficiency.
    """
    
    def __init__(self, 
                 config_path: Optional[str] = None, 
                 debug: bool = False,
                 temp_dir: Optional[str] = None,
                 enable_caching: bool = True,
                 enable_parallel_processing: bool = True,
                 enable_performance_monitoring: bool = True,
                 max_workers: int = 2,
                 cache_size: int = 50):
        """
        Initialize the Optimized Document Processor.
        
        Args:
            config_path: Path to configuration file
            debug: Enable debug logging
            temp_dir: Custom temporary directory
            enable_caching: Enable intelligent caching
            enable_parallel_processing: Enable parallel processing
            enable_performance_monitoring: Enable performance monitoring
            max_workers: Maximum parallel workers
            cache_size: Maximum cache entries
        """
        # Initialize base processor
        super().__init__(config_path, debug, temp_dir, enable_caching)
        
        self.enable_parallel_processing = enable_parallel_processing
        self.enable_performance_monitoring = enable_performance_monitoring
        self.max_workers = max_workers
        
        # Initialize optimization components
        self._initialize_optimization_components(cache_size)
        
        # Update statistics to include optimization metrics
        self.stats.update({
            'parallel_operations': 0,
            'cache_hits': 0,
            'cache_misses': 0,
            'memory_optimizations': 0,
            'performance_improvements': 0
        })
        
        self.logger.info("OptimizedDocumentProcessor initialized with all optimizations")
    
    def _initialize_optimization_components(self, cache_size: int):
        """Initialize parallel processing, caching, and monitoring components"""
        try:
            # Initialize parallel processor
            if self.enable_parallel_processing:
                self.parallel_processor = ParallelProcessor(
                    max_workers=self.max_workers,
                    debug=self.debug,
                    enable_process_pool=False  # Use threads for I/O bound tasks
                )
                self.logger.info(f"Parallel processor initialized with {self.max_workers} workers")
            else:
                self.parallel_processor = None
            
            # Initialize intelligent cache
            if self.enable_caching:
                self.intelligent_cache = IntelligentCache(
                    max_memory_entries=cache_size,
                    max_disk_entries=cache_size * 4,
                    enable_disk_cache=True,
                    debug=self.debug
                )
                self.logger.info(f"Intelligent cache initialized with {cache_size} memory entries")
            else:
                self.intelligent_cache = None
            
            # Initialize performance monitor
            if self.enable_performance_monitoring:
                self.performance_monitor = PerformanceMonitor(
                    enable_detailed_monitoring=True,
                    memory_threshold_mb=500.0,
                    auto_optimize_memory=True,
                    debug=self.debug
                )
                self.logger.info("Performance monitor initialized")
            else:
                self.performance_monitor = None
                
        except Exception as e:
            self.logger.error(f"Failed to initialize optimization components: {e}")
            # Disable optimizations if initialization fails
            self.enable_parallel_processing = False
            self.enable_caching = False
            self.enable_performance_monitoring = False
            self.parallel_processor = None
            self.intelligent_cache = None
            self.performance_monitor = None
    
    def process_document(self, file_path: str, file_type: Optional[str] = None) -> OptimizedProcessingResult:
        """
        Process document with all optimizations enabled.
        
        Args:
            file_path: Path to the document file
            file_type: Optional file type hint
            
        Returns:
            OptimizedProcessingResult with processing results and optimization metrics
        """
        if not os.path.exists(file_path):
            error_msg = f"Document file not found: {file_path}"
            self.logger.error(error_msg)
            return self._create_optimized_error_result(error_msg, "FILE_NOT_FOUND")
        
        # Start performance monitoring
        operation_id = f"optimized_process_{int(time.time() * 1000)}"
        perf_context = None
        
        if self.performance_monitor:
            perf_context = self.performance_monitor.start_operation(
                operation_id, "optimized_document_processing", file_path
            )
        
        try:
            self.logger.info(f"Processing document with optimizations: {file_path}")
            self._send_progress("Initializing optimized document processing...")
            
            # Check intelligent cache first
            cache_hit = False
            if self.intelligent_cache:
                cached_result = self.intelligent_cache.get(file_path)
                if cached_result:
                    cache_hit = True
                    self.stats['cache_hits'] += 1
                    
                    if self.performance_monitor:
                        self.performance_monitor.end_operation(perf_context, success=True)
                    
                    self.logger.info("Returning cached result")
                    return self._convert_to_optimized_result(cached_result, cache_hit=True)
                else:
                    self.stats['cache_misses'] += 1
            
            # Process with optimizations
            result = self._process_document_optimized(file_path, file_type, perf_context)
            
            # Cache successful results
            if self.intelligent_cache and result.success:
                self.intelligent_cache.put(
                    file_path=file_path,
                    data=result,
                    processing_time=result.processing_time,
                    confidence_score=result.confidence_score,
                    metadata={"optimization_stats": result.optimization_stats}
                )
            
            # End performance monitoring
            if self.performance_monitor:
                self.performance_monitor.end_operation(
                    perf_context, 
                    success=result.success,
                    error_message=result.error_message
                )
            
            return result
            
        except Exception as e:
            self.stats['errors_encountered'] += 1
            error_msg = f"Optimized processing failed for {file_path}: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            if self.performance_monitor and perf_context:
                self.performance_monitor.end_operation(
                    perf_context, 
                    success=False, 
                    error_message=str(e)
                )
            
            return self._create_optimized_error_result(error_msg, "PROCESSING_ERROR", {"file_path": file_path})
    
    def _process_document_optimized(self, file_path: str, file_type: Optional[str], 
                                  perf_context: Optional[Dict]) -> OptimizedProcessingResult:
        """
        Internal optimized processing with parallel execution and performance monitoring.
        """
        start_time = time.time()
        optimization_stats = {
            'parallel_processing_used': False,
            'memory_optimized': False,
            'performance_improvements': {}
        }
        
        try:
            # Step 1: Detect document format (unchanged)
            self._send_progress("Detecting document format...")
            detected_format = self.format_detector.detect_format(file_path)
            
            # Step 2: Determine if parallel processing is beneficial
            use_parallel = self._should_use_parallel_processing(detected_format)
            
            if use_parallel and self.parallel_processor:
                # Process with parallel optimization
                result = self._process_with_parallel_optimization(file_path, detected_format, optimization_stats)
            else:
                # Process with standard enhanced pipeline
                result = self._process_with_standard_pipeline(file_path, detected_format)
            
            # Step 3: Apply memory optimization if needed
            if self.performance_monitor:
                current_memory = self.performance_monitor._get_current_memory_usage()
                if current_memory > 300:  # MB threshold
                    self._send_progress("Optimizing memory usage...")
                    memory_stats = self.performance_monitor.optimize_memory()
                    optimization_stats['memory_optimized'] = True
                    optimization_stats['memory_saved_mb'] = memory_stats.memory_saved
                    self.stats['memory_optimizations'] += 1
            
            # Step 4: Convert to optimized result
            processing_time = time.time() - start_time
            
            optimized_result = OptimizedProcessingResult(
                success=result.success,
                transactions=result.transactions,
                metadata=result.metadata,
                processing_time=processing_time,
                confidence_score=result.confidence_score,
                error_message=result.error_message,
                parallel_processing_used=optimization_stats['parallel_processing_used'],
                cache_hit=False,
                memory_optimized=optimization_stats['memory_optimized'],
                optimization_stats=optimization_stats
            )
            
            return optimized_result
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_msg = f"Optimized processing error: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            return OptimizedProcessingResult(
                success=False,
                transactions=[],
                metadata=ProcessingMetadata(
                    processing_time=processing_time,
                    total_transactions=0,
                    tables_found=0,
                    text_regions_found=0,
                    format_detected=detected_format.detected_format if 'detected_format' in locals() else 'unknown',
                    strategy_used='optimized_error',
                    components_used=[],
                    preprocessing_applied=False,
                    fallback_used=False
                ),
                processing_time=processing_time,
                confidence_score=0.0,
                error_message=error_msg,
                optimization_stats=optimization_stats
            )
    
    def _should_use_parallel_processing(self, detected_format: FormatDetectionResult) -> bool:
        """
        Determine if parallel processing would be beneficial for this document.
        
        Args:
            detected_format: Detected document format information
            
        Returns:
            True if parallel processing should be used
        """
        if not self.enable_parallel_processing or not self.parallel_processor:
            return False
        
        # Use parallel processing for PDFs with multiple pages
        if detected_format.detected_format.lower() == 'pdf':
            page_count = detected_format.metadata.get('page_count', 1) if detected_format.metadata else 1
            return page_count > 1
        
        # Use parallel processing for large images
        if detected_format.detected_format.lower() in ['jpg', 'jpeg', 'png', 'tiff']:
            file_size_mb = detected_format.metadata.get('file_size', 0) / (1024 * 1024) if detected_format.metadata else 0
            return file_size_mb > 5  # 5MB threshold
        
        return False
    
    def _process_with_parallel_optimization(self, file_path: str, detected_format: FormatDetectionResult, 
                                          optimization_stats: Dict) -> Any:
        """
        Process document using parallel optimization for improved performance.
        """
        self._send_progress("Processing with parallel optimization...")
        self.logger.info("Using parallel processing for enhanced performance")
        
        format_type = detected_format.detected_format.lower()
        
        if format_type == 'pdf':
            # Parallel PDF processing
            parallel_results = self.parallel_processor.process_pdf_parallel(
                file_path=file_path,
                enable_text_extraction=True,
                enable_table_detection=True,
                enable_ocr=detected_format.metadata.get('is_scanned', False) if detected_format.metadata else False
            )
            
            optimization_stats['parallel_processing_used'] = True
            optimization_stats['parallel_tasks'] = len(parallel_results)
            self.stats['parallel_operations'] += 1
            
            # Combine parallel results
            return self._combine_parallel_results(parallel_results, detected_format)
        
        else:
            # Fall back to standard processing for non-PDF formats
            return self._process_with_standard_pipeline(file_path, detected_format)
    
    def _combine_parallel_results(self, parallel_results: Dict[str, ParallelResult], 
                                detected_format: FormatDetectionResult) -> Any:
        """
        Combine results from parallel processing tasks into a unified result.
        """
        self._send_progress("Combining parallel processing results...")
        
        combined_transactions = []
        components_used = []
        total_confidence = 0.0
        confidence_count = 0
        
        # Process text extraction results
        for task_id, result in parallel_results.items():
            if not result.success:
                continue
                
            if result.task_type == "text_extraction":
                text_data = result.result
                if text_data and text_data.get('text'):
                    # Convert text to transactions (simplified)
                    text_transactions = self._convert_text_to_transactions(
                        text_data['text'], 
                        0.8  # Default confidence for text extraction
                    )
                    combined_transactions.extend(text_transactions)
                    components_used.append('text_extraction')
            
            elif result.task_type == "table_detection":
                table_data = result.result
                if table_data and table_data.get('tables'):
                    # Convert tables to transactions
                    for table_info in table_data['tables']:
                        if hasattr(table_info, 'data') and hasattr(table_info, 'confidence'):
                            table_transactions = self._convert_table_to_transactions(
                                table_info.data, 
                                table_info.confidence
                            )
                            combined_transactions.extend(table_transactions)
                    components_used.append('table_detection')
                    total_confidence += table_data.get('confidence', 0.0)
                    confidence_count += 1
            
            elif result.task_type == "ocr_processing":
                ocr_data = result.result
                if ocr_data and ocr_data.get('text'):
                    ocr_transactions = self._convert_text_to_transactions(
                        ocr_data['text'], 
                        ocr_data.get('confidence', 0.5)
                    )
                    combined_transactions.extend(ocr_transactions)
                    components_used.append('ocr_processing')
                    total_confidence += ocr_data.get('confidence', 0.0)
                    confidence_count += 1
        
        # Calculate overall confidence
        overall_confidence = total_confidence / confidence_count if confidence_count > 0 else 0.5
        
        # Apply NLP validation if enabled
        if self.config.get('processing', {}).get('enable_nlp_validation', True) and combined_transactions:
            self._send_progress("Applying NLP validation to combined results...")
            validated_transactions = []
            
            for transaction in combined_transactions:
                try:
                    validation_result = self.nlp_validator.validate_with_context(transaction)
                    if validation_result.is_valid:
                        transaction['validation_score'] = validation_result.confidence
                        validated_transactions.append(transaction)
                except Exception as e:
                    self.logger.warning(f"NLP validation failed for transaction: {e}")
                    validated_transactions.append(transaction)
            
            combined_transactions = validated_transactions
            components_used.append('nlp_validation')
        
        # Create result object
        class ParallelProcessingResult:
            def __init__(self):
                self.success = len(combined_transactions) > 0
                self.transactions = combined_transactions
                self.confidence_score = overall_confidence
                self.error_message = None if self.success else "No transactions extracted from parallel processing"
                self.components_used = components_used
                self.tables_found = sum(1 for r in parallel_results.values() 
                                      if r.task_type == "table_detection" and r.success)
                self.text_regions_found = sum(1 for r in parallel_results.values() 
                                            if r.task_type in ["text_extraction", "ocr_processing"] and r.success)
                self.preprocessing_applied = any(r.task_type == "ocr_processing" for r in parallel_results.values())
                self.fallback_used = False
        
        return ParallelProcessingResult()
    
    def _process_with_standard_pipeline(self, file_path: str, detected_format: FormatDetectionResult) -> Any:
        """
        Process document using the standard enhanced pipeline (non-parallel).
        """
        self._send_progress("Processing with standard enhanced pipeline...")
        
        # Use the parent class method for standard processing
        strategy = self._select_processing_strategy(detected_format)
        return self._execute_processing_strategy(file_path, detected_format, strategy)
    
    def _convert_to_optimized_result(self, cached_result: Any, cache_hit: bool = False) -> OptimizedProcessingResult:
        """Convert cached or standard result to OptimizedProcessingResult"""
        if isinstance(cached_result, OptimizedProcessingResult):
            cached_result.cache_hit = cache_hit
            return cached_result
        elif isinstance(cached_result, EnhancedProcessingResult):
            return OptimizedProcessingResult(
                success=cached_result.success,
                transactions=cached_result.transactions,
                metadata=cached_result.metadata,
                processing_time=cached_result.processing_time,
                confidence_score=cached_result.confidence_score,
                error_message=cached_result.error_message,
                cache_hit=cache_hit,
                parallel_processing_used=False,
                memory_optimized=False,
                optimization_stats={"from_cache": True}
            )
        else:
            # Handle other result types
            return OptimizedProcessingResult(
                success=True,
                transactions=getattr(cached_result, 'transactions', []),
                metadata=ProcessingMetadata(
                    processing_time=0.0,
                    total_transactions=len(getattr(cached_result, 'transactions', [])),
                    tables_found=0,
                    text_regions_found=0,
                    format_detected='unknown',
                    strategy_used='cached',
                    components_used=[],
                    preprocessing_applied=False,
                    fallback_used=False
                ),
                processing_time=0.0,
                confidence_score=getattr(cached_result, 'confidence_score', 1.0),
                cache_hit=cache_hit,
                optimization_stats={"from_cache": True}
            )
    
    def _create_optimized_error_result(self, error_message: str, error_code: str = "PROCESSING_ERROR", 
                                     details: Dict[str, Any] = None) -> OptimizedProcessingResult:
        """Create a standardized optimized error result"""
        return OptimizedProcessingResult(
            success=False,
            transactions=[],
            metadata=ProcessingMetadata(
                processing_time=0.0,
                total_transactions=0,
                tables_found=0,
                text_regions_found=0,
                format_detected='unknown',
                strategy_used='error',
                components_used=[],
                preprocessing_applied=False,
                fallback_used=False
            ),
            processing_time=0.0,
            confidence_score=0.0,
            error_message=error_message,
            parallel_processing_used=False,
            cache_hit=False,
            memory_optimized=False,
            optimization_stats={
                "error_code": error_code,
                "error_details": details or {}
            }
        )
    
    def get_optimization_stats(self) -> Dict[str, Any]:
        """Get comprehensive optimization statistics"""
        base_stats = self.get_processing_stats()
        
        optimization_stats = {
            "parallel_processing": {},
            "caching": {},
            "performance_monitoring": {}
        }
        
        # Parallel processing stats
        if self.parallel_processor:
            optimization_stats["parallel_processing"] = self.parallel_processor.get_processing_stats()
        
        # Caching stats
        if self.intelligent_cache:
            optimization_stats["caching"] = self.intelligent_cache.get_cache_stats()
        
        # Performance monitoring stats
        if self.performance_monitor:
            optimization_stats["performance_monitoring"] = self.performance_monitor.get_performance_report()
        
        return {
            **base_stats,
            "optimization_stats": optimization_stats
        }
    
    def benchmark_performance(self, test_files: List[str]) -> Dict[str, Any]:
        """
        Benchmark optimized processor against standard processor.
        
        Args:
            test_files: List of test file paths
            
        Returns:
            Benchmark results
        """
        if not self.performance_monitor:
            return {"error": "Performance monitoring not enabled"}
        
        benchmark_results = []
        
        for test_file in test_files:
            if not os.path.exists(test_file):
                continue
            
            try:
                # Benchmark optimized processing
                def optimized_processor(file_path):
                    return self.process_document(file_path)
                
                # Benchmark standard processing (disable optimizations temporarily)
                def standard_processor(file_path):
                    # Temporarily disable optimizations
                    original_parallel = self.enable_parallel_processing
                    original_cache = self.enable_caching
                    
                    self.enable_parallel_processing = False
                    self.enable_caching = False
                    
                    try:
                        return super(OptimizedDocumentProcessor, self).process_document(file_path)
                    finally:
                        self.enable_parallel_processing = original_parallel
                        self.enable_caching = original_cache
                
                benchmark = self.performance_monitor.benchmark_against_legacy(
                    test_name=f"optimization_test_{os.path.basename(test_file)}",
                    current_processor=optimized_processor,
                    legacy_processor=standard_processor,
                    test_file=test_file
                )
                
                benchmark_results.append(benchmark)
                
            except Exception as e:
                self.logger.error(f"Benchmark failed for {test_file}: {e}")
        
        return {
            "benchmark_results": [asdict(b) for b in benchmark_results],
            "summary": self._summarize_benchmarks(benchmark_results)
        }
    
    def _summarize_benchmarks(self, benchmarks: List) -> Dict[str, Any]:
        """Summarize benchmark results"""
        if not benchmarks:
            return {}
        
        improvements = [b.improvement_ratio for b in benchmarks if b.improvement_ratio]
        memory_improvements = [b.memory_improvement for b in benchmarks if b.memory_improvement]
        
        return {
            "total_tests": len(benchmarks),
            "average_speed_improvement": sum(improvements) / len(improvements) if improvements else 0,
            "best_speed_improvement": max(improvements) if improvements else 0,
            "average_memory_improvement": sum(memory_improvements) / len(memory_improvements) if memory_improvements else 0,
            "best_memory_improvement": max(memory_improvements) if memory_improvements else 0
        }
    
    def cleanup_resources(self):
        """Clean up all optimization resources"""
        try:
            # Clean up base resources
            super().cleanup_resources()
            
            # Clean up parallel processor
            if self.parallel_processor:
                self.parallel_processor.shutdown()
            
            # Clean up performance monitor
            if self.performance_monitor:
                self.performance_monitor.stop_monitoring()
            
            # Cache cleanup is automatic
            
            self.logger.info("All optimization resources cleaned up")
            
        except Exception as e:
            self.logger.error(f"Error during optimization resource cleanup: {e}")
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit with optimization cleanup"""
        self.cleanup_resources()


# Convenience function for creating optimized processor
def create_optimized_processor(config_path: Optional[str] = None,
                             debug: bool = False,
                             enable_all_optimizations: bool = True,
                             max_workers: int = 2,
                             cache_size: int = 50) -> OptimizedDocumentProcessor:
    """
    Create an OptimizedDocumentProcessor instance.
    
    Args:
        config_path: Path to configuration file
        debug: Enable debug logging
        enable_all_optimizations: Enable all optimization features
        max_workers: Maximum parallel workers
        cache_size: Maximum cache entries
        
    Returns:
        OptimizedDocumentProcessor instance
    """
    return OptimizedDocumentProcessor(
        config_path=config_path,
        debug=debug,
        enable_caching=enable_all_optimizations,
        enable_parallel_processing=enable_all_optimizations,
        enable_performance_monitoring=enable_all_optimizations,
        max_workers=max_workers,
        cache_size=cache_size
    )