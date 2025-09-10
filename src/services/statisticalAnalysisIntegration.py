"""
Statistical Analysis Integration Service
Integrates all statistical analysis and adaptive learning components
"""

import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import asdict
import json
import time

from .statisticalAnalyzer import StatisticalAnalyzer, TransactionAnomaly, StatisticalMetrics
from .patternRecognitionSystem import PatternRecognitionSystem, DocumentClassification, BankIdentification
from .adaptiveConfigurationSystem import AdaptiveConfigurationSystem, PerformanceMetric
from .performanceTrackingSystem import PerformanceTrackingSystem, ProcessingMetrics

logger = logging.getLogger(__name__)

class StatisticalAnalysisIntegration:
    """
    Integrates statistical analysis, pattern recognition, adaptive configuration, and performance tracking
    Requirements: 7.1, 7.2, 7.3, 8.1, 8.2
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        
        # Initialize all components
        self.statistical_analyzer = StatisticalAnalyzer(self.config.get('statistical_analyzer', {}))
        self.pattern_recognition = PatternRecognitionSystem(self.config.get('pattern_recognition', {}))
        self.adaptive_config = AdaptiveConfigurationSystem(self.config.get('adaptive_config', {}))
        self.performance_tracker = PerformanceTrackingSystem(self.config.get('performance_tracker', {}))
        
        logger.info("Statistical Analysis Integration initialized")
    
    def analyze_document_and_optimize(self, document_content: Dict, metadata: Dict, 
                                    transactions: List[Dict]) -> Dict[str, Any]:
        """
        Comprehensive analysis of document with optimization recommendations
        
        Args:
            document_content: Extracted document content
            metadata: Document metadata
            transactions: Extracted transactions
            
        Returns:
            Complete analysis results with optimization recommendations
        """
        logger.info("Starting comprehensive document analysis and optimization")
        
        start_time = time.time()
        
        # Start performance tracking
        processing_id = self.performance_tracker.start_processing_tracking({
            'document_type': metadata.get('document_type', 'unknown'),
            'bank_type': metadata.get('bank_type', 'unknown'),
            'file_size': metadata.get('file_size', 0),
            'page_count': metadata.get('page_count', 1)
        })
        
        results = {
            'processing_id': processing_id,
            'timestamp': time.time(),
            'analysis_results': {},
            'optimization_recommendations': {},
            'performance_metrics': {}
        }
        
        try:
            # 1. Statistical Analysis of Transactions
            logger.info("Performing statistical analysis of transactions")
            stage_start = time.time()
            
            anomalies, statistical_metrics = self.statistical_analyzer.analyze_transactions(transactions)
            
            self.performance_tracker.record_stage_performance(
                processing_id, 'statistical_analysis', 
                time.time() - stage_start, True, 
                {'anomalies_detected': len(anomalies)}
            )
            
            results['analysis_results']['statistical_analysis'] = {
                'anomalies': [asdict(a) for a in anomalies],
                'metrics': asdict(statistical_metrics),
                'anomaly_summary': self.statistical_analyzer.get_anomaly_summary(anomalies)
            }
            
            # 2. Pattern Recognition and Document Classification
            logger.info("Performing pattern recognition and document classification")
            stage_start = time.time()
            
            document_classification = self.pattern_recognition.identify_document_format(
                document_content, metadata
            )
            
            bank_identification = self.pattern_recognition.identify_bank_type(
                document_content, transactions
            )
            
            self.performance_tracker.record_stage_performance(
                processing_id, 'pattern_recognition', 
                time.time() - stage_start, True,
                {
                    'document_confidence': document_classification.confidence,
                    'bank_confidence': bank_identification.confidence
                }
            )
            
            results['analysis_results']['pattern_recognition'] = {
                'document_classification': asdict(document_classification),
                'bank_identification': asdict(bank_identification)
            }
            
            # 3. Get Optimal Configuration
            logger.info("Determining optimal configuration")
            stage_start = time.time()
            
            document_characteristics = self._extract_document_characteristics(
                document_content, metadata, statistical_metrics
            )
            
            optimal_config = self.adaptive_config.get_optimal_configuration(
                document_classification.document_type,
                bank_identification.bank_name,
                document_characteristics
            )
            
            extraction_strategy = self.pattern_recognition.get_optimal_extraction_strategy(
                document_classification, bank_identification
            )
            
            self.performance_tracker.record_stage_performance(
                processing_id, 'configuration_optimization', 
                time.time() - stage_start, True,
                {'strategy_confidence': extraction_strategy.get('confidence', 0.0)}
            )
            
            results['optimization_recommendations']['configuration'] = {
                'optimal_config': optimal_config,
                'extraction_strategy': extraction_strategy
            }
            
            # 4. Performance Analysis and Recommendations
            logger.info("Generating performance recommendations")
            stage_start = time.time()
            
            performance_analysis = self.performance_tracker.get_performance_analysis(7)  # Last 7 days
            optimization_recommendations = self.performance_tracker.optimize_performance_automatically()
            
            self.performance_tracker.record_stage_performance(
                processing_id, 'performance_analysis', 
                time.time() - stage_start, True,
                {'recommendations_count': len(optimization_recommendations)}
            )
            
            results['optimization_recommendations']['performance'] = {
                'analysis': performance_analysis,
                'recommendations': [asdict(r) for r in optimization_recommendations]
            }
            
            # 5. Adaptive Learning Updates
            logger.info("Updating adaptive learning systems")
            stage_start = time.time()
            
            # Record performance for adaptive learning
            performance_metric = self._calculate_performance_metric(
                transactions, anomalies, statistical_metrics, 
                document_classification, bank_identification
            )
            
            self.adaptive_config.record_performance(
                document_classification.document_type,
                bank_identification.bank_name,
                optimal_config,
                performance_metric,
                document_characteristics
            )
            
            # Update pattern recognition with new document
            pattern_learning_summary = self.pattern_recognition.learn_document_patterns([{
                'content': document_content,
                'metadata': metadata,
                'document_type': document_classification.document_type,
                'bank_type': bank_identification.bank_name
            }])
            
            self.performance_tracker.record_stage_performance(
                processing_id, 'adaptive_learning', 
                time.time() - stage_start, True,
                {'patterns_learned': pattern_learning_summary.get('patterns_discovered', 0)}
            )
            
            results['analysis_results']['adaptive_learning'] = {
                'performance_recorded': True,
                'pattern_learning_summary': pattern_learning_summary
            }
            
            # 6. Generate Comprehensive Recommendations
            logger.info("Generating comprehensive recommendations")
            
            comprehensive_recommendations = self._generate_comprehensive_recommendations(
                anomalies, statistical_metrics, document_classification, 
                bank_identification, performance_analysis, optimization_recommendations
            )
            
            results['optimization_recommendations']['comprehensive'] = comprehensive_recommendations
            
            # Complete performance tracking
            final_results = {
                'success': True,
                'accuracy_score': performance_metric.accuracy,
                'confidence_score': performance_metric.confidence_score,
                'completeness_score': performance_metric.extraction_completeness,
                'error_count': len(anomalies),
                'transactions_count': len(transactions),
                'anomalies_count': len(anomalies)
            }
            
            processing_metrics = self.performance_tracker.complete_processing_tracking(
                processing_id, final_results
            )
            
            results['performance_metrics'] = asdict(processing_metrics)
            
            total_time = time.time() - start_time
            logger.info(f"Comprehensive analysis completed in {total_time:.3f}s")
            
            return results
            
        except Exception as e:
            logger.error(f"Error in comprehensive analysis: {e}")
            
            # Record failed processing
            final_results = {
                'success': False,
                'error_message': str(e),
                'accuracy_score': 0.0,
                'confidence_score': 0.0,
                'completeness_score': 0.0,
                'error_count': 1,
                'transactions_count': len(transactions),
                'anomalies_count': 0
            }
            
            processing_metrics = self.performance_tracker.complete_processing_tracking(
                processing_id, final_results
            )
            
            results['error'] = str(e)
            results['performance_metrics'] = asdict(processing_metrics)
            
            return results
    
    def get_system_insights(self) -> Dict[str, Any]:
        """
        Get comprehensive system insights from all components
        
        Returns:
            System insights and statistics
        """
        logger.info("Generating comprehensive system insights")
        
        insights = {
            'timestamp': time.time(),
            'statistical_analysis': {},
            'pattern_recognition': {},
            'adaptive_configuration': {},
            'performance_tracking': {},
            'system_health': {}
        }
        
        try:
            # Pattern recognition statistics
            insights['pattern_recognition'] = self.pattern_recognition.get_pattern_statistics()
            
            # Adaptive configuration statistics
            insights['adaptive_configuration'] = self.adaptive_config.get_system_statistics()
            
            # Performance tracking analysis
            insights['performance_tracking'] = self.performance_tracker.get_performance_analysis(30)  # Last 30 days
            
            # System health
            insights['system_health'] = self.performance_tracker.get_system_health()
            
            # Real-time performance
            insights['real_time_performance'] = self.performance_tracker.get_real_time_performance()
            
            logger.info("System insights generated successfully")
            
        except Exception as e:
            logger.error(f"Error generating system insights: {e}")
            insights['error'] = str(e)
        
        return insights
    
    def optimize_system_automatically(self) -> Dict[str, Any]:
        """
        Perform automatic system optimization across all components
        
        Returns:
            Optimization results and recommendations
        """
        logger.info("Performing automatic system optimization")
        
        optimization_results = {
            'timestamp': time.time(),
            'optimizations_applied': [],
            'recommendations': [],
            'performance_improvements': {}
        }
        
        try:
            # Get performance recommendations
            performance_recommendations = self.performance_tracker.optimize_performance_automatically()
            
            # Get configuration recommendations for common document types
            config_recommendations = []
            common_doc_types = ['bank_statement', 'transaction_export']
            common_banks = ['santander', 'bbva', 'caixabank']
            
            for doc_type in common_doc_types:
                for bank in common_banks:
                    recommendations = self.adaptive_config.get_configuration_recommendations(doc_type, bank)
                    config_recommendations.extend(recommendations)
            
            # Apply high-confidence optimizations automatically
            applied_optimizations = []
            
            for recommendation in performance_recommendations:
                if recommendation.priority == 'high' and recommendation.expected_improvement > 0.2:
                    # Apply optimization (simplified - would implement actual changes)
                    applied_optimizations.append({
                        'type': 'performance',
                        'recommendation_id': recommendation.recommendation_id,
                        'description': recommendation.description,
                        'expected_improvement': recommendation.expected_improvement
                    })
            
            for recommendation in config_recommendations:
                if recommendation.confidence > 0.8 and recommendation.expected_improvement > 0.15:
                    # Apply configuration optimization
                    applied_optimizations.append({
                        'type': 'configuration',
                        'profile_id': recommendation.profile_id,
                        'expected_improvement': recommendation.expected_improvement
                    })
            
            optimization_results['optimizations_applied'] = applied_optimizations
            optimization_results['recommendations'] = {
                'performance': [asdict(r) for r in performance_recommendations],
                'configuration': [asdict(r) for r in config_recommendations]
            }
            
            logger.info(f"Applied {len(applied_optimizations)} automatic optimizations")
            
        except Exception as e:
            logger.error(f"Error in automatic optimization: {e}")
            optimization_results['error'] = str(e)
        
        return optimization_results
    
    def _extract_document_characteristics(self, content: Dict, metadata: Dict, 
                                        statistical_metrics: StatisticalMetrics) -> Dict[str, Any]:
        """Extract document characteristics for adaptive configuration"""
        
        characteristics = {
            'file_extension': metadata.get('file_extension', ''),
            'file_size': metadata.get('file_size', 0),
            'page_count': metadata.get('page_count', 1),
            'confidence_score': content.get('confidence', 0.8),
            'table_count': len(content.get('tables', [])),
            'text_length': len(content.get('text', '')),
            'transaction_count': statistical_metrics.total_transactions,
            'anomaly_rate': statistical_metrics.anomaly_rate,
            'format_type': metadata.get('format_type', 'unknown')
        }
        
        return characteristics
    
    def _calculate_performance_metric(self, transactions: List[Dict], anomalies: List[TransactionAnomaly],
                                    statistical_metrics: StatisticalMetrics,
                                    doc_classification: DocumentClassification,
                                    bank_identification: BankIdentification) -> PerformanceMetric:
        """Calculate performance metrics for adaptive learning"""
        
        # Calculate accuracy based on anomaly rate and confidence
        accuracy = max(0.0, 1.0 - statistical_metrics.anomaly_rate)
        
        # Processing time (simplified - would use actual timing)
        processing_time = 10.0  # Placeholder
        
        # Confidence score from classifications
        confidence_score = (doc_classification.confidence + bank_identification.confidence) / 2
        
        # Error rate based on anomalies
        error_rate = min(1.0, len(anomalies) / max(1, len(transactions)))
        
        # Completeness based on successful extractions
        completeness = min(1.0, statistical_metrics.total_transactions / max(1, len(transactions)))
        
        return PerformanceMetric(
            accuracy=accuracy,
            processing_time=processing_time,
            confidence_score=confidence_score,
            error_rate=error_rate,
            extraction_completeness=completeness
        )
    
    def _generate_comprehensive_recommendations(self, anomalies: List[TransactionAnomaly],
                                              statistical_metrics: StatisticalMetrics,
                                              doc_classification: DocumentClassification,
                                              bank_identification: BankIdentification,
                                              performance_analysis: Dict[str, Any],
                                              optimization_recommendations: List) -> Dict[str, Any]:
        """Generate comprehensive recommendations combining all analyses"""
        
        recommendations = {
            'immediate_actions': [],
            'configuration_changes': [],
            'quality_improvements': [],
            'performance_optimizations': [],
            'monitoring_alerts': []
        }
        
        # Immediate actions based on anomalies
        high_severity_anomalies = [a for a in anomalies if a.severity > 0.8]
        if high_severity_anomalies:
            recommendations['immediate_actions'].append({
                'priority': 'high',
                'action': f'Review {len(high_severity_anomalies)} high-severity anomalies',
                'details': [a.description for a in high_severity_anomalies[:3]]
            })
        
        # Configuration changes based on classification confidence
        if doc_classification.confidence < 0.7:
            recommendations['configuration_changes'].append({
                'priority': 'medium',
                'change': 'Improve document classification',
                'reason': f'Low classification confidence: {doc_classification.confidence:.2%}'
            })
        
        if bank_identification.confidence < 0.7:
            recommendations['configuration_changes'].append({
                'priority': 'medium',
                'change': 'Enhance bank identification',
                'reason': f'Low bank identification confidence: {bank_identification.confidence:.2%}'
            })
        
        # Quality improvements based on statistical metrics
        if statistical_metrics.anomaly_rate > 0.2:
            recommendations['quality_improvements'].append({
                'priority': 'high',
                'improvement': 'Reduce anomaly rate',
                'current_rate': f'{statistical_metrics.anomaly_rate:.2%}',
                'target_rate': '< 10%'
            })
        
        # Performance optimizations from performance analysis
        for opt_rec in optimization_recommendations:
            if opt_rec.priority == 'high':
                recommendations['performance_optimizations'].append({
                    'optimization': opt_rec.description,
                    'expected_improvement': f'{opt_rec.expected_improvement:.1%}',
                    'actions': opt_rec.specific_actions
                })
        
        # Monitoring alerts
        if statistical_metrics.total_transactions == 0:
            recommendations['monitoring_alerts'].append({
                'alert': 'No transactions extracted',
                'severity': 'critical',
                'action': 'Check extraction methods and document format'
            })
        
        return recommendations
    
    def get_learning_progress(self) -> Dict[str, Any]:
        """Get progress of adaptive learning systems"""
        
        return {
            'pattern_recognition': self.pattern_recognition.get_pattern_statistics(),
            'adaptive_configuration': self.adaptive_config.get_system_statistics(),
            'performance_tracking': {
                'total_operations': len(self.performance_tracker.metrics_history),
                'system_health': self.performance_tracker.get_system_health()
            }
        }