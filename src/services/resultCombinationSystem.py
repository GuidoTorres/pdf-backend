#!/usr/bin/env python3
"""
Result Combination and Validation System

This module implements intelligent result fusion logic to combine text, table, and OCR results,
with conflict resolution, cross-validation, and comprehensive quality assessment.

Addresses Requirements:
- 6.1: Ensemble algorithms for combining multiple extraction results
- 6.2: Confidence-based conflict resolution between different methods
- 6.3: Cross-validation between extraction methods
- 10.1: Detailed confidence scores and quality metrics
- 10.3: Performance metrics and method comparison
"""

import logging
import numpy as np
import pandas as pd
from typing import List, Dict, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from datetime import datetime
import re
import statistics
from collections import defaultdict, Counter
import difflib

# For statistical analysis and anomaly detection
try:
    from scipy import stats
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler
    ADVANCED_STATS_AVAILABLE = True
except ImportError:
    ADVANCED_STATS_AVAILABLE = False


@dataclass
class ExtractionResult:
    """Individual extraction result from a specific method"""
    method: str  # 'pdfplumber', 'easyocr', 'pymupdf', etc.
    transactions: List[Dict]
    confidence: float
    processing_time: float
    metadata: Dict[str, Any]
    quality_metrics: Dict[str, float]


@dataclass
class ConflictResolution:
    """Result of conflict resolution between methods"""
    resolved_value: Any
    winning_method: str
    confidence: float
    conflict_type: str
    evidence: Dict[str, Any]


@dataclass
class CrossValidationResult:
    """Result of cross-validation between methods"""
    consistency_score: float
    agreement_percentage: float
    discrepancies: List[Dict]
    validation_details: Dict[str, Any]


@dataclass
class QualityAssessment:
    """Comprehensive quality assessment of combined results"""
    overall_confidence: float
    method_scores: Dict[str, float]
    field_confidence: Dict[str, float]
    completeness_score: float
    consistency_score: float
    anomaly_score: float
    reliability_indicators: Dict[str, Any]


@dataclass
class CombinedResult:
    """Final combined result with comprehensive metadata"""
    transactions: List[Dict]
    quality_assessment: QualityAssessment
    cross_validation: CrossValidationResult
    method_contributions: Dict[str, float]
    conflict_resolutions: List[ConflictResolution]
    recommendations: List[str]
    processing_summary: Dict[str, Any]


class ResultCombinationSystem:
    """
    Intelligent system for combining and validating extraction results from multiple methods.
    
    This system implements ensemble algorithms, conflict resolution, cross-validation,
    and comprehensive quality assessment for document extraction results.
    """
    
    def __init__(self, debug: bool = False):
        """
        Initialize the Result Combination System.
        
        Args:
            debug: Enable debug logging
        """
        self.debug = debug
        self.logger = self._setup_logger()
        
        # Configuration for combination algorithms
        self.config = {
            'confidence_weights': {
                'pdfplumber': 0.9,
                'easyocr': 0.8,
                'pymupdf': 0.85,
                'tesseract': 0.7,
                'camelot': 0.75
            },
            'quality_thresholds': {
                'min_confidence': 0.5,
                'high_confidence': 0.8,
                'consistency_threshold': 0.7,
                'anomaly_threshold': 0.3
            },
            'field_weights': {
                'date': 1.0,
                'amount': 1.0,
                'description': 0.8,
                'balance': 0.9,
                'reference': 0.7
            }
        }
        
        # Initialize statistical components if available
        if ADVANCED_STATS_AVAILABLE:
            self.anomaly_detector = IsolationForest(contamination=0.1, random_state=42)
            self.scaler = StandardScaler()
        
        self.logger.info("ResultCombinationSystem initialized successfully")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.ResultCombinationSystem")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def combine_results(self, extraction_results: List[ExtractionResult]) -> CombinedResult:
        """
        Combine multiple extraction results using intelligent fusion algorithms.
        
        Args:
            extraction_results: List of extraction results from different methods
            
        Returns:
            CombinedResult with combined transactions and comprehensive analysis
        """
        if not extraction_results:
            raise ValueError("No extraction results provided")
        
        self.logger.info(f"Combining results from {len(extraction_results)} methods")
        
        # Step 1: Preprocess and normalize results
        normalized_results = self._normalize_results(extraction_results)
        
        # Step 2: Perform cross-validation between methods
        cross_validation = self._perform_cross_validation(normalized_results)
        
        # Step 3: Apply ensemble fusion algorithms
        fused_transactions = self._apply_ensemble_fusion(normalized_results, cross_validation)
        
        # Step 4: Resolve conflicts between methods
        conflict_resolutions = self._resolve_conflicts(normalized_results, fused_transactions)
        
        # Step 5: Apply final conflict resolutions
        final_transactions = self._apply_conflict_resolutions(fused_transactions, conflict_resolutions)
        
        # Step 6: Calculate comprehensive quality assessment
        quality_assessment = self._calculate_quality_assessment(
            final_transactions, normalized_results, cross_validation
        )
        
        # Step 7: Calculate method contributions
        method_contributions = self._calculate_method_contributions(normalized_results, final_transactions)
        
        # Step 8: Generate recommendations
        recommendations = self._generate_recommendations(
            quality_assessment, cross_validation, conflict_resolutions
        )
        
        # Step 9: Create processing summary
        processing_summary = self._create_processing_summary(
            extraction_results, normalized_results, final_transactions
        )
        
        combined_result = CombinedResult(
            transactions=final_transactions,
            quality_assessment=quality_assessment,
            cross_validation=cross_validation,
            method_contributions=method_contributions,
            conflict_resolutions=conflict_resolutions,
            recommendations=recommendations,
            processing_summary=processing_summary
        )
        
        self.logger.info(
            f"Result combination completed: {len(final_transactions)} transactions "
            f"with {quality_assessment.overall_confidence:.2f} overall confidence"
        )
        
        return combined_result
    
    def _normalize_results(self, extraction_results: List[ExtractionResult]) -> List[ExtractionResult]:
        """
        Normalize extraction results for consistent comparison and combination.
        
        Args:
            extraction_results: Raw extraction results
            
        Returns:
            Normalized extraction results
        """
        normalized_results = []
        
        for result in extraction_results:
            # Normalize transaction fields
            normalized_transactions = []
            for transaction in result.transactions:
                normalized_transaction = self._normalize_transaction(transaction)
                normalized_transactions.append(normalized_transaction)
            
            # Create normalized result
            normalized_result = ExtractionResult(
                method=result.method,
                transactions=normalized_transactions,
                confidence=result.confidence,
                processing_time=result.processing_time,
                metadata=result.metadata,
                quality_metrics=result.quality_metrics
            )
            
            normalized_results.append(normalized_result)
        
        return normalized_results
    
    def _normalize_transaction(self, transaction: Dict) -> Dict:
        """
        Normalize individual transaction fields for consistent comparison.
        
        Args:
            transaction: Raw transaction dictionary
            
        Returns:
            Normalized transaction dictionary
        """
        normalized = transaction.copy()
        
        # Normalize date fields
        if 'date' in normalized:
            normalized['date'] = self._normalize_date(normalized['date'])
        
        # Normalize amount fields
        if 'amount' in normalized:
            normalized['amount'] = self._normalize_amount(normalized['amount'])
        
        # Normalize text fields
        for field in ['description', 'reference', 'type']:
            if field in normalized:
                normalized[field] = self._normalize_text(normalized[field])
        
        return normalized
    
    def _normalize_date(self, date_value: Any) -> str:
        """Normalize date values to consistent format"""
        if not date_value:
            return ""
        
        date_str = str(date_value).strip()
        
        # Common date patterns
        date_patterns = [
            (r'(\d{1,2})[/-](\d{1,2})[/-](\d{4})', 'DMY'),  # DD/MM/YYYY or DD-MM-YYYY
            (r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})', 'YMD'),  # YYYY/MM/DD or YYYY-MM-DD
            (r'(\d{1,2})[/-](\d{1,2})[/-](\d{2})', 'DMY2'),  # DD/MM/YY or DD-MM-YY
        ]
        
        for pattern, format_type in date_patterns:
            match = re.search(pattern, date_str)
            if match:
                groups = match.groups()
                
                if format_type == 'YMD':  # YYYY/MM/DD format
                    year, month, day = groups
                    return f"{day.zfill(2)}/{month.zfill(2)}/{year}"
                elif format_type == 'DMY2':  # DD/MM/YY format
                    day, month, year = groups
                    year_int = int(year)
                    full_year = 2000 + year_int if year_int < 50 else 1900 + year_int
                    return f"{day.zfill(2)}/{month.zfill(2)}/{full_year}"
                else:  # DMY format
                    day, month, year = groups
                    return f"{day.zfill(2)}/{month.zfill(2)}/{year}"
        
        return date_str
    
    def _normalize_amount(self, amount_value: Any) -> float:
        """Normalize amount values to consistent float format"""
        if not amount_value:
            return 0.0
        
        amount_str = str(amount_value).strip()
        
        # Handle negative amounts
        is_negative = '-' in amount_str or '(' in amount_str
        
        # Remove currency symbols and spaces
        amount_str = re.sub(r'[€$£¥₹\s]', '', amount_str)
        amount_str = re.sub(r'[-()]', '', amount_str)
        
        # Extract numeric value
        try:
            # Handle decimal separators (both . and ,)
            if '.' in amount_str and ',' in amount_str:
                # Determine which is decimal separator based on position
                last_dot = amount_str.rfind('.')
                last_comma = amount_str.rfind(',')
                
                if last_dot > last_comma:
                    # Dot is decimal separator, comma is thousands separator
                    amount_str = amount_str.replace(',', '')
                else:
                    # Comma is decimal separator, dot is thousands separator
                    amount_str = amount_str.replace('.', '').replace(',', '.')
            elif ',' in amount_str:
                # Check if comma is decimal separator (European format)
                parts = amount_str.split(',')
                if len(parts) == 2 and len(parts[1]) <= 2:
                    # Comma is decimal separator
                    amount_str = amount_str.replace(',', '.')
                else:
                    # Comma is thousands separator
                    amount_str = amount_str.replace(',', '')
            
            amount = float(amount_str)
            return -amount if is_negative else amount
            
        except ValueError:
            self.logger.warning(f"Could not normalize amount: {amount_value}")
            return 0.0
    
    def _normalize_text(self, text_value: Any) -> str:
        """Normalize text values for consistent comparison"""
        if not text_value:
            return ""
        
        text = str(text_value).strip()
        
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Normalize case
        text = text.upper()
        
        return text
    
    def _perform_cross_validation(self, results: List[ExtractionResult]) -> CrossValidationResult:
        """
        Perform cross-validation between different extraction methods.
        
        Args:
            results: Normalized extraction results
            
        Returns:
            CrossValidationResult with consistency analysis
        """
        if len(results) < 2:
            return CrossValidationResult(
                consistency_score=1.0,
                agreement_percentage=100.0,
                discrepancies=[],
                validation_details={'note': 'Only one method available, no cross-validation possible'}
            )
        
        self.logger.info("Performing cross-validation between methods")
        
        # Compare transactions between methods
        discrepancies = []
        agreements = 0
        total_comparisons = 0
        
        # Create transaction matrices for comparison
        method_transactions = {result.method: result.transactions for result in results}
        
        # Compare each pair of methods
        method_names = list(method_transactions.keys())
        for i in range(len(method_names)):
            for j in range(i + 1, len(method_names)):
                method1, method2 = method_names[i], method_names[j]
                transactions1 = method_transactions[method1]
                transactions2 = method_transactions[method2]
                
                # Compare transaction counts
                if len(transactions1) != len(transactions2):
                    discrepancies.append({
                        'type': 'transaction_count_mismatch',
                        'method1': method1,
                        'method2': method2,
                        'count1': len(transactions1),
                        'count2': len(transactions2),
                        'severity': 'high'
                    })
                
                # Compare individual transactions
                max_transactions = max(len(transactions1), len(transactions2))
                for idx in range(max_transactions):
                    total_comparisons += 1
                    
                    if idx < len(transactions1) and idx < len(transactions2):
                        t1, t2 = transactions1[idx], transactions2[idx]
                        
                        # Compare key fields
                        field_agreements = self._compare_transaction_fields(t1, t2, method1, method2)
                        
                        if field_agreements['overall_agreement']:
                            agreements += 1
                        else:
                            discrepancies.extend(field_agreements['discrepancies'])
        
        # Calculate consistency metrics
        agreement_percentage = (agreements / total_comparisons * 100) if total_comparisons > 0 else 0
        consistency_score = agreement_percentage / 100.0
        
        # Additional validation details
        validation_details = {
            'methods_compared': method_names,
            'total_comparisons': total_comparisons,
            'agreements': agreements,
            'discrepancy_count': len(discrepancies),
            'discrepancy_types': Counter([d['type'] for d in discrepancies])
        }
        
        return CrossValidationResult(
            consistency_score=consistency_score,
            agreement_percentage=agreement_percentage,
            discrepancies=discrepancies,
            validation_details=validation_details
        )
    
    def _compare_transaction_fields(self, t1: Dict, t2: Dict, method1: str, method2: str) -> Dict:
        """
        Compare individual transaction fields between two methods.
        
        Args:
            t1, t2: Transactions to compare
            method1, method2: Method names
            
        Returns:
            Dictionary with comparison results
        """
        discrepancies = []
        field_agreements = {}
        
        # Compare key fields
        key_fields = ['date', 'amount', 'description', 'balance']
        
        for field in key_fields:
            if field in t1 and field in t2:
                agreement = self._compare_field_values(t1[field], t2[field], field)
                field_agreements[field] = agreement
                
                if not agreement:
                    discrepancies.append({
                        'type': f'{field}_mismatch',
                        'method1': method1,
                        'method2': method2,
                        'value1': t1[field],
                        'value2': t2[field],
                        'severity': 'medium' if field in ['description'] else 'high'
                    })
            elif field in t1 or field in t2:
                # Field missing in one method
                discrepancies.append({
                    'type': f'{field}_missing',
                    'method1': method1,
                    'method2': method2,
                    'present_in': method1 if field in t1 else method2,
                    'severity': 'medium'
                })
                field_agreements[field] = False
        
        overall_agreement = sum(field_agreements.values()) / len(field_agreements) >= 0.7
        
        return {
            'overall_agreement': overall_agreement,
            'field_agreements': field_agreements,
            'discrepancies': discrepancies
        }
    
    def _compare_field_values(self, value1: Any, value2: Any, field_type: str) -> bool:
        """
        Compare two field values based on field type.
        
        Args:
            value1, value2: Values to compare
            field_type: Type of field (date, amount, description, etc.)
            
        Returns:
            True if values are considered equivalent
        """
        if field_type == 'amount':
            # Compare amounts with tolerance
            try:
                amt1 = self._normalize_amount(value1) if value1 else 0.0
                amt2 = self._normalize_amount(value2) if value2 else 0.0
                return abs(amt1 - amt2) <= 0.011  # 1 cent tolerance with floating point buffer
            except (ValueError, TypeError):
                return str(value1).strip() == str(value2).strip()
        
        elif field_type == 'date':
            # Compare normalized dates
            date1 = self._normalize_date(value1)
            date2 = self._normalize_date(value2)
            return date1 == date2
        
        elif field_type == 'description':
            # Compare text with similarity threshold
            text1 = self._normalize_text(value1)
            text2 = self._normalize_text(value2)
            
            if not text1 or not text2:
                return text1 == text2
            
            # Use sequence matching for similarity
            similarity = difflib.SequenceMatcher(None, text1, text2).ratio()
            return similarity >= 0.8
        
        else:
            # Default string comparison
            return str(value1).strip() == str(value2).strip()
    
    def _apply_ensemble_fusion(self, results: List[ExtractionResult], 
                             cross_validation: CrossValidationResult) -> List[Dict]:
        """
        Apply ensemble fusion algorithms to combine results from multiple methods.
        
        Args:
            results: Normalized extraction results
            cross_validation: Cross-validation results
            
        Returns:
            List of fused transactions
        """
        if not results:
            return []
        
        if len(results) == 1:
            return results[0].transactions
        
        self.logger.info("Applying ensemble fusion algorithms")
        
        # Strategy 1: Weighted voting based on method confidence
        weighted_results = self._apply_weighted_voting(results)
        
        # Strategy 2: Consensus-based fusion
        consensus_results = self._apply_consensus_fusion(results, cross_validation)
        
        # Strategy 3: Best-method selection for each transaction
        best_method_results = self._apply_best_method_selection(results)
        
        # Combine strategies based on cross-validation results
        if cross_validation.consistency_score >= 0.8:
            # High consistency - use weighted voting
            return weighted_results
        elif cross_validation.consistency_score >= 0.6:
            # Medium consistency - use consensus fusion
            return consensus_results
        else:
            # Low consistency - use best method selection
            return best_method_results
    
    def _apply_weighted_voting(self, results: List[ExtractionResult]) -> List[Dict]:
        """
        Apply weighted voting ensemble method.
        
        Args:
            results: Extraction results
            
        Returns:
            Fused transactions using weighted voting
        """
        if not results:
            return []
        
        # Calculate weights based on method confidence and quality
        method_weights = {}
        for result in results:
            base_weight = self.config['confidence_weights'].get(result.method, 0.5)
            confidence_weight = result.confidence
            quality_weight = np.mean(list(result.quality_metrics.values())) if result.quality_metrics else 0.5
            
            method_weights[result.method] = base_weight * confidence_weight * quality_weight
        
        # Normalize weights
        total_weight = sum(method_weights.values())
        if total_weight > 0:
            method_weights = {k: v / total_weight for k, v in method_weights.items()}
        
        # Find the method with highest weight as primary
        primary_method = max(method_weights.keys(), key=lambda k: method_weights[k])
        primary_result = next(r for r in results if r.method == primary_method)
        
        # Use primary method's transactions as base
        fused_transactions = []
        for transaction in primary_result.transactions:
            fused_transaction = transaction.copy()
            fused_transaction['_fusion_method'] = 'weighted_voting'
            fused_transaction['_primary_method'] = primary_method
            fused_transaction['_method_weights'] = method_weights
            fused_transactions.append(fused_transaction)
        
        return fused_transactions
    
    def _apply_consensus_fusion(self, results: List[ExtractionResult], 
                              cross_validation: CrossValidationResult) -> List[Dict]:
        """
        Apply consensus-based fusion method.
        
        Args:
            results: Extraction results
            cross_validation: Cross-validation results
            
        Returns:
            Fused transactions using consensus
        """
        if not results:
            return []
        
        # Group transactions by similarity
        transaction_groups = self._group_similar_transactions(results)
        
        fused_transactions = []
        for group in transaction_groups:
            # Create consensus transaction from group
            consensus_transaction = self._create_consensus_transaction(group)
            consensus_transaction['_fusion_method'] = 'consensus'
            fused_transactions.append(consensus_transaction)
        
        return fused_transactions
    
    def _apply_best_method_selection(self, results: List[ExtractionResult]) -> List[Dict]:
        """
        Apply best method selection for each transaction.
        
        Args:
            results: Extraction results
            
        Returns:
            Fused transactions using best method selection
        """
        if not results:
            return []
        
        # Select best method based on overall quality
        best_result = max(results, key=lambda r: r.confidence * np.mean(list(r.quality_metrics.values()) or [0.5]))
        
        fused_transactions = []
        for transaction in best_result.transactions:
            fused_transaction = transaction.copy()
            fused_transaction['_fusion_method'] = 'best_method'
            fused_transaction['_selected_method'] = best_result.method
            fused_transactions.append(fused_transaction)
        
        return fused_transactions
    
    def _group_similar_transactions(self, results: List[ExtractionResult]) -> List[List[Dict]]:
        """
        Group similar transactions across different methods.
        
        Args:
            results: Extraction results
            
        Returns:
            List of transaction groups
        """
        all_transactions = []
        for result in results:
            for transaction in result.transactions:
                transaction['_source_method'] = result.method
                all_transactions.append(transaction)
        
        # Simple grouping by position (assuming similar order)
        groups = []
        max_transactions = max(len(result.transactions) for result in results)
        
        for i in range(max_transactions):
            group = []
            for result in results:
                if i < len(result.transactions):
                    transaction = result.transactions[i].copy()
                    transaction['_source_method'] = result.method
                    group.append(transaction)
            
            if group:
                groups.append(group)
        
        return groups
    
    def _create_consensus_transaction(self, transaction_group: List[Dict]) -> Dict:
        """
        Create consensus transaction from a group of similar transactions.
        
        Args:
            transaction_group: Group of similar transactions
            
        Returns:
            Consensus transaction
        """
        if not transaction_group:
            return {}
        
        if len(transaction_group) == 1:
            return transaction_group[0]
        
        consensus = {}
        
        # Get all possible fields
        all_fields = set()
        for transaction in transaction_group:
            all_fields.update(transaction.keys())
        
        # Create consensus for each field
        for field in all_fields:
            if field.startswith('_'):
                continue
                
            values = [t.get(field) for t in transaction_group if field in t and t[field]]
            
            if not values:
                continue
            
            if field == 'amount':
                # Use median for amounts
                numeric_values = []
                for v in values:
                    try:
                        numeric_values.append(float(v))
                    except (ValueError, TypeError):
                        pass
                
                if numeric_values:
                    consensus[field] = statistics.median(numeric_values)
            
            elif field == 'date':
                # Use most common date
                normalized_dates = [self._normalize_date(v) for v in values]
                consensus[field] = Counter(normalized_dates).most_common(1)[0][0]
            
            else:
                # Use most common value for other fields
                consensus[field] = Counter(values).most_common(1)[0][0]
        
        # Add consensus metadata
        consensus['_consensus_sources'] = [t.get('_source_method', 'unknown') for t in transaction_group]
        consensus['_consensus_confidence'] = len(transaction_group) / len(transaction_group)
        
        return consensus 
   
    def _resolve_conflicts(self, results: List[ExtractionResult], 
                          fused_transactions: List[Dict]) -> List[ConflictResolution]:
        """
        Resolve conflicts between different extraction methods.
        
        Args:
            results: Original extraction results
            fused_transactions: Fused transactions that may have conflicts
            
        Returns:
            List of conflict resolutions
        """
        conflict_resolutions = []
        
        if len(results) < 2:
            return conflict_resolutions
        
        self.logger.info("Resolving conflicts between extraction methods")
        
        # Create method-transaction mapping
        method_transactions = {result.method: result.transactions for result in results}
        
        # Check for conflicts in each transaction
        for idx, fused_transaction in enumerate(fused_transactions):
            # Get corresponding transactions from each method
            method_values = {}
            for method, transactions in method_transactions.items():
                if idx < len(transactions):
                    method_values[method] = transactions[idx]
            
            # Check each field for conflicts
            for field in ['date', 'amount', 'description', 'balance']:
                field_values = {}
                for method, transaction in method_values.items():
                    if field in transaction and transaction[field]:
                        field_values[method] = transaction[field]
                
                if len(field_values) > 1:
                    # Check if there's a conflict
                    conflict = self._detect_field_conflict(field, field_values)
                    
                    if conflict:
                        resolution = self._resolve_field_conflict(field, field_values, results)
                        resolution.conflict_type = f"{field}_conflict"
                        conflict_resolutions.append(resolution)
        
        return conflict_resolutions
    
    def _detect_field_conflict(self, field: str, field_values: Dict[str, Any]) -> bool:
        """
        Detect if there's a conflict in field values across methods.
        
        Args:
            field: Field name
            field_values: Dictionary of method -> value
            
        Returns:
            True if conflict detected
        """
        if len(field_values) < 2:
            return False
        
        values = list(field_values.values())
        
        if field == 'amount':
            # Check for significant amount differences using normalized values
            try:
                amounts = [self._normalize_amount(v) for v in values]
                max_diff = max(amounts) - min(amounts)
                return max_diff > 0.011  # More than 1 cent difference
            except (ValueError, TypeError):
                return len(set(str(v).strip() for v in values)) > 1
        
        elif field == 'date':
            # Check for date differences using normalized dates
            normalized_dates = [self._normalize_date(v) for v in values]
            return len(set(normalized_dates)) > 1
        
        else:
            # Check for text differences using normalized text
            normalized_texts = [self._normalize_text(v) for v in values]
            return len(set(normalized_texts)) > 1
    
    def _resolve_field_conflict(self, field: str, field_values: Dict[str, Any], 
                               results: List[ExtractionResult]) -> ConflictResolution:
        """
        Resolve conflict for a specific field.
        
        Args:
            field: Field name with conflict
            field_values: Dictionary of method -> value
            results: Original extraction results for confidence lookup
            
        Returns:
            ConflictResolution with resolved value
        """
        # Get method confidences
        method_confidences = {result.method: result.confidence for result in results}
        
        # Calculate weighted scores for each value
        value_scores = defaultdict(list)
        
        for method, value in field_values.items():
            base_confidence = method_confidences.get(method, 0.5)
            method_weight = self.config['confidence_weights'].get(method, 0.5)
            field_weight = self.config['field_weights'].get(field, 0.8)
            
            total_score = base_confidence * method_weight * field_weight
            value_scores[str(value)].append((method, total_score))
        
        # Find value with highest total score
        best_value = None
        best_score = 0
        best_method = None
        
        for value, method_scores in value_scores.items():
            total_score = sum(score for _, score in method_scores)
            if total_score > best_score:
                best_score = total_score
                best_value = value
                best_method = method_scores[0][0]  # Method with highest individual score
        
        # Convert back to original type if needed
        if field == 'amount':
            try:
                best_value = float(best_value)
            except (ValueError, TypeError):
                pass
        
        return ConflictResolution(
            resolved_value=best_value,
            winning_method=best_method,
            confidence=best_score,
            conflict_type=f"{field}_conflict",
            evidence={
                'field_values': field_values,
                'method_confidences': method_confidences,
                'value_scores': dict(value_scores)
            }
        )
    
    def _apply_conflict_resolutions(self, transactions: List[Dict], 
                                  resolutions: List[ConflictResolution]) -> List[Dict]:
        """
        Apply conflict resolutions to transactions.
        
        Args:
            transactions: Fused transactions
            resolutions: Conflict resolutions to apply
            
        Returns:
            Transactions with conflicts resolved
        """
        if not resolutions:
            return transactions
        
        resolved_transactions = []
        
        for idx, transaction in enumerate(transactions):
            resolved_transaction = transaction.copy()
            
            # Apply relevant resolutions
            for resolution in resolutions:
                if resolution.conflict_type.endswith('_conflict'):
                    field = resolution.conflict_type.replace('_conflict', '')
                    resolved_transaction[field] = resolution.resolved_value
                    
                    # Add resolution metadata
                    if '_conflict_resolutions' not in resolved_transaction:
                        resolved_transaction['_conflict_resolutions'] = []
                    
                    resolved_transaction['_conflict_resolutions'].append({
                        'field': field,
                        'resolved_value': resolution.resolved_value,
                        'winning_method': resolution.winning_method,
                        'confidence': resolution.confidence
                    })
            
            resolved_transactions.append(resolved_transaction)
        
        return resolved_transactions
    
    def _calculate_quality_assessment(self, transactions: List[Dict], 
                                    results: List[ExtractionResult],
                                    cross_validation: CrossValidationResult) -> QualityAssessment:
        """
        Calculate comprehensive quality assessment for combined results.
        
        Args:
            transactions: Final combined transactions
            results: Original extraction results
            cross_validation: Cross-validation results
            
        Returns:
            QualityAssessment with detailed metrics
        """
        # Calculate method scores
        method_scores = {}
        for result in results:
            base_score = result.confidence
            quality_score = np.mean(list(result.quality_metrics.values())) if result.quality_metrics else 0.5
            method_scores[result.method] = (base_score + quality_score) / 2
        
        # Calculate field confidence scores
        field_confidence = self._calculate_field_confidence(transactions, results)
        
        # Calculate completeness score
        completeness_score = self._calculate_completeness_score(transactions)
        
        # Calculate consistency score (from cross-validation)
        consistency_score = cross_validation.consistency_score
        
        # Calculate anomaly score
        anomaly_score = self._calculate_anomaly_score(transactions)
        
        # Calculate overall confidence
        overall_confidence = self._calculate_overall_confidence(
            method_scores, field_confidence, completeness_score, consistency_score, anomaly_score
        )
        
        # Calculate reliability indicators
        reliability_indicators = self._calculate_reliability_indicators(
            transactions, results, cross_validation
        )
        
        return QualityAssessment(
            overall_confidence=overall_confidence,
            method_scores=method_scores,
            field_confidence=field_confidence,
            completeness_score=completeness_score,
            consistency_score=consistency_score,
            anomaly_score=anomaly_score,
            reliability_indicators=reliability_indicators
        )
    
    def _calculate_field_confidence(self, transactions: List[Dict], 
                                  results: List[ExtractionResult]) -> Dict[str, float]:
        """
        Calculate confidence scores for each field type.
        
        Args:
            transactions: Combined transactions
            results: Original extraction results
            
        Returns:
            Dictionary of field -> confidence score
        """
        field_confidence = {}
        
        # Key fields to analyze
        key_fields = ['date', 'amount', 'description', 'balance', 'reference']
        
        for field in key_fields:
            field_values = []
            field_qualities = []
            
            for transaction in transactions:
                if field in transaction and transaction[field]:
                    field_values.append(transaction[field])
                    
                    # Get quality from conflict resolutions if available
                    if '_conflict_resolutions' in transaction:
                        for resolution in transaction['_conflict_resolutions']:
                            if resolution['field'] == field:
                                field_qualities.append(resolution['confidence'])
                                break
                        else:
                            field_qualities.append(0.8)  # Default for non-conflicted fields
                    else:
                        field_qualities.append(0.8)  # Default for non-conflicted fields
            
            if field_values:
                # Calculate field-specific confidence
                if field == 'amount':
                    # For amounts, check for reasonable values and consistency
                    try:
                        amounts = [float(v) for v in field_values if v]
                        if amounts:
                            # Check for outliers
                            mean_amount = np.mean(amounts)
                            std_amount = np.std(amounts)
                            outliers = sum(1 for a in amounts if abs(a - mean_amount) > 2 * std_amount)
                            outlier_ratio = outliers / len(amounts)
                            
                            base_confidence = np.mean(field_qualities)
                            field_confidence[field] = base_confidence * (1 - outlier_ratio * 0.5)
                        else:
                            field_confidence[field] = 0.0
                    except (ValueError, TypeError):
                        field_confidence[field] = np.mean(field_qualities) * 0.5
                
                elif field == 'date':
                    # For dates, check format consistency
                    valid_dates = 0
                    for date_val in field_values:
                        normalized_date = self._normalize_date(date_val)
                        if re.match(r'\d{2}/\d{2}/\d{4}', normalized_date):
                            valid_dates += 1
                    
                    date_validity = valid_dates / len(field_values)
                    base_confidence = np.mean(field_qualities)
                    field_confidence[field] = base_confidence * date_validity
                
                else:
                    # For text fields, use average quality
                    field_confidence[field] = np.mean(field_qualities)
            else:
                field_confidence[field] = 0.0
        
        return field_confidence
    
    def _calculate_completeness_score(self, transactions: List[Dict]) -> float:
        """
        Calculate completeness score based on filled fields.
        
        Args:
            transactions: Combined transactions
            
        Returns:
            Completeness score (0.0 to 1.0)
        """
        if not transactions:
            return 0.0
        
        required_fields = ['date', 'amount', 'description']
        optional_fields = ['balance', 'reference', 'type']
        
        total_completeness = 0.0
        
        for transaction in transactions:
            # Required fields score (70% weight)
            required_score = sum(1 for field in required_fields 
                               if field in transaction and transaction[field]) / len(required_fields)
            
            # Optional fields score (30% weight)
            optional_score = sum(1 for field in optional_fields 
                               if field in transaction and transaction[field]) / len(optional_fields)
            
            transaction_completeness = required_score * 0.7 + optional_score * 0.3
            total_completeness += transaction_completeness
        
        return total_completeness / len(transactions)
    
    def _calculate_anomaly_score(self, transactions: List[Dict]) -> float:
        """
        Calculate anomaly score to detect suspicious transactions.
        
        Args:
            transactions: Combined transactions
            
        Returns:
            Anomaly score (0.0 = no anomalies, 1.0 = many anomalies)
        """
        if not transactions or not ADVANCED_STATS_AVAILABLE:
            return 0.0
        
        try:
            # Extract numerical features for anomaly detection
            features = []
            for transaction in transactions:
                feature_vector = []
                
                # Amount feature
                try:
                    amount = float(transaction.get('amount', 0))
                    feature_vector.append(amount)
                except (ValueError, TypeError):
                    feature_vector.append(0.0)
                
                # Description length feature
                description = str(transaction.get('description', ''))
                feature_vector.append(len(description))
                
                # Date consistency feature (days from first transaction)
                # Simplified: use transaction index as proxy
                feature_vector.append(len(features))
                
                features.append(feature_vector)
            
            if len(features) < 2:
                return 0.0
            
            # Normalize features
            features_array = np.array(features)
            normalized_features = self.scaler.fit_transform(features_array)
            
            # Detect anomalies
            anomaly_labels = self.anomaly_detector.fit_predict(normalized_features)
            anomaly_count = sum(1 for label in anomaly_labels if label == -1)
            
            return anomaly_count / len(transactions)
            
        except Exception as e:
            self.logger.warning(f"Could not calculate anomaly score: {e}")
            return 0.0
    
    def _calculate_overall_confidence(self, method_scores: Dict[str, float],
                                    field_confidence: Dict[str, float],
                                    completeness_score: float,
                                    consistency_score: float,
                                    anomaly_score: float) -> float:
        """
        Calculate overall confidence score combining all metrics.
        
        Args:
            method_scores: Confidence scores for each method
            field_confidence: Confidence scores for each field
            completeness_score: Completeness score
            consistency_score: Consistency score
            anomaly_score: Anomaly score
            
        Returns:
            Overall confidence score (0.0 to 1.0)
        """
        # Weight different components
        weights = {
            'method_quality': 0.3,
            'field_quality': 0.25,
            'completeness': 0.2,
            'consistency': 0.15,
            'anomaly_penalty': 0.1
        }
        
        # Calculate weighted components
        method_quality = np.mean(list(method_scores.values())) if method_scores else 0.5
        field_quality = np.mean(list(field_confidence.values())) if field_confidence else 0.5
        anomaly_penalty = 1.0 - anomaly_score  # Convert anomaly score to penalty
        
        overall_confidence = (
            method_quality * weights['method_quality'] +
            field_quality * weights['field_quality'] +
            completeness_score * weights['completeness'] +
            consistency_score * weights['consistency'] +
            anomaly_penalty * weights['anomaly_penalty']
        )
        
        return max(0.0, min(1.0, overall_confidence))
    
    def _calculate_reliability_indicators(self, transactions: List[Dict],
                                        results: List[ExtractionResult],
                                        cross_validation: CrossValidationResult) -> Dict[str, Any]:
        """
        Calculate reliability indicators for the extraction process.
        
        Args:
            transactions: Combined transactions
            results: Original extraction results
            cross_validation: Cross-validation results
            
        Returns:
            Dictionary of reliability indicators
        """
        indicators = {}
        
        # Method agreement indicator
        if len(results) > 1:
            indicators['method_agreement'] = cross_validation.agreement_percentage
            indicators['method_consistency'] = cross_validation.consistency_score
        else:
            indicators['method_agreement'] = 100.0
            indicators['method_consistency'] = 1.0
        
        # Data quality indicators
        indicators['transaction_count'] = len(transactions)
        indicators['average_fields_per_transaction'] = np.mean([
            len([k for k, v in t.items() if not k.startswith('_') and v])
            for t in transactions
        ]) if transactions else 0
        
        # Processing indicators
        indicators['methods_used'] = [result.method for result in results]
        indicators['processing_times'] = {result.method: result.processing_time for result in results}
        indicators['total_processing_time'] = sum(result.processing_time for result in results)
        
        # Conflict indicators
        conflict_count = sum(1 for t in transactions if '_conflict_resolutions' in t)
        indicators['conflicts_resolved'] = conflict_count
        indicators['conflict_rate'] = conflict_count / len(transactions) if transactions else 0
        
        return indicators
    
    def _calculate_method_contributions(self, results: List[ExtractionResult], 
                                      final_transactions: List[Dict]) -> Dict[str, float]:
        """
        Calculate how much each method contributed to the final result.
        
        Args:
            results: Original extraction results
            final_transactions: Final combined transactions
            
        Returns:
            Dictionary of method -> contribution percentage
        """
        contributions = defaultdict(float)
        
        for transaction in final_transactions:
            # Check fusion method used
            fusion_method = transaction.get('_fusion_method', 'unknown')
            
            if fusion_method == 'weighted_voting':
                primary_method = transaction.get('_primary_method', 'unknown')
                contributions[primary_method] += 1.0
            
            elif fusion_method == 'consensus':
                sources = transaction.get('_consensus_sources', [])
                if sources:
                    contribution_per_source = 1.0 / len(sources)
                    for source in sources:
                        contributions[source] += contribution_per_source
            
            elif fusion_method == 'best_method':
                selected_method = transaction.get('_selected_method', 'unknown')
                contributions[selected_method] += 1.0
            
            # Also check conflict resolutions
            if '_conflict_resolutions' in transaction:
                for resolution in transaction['_conflict_resolutions']:
                    winning_method = resolution.get('winning_method', 'unknown')
                    contributions[winning_method] += 0.1  # Small bonus for winning conflicts
        
        # Normalize to percentages
        total_contributions = sum(contributions.values())
        if total_contributions > 0:
            contributions = {k: (v / total_contributions) * 100 
                           for k, v in contributions.items()}
        
        return dict(contributions)
    
    def _generate_recommendations(self, quality_assessment: QualityAssessment,
                                cross_validation: CrossValidationResult,
                                conflict_resolutions: List[ConflictResolution]) -> List[str]:
        """
        Generate recommendations based on quality assessment and analysis.
        
        Args:
            quality_assessment: Quality assessment results
            cross_validation: Cross-validation results
            conflict_resolutions: Conflict resolution results
            
        Returns:
            List of recommendation strings
        """
        recommendations = []
        
        # Overall confidence recommendations
        if quality_assessment.overall_confidence < 0.5:
            recommendations.append(
                "LOW CONFIDENCE: Consider manual review of all transactions due to low overall confidence"
            )
        elif quality_assessment.overall_confidence < 0.7:
            recommendations.append(
                "MEDIUM CONFIDENCE: Review transactions with low field confidence scores"
            )
        
        # Method-specific recommendations
        if quality_assessment.method_scores:
            worst_method = min(quality_assessment.method_scores.keys(), 
                             key=lambda k: quality_assessment.method_scores[k])
            worst_score = quality_assessment.method_scores[worst_method]
            
            if worst_score < 0.5:
                recommendations.append(
                    f"Consider disabling or reconfiguring {worst_method} method due to poor performance"
                )
        
        # Field-specific recommendations
        for field, confidence in quality_assessment.field_confidence.items():
            if confidence < 0.5:
                recommendations.append(
                    f"LOW CONFIDENCE in {field} field: Manual verification recommended"
                )
        
        # Completeness recommendations
        if quality_assessment.completeness_score < 0.7:
            recommendations.append(
                "INCOMPLETE DATA: Many transactions are missing required fields"
            )
        
        # Consistency recommendations
        if cross_validation.consistency_score < 0.6:
            recommendations.append(
                "LOW CONSISTENCY: Methods disagree significantly - consider document quality issues"
            )
        
        # Anomaly recommendations
        if quality_assessment.anomaly_score > 0.2:
            recommendations.append(
                "ANOMALIES DETECTED: Review transactions flagged as unusual patterns"
            )
        
        # Conflict recommendations
        if len(conflict_resolutions) > 0:
            high_conflict_count = sum(1 for r in conflict_resolutions if r.confidence < 0.7)
            if high_conflict_count > 0:
                recommendations.append(
                    f"CONFLICTS DETECTED: {high_conflict_count} conflicts resolved with low confidence"
                )
        
        return recommendations
    
    def _create_processing_summary(self, original_results: List[ExtractionResult],
                                 normalized_results: List[ExtractionResult],
                                 final_transactions: List[Dict]) -> Dict[str, Any]:
        """
        Create comprehensive processing summary.
        
        Args:
            original_results: Original extraction results
            normalized_results: Normalized extraction results
            final_transactions: Final combined transactions
            
        Returns:
            Processing summary dictionary
        """
        summary = {
            'input_methods': len(original_results),
            'methods_used': [result.method for result in original_results],
            'total_processing_time': sum(result.processing_time for result in original_results),
            'original_transaction_counts': {
                result.method: len(result.transactions) for result in original_results
            },
            'final_transaction_count': len(final_transactions),
            'fusion_methods_used': list(set(
                t.get('_fusion_method', 'unknown') for t in final_transactions
            )),
            'conflicts_resolved': sum(1 for t in final_transactions if '_conflict_resolutions' in t),
            'average_confidence': np.mean([
                result.confidence for result in original_results
            ]) if original_results else 0.0
        }
        
        return summary


# Utility functions for integration with existing system
def create_extraction_result(method: str, transactions: List[Dict], 
                           confidence: float, processing_time: float,
                           metadata: Dict = None, quality_metrics: Dict = None) -> ExtractionResult:
    """
    Create an ExtractionResult object for use with the combination system.
    
    Args:
        method: Name of extraction method
        transactions: List of extracted transactions
        confidence: Overall confidence score
        processing_time: Time taken for extraction
        metadata: Optional metadata dictionary
        quality_metrics: Optional quality metrics dictionary
        
    Returns:
        ExtractionResult object
    """
    return ExtractionResult(
        method=method,
        transactions=transactions or [],
        confidence=confidence,
        processing_time=processing_time,
        metadata=metadata or {},
        quality_metrics=quality_metrics or {}
    )


def combine_extraction_results(results: List[ExtractionResult], debug: bool = False) -> CombinedResult:
    """
    Convenience function to combine extraction results.
    
    Args:
        results: List of extraction results to combine
        debug: Enable debug logging
        
    Returns:
        CombinedResult with combined and validated results
    """
    combiner = ResultCombinationSystem(debug=debug)
    return combiner.combine_results(results)