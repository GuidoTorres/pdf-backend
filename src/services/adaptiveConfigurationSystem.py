"""
Adaptive Configuration System
Learns optimal settings for different document types and automatically adjusts configuration
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
import json
import logging
import os
from datetime import datetime, timedelta
from collections import defaultdict
import copy

logger = logging.getLogger(__name__)

@dataclass
class ConfigurationProfile:
    """Represents a configuration profile for a specific document/bank type"""
    profile_id: str
    document_type: str
    bank_type: str
    configuration: Dict[str, Any]
    performance_metrics: Dict[str, float]
    usage_count: int
    success_rate: float
    last_updated: str
    created_date: str

@dataclass
class PerformanceMetric:
    """Represents performance metrics for a configuration"""
    accuracy: float
    processing_time: float
    confidence_score: float
    error_rate: float
    extraction_completeness: float

@dataclass
class ConfigurationRecommendation:
    """Represents a configuration recommendation"""
    profile_id: str
    recommended_config: Dict[str, Any]
    confidence: float
    expected_improvement: float
    reasoning: List[str]

class AdaptiveConfigurationSystem:
    """
    Implements adaptive configuration system that learns optimal settings
    Requirements: 8.1, 8.2, 8.3
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or self._get_default_config()
        self.profiles = {}
        self.performance_history = defaultdict(list)
        self.base_configurations = self._get_base_configurations()
        self.config_path = self.config.get('config_path', 'backend/src/config')
        
        # Ensure config directory exists
        os.makedirs(self.config_path, exist_ok=True)
        
        # Load existing profiles
        self._load_profiles()
        
    def _get_default_config(self) -> Dict:
        """Get default configuration for adaptive system"""
        return {
            'config_path': 'backend/src/config',
            'min_samples_for_adaptation': 5,
            'performance_threshold': 0.8,
            'adaptation_sensitivity': 0.1,
            'max_profiles_per_type': 10,
            'learning_rate': 0.1,
            'confidence_threshold': 0.7
        }
    
    def _get_base_configurations(self) -> Dict[str, Dict]:
        """Get base configurations for different document types"""
        return {
            'pdf_native_bank_statement': {
                'text_extraction': {
                    'method': 'pymupdf',
                    'extract_images': False,
                    'extract_tables': True
                },
                'table_detection': {
                    'method': 'pdfplumber',
                    'table_settings': {
                        'vertical_strategy': 'lines',
                        'horizontal_strategy': 'lines',
                        'snap_tolerance': 3
                    }
                },
                'ocr': {
                    'enabled': False,
                    'method': 'easyocr',
                    'languages': ['en', 'es'],
                    'confidence_threshold': 0.5
                },
                'preprocessing': {
                    'image_enhancement': False,
                    'noise_reduction': False,
                    'contrast_adjustment': False
                },
                'validation': {
                    'nlp_validation': True,
                    'statistical_validation': True,
                    'confidence_threshold': 0.7
                }
            },
            'pdf_scanned_bank_statement': {
                'text_extraction': {
                    'method': 'ocr_primary',
                    'extract_images': True,
                    'extract_tables': False
                },
                'table_detection': {
                    'method': 'ocr_based',
                    'post_ocr_table_detection': True
                },
                'ocr': {
                    'enabled': True,
                    'method': 'easyocr',
                    'languages': ['en', 'es'],
                    'confidence_threshold': 0.4
                },
                'preprocessing': {
                    'image_enhancement': True,
                    'noise_reduction': True,
                    'contrast_adjustment': True,
                    'dpi': 300
                },
                'validation': {
                    'nlp_validation': True,
                    'statistical_validation': True,
                    'confidence_threshold': 0.6
                }
            },
            'excel_transaction_export': {
                'data_processing': {
                    'method': 'pandas',
                    'engine': 'openpyxl',
                    'header_detection': 'auto',
                    'skip_rows': 0
                },
                'column_mapping': {
                    'auto_detect': True,
                    'date_formats': ['%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y'],
                    'amount_formats': ['european', 'us']
                },
                'validation': {
                    'data_type_validation': True,
                    'range_validation': True,
                    'completeness_check': True
                }
            },
            'image_bank_statement': {
                'preprocessing': {
                    'image_enhancement': True,
                    'noise_reduction': True,
                    'contrast_adjustment': True,
                    'orientation_correction': True,
                    'dpi': 300
                },
                'ocr': {
                    'enabled': True,
                    'method': 'easyocr',
                    'languages': ['en', 'es'],
                    'confidence_threshold': 0.3
                },
                'post_processing': {
                    'text_cleaning': True,
                    'pattern_matching': True,
                    'structure_detection': True
                },
                'validation': {
                    'nlp_validation': True,
                    'statistical_validation': True,
                    'confidence_threshold': 0.5
                }
            }
        }
    
    def get_optimal_configuration(self, document_type: str, bank_type: str, 
                                document_characteristics: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get optimal configuration for a specific document and bank type
        
        Args:
            document_type: Type of document (e.g., 'bank_statement', 'transaction_export')
            bank_type: Type of bank (e.g., 'santander', 'bbva')
            document_characteristics: Characteristics of the specific document
            
        Returns:
            Optimal configuration dictionary
        """
        logger.info(f"Getting optimal configuration for {document_type} from {bank_type}")
        
        # Find matching profile
        profile = self._find_best_matching_profile(document_type, bank_type, document_characteristics)
        
        if profile and profile.success_rate >= self.config['performance_threshold']:
            logger.info(f"Using learned profile {profile.profile_id} with {profile.success_rate:.2%} success rate")
            return profile.configuration
        
        # Fall back to base configuration with adaptations
        base_config = self._get_base_configuration(document_type, document_characteristics)
        
        # Apply bank-specific adaptations
        adapted_config = self._apply_bank_adaptations(base_config, bank_type)
        
        # Apply document-specific adaptations
        final_config = self._apply_document_adaptations(adapted_config, document_characteristics)
        
        logger.info(f"Using adapted base configuration for {document_type}")
        
        return final_config
    
    def record_performance(self, document_type: str, bank_type: str, 
                         configuration: Dict[str, Any], performance: PerformanceMetric,
                         document_characteristics: Dict[str, Any]):
        """
        Record performance metrics for a configuration
        
        Args:
            document_type: Type of document processed
            bank_type: Type of bank
            configuration: Configuration used
            performance: Performance metrics achieved
            document_characteristics: Characteristics of the document
        """
        logger.info(f"Recording performance for {document_type} from {bank_type}")
        
        # Find or create profile
        profile = self._find_or_create_profile(document_type, bank_type, configuration, document_characteristics)
        
        # Update performance metrics
        self._update_profile_performance(profile, performance)
        
        # Store performance history
        self.performance_history[profile.profile_id].append({
            'timestamp': datetime.now().isoformat(),
            'performance': asdict(performance),
            'configuration': configuration,
            'document_characteristics': document_characteristics
        })
        
        # Check if adaptation is needed
        if self._should_adapt_configuration(profile):
            self._adapt_configuration(profile)
        
        # Save profiles
        self._save_profiles()
        
        logger.info(f"Performance recorded for profile {profile.profile_id}")
    
    def get_configuration_recommendations(self, document_type: str, bank_type: str) -> List[ConfigurationRecommendation]:
        """
        Get configuration recommendations for improving performance
        
        Args:
            document_type: Type of document
            bank_type: Type of bank
            
        Returns:
            List of configuration recommendations
        """
        logger.info(f"Generating configuration recommendations for {document_type} from {bank_type}")
        
        recommendations = []
        
        # Find profiles for this document/bank type
        matching_profiles = [p for p in self.profiles.values() 
                           if p.document_type == document_type and p.bank_type == bank_type]
        
        if not matching_profiles:
            return recommendations
        
        # Analyze performance patterns
        for profile in matching_profiles:
            if profile.usage_count >= self.config['min_samples_for_adaptation']:
                recommendation = self._generate_recommendation(profile)
                if recommendation:
                    recommendations.append(recommendation)
        
        # Sort by expected improvement
        recommendations.sort(key=lambda x: x.expected_improvement, reverse=True)
        
        logger.info(f"Generated {len(recommendations)} configuration recommendations")
        
        return recommendations
    
    def optimize_configuration_automatically(self, document_type: str, bank_type: str) -> Optional[Dict[str, Any]]:
        """
        Automatically optimize configuration based on historical performance
        
        Args:
            document_type: Type of document
            bank_type: Type of bank
            
        Returns:
            Optimized configuration or None if no optimization possible
        """
        logger.info(f"Automatically optimizing configuration for {document_type} from {bank_type}")
        
        # Get recommendations
        recommendations = self.get_configuration_recommendations(document_type, bank_type)
        
        if not recommendations:
            return None
        
        # Select best recommendation with high confidence
        best_recommendation = recommendations[0]
        
        if best_recommendation.confidence >= self.config['confidence_threshold']:
            logger.info(f"Applying automatic optimization with {best_recommendation.confidence:.2%} confidence")
            return best_recommendation.recommended_config
        
        logger.info("No high-confidence optimization available")
        return None
    
    def _find_best_matching_profile(self, document_type: str, bank_type: str, 
                                  characteristics: Dict[str, Any]) -> Optional[ConfigurationProfile]:
        """Find the best matching configuration profile"""
        
        matching_profiles = []
        
        for profile in self.profiles.values():
            if profile.document_type == document_type and profile.bank_type == bank_type:
                # Calculate similarity score
                similarity = self._calculate_characteristic_similarity(
                    characteristics, profile.configuration.get('document_characteristics', {})
                )
                matching_profiles.append((profile, similarity))
        
        if not matching_profiles:
            return None
        
        # Sort by similarity and success rate
        matching_profiles.sort(key=lambda x: (x[1], x[0].success_rate), reverse=True)
        
        return matching_profiles[0][0]
    
    def _get_base_configuration(self, document_type: str, characteristics: Dict[str, Any]) -> Dict[str, Any]:
        """Get base configuration for document type"""
        
        # Determine configuration key based on document type and characteristics
        if document_type == 'bank_statement':
            if characteristics.get('format_type') == 'pdf_native':
                config_key = 'pdf_native_bank_statement'
            elif characteristics.get('format_type') == 'pdf_scanned':
                config_key = 'pdf_scanned_bank_statement'
            elif characteristics.get('format_type') == 'image':
                config_key = 'image_bank_statement'
            else:
                config_key = 'pdf_native_bank_statement'  # Default
        elif document_type == 'transaction_export':
            config_key = 'excel_transaction_export'
        else:
            config_key = 'pdf_native_bank_statement'  # Default fallback
        
        return copy.deepcopy(self.base_configurations.get(config_key, {}))
    
    def _apply_bank_adaptations(self, config: Dict[str, Any], bank_type: str) -> Dict[str, Any]:
        """Apply bank-specific adaptations to configuration"""
        
        bank_adaptations = {
            'santander': {
                'table_detection': {
                    'table_settings': {
                        'snap_tolerance': 2,  # Tighter tolerance for Santander tables
                        'join_tolerance': 2
                    }
                },
                'validation': {
                    'date_formats': ['%d/%m/%Y'],  # Santander uses DD/MM/YYYY
                    'amount_format': 'european'
                }
            },
            'bbva': {
                'table_detection': {
                    'table_settings': {
                        'vertical_strategy': 'text',  # BBVA has text-based tables
                        'snap_tolerance': 4
                    }
                },
                'validation': {
                    'date_formats': ['%d-%m-%Y'],  # BBVA uses DD-MM-YYYY
                    'amount_format': 'european'
                }
            },
            'caixabank': {
                'ocr': {
                    'confidence_threshold': 0.6  # CaixaBank documents are usually cleaner
                },
                'validation': {
                    'date_formats': ['%d/%m/%Y', '%Y-%m-%d'],
                    'amount_format': 'european'
                }
            }
        }
        
        if bank_type in bank_adaptations:
            config = self._deep_merge_configs(config, bank_adaptations[bank_type])
        
        return config
    
    def _apply_document_adaptations(self, config: Dict[str, Any], characteristics: Dict[str, Any]) -> Dict[str, Any]:
        """Apply document-specific adaptations to configuration"""
        
        # Adapt based on document quality
        confidence_score = characteristics.get('confidence_score', 0.8)
        
        if confidence_score < 0.6:
            # Low quality document - enhance preprocessing
            if 'preprocessing' in config:
                config['preprocessing']['image_enhancement'] = True
                config['preprocessing']['noise_reduction'] = True
                config['preprocessing']['contrast_adjustment'] = True
            
            if 'ocr' in config:
                config['ocr']['confidence_threshold'] = 0.3  # Lower threshold for poor quality
        
        # Adapt based on document size
        page_count = characteristics.get('page_count', 1)
        
        if page_count > 10:
            # Large document - optimize for performance
            if 'processing' not in config:
                config['processing'] = {}
            config['processing']['parallel_processing'] = True
            config['processing']['batch_size'] = 5
        
        # Adapt based on table complexity
        table_count = characteristics.get('table_count', 0)
        
        if table_count > 3:
            # Complex tables - use enhanced detection
            if 'table_detection' in config:
                config['table_detection']['method'] = 'pdfplumber'
                config['table_detection']['table_settings']['snap_tolerance'] = 2
        
        return config
    
    def _find_or_create_profile(self, document_type: str, bank_type: str, 
                              configuration: Dict[str, Any], characteristics: Dict[str, Any]) -> ConfigurationProfile:
        """Find existing profile or create new one"""
        
        # Look for existing profile
        profile_id = f"{document_type}_{bank_type}_{hash(str(sorted(configuration.items())))}"
        
        if profile_id in self.profiles:
            return self.profiles[profile_id]
        
        # Create new profile
        profile = ConfigurationProfile(
            profile_id=profile_id,
            document_type=document_type,
            bank_type=bank_type,
            configuration=configuration,
            performance_metrics={},
            usage_count=0,
            success_rate=0.0,
            last_updated=datetime.now().isoformat(),
            created_date=datetime.now().isoformat()
        )
        
        # Store document characteristics in configuration for future matching
        profile.configuration['document_characteristics'] = characteristics
        
        self.profiles[profile_id] = profile
        
        logger.info(f"Created new configuration profile: {profile_id}")
        
        return profile
    
    def _update_profile_performance(self, profile: ConfigurationProfile, performance: PerformanceMetric):
        """Update profile performance metrics"""
        
        profile.usage_count += 1
        
        # Calculate weighted average of performance metrics
        weight = 1.0 / profile.usage_count
        
        if not profile.performance_metrics:
            profile.performance_metrics = asdict(performance)
        else:
            for key, value in asdict(performance).items():
                if key in profile.performance_metrics:
                    profile.performance_metrics[key] = (
                        (1 - weight) * profile.performance_metrics[key] + weight * value
                    )
                else:
                    profile.performance_metrics[key] = value
        
        # Update success rate (based on accuracy and low error rate)
        accuracy = profile.performance_metrics.get('accuracy', 0.0)
        error_rate = profile.performance_metrics.get('error_rate', 1.0)
        profile.success_rate = accuracy * (1 - error_rate)
        
        profile.last_updated = datetime.now().isoformat()
    
    def _should_adapt_configuration(self, profile: ConfigurationProfile) -> bool:
        """Determine if configuration should be adapted"""
        
        # Need minimum samples
        if profile.usage_count < self.config['min_samples_for_adaptation']:
            return False
        
        # Check if performance is below threshold
        if profile.success_rate < self.config['performance_threshold']:
            return True
        
        # Check if there's been consistent poor performance recently
        recent_history = self.performance_history[profile.profile_id][-5:]  # Last 5 runs
        
        if len(recent_history) >= 3:
            recent_accuracies = [h['performance']['accuracy'] for h in recent_history]
            if np.mean(recent_accuracies) < profile.success_rate - self.config['adaptation_sensitivity']:
                return True
        
        return False
    
    def _adapt_configuration(self, profile: ConfigurationProfile):
        """Adapt configuration based on performance history"""
        
        logger.info(f"Adapting configuration for profile {profile.profile_id}")
        
        history = self.performance_history[profile.profile_id]
        
        if len(history) < self.config['min_samples_for_adaptation']:
            return
        
        # Analyze what configurations worked best
        best_performances = sorted(history, key=lambda x: x['performance']['accuracy'], reverse=True)[:3]
        
        # Extract common configuration elements from best performances
        best_configs = [h['configuration'] for h in best_performances]
        
        # Create adapted configuration
        adapted_config = self._merge_best_configurations(best_configs)
        
        # Update profile configuration
        profile.configuration = adapted_config
        profile.last_updated = datetime.now().isoformat()
        
        logger.info(f"Configuration adapted for profile {profile.profile_id}")
    
    def _generate_recommendation(self, profile: ConfigurationProfile) -> Optional[ConfigurationRecommendation]:
        """Generate configuration recommendation for a profile"""
        
        history = self.performance_history[profile.profile_id]
        
        if len(history) < self.config['min_samples_for_adaptation']:
            return None
        
        # Analyze performance trends
        recent_performance = np.mean([h['performance']['accuracy'] for h in history[-5:]])
        overall_performance = profile.success_rate
        
        if recent_performance >= overall_performance:
            return None  # No improvement needed
        
        # Find best performing configurations
        best_runs = sorted(history, key=lambda x: x['performance']['accuracy'], reverse=True)[:2]
        
        if not best_runs:
            return None
        
        # Create recommendation based on best configuration
        recommended_config = best_runs[0]['configuration']
        expected_improvement = best_runs[0]['performance']['accuracy'] - recent_performance
        
        reasoning = [
            f"Current performance: {recent_performance:.2%}",
            f"Best historical performance: {best_runs[0]['performance']['accuracy']:.2%}",
            f"Expected improvement: {expected_improvement:.2%}"
        ]
        
        return ConfigurationRecommendation(
            profile_id=profile.profile_id,
            recommended_config=recommended_config,
            confidence=min(0.9, expected_improvement * 2),  # Confidence based on improvement potential
            expected_improvement=expected_improvement,
            reasoning=reasoning
        )
    
    def _calculate_characteristic_similarity(self, chars1: Dict[str, Any], chars2: Dict[str, Any]) -> float:
        """Calculate similarity between document characteristics"""
        
        if not chars1 or not chars2:
            return 0.0
        
        common_keys = set(chars1.keys()) & set(chars2.keys())
        
        if not common_keys:
            return 0.0
        
        similarities = []
        
        for key in common_keys:
            val1, val2 = chars1[key], chars2[key]
            
            if isinstance(val1, (int, float)) and isinstance(val2, (int, float)):
                # Numerical similarity
                if val1 == 0 and val2 == 0:
                    similarities.append(1.0)
                else:
                    similarities.append(1.0 - abs(val1 - val2) / max(abs(val1), abs(val2), 1))
            elif isinstance(val1, bool) and isinstance(val2, bool):
                # Boolean similarity
                similarities.append(1.0 if val1 == val2 else 0.0)
            elif isinstance(val1, str) and isinstance(val2, str):
                # String similarity
                similarities.append(1.0 if val1 == val2 else 0.0)
        
        return np.mean(similarities) if similarities else 0.0
    
    def _deep_merge_configs(self, base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
        """Deep merge two configuration dictionaries"""
        
        result = copy.deepcopy(base)
        
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._deep_merge_configs(result[key], value)
            else:
                result[key] = value
        
        return result
    
    def _merge_best_configurations(self, configs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Merge multiple configurations, taking the most common values"""
        
        if not configs:
            return {}
        
        if len(configs) == 1:
            return configs[0]
        
        # Start with first config as base
        merged = copy.deepcopy(configs[0])
        
        # For each subsequent config, merge common elements
        for config in configs[1:]:
            merged = self._deep_merge_configs(merged, config)
        
        return merged
    
    def _load_profiles(self):
        """Load configuration profiles from disk"""
        profiles_file = os.path.join(self.config_path, 'adaptive_profiles.json')
        history_file = os.path.join(self.config_path, 'performance_history.json')
        
        try:
            if os.path.exists(profiles_file):
                with open(profiles_file, 'r') as f:
                    data = json.load(f)
                    self.profiles = {k: ConfigurationProfile(**v) for k, v in data.items()}
                logger.info(f"Loaded {len(self.profiles)} configuration profiles")
        except Exception as e:
            logger.warning(f"Failed to load profiles: {e}")
        
        try:
            if os.path.exists(history_file):
                with open(history_file, 'r') as f:
                    self.performance_history = defaultdict(list, json.load(f))
                logger.info(f"Loaded performance history for {len(self.performance_history)} profiles")
        except Exception as e:
            logger.warning(f"Failed to load performance history: {e}")
    
    def _save_profiles(self):
        """Save configuration profiles to disk"""
        profiles_file = os.path.join(self.config_path, 'adaptive_profiles.json')
        history_file = os.path.join(self.config_path, 'performance_history.json')
        
        try:
            with open(profiles_file, 'w') as f:
                data = {k: asdict(v) for k, v in self.profiles.items()}
                json.dump(data, f, indent=2)
            
            with open(history_file, 'w') as f:
                json.dump(dict(self.performance_history), f, indent=2)
            
            logger.info("Configuration profiles saved successfully")
        except Exception as e:
            logger.error(f"Failed to save profiles: {e}")
    
    def get_system_statistics(self) -> Dict[str, Any]:
        """Get statistics about the adaptive configuration system"""
        
        if not self.profiles:
            return {'total_profiles': 0, 'message': 'No profiles available'}
        
        success_rates = [p.success_rate for p in self.profiles.values()]
        usage_counts = [p.usage_count for p in self.profiles.values()]
        
        # Group by document type
        doc_type_stats = defaultdict(list)
        for profile in self.profiles.values():
            doc_type_stats[profile.document_type].append(profile.success_rate)
        
        return {
            'total_profiles': len(self.profiles),
            'average_success_rate': np.mean(success_rates),
            'total_usage_count': sum(usage_counts),
            'document_type_performance': {
                doc_type: {
                    'count': len(rates),
                    'average_success_rate': np.mean(rates)
                }
                for doc_type, rates in doc_type_stats.items()
            },
            'top_performing_profiles': [
                {
                    'profile_id': p.profile_id,
                    'document_type': p.document_type,
                    'bank_type': p.bank_type,
                    'success_rate': p.success_rate,
                    'usage_count': p.usage_count
                }
                for p in sorted(self.profiles.values(), key=lambda x: x.success_rate, reverse=True)[:5]
            ]
        }