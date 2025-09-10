"""
Performance Tracking and Optimization System
Tracks performance metrics and automatically optimizes based on historical results
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
import json
import logging
import os
from datetime import datetime, timedelta
from collections import defaultdict, deque
import time
import threading
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

@dataclass
class ProcessingMetrics:
    """Comprehensive processing metrics"""
    processing_id: str
    timestamp: str
    document_type: str
    bank_type: str
    file_size: int
    page_count: int
    
    # Performance metrics
    total_processing_time: float
    text_extraction_time: float
    table_detection_time: float
    ocr_processing_time: float
    validation_time: float
    
    # Quality metrics
    accuracy_score: float
    confidence_score: float
    completeness_score: float
    error_count: int
    
    # Method performance
    methods_used: List[str]
    method_success_rates: Dict[str, float]
    method_processing_times: Dict[str, float]
    
    # Resource usage
    memory_usage_mb: float
    cpu_usage_percent: float
    
    # Results
    transactions_extracted: int
    anomalies_detected: int
    success: bool
    error_message: Optional[str] = None

@dataclass
class PerformanceTrend:
    """Performance trend analysis"""
    metric_name: str
    time_period: str
    trend_direction: str  # 'improving', 'declining', 'stable'
    trend_strength: float  # 0.0 to 1.0
    current_value: float
    previous_value: float
    change_percentage: float

@dataclass
class OptimizationRecommendation:
    """Performance optimization recommendation"""
    recommendation_id: str
    category: str  # 'configuration', 'resource', 'method'
    priority: str  # 'high', 'medium', 'low'
    description: str
    expected_improvement: float
    implementation_effort: str  # 'low', 'medium', 'high'
    specific_actions: List[str]

class PerformanceTrackingSystem:
    """
    Implements performance tracking and automatic optimization
    Requirements: 8.1, 8.2, 10.1, 10.2, 10.3
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or self._get_default_config()
        self.metrics_history = deque(maxlen=self.config['max_history_size'])
        self.performance_cache = {}
        self.optimization_history = []
        self.real_time_metrics = {}
        self.data_path = self.config.get('data_path', 'backend/src/data/performance')
        
        # Thread-safe operations
        self.lock = threading.Lock()
        
        # Ensure data directory exists
        os.makedirs(self.data_path, exist_ok=True)
        
        # Load historical data
        self._load_historical_data()
        
        # Start background optimization thread
        self._start_background_optimization()
    
    def _get_default_config(self) -> Dict:
        """Get default configuration for performance tracking"""
        return {
            'data_path': 'backend/src/data/performance',
            'max_history_size': 1000,
            'optimization_interval_minutes': 60,
            'performance_threshold': 0.8,
            'trend_analysis_days': 7,
            'min_samples_for_optimization': 10,
            'auto_optimization_enabled': True,
            'resource_monitoring_enabled': True
        }
    
    def start_processing_tracking(self, document_info: Dict[str, Any]) -> str:
        """
        Start tracking performance for a document processing operation
        
        Args:
            document_info: Information about the document being processed
            
        Returns:
            Processing ID for tracking
        """
        processing_id = f"proc_{int(time.time() * 1000)}_{hash(str(document_info))}"
        
        with self.lock:
            self.real_time_metrics[processing_id] = {
                'start_time': time.time(),
                'document_info': document_info,
                'stage_times': {},
                'method_performance': {},
                'resource_usage': []
            }
        
        logger.info(f"Started performance tracking for processing {processing_id}")
        
        return processing_id
    
    def record_stage_performance(self, processing_id: str, stage_name: str, 
                                duration: float, success: bool, metrics: Dict[str, Any]):
        """
        Record performance metrics for a processing stage
        
        Args:
            processing_id: Processing ID from start_processing_tracking
            stage_name: Name of the processing stage
            duration: Time taken for the stage in seconds
            success: Whether the stage completed successfully
            metrics: Additional metrics for the stage
        """
        with self.lock:
            if processing_id not in self.real_time_metrics:
                logger.warning(f"Processing ID {processing_id} not found for stage recording")
                return
            
            tracking_data = self.real_time_metrics[processing_id]
            tracking_data['stage_times'][stage_name] = {
                'duration': duration,
                'success': success,
                'metrics': metrics,
                'timestamp': time.time()
            }
        
        logger.debug(f"Recorded stage {stage_name} performance for {processing_id}: {duration:.3f}s")
    
    def record_method_performance(self, processing_id: str, method_name: str,
                                success_rate: float, processing_time: float, 
                                quality_metrics: Dict[str, float]):
        """
        Record performance metrics for a specific extraction method
        
        Args:
            processing_id: Processing ID
            method_name: Name of the extraction method
            success_rate: Success rate of the method (0.0 to 1.0)
            processing_time: Time taken by the method
            quality_metrics: Quality metrics (accuracy, confidence, etc.)
        """
        with self.lock:
            if processing_id not in self.real_time_metrics:
                logger.warning(f"Processing ID {processing_id} not found for method recording")
                return
            
            tracking_data = self.real_time_metrics[processing_id]
            tracking_data['method_performance'][method_name] = {
                'success_rate': success_rate,
                'processing_time': processing_time,
                'quality_metrics': quality_metrics,
                'timestamp': time.time()
            }
        
        logger.debug(f"Recorded method {method_name} performance for {processing_id}")
    
    def complete_processing_tracking(self, processing_id: str, final_results: Dict[str, Any]) -> ProcessingMetrics:
        """
        Complete performance tracking and generate comprehensive metrics
        
        Args:
            processing_id: Processing ID
            final_results: Final processing results
            
        Returns:
            Complete processing metrics
        """
        with self.lock:
            if processing_id not in self.real_time_metrics:
                logger.warning(f"Processing ID {processing_id} not found for completion")
                return None
            
            tracking_data = self.real_time_metrics[processing_id]
            end_time = time.time()
            total_time = end_time - tracking_data['start_time']
            
            # Compile comprehensive metrics
            metrics = self._compile_processing_metrics(processing_id, tracking_data, final_results, total_time)
            
            # Add to history
            self.metrics_history.append(metrics)
            
            # Clean up real-time tracking
            del self.real_time_metrics[processing_id]
        
        # Save metrics
        self._save_metrics(metrics)
        
        # Trigger optimization analysis if needed
        if len(self.metrics_history) % 10 == 0:  # Every 10 processes
            self._analyze_for_optimization()
        
        logger.info(f"Completed performance tracking for {processing_id}: {total_time:.3f}s total")
        
        return metrics
    
    def get_performance_analysis(self, time_period_days: int = 7) -> Dict[str, Any]:
        """
        Get comprehensive performance analysis for a time period
        
        Args:
            time_period_days: Number of days to analyze
            
        Returns:
            Performance analysis results
        """
        logger.info(f"Generating performance analysis for last {time_period_days} days")
        
        # Filter metrics by time period
        cutoff_time = datetime.now() - timedelta(days=time_period_days)
        recent_metrics = [
            m for m in self.metrics_history 
            if datetime.fromisoformat(m.timestamp) >= cutoff_time
        ]
        
        if not recent_metrics:
            return {'message': 'No recent metrics available', 'metrics_count': 0}
        
        analysis = {
            'summary': self._generate_performance_summary(recent_metrics),
            'trends': self._analyze_performance_trends(recent_metrics),
            'method_comparison': self._compare_method_performance(recent_metrics),
            'resource_analysis': self._analyze_resource_usage(recent_metrics),
            'quality_analysis': self._analyze_quality_metrics(recent_metrics),
            'recommendations': self._generate_optimization_recommendations(recent_metrics)
        }
        
        logger.info(f"Performance analysis completed for {len(recent_metrics)} processing operations")
        
        return analysis
    
    def get_real_time_performance(self) -> Dict[str, Any]:
        """Get current real-time performance metrics"""
        
        with self.lock:
            active_processes = len(self.real_time_metrics)
            
            if active_processes == 0:
                return {'active_processes': 0, 'message': 'No active processes'}
            
            # Calculate average processing times for active processes
            current_times = []
            for proc_data in self.real_time_metrics.values():
                current_time = time.time() - proc_data['start_time']
                current_times.append(current_time)
            
            return {
                'active_processes': active_processes,
                'average_processing_time': np.mean(current_times),
                'longest_processing_time': max(current_times),
                'processes_over_threshold': sum(1 for t in current_times if t > 30),  # 30 seconds threshold
                'system_load': self._get_system_load()
            }
    
    def optimize_performance_automatically(self) -> List[OptimizationRecommendation]:
        """
        Automatically analyze performance and generate optimization recommendations
        
        Returns:
            List of optimization recommendations
        """
        logger.info("Running automatic performance optimization analysis")
        
        if len(self.metrics_history) < self.config['min_samples_for_optimization']:
            logger.info(f"Insufficient data for optimization (need {self.config['min_samples_for_optimization']} samples)")
            return []
        
        # Analyze recent performance
        recent_metrics = list(self.metrics_history)[-50:]  # Last 50 operations
        
        recommendations = []
        
        # Method performance optimization
        method_recommendations = self._optimize_method_selection(recent_metrics)
        recommendations.extend(method_recommendations)
        
        # Resource optimization
        resource_recommendations = self._optimize_resource_usage(recent_metrics)
        recommendations.extend(resource_recommendations)
        
        # Configuration optimization
        config_recommendations = self._optimize_configuration_settings(recent_metrics)
        recommendations.extend(config_recommendations)
        
        # Quality optimization
        quality_recommendations = self._optimize_quality_settings(recent_metrics)
        recommendations.extend(quality_recommendations)
        
        # Sort by priority and expected improvement
        recommendations.sort(key=lambda x: (
            {'high': 3, 'medium': 2, 'low': 1}[x.priority],
            x.expected_improvement
        ), reverse=True)
        
        # Store optimization history
        self.optimization_history.append({
            'timestamp': datetime.now().isoformat(),
            'recommendations_count': len(recommendations),
            'recommendations': [asdict(r) for r in recommendations]
        })
        
        logger.info(f"Generated {len(recommendations)} optimization recommendations")
        
        return recommendations
    
    def _compile_processing_metrics(self, processing_id: str, tracking_data: Dict, 
                                  final_results: Dict, total_time: float) -> ProcessingMetrics:
        """Compile comprehensive processing metrics"""
        
        doc_info = tracking_data['document_info']
        stage_times = tracking_data['stage_times']
        method_performance = tracking_data['method_performance']
        
        # Extract stage times
        text_extraction_time = stage_times.get('text_extraction', {}).get('duration', 0.0)
        table_detection_time = stage_times.get('table_detection', {}).get('duration', 0.0)
        ocr_processing_time = stage_times.get('ocr_processing', {}).get('duration', 0.0)
        validation_time = stage_times.get('validation', {}).get('duration', 0.0)
        
        # Extract method information
        methods_used = list(method_performance.keys())
        method_success_rates = {k: v['success_rate'] for k, v in method_performance.items()}
        method_processing_times = {k: v['processing_time'] for k, v in method_performance.items()}
        
        # Calculate quality metrics
        accuracy_score = final_results.get('accuracy_score', 0.0)
        confidence_score = final_results.get('confidence_score', 0.0)
        completeness_score = final_results.get('completeness_score', 0.0)
        error_count = final_results.get('error_count', 0)
        
        # Resource usage (simplified - would integrate with actual monitoring)
        memory_usage_mb = self._get_memory_usage()
        cpu_usage_percent = self._get_cpu_usage()
        
        return ProcessingMetrics(
            processing_id=processing_id,
            timestamp=datetime.now().isoformat(),
            document_type=doc_info.get('document_type', 'unknown'),
            bank_type=doc_info.get('bank_type', 'unknown'),
            file_size=doc_info.get('file_size', 0),
            page_count=doc_info.get('page_count', 1),
            
            total_processing_time=total_time,
            text_extraction_time=text_extraction_time,
            table_detection_time=table_detection_time,
            ocr_processing_time=ocr_processing_time,
            validation_time=validation_time,
            
            accuracy_score=accuracy_score,
            confidence_score=confidence_score,
            completeness_score=completeness_score,
            error_count=error_count,
            
            methods_used=methods_used,
            method_success_rates=method_success_rates,
            method_processing_times=method_processing_times,
            
            memory_usage_mb=memory_usage_mb,
            cpu_usage_percent=cpu_usage_percent,
            
            transactions_extracted=final_results.get('transactions_count', 0),
            anomalies_detected=final_results.get('anomalies_count', 0),
            success=final_results.get('success', False),
            error_message=final_results.get('error_message')
        )
    
    def _generate_performance_summary(self, metrics: List[ProcessingMetrics]) -> Dict[str, Any]:
        """Generate performance summary statistics"""
        
        if not metrics:
            return {}
        
        processing_times = [m.total_processing_time for m in metrics]
        accuracy_scores = [m.accuracy_score for m in metrics]
        confidence_scores = [m.confidence_score for m in metrics]
        success_rate = sum(1 for m in metrics if m.success) / len(metrics)
        
        return {
            'total_operations': len(metrics),
            'success_rate': success_rate,
            'average_processing_time': np.mean(processing_times),
            'median_processing_time': np.median(processing_times),
            'processing_time_std': np.std(processing_times),
            'average_accuracy': np.mean(accuracy_scores),
            'average_confidence': np.mean(confidence_scores),
            'total_transactions_extracted': sum(m.transactions_extracted for m in metrics),
            'total_anomalies_detected': sum(m.anomalies_detected for m in metrics),
            'average_file_size_mb': np.mean([m.file_size / (1024*1024) for m in metrics]),
            'operations_by_document_type': self._count_by_field(metrics, 'document_type'),
            'operations_by_bank_type': self._count_by_field(metrics, 'bank_type')
        }
    
    def _analyze_performance_trends(self, metrics: List[ProcessingMetrics]) -> List[PerformanceTrend]:
        """Analyze performance trends over time"""
        
        if len(metrics) < 10:  # Need minimum data for trend analysis
            return []
        
        # Sort by timestamp
        sorted_metrics = sorted(metrics, key=lambda x: x.timestamp)
        
        # Split into two halves for comparison
        mid_point = len(sorted_metrics) // 2
        first_half = sorted_metrics[:mid_point]
        second_half = sorted_metrics[mid_point:]
        
        trends = []
        
        # Analyze different metrics
        trend_metrics = [
            ('processing_time', 'total_processing_time'),
            ('accuracy', 'accuracy_score'),
            ('confidence', 'confidence_score'),
            ('success_rate', None)  # Special handling
        ]
        
        for trend_name, field_name in trend_metrics:
            if field_name:
                first_values = [getattr(m, field_name) for m in first_half]
                second_values = [getattr(m, field_name) for m in second_half]
            else:  # success_rate
                first_values = [1.0 if m.success else 0.0 for m in first_half]
                second_values = [1.0 if m.success else 0.0 for m in second_half]
            
            first_avg = np.mean(first_values)
            second_avg = np.mean(second_values)
            
            change_percentage = ((second_avg - first_avg) / first_avg * 100) if first_avg > 0 else 0
            
            # Determine trend direction
            if abs(change_percentage) < 5:  # Less than 5% change
                direction = 'stable'
                strength = 0.1
            elif change_percentage > 0:
                if trend_name in ['accuracy', 'confidence', 'success_rate']:
                    direction = 'improving'
                else:  # processing_time
                    direction = 'declining'
                strength = min(abs(change_percentage) / 20, 1.0)
            else:
                if trend_name in ['accuracy', 'confidence', 'success_rate']:
                    direction = 'declining'
                else:  # processing_time
                    direction = 'improving'
                strength = min(abs(change_percentage) / 20, 1.0)
            
            trends.append(PerformanceTrend(
                metric_name=trend_name,
                time_period=f"{len(metrics)} operations",
                trend_direction=direction,
                trend_strength=strength,
                current_value=second_avg,
                previous_value=first_avg,
                change_percentage=change_percentage
            ))
        
        return trends
    
    def _compare_method_performance(self, metrics: List[ProcessingMetrics]) -> Dict[str, Any]:
        """Compare performance of different extraction methods"""
        
        method_stats = defaultdict(lambda: {
            'usage_count': 0,
            'success_rates': [],
            'processing_times': [],
            'accuracy_scores': []
        })
        
        for metric in metrics:
            for method in metric.methods_used:
                stats = method_stats[method]
                stats['usage_count'] += 1
                
                if method in metric.method_success_rates:
                    stats['success_rates'].append(metric.method_success_rates[method])
                
                if method in metric.method_processing_times:
                    stats['processing_times'].append(metric.method_processing_times[method])
                
                stats['accuracy_scores'].append(metric.accuracy_score)
        
        # Calculate averages
        comparison = {}
        for method, stats in method_stats.items():
            comparison[method] = {
                'usage_count': stats['usage_count'],
                'average_success_rate': np.mean(stats['success_rates']) if stats['success_rates'] else 0.0,
                'average_processing_time': np.mean(stats['processing_times']) if stats['processing_times'] else 0.0,
                'average_accuracy': np.mean(stats['accuracy_scores']) if stats['accuracy_scores'] else 0.0,
                'usage_percentage': stats['usage_count'] / len(metrics) * 100
            }
        
        return comparison
    
    def _analyze_resource_usage(self, metrics: List[ProcessingMetrics]) -> Dict[str, Any]:
        """Analyze resource usage patterns"""
        
        memory_usage = [m.memory_usage_mb for m in metrics]
        cpu_usage = [m.cpu_usage_percent for m in metrics]
        processing_times = [m.total_processing_time for m in metrics]
        file_sizes = [m.file_size / (1024*1024) for m in metrics]  # Convert to MB
        
        return {
            'memory_usage': {
                'average_mb': np.mean(memory_usage),
                'peak_mb': max(memory_usage),
                'std_mb': np.std(memory_usage)
            },
            'cpu_usage': {
                'average_percent': np.mean(cpu_usage),
                'peak_percent': max(cpu_usage),
                'std_percent': np.std(cpu_usage)
            },
            'efficiency_metrics': {
                'mb_per_second': np.mean([fs/pt for fs, pt in zip(file_sizes, processing_times) if pt > 0]),
                'time_per_mb': np.mean([pt/fs for fs, pt in zip(file_sizes, processing_times) if fs > 0])
            },
            'resource_correlation': {
                'memory_time_correlation': np.corrcoef(memory_usage, processing_times)[0, 1],
                'cpu_time_correlation': np.corrcoef(cpu_usage, processing_times)[0, 1],
                'size_time_correlation': np.corrcoef(file_sizes, processing_times)[0, 1]
            }
        }
    
    def _analyze_quality_metrics(self, metrics: List[ProcessingMetrics]) -> Dict[str, Any]:
        """Analyze quality metrics and patterns"""
        
        accuracy_scores = [m.accuracy_score for m in metrics]
        confidence_scores = [m.confidence_score for m in metrics]
        completeness_scores = [m.completeness_score for m in metrics]
        error_counts = [m.error_count for m in metrics]
        
        # Quality by document type
        quality_by_doc_type = defaultdict(lambda: {'accuracy': [], 'confidence': [], 'completeness': []})
        for metric in metrics:
            quality_by_doc_type[metric.document_type]['accuracy'].append(metric.accuracy_score)
            quality_by_doc_type[metric.document_type]['confidence'].append(metric.confidence_score)
            quality_by_doc_type[metric.document_type]['completeness'].append(metric.completeness_score)
        
        doc_type_quality = {}
        for doc_type, quality_data in quality_by_doc_type.items():
            doc_type_quality[doc_type] = {
                'average_accuracy': np.mean(quality_data['accuracy']),
                'average_confidence': np.mean(quality_data['confidence']),
                'average_completeness': np.mean(quality_data['completeness']),
                'sample_count': len(quality_data['accuracy'])
            }
        
        return {
            'overall_quality': {
                'average_accuracy': np.mean(accuracy_scores),
                'average_confidence': np.mean(confidence_scores),
                'average_completeness': np.mean(completeness_scores),
                'average_errors': np.mean(error_counts),
                'high_quality_rate': sum(1 for a in accuracy_scores if a > 0.8) / len(accuracy_scores)
            },
            'quality_by_document_type': doc_type_quality,
            'quality_distribution': {
                'accuracy_std': np.std(accuracy_scores),
                'confidence_std': np.std(confidence_scores),
                'low_accuracy_count': sum(1 for a in accuracy_scores if a < 0.6),
                'low_confidence_count': sum(1 for c in confidence_scores if c < 0.5)
            }
        }
    
    def _generate_optimization_recommendations(self, metrics: List[ProcessingMetrics]) -> List[OptimizationRecommendation]:
        """Generate optimization recommendations based on performance analysis"""
        
        recommendations = []
        
        # Analyze processing times
        processing_times = [m.total_processing_time for m in metrics]
        avg_processing_time = np.mean(processing_times)
        
        if avg_processing_time > 30:  # More than 30 seconds average
            recommendations.append(OptimizationRecommendation(
                recommendation_id="opt_processing_time_1",
                category="performance",
                priority="high",
                description="Average processing time is high, consider enabling parallel processing",
                expected_improvement=0.3,
                implementation_effort="medium",
                specific_actions=[
                    "Enable parallel processing for text extraction and table detection",
                    "Implement document preprocessing optimization",
                    "Consider caching for similar documents"
                ]
            ))
        
        # Analyze method performance
        method_comparison = self._compare_method_performance(metrics)
        
        # Find underperforming methods
        for method, stats in method_comparison.items():
            if stats['average_success_rate'] < 0.7 and stats['usage_count'] > 5:
                recommendations.append(OptimizationRecommendation(
                    recommendation_id=f"opt_method_{method}",
                    category="method",
                    priority="medium",
                    description=f"Method {method} has low success rate ({stats['average_success_rate']:.2%})",
                    expected_improvement=0.2,
                    implementation_effort="low",
                    specific_actions=[
                        f"Review {method} configuration parameters",
                        f"Consider alternative methods for {method}",
                        "Implement fallback mechanisms"
                    ]
                ))
        
        # Analyze quality metrics
        accuracy_scores = [m.accuracy_score for m in metrics]
        low_accuracy_rate = sum(1 for a in accuracy_scores if a < 0.7) / len(accuracy_scores)
        
        if low_accuracy_rate > 0.2:  # More than 20% low accuracy
            recommendations.append(OptimizationRecommendation(
                recommendation_id="opt_quality_1",
                category="quality",
                priority="high",
                description=f"High rate of low accuracy results ({low_accuracy_rate:.2%})",
                expected_improvement=0.25,
                implementation_effort="medium",
                specific_actions=[
                    "Enhance preprocessing for low-quality documents",
                    "Implement adaptive OCR settings",
                    "Add quality-based method selection"
                ]
            ))
        
        return recommendations
    
    def _optimize_method_selection(self, metrics: List[ProcessingMetrics]) -> List[OptimizationRecommendation]:
        """Generate method selection optimization recommendations"""
        
        recommendations = []
        method_comparison = self._compare_method_performance(metrics)
        
        # Find best performing methods
        best_methods = sorted(method_comparison.items(), 
                            key=lambda x: x[1]['average_success_rate'], reverse=True)
        
        if len(best_methods) > 1:
            best_method = best_methods[0]
            worst_method = best_methods[-1]
            
            improvement_potential = best_method[1]['average_success_rate'] - worst_method[1]['average_success_rate']
            
            if improvement_potential > 0.1:  # 10% improvement potential
                recommendations.append(OptimizationRecommendation(
                    recommendation_id="opt_method_selection",
                    category="method",
                    priority="medium",
                    description=f"Switch from {worst_method[0]} to {best_method[0]} for better performance",
                    expected_improvement=improvement_potential,
                    implementation_effort="low",
                    specific_actions=[
                        f"Prioritize {best_method[0]} over {worst_method[0]}",
                        "Update method selection logic",
                        "Test performance improvement"
                    ]
                ))
        
        return recommendations
    
    def _optimize_resource_usage(self, metrics: List[ProcessingMetrics]) -> List[OptimizationRecommendation]:
        """Generate resource usage optimization recommendations"""
        
        recommendations = []
        
        # Analyze memory usage
        memory_usage = [m.memory_usage_mb for m in metrics]
        avg_memory = np.mean(memory_usage)
        
        if avg_memory > 1000:  # More than 1GB average
            recommendations.append(OptimizationRecommendation(
                recommendation_id="opt_memory_usage",
                category="resource",
                priority="medium",
                description=f"High memory usage detected ({avg_memory:.0f}MB average)",
                expected_improvement=0.15,
                implementation_effort="medium",
                specific_actions=[
                    "Implement memory-efficient processing",
                    "Add garbage collection optimization",
                    "Process large documents in chunks"
                ]
            ))
        
        return recommendations
    
    def _optimize_configuration_settings(self, metrics: List[ProcessingMetrics]) -> List[OptimizationRecommendation]:
        """Generate configuration optimization recommendations"""
        
        recommendations = []
        
        # Analyze processing time vs quality trade-offs
        processing_times = [m.total_processing_time for m in metrics]
        accuracy_scores = [m.accuracy_score for m in metrics]
        
        # Find documents with high processing time but low accuracy
        inefficient_processes = [
            (pt, acc) for pt, acc in zip(processing_times, accuracy_scores)
            if pt > np.percentile(processing_times, 75) and acc < np.percentile(accuracy_scores, 25)
        ]
        
        if len(inefficient_processes) > len(metrics) * 0.1:  # More than 10% inefficient
            recommendations.append(OptimizationRecommendation(
                recommendation_id="opt_config_efficiency",
                category="configuration",
                priority="high",
                description="Detected inefficient processing (high time, low accuracy)",
                expected_improvement=0.2,
                implementation_effort="medium",
                specific_actions=[
                    "Adjust quality vs speed trade-offs",
                    "Implement adaptive configuration",
                    "Optimize preprocessing settings"
                ]
            ))
        
        return recommendations
    
    def _optimize_quality_settings(self, metrics: List[ProcessingMetrics]) -> List[OptimizationRecommendation]:
        """Generate quality optimization recommendations"""
        
        recommendations = []
        
        # Analyze confidence vs accuracy correlation
        confidence_scores = [m.confidence_score for m in metrics]
        accuracy_scores = [m.accuracy_score for m in metrics]
        
        correlation = np.corrcoef(confidence_scores, accuracy_scores)[0, 1]
        
        if correlation < 0.5:  # Poor correlation between confidence and accuracy
            recommendations.append(OptimizationRecommendation(
                recommendation_id="opt_confidence_calibration",
                category="quality",
                priority="medium",
                description="Poor correlation between confidence and accuracy scores",
                expected_improvement=0.15,
                implementation_effort="high",
                specific_actions=[
                    "Recalibrate confidence scoring",
                    "Implement better quality metrics",
                    "Add cross-validation mechanisms"
                ]
            ))
        
        return recommendations
    
    def _count_by_field(self, metrics: List[ProcessingMetrics], field_name: str) -> Dict[str, int]:
        """Count occurrences by field value"""
        counts = defaultdict(int)
        for metric in metrics:
            value = getattr(metric, field_name, 'unknown')
            counts[value] += 1
        return dict(counts)
    
    def _get_system_load(self) -> Dict[str, float]:
        """Get current system load metrics"""
        # Simplified system load - would integrate with actual monitoring
        return {
            'cpu_percent': self._get_cpu_usage(),
            'memory_percent': 50.0,  # Placeholder
            'disk_io_percent': 20.0   # Placeholder
        }
    
    def _get_memory_usage(self) -> float:
        """Get current memory usage in MB"""
        # Simplified - would use psutil or similar
        return 512.0  # Placeholder
    
    def _get_cpu_usage(self) -> float:
        """Get current CPU usage percentage"""
        # Simplified - would use psutil or similar
        return 25.0  # Placeholder
    
    def _analyze_for_optimization(self):
        """Analyze recent performance for optimization opportunities"""
        if self.config['auto_optimization_enabled']:
            recommendations = self.optimize_performance_automatically()
            if recommendations:
                logger.info(f"Generated {len(recommendations)} automatic optimization recommendations")
    
    def _start_background_optimization(self):
        """Start background thread for periodic optimization analysis"""
        if not self.config['auto_optimization_enabled']:
            return
        
        def optimization_worker():
            while True:
                try:
                    time.sleep(self.config['optimization_interval_minutes'] * 60)
                    self._analyze_for_optimization()
                except Exception as e:
                    logger.error(f"Background optimization error: {e}")
        
        optimization_thread = threading.Thread(target=optimization_worker, daemon=True)
        optimization_thread.start()
        logger.info("Started background optimization thread")
    
    def _load_historical_data(self):
        """Load historical performance data"""
        metrics_file = os.path.join(self.data_path, 'performance_metrics.json')
        
        try:
            if os.path.exists(metrics_file):
                with open(metrics_file, 'r') as f:
                    data = json.load(f)
                    for item in data:
                        self.metrics_history.append(ProcessingMetrics(**item))
                logger.info(f"Loaded {len(self.metrics_history)} historical performance metrics")
        except Exception as e:
            logger.warning(f"Failed to load historical data: {e}")
    
    def _save_metrics(self, metrics: ProcessingMetrics):
        """Save metrics to persistent storage"""
        metrics_file = os.path.join(self.data_path, 'performance_metrics.json')
        
        try:
            # Load existing data
            existing_data = []
            if os.path.exists(metrics_file):
                with open(metrics_file, 'r') as f:
                    existing_data = json.load(f)
            
            # Add new metrics
            existing_data.append(asdict(metrics))
            
            # Keep only recent data (last 1000 entries)
            if len(existing_data) > 1000:
                existing_data = existing_data[-1000:]
            
            # Save back to file
            with open(metrics_file, 'w') as f:
                json.dump(existing_data, f, indent=2)
                
        except Exception as e:
            logger.error(f"Failed to save metrics: {e}")
    
    def get_system_health(self) -> Dict[str, Any]:
        """Get overall system health metrics"""
        
        if not self.metrics_history:
            return {'status': 'no_data', 'message': 'No performance data available'}
        
        recent_metrics = list(self.metrics_history)[-20:]  # Last 20 operations
        
        # Calculate health indicators
        success_rate = sum(1 for m in recent_metrics if m.success) / len(recent_metrics)
        avg_accuracy = np.mean([m.accuracy_score for m in recent_metrics])
        avg_processing_time = np.mean([m.total_processing_time for m in recent_metrics])
        
        # Determine health status
        if success_rate > 0.9 and avg_accuracy > 0.8:
            status = 'healthy'
        elif success_rate > 0.7 and avg_accuracy > 0.6:
            status = 'warning'
        else:
            status = 'critical'
        
        return {
            'status': status,
            'success_rate': success_rate,
            'average_accuracy': avg_accuracy,
            'average_processing_time': avg_processing_time,
            'total_operations': len(self.metrics_history),
            'recent_operations': len(recent_metrics),
            'last_updated': recent_metrics[-1].timestamp if recent_metrics else None
        }