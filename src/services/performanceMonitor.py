#!/usr/bin/env python3
"""
Performance Monitor and Benchmarking System

This module implements comprehensive performance monitoring and benchmarking
capabilities for document processing operations, including memory optimization
and resource management for large documents.
"""

import os
import time
import json
import logging
import threading
import psutil
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, asdict, field
from pathlib import Path
import statistics
from collections import deque
import gc


@dataclass
class PerformanceMetrics:
    """Performance metrics for a processing operation"""
    operation_id: str
    operation_type: str
    start_time: float
    end_time: float
    duration: float
    memory_start: float
    memory_end: float
    memory_peak: float
    memory_delta: float
    cpu_usage: float
    file_size: int
    success: bool
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BenchmarkResult:
    """Result of a benchmark comparison"""
    test_name: str
    current_system_time: float
    legacy_system_time: Optional[float]
    improvement_ratio: Optional[float]
    current_memory: float
    legacy_memory: Optional[float]
    memory_improvement: Optional[float]
    accuracy_score: float
    confidence_score: float
    test_file: str
    timestamp: float


@dataclass
class ResourceUsageSnapshot:
    """Snapshot of system resource usage"""
    timestamp: float
    memory_mb: float
    cpu_percent: float
    disk_io_read: int
    disk_io_write: int
    thread_count: int
    file_descriptors: int


@dataclass
class MemoryOptimizationStats:
    """Statistics for memory optimization operations"""
    initial_memory: float
    optimized_memory: float
    memory_saved: float
    optimization_time: float
    gc_collections: int
    objects_freed: int


class PerformanceMonitor:
    """
    Comprehensive performance monitoring system for document processing.
    
    Features:
    - Real-time performance tracking
    - Memory usage optimization
    - Benchmarking against legacy systems
    - Resource usage monitoring
    - Performance analytics and reporting
    """
    
    def __init__(self, 
                 enable_detailed_monitoring: bool = True,
                 memory_threshold_mb: float = 500.0,
                 auto_optimize_memory: bool = True,
                 debug: bool = False):
        """
        Initialize the Performance Monitor.
        
        Args:
            enable_detailed_monitoring: Enable detailed resource monitoring
            memory_threshold_mb: Memory threshold for optimization triggers
            auto_optimize_memory: Automatically optimize memory when threshold is reached
            debug: Enable debug logging
        """
        self.enable_detailed_monitoring = enable_detailed_monitoring
        self.memory_threshold_mb = memory_threshold_mb
        self.auto_optimize_memory = auto_optimize_memory
        self.debug = debug
        
        # Set up logging
        self.logger = self._setup_logger()
        
        # Performance tracking
        self.metrics: List[PerformanceMetrics] = []
        self.benchmark_results: List[BenchmarkResult] = []
        self.resource_snapshots: deque = deque(maxlen=1000)  # Keep last 1000 snapshots
        
        # Thread safety
        self.lock = threading.RLock()
        
        # Resource monitoring thread
        self.monitoring_active = False
        self.monitoring_thread = None
        self.monitoring_interval = 1.0  # seconds
        
        # Memory optimization
        self.memory_optimizations: List[MemoryOptimizationStats] = []
        
        # Performance baselines
        self.performance_baselines: Dict[str, float] = {}
        
        if self.enable_detailed_monitoring:
            self.start_monitoring()
        
        self.logger.info("PerformanceMonitor initialized")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger for the performance monitor"""
        logger = logging.getLogger(f"{__name__}.PerformanceMonitor")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def start_monitoring(self):
        """Start background resource monitoring"""
        if not self.monitoring_active:
            self.monitoring_active = True
            self.monitoring_thread = threading.Thread(
                target=self._monitoring_loop,
                daemon=True
            )
            self.monitoring_thread.start()
            self.logger.info("Started background resource monitoring")
    
    def stop_monitoring(self):
        """Stop background resource monitoring"""
        if self.monitoring_active:
            self.monitoring_active = False
            if self.monitoring_thread:
                self.monitoring_thread.join(timeout=2.0)
            self.logger.info("Stopped background resource monitoring")
    
    def _monitoring_loop(self):
        """Background monitoring loop"""
        while self.monitoring_active:
            try:
                snapshot = self._capture_resource_snapshot()
                
                with self.lock:
                    self.resource_snapshots.append(snapshot)
                
                # Check memory threshold
                if (self.auto_optimize_memory and 
                    snapshot.memory_mb > self.memory_threshold_mb):
                    self.optimize_memory()
                
                time.sleep(self.monitoring_interval)
                
            except Exception as e:
                if self.debug:
                    self.logger.error(f"Monitoring loop error: {e}")
                time.sleep(self.monitoring_interval)
    
    def _capture_resource_snapshot(self) -> ResourceUsageSnapshot:
        """Capture current system resource usage"""
        try:
            process = psutil.Process()
            memory_info = process.memory_info()
            cpu_percent = process.cpu_percent()
            
            # Get I/O stats if available
            try:
                io_counters = process.io_counters()
                disk_read = io_counters.read_bytes
                disk_write = io_counters.write_bytes
            except (AttributeError, psutil.AccessDenied):
                disk_read = disk_write = 0
            
            # Get thread and file descriptor counts
            try:
                thread_count = process.num_threads()
            except (AttributeError, psutil.AccessDenied):
                thread_count = 0
            
            try:
                fd_count = process.num_fds() if hasattr(process, 'num_fds') else 0
            except (AttributeError, psutil.AccessDenied):
                fd_count = 0
            
            return ResourceUsageSnapshot(
                timestamp=time.time(),
                memory_mb=memory_info.rss / (1024 * 1024),
                cpu_percent=cpu_percent,
                disk_io_read=disk_read,
                disk_io_write=disk_write,
                thread_count=thread_count,
                file_descriptors=fd_count
            )
            
        except Exception as e:
            if self.debug:
                self.logger.error(f"Failed to capture resource snapshot: {e}")
            
            return ResourceUsageSnapshot(
                timestamp=time.time(),
                memory_mb=0.0,
                cpu_percent=0.0,
                disk_io_read=0,
                disk_io_write=0,
                thread_count=0,
                file_descriptors=0
            )
    
    def start_operation(self, operation_id: str, operation_type: str, 
                       file_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Start monitoring a processing operation.
        
        Args:
            operation_id: Unique identifier for the operation
            operation_type: Type of operation (e.g., 'pdf_processing', 'table_detection')
            file_path: Path to file being processed
            
        Returns:
            Context dictionary for the operation
        """
        start_time = time.time()
        memory_start = self._get_current_memory_usage()
        
        # Get file size if path provided
        file_size = 0
        if file_path and os.path.exists(file_path):
            try:
                file_size = os.path.getsize(file_path)
            except:
                pass
        
        context = {
            'operation_id': operation_id,
            'operation_type': operation_type,
            'start_time': start_time,
            'memory_start': memory_start,
            'file_size': file_size,
            'file_path': file_path
        }
        
        if self.debug:
            self.logger.debug(f"Started monitoring operation: {operation_id} ({operation_type})")
        
        return context
    
    def end_operation(self, context: Dict[str, Any], success: bool = True, 
                     error_message: Optional[str] = None, 
                     metadata: Optional[Dict[str, Any]] = None) -> PerformanceMetrics:
        """
        End monitoring of a processing operation.
        
        Args:
            context: Context dictionary from start_operation
            success: Whether the operation succeeded
            error_message: Error message if operation failed
            metadata: Additional metadata about the operation
            
        Returns:
            PerformanceMetrics for the completed operation
        """
        end_time = time.time()
        memory_end = self._get_current_memory_usage()
        
        # Calculate metrics
        duration = end_time - context['start_time']
        memory_delta = memory_end - context['memory_start']
        
        # Get peak memory usage from recent snapshots
        memory_peak = memory_end
        if self.resource_snapshots:
            recent_snapshots = [
                s for s in self.resource_snapshots 
                if s.timestamp >= context['start_time']
            ]
            if recent_snapshots:
                memory_peak = max(s.memory_mb for s in recent_snapshots)
        
        # Get average CPU usage during operation
        cpu_usage = 0.0
        if self.resource_snapshots:
            recent_snapshots = [
                s for s in self.resource_snapshots 
                if s.timestamp >= context['start_time']
            ]
            if recent_snapshots:
                cpu_usage = statistics.mean(s.cpu_percent for s in recent_snapshots)
        
        # Create performance metrics
        metrics = PerformanceMetrics(
            operation_id=context['operation_id'],
            operation_type=context['operation_type'],
            start_time=context['start_time'],
            end_time=end_time,
            duration=duration,
            memory_start=context['memory_start'],
            memory_end=memory_end,
            memory_peak=memory_peak,
            memory_delta=memory_delta,
            cpu_usage=cpu_usage,
            file_size=context.get('file_size', 0),
            success=success,
            error_message=error_message,
            metadata=metadata or {}
        )
        
        # Store metrics
        with self.lock:
            self.metrics.append(metrics)
        
        # Update performance baselines
        if success:
            self._update_performance_baseline(context['operation_type'], duration)
        
        if self.debug:
            self.logger.debug(
                f"Completed operation {context['operation_id']}: "
                f"{duration:.2f}s, {memory_delta:+.1f}MB memory"
            )
        
        return metrics
    
    def _get_current_memory_usage(self) -> float:
        """Get current process memory usage in MB"""
        try:
            process = psutil.Process()
            return process.memory_info().rss / (1024 * 1024)
        except:
            return 0.0
    
    def _update_performance_baseline(self, operation_type: str, duration: float):
        """Update performance baseline for operation type"""
        if operation_type not in self.performance_baselines:
            self.performance_baselines[operation_type] = duration
        else:
            # Use exponential moving average
            alpha = 0.1
            self.performance_baselines[operation_type] = (
                alpha * duration + 
                (1 - alpha) * self.performance_baselines[operation_type]
            )
    
    def optimize_memory(self) -> MemoryOptimizationStats:
        """
        Optimize memory usage by forcing garbage collection and cleanup.
        
        Returns:
            MemoryOptimizationStats with optimization results
        """
        start_time = time.time()
        initial_memory = self._get_current_memory_usage()
        
        # Force garbage collection
        gc_collections = 0
        objects_freed = 0
        
        for generation in range(3):
            collected = gc.collect(generation)
            gc_collections += 1
            objects_freed += collected
        
        # Additional cleanup
        gc.collect()
        gc_collections += 1
        
        optimized_memory = self._get_current_memory_usage()
        memory_saved = initial_memory - optimized_memory
        optimization_time = time.time() - start_time
        
        stats = MemoryOptimizationStats(
            initial_memory=initial_memory,
            optimized_memory=optimized_memory,
            memory_saved=memory_saved,
            optimization_time=optimization_time,
            gc_collections=gc_collections,
            objects_freed=objects_freed
        )
        
        with self.lock:
            self.memory_optimizations.append(stats)
        
        if memory_saved > 1.0:  # Only log if significant memory was freed
            self.logger.info(f"Memory optimization freed {memory_saved:.1f}MB in {optimization_time:.3f}s")
        
        return stats
    
    def benchmark_against_legacy(self, 
                                test_name: str,
                                current_processor: Callable,
                                legacy_processor: Optional[Callable],
                                test_file: str,
                                **kwargs) -> BenchmarkResult:
        """
        Benchmark current system against legacy system.
        
        Args:
            test_name: Name of the benchmark test
            current_processor: Current processing function
            legacy_processor: Legacy processing function (optional)
            test_file: Path to test file
            **kwargs: Additional arguments for processors
            
        Returns:
            BenchmarkResult with comparison metrics
        """
        self.logger.info(f"Starting benchmark: {test_name}")
        
        # Benchmark current system
        current_context = self.start_operation(f"benchmark_current_{test_name}", "benchmark", test_file)
        
        try:
            current_result = current_processor(test_file, **kwargs)
            current_success = True
            current_accuracy = getattr(current_result, 'confidence_score', 1.0)
        except Exception as e:
            current_success = False
            current_accuracy = 0.0
            self.logger.error(f"Current system benchmark failed: {e}")
        
        current_metrics = self.end_operation(current_context, current_success)
        
        # Benchmark legacy system if provided
        legacy_metrics = None
        legacy_accuracy = None
        
        if legacy_processor:
            legacy_context = self.start_operation(f"benchmark_legacy_{test_name}", "benchmark", test_file)
            
            try:
                legacy_result = legacy_processor(test_file, **kwargs)
                legacy_success = True
                legacy_accuracy = getattr(legacy_result, 'confidence_score', 1.0)
            except Exception as e:
                legacy_success = False
                legacy_accuracy = 0.0
                self.logger.error(f"Legacy system benchmark failed: {e}")
            
            legacy_metrics = self.end_operation(legacy_context, legacy_success)
        
        # Calculate improvement ratios
        improvement_ratio = None
        memory_improvement = None
        
        if legacy_metrics:
            if legacy_metrics.duration > 0:
                improvement_ratio = legacy_metrics.duration / current_metrics.duration
            
            if legacy_metrics.memory_peak > 0:
                memory_improvement = legacy_metrics.memory_peak / current_metrics.memory_peak
        
        # Create benchmark result
        benchmark = BenchmarkResult(
            test_name=test_name,
            current_system_time=current_metrics.duration,
            legacy_system_time=legacy_metrics.duration if legacy_metrics else None,
            improvement_ratio=improvement_ratio,
            current_memory=current_metrics.memory_peak,
            legacy_memory=legacy_metrics.memory_peak if legacy_metrics else None,
            memory_improvement=memory_improvement,
            accuracy_score=current_accuracy,
            confidence_score=current_accuracy,
            test_file=test_file,
            timestamp=time.time()
        )
        
        with self.lock:
            self.benchmark_results.append(benchmark)
        
        # Log results
        if improvement_ratio:
            self.logger.info(
                f"Benchmark {test_name}: {improvement_ratio:.2f}x speed improvement, "
                f"{memory_improvement:.2f}x memory improvement"
            )
        else:
            self.logger.info(
                f"Benchmark {test_name}: {current_metrics.duration:.2f}s, "
                f"{current_metrics.memory_peak:.1f}MB peak memory"
            )
        
        return benchmark
    
    def get_performance_report(self) -> Dict[str, Any]:
        """Generate comprehensive performance report"""
        with self.lock:
            if not self.metrics:
                return {"error": "No performance data available"}
            
            # Calculate overall statistics
            successful_operations = [m for m in self.metrics if m.success]
            failed_operations = [m for m in self.metrics if not m.success]
            
            durations = [m.duration for m in successful_operations]
            memory_deltas = [m.memory_delta for m in successful_operations]
            memory_peaks = [m.memory_peak for m in successful_operations]
            
            # Performance statistics
            performance_stats = {}
            if durations:
                performance_stats = {
                    "total_operations": len(self.metrics),
                    "successful_operations": len(successful_operations),
                    "failed_operations": len(failed_operations),
                    "success_rate": len(successful_operations) / len(self.metrics),
                    "average_duration": statistics.mean(durations),
                    "median_duration": statistics.median(durations),
                    "min_duration": min(durations),
                    "max_duration": max(durations),
                    "duration_std_dev": statistics.stdev(durations) if len(durations) > 1 else 0,
                    "average_memory_delta": statistics.mean(memory_deltas),
                    "average_memory_peak": statistics.mean(memory_peaks),
                    "max_memory_peak": max(memory_peaks),
                    "total_processing_time": sum(durations)
                }
            
            # Operation type breakdown
            operation_types = {}
            for metric in successful_operations:
                op_type = metric.operation_type
                if op_type not in operation_types:
                    operation_types[op_type] = []
                operation_types[op_type].append(metric.duration)
            
            type_stats = {}
            for op_type, durations in operation_types.items():
                type_stats[op_type] = {
                    "count": len(durations),
                    "average_duration": statistics.mean(durations),
                    "total_duration": sum(durations)
                }
            
            # Memory optimization statistics
            memory_stats = {}
            if self.memory_optimizations:
                total_saved = sum(opt.memory_saved for opt in self.memory_optimizations)
                memory_stats = {
                    "optimizations_performed": len(self.memory_optimizations),
                    "total_memory_saved_mb": total_saved,
                    "average_memory_saved_mb": total_saved / len(self.memory_optimizations),
                    "total_optimization_time": sum(opt.optimization_time for opt in self.memory_optimizations)
                }
            
            # Resource usage trends
            resource_trends = {}
            if self.resource_snapshots:
                recent_snapshots = list(self.resource_snapshots)[-100:]  # Last 100 snapshots
                
                memory_values = [s.memory_mb for s in recent_snapshots]
                cpu_values = [s.cpu_percent for s in recent_snapshots]
                
                resource_trends = {
                    "current_memory_mb": memory_values[-1] if memory_values else 0,
                    "average_memory_mb": statistics.mean(memory_values),
                    "peak_memory_mb": max(memory_values),
                    "current_cpu_percent": cpu_values[-1] if cpu_values else 0,
                    "average_cpu_percent": statistics.mean(cpu_values),
                    "peak_cpu_percent": max(cpu_values)
                }
            
            # Benchmark summary
            benchmark_summary = {}
            if self.benchmark_results:
                improvements = [b.improvement_ratio for b in self.benchmark_results if b.improvement_ratio]
                memory_improvements = [b.memory_improvement for b in self.benchmark_results if b.memory_improvement]
                
                if improvements:
                    benchmark_summary = {
                        "benchmarks_performed": len(self.benchmark_results),
                        "average_speed_improvement": statistics.mean(improvements),
                        "best_speed_improvement": max(improvements),
                        "average_memory_improvement": statistics.mean(memory_improvements) if memory_improvements else None,
                        "best_memory_improvement": max(memory_improvements) if memory_improvements else None
                    }
            
            return {
                "report_generated_at": time.time(),
                "performance_statistics": performance_stats,
                "operation_type_breakdown": type_stats,
                "memory_optimization": memory_stats,
                "resource_usage_trends": resource_trends,
                "benchmark_summary": benchmark_summary,
                "performance_baselines": self.performance_baselines
            }
    
    def export_metrics(self, file_path: str):
        """Export performance metrics to JSON file"""
        with self.lock:
            data = {
                "metrics": [asdict(m) for m in self.metrics],
                "benchmarks": [asdict(b) for b in self.benchmark_results],
                "memory_optimizations": [asdict(opt) for opt in self.memory_optimizations],
                "performance_baselines": self.performance_baselines,
                "export_timestamp": time.time()
            }
        
        try:
            with open(file_path, 'w') as f:
                json.dump(data, f, indent=2)
            
            self.logger.info(f"Performance metrics exported to {file_path}")
        
        except Exception as e:
            self.logger.error(f"Failed to export metrics: {e}")
    
    def clear_metrics(self):
        """Clear all stored metrics and statistics"""
        with self.lock:
            self.metrics.clear()
            self.benchmark_results.clear()
            self.memory_optimizations.clear()
            self.resource_snapshots.clear()
            self.performance_baselines.clear()
        
        self.logger.info("Performance metrics cleared")
    
    def __enter__(self):
        """Context manager entry"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        self.stop_monitoring()


# Convenience functions
def monitor_operation(monitor: PerformanceMonitor, operation_type: str):
    """Decorator for monitoring function performance"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            operation_id = f"{func.__name__}_{int(time.time() * 1000)}"
            context = monitor.start_operation(operation_id, operation_type)
            
            try:
                result = func(*args, **kwargs)
                monitor.end_operation(context, success=True)
                return result
            except Exception as e:
                monitor.end_operation(context, success=False, error_message=str(e))
                raise
        
        return wrapper
    return decorator


def create_performance_monitor(enable_detailed_monitoring: bool = True,
                             memory_threshold_mb: float = 500.0,
                             debug: bool = False) -> PerformanceMonitor:
    """
    Create a PerformanceMonitor instance.
    
    Args:
        enable_detailed_monitoring: Enable detailed resource monitoring
        memory_threshold_mb: Memory threshold for optimization triggers
        debug: Enable debug logging
        
    Returns:
        PerformanceMonitor instance
    """
    return PerformanceMonitor(
        enable_detailed_monitoring=enable_detailed_monitoring,
        memory_threshold_mb=memory_threshold_mb,
        auto_optimize_memory=True,
        debug=debug
    )