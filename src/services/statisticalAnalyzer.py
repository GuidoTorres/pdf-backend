"""
Statistical Analysis Service for Document Extraction
Implements anomaly detection and statistical analysis for extracted transactions
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
import json
import logging
from scipy import stats
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import DBSCAN
import re

logger = logging.getLogger(__name__)

@dataclass
class TransactionAnomaly:
    """Represents a detected anomaly in a transaction"""
    transaction_id: str
    anomaly_type: str
    severity: float  # 0.0 to 1.0
    description: str
    field_name: str
    expected_value: Optional[str] = None
    actual_value: Optional[str] = None
    confidence: float = 0.0

@dataclass
class StatisticalMetrics:
    """Statistical metrics for a set of transactions"""
    total_transactions: int
    anomaly_count: int
    anomaly_rate: float
    amount_statistics: Dict[str, float]
    date_range: Dict[str, str]
    description_patterns: List[str]
    confidence_distribution: Dict[str, float]

class StatisticalAnalyzer:
    """
    Implements statistical analysis for anomaly detection in extracted transactions
    Requirements: 7.1, 7.2, 7.3
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or self._get_default_config()
        self.scaler = StandardScaler()
        self.isolation_forest = IsolationForest(
            contamination=self.config.get('contamination_rate', 0.1),
            random_state=42
        )
        self.historical_data = []
        
    def _get_default_config(self) -> Dict:
        """Get default configuration for statistical analysis"""
        return {
            'contamination_rate': 0.1,  # Expected anomaly rate
            'amount_outlier_threshold': 3.0,  # Z-score threshold
            'date_range_days': 365,  # Expected date range
            'min_description_length': 3,
            'max_description_length': 200,
            'confidence_threshold': 0.5
        }
    
    def analyze_transactions(self, transactions: List[Dict]) -> Tuple[List[TransactionAnomaly], StatisticalMetrics]:
        """
        Analyze transactions for anomalies and generate statistical metrics
        
        Args:
            transactions: List of extracted transactions
            
        Returns:
            Tuple of (anomalies, metrics)
        """
        if not transactions:
            return [], StatisticalMetrics(0, 0, 0.0, {}, {}, [], {})
        
        logger.info(f"Analyzing {len(transactions)} transactions for anomalies")
        
        # Convert to DataFrame for easier analysis
        df = pd.DataFrame(transactions)
        
        # Detect various types of anomalies
        anomalies = []
        anomalies.extend(self._detect_amount_anomalies(df))
        anomalies.extend(self._detect_date_anomalies(df))
        anomalies.extend(self._detect_description_anomalies(df))
        anomalies.extend(self._detect_pattern_anomalies(df))
        anomalies.extend(self._detect_statistical_outliers(df))
        
        # Generate statistical metrics
        metrics = self._generate_statistical_metrics(df, anomalies)
        
        logger.info(f"Detected {len(anomalies)} anomalies ({metrics.anomaly_rate:.2%} rate)")
        
        return anomalies, metrics
    
    def _detect_amount_anomalies(self, df: pd.DataFrame) -> List[TransactionAnomaly]:
        """Detect anomalies in transaction amounts"""
        anomalies = []
        
        if 'amount' not in df.columns:
            return anomalies
        
        # Convert amounts to numeric, handling various formats
        amounts = []
        for idx, row in df.iterrows():
            amount_str = str(row.get('amount', ''))
            amount_numeric = self._extract_numeric_amount(amount_str)
            amounts.append((idx, amount_str, amount_numeric))
        
        # Filter valid amounts for statistical analysis
        valid_amounts = [(idx, orig, num) for idx, orig, num in amounts if num is not None]
        
        if len(valid_amounts) < 3:  # Need minimum data for statistics
            return anomalies
        
        amount_values = [num for _, _, num in valid_amounts]
        
        # Z-score based outlier detection
        z_scores = np.abs(stats.zscore(amount_values))
        threshold = self.config['amount_outlier_threshold']
        
        for i, (idx, original, numeric) in enumerate(valid_amounts):
            if z_scores[i] > threshold:
                anomalies.append(TransactionAnomaly(
                    transaction_id=str(idx),
                    anomaly_type='amount_outlier',
                    severity=min(z_scores[i] / threshold, 1.0),
                    description=f'Amount {original} is a statistical outlier (z-score: {z_scores[i]:.2f})',
                    field_name='amount',
                    actual_value=original,
                    confidence=0.8
                ))
        
        # Detect invalid amount formats
        for idx, original, numeric in amounts:
            if numeric is None and original.strip():
                anomalies.append(TransactionAnomaly(
                    transaction_id=str(idx),
                    anomaly_type='invalid_amount_format',
                    severity=0.9,
                    description=f'Amount "{original}" has invalid format',
                    field_name='amount',
                    actual_value=original,
                    confidence=0.95
                ))
        
        return anomalies
    
    def _detect_date_anomalies(self, df: pd.DataFrame) -> List[TransactionAnomaly]:
        """Detect anomalies in transaction dates"""
        anomalies = []
        
        if 'date' not in df.columns:
            return anomalies
        
        current_date = datetime.now()
        max_days_back = self.config['date_range_days']
        min_valid_date = current_date - timedelta(days=max_days_back)
        max_valid_date = current_date + timedelta(days=30)  # Allow some future dates
        
        for idx, row in df.iterrows():
            date_str = str(row.get('date', ''))
            parsed_date = self._parse_date(date_str)
            
            if parsed_date is None and date_str.strip():
                anomalies.append(TransactionAnomaly(
                    transaction_id=str(idx),
                    anomaly_type='invalid_date_format',
                    severity=0.8,
                    description=f'Date "{date_str}" has invalid format',
                    field_name='date',
                    actual_value=date_str,
                    confidence=0.9
                ))
            elif parsed_date:
                if parsed_date < min_valid_date:
                    anomalies.append(TransactionAnomaly(
                        transaction_id=str(idx),
                        anomaly_type='date_too_old',
                        severity=0.6,
                        description=f'Date {date_str} is older than expected range',
                        field_name='date',
                        actual_value=date_str,
                        confidence=0.7
                    ))
                elif parsed_date > max_valid_date:
                    anomalies.append(TransactionAnomaly(
                        transaction_id=str(idx),
                        anomaly_type='future_date',
                        severity=0.8,
                        description=f'Date {date_str} is in the future',
                        field_name='date',
                        actual_value=date_str,
                        confidence=0.9
                    ))
        
        return anomalies
    
    def _detect_description_anomalies(self, df: pd.DataFrame) -> List[TransactionAnomaly]:
        """Detect anomalies in transaction descriptions"""
        anomalies = []
        
        if 'description' not in df.columns:
            return anomalies
        
        min_length = self.config['min_description_length']
        max_length = self.config['max_description_length']
        
        for idx, row in df.iterrows():
            description = str(row.get('description', ''))
            
            # Check length anomalies
            if len(description.strip()) < min_length:
                anomalies.append(TransactionAnomaly(
                    transaction_id=str(idx),
                    anomaly_type='description_too_short',
                    severity=0.5,
                    description=f'Description "{description}" is too short ({len(description)} chars)',
                    field_name='description',
                    actual_value=description,
                    confidence=0.8
                ))
            elif len(description) > max_length:
                anomalies.append(TransactionAnomaly(
                    transaction_id=str(idx),
                    anomaly_type='description_too_long',
                    severity=0.6,
                    description=f'Description is too long ({len(description)} chars)',
                    field_name='description',
                    actual_value=description[:50] + '...',
                    confidence=0.7
                ))
            
            # Check for suspicious patterns
            if self._has_suspicious_patterns(description):
                anomalies.append(TransactionAnomaly(
                    transaction_id=str(idx),
                    anomaly_type='suspicious_description',
                    severity=0.7,
                    description=f'Description contains suspicious patterns',
                    field_name='description',
                    actual_value=description,
                    confidence=0.6
                ))
        
        return anomalies
    
    def _detect_pattern_anomalies(self, df: pd.DataFrame) -> List[TransactionAnomaly]:
        """Detect pattern-based anomalies across transactions"""
        anomalies = []
        
        # Check for duplicate transactions (potential OCR errors)
        if len(df) > 1:
            # Group by similar amounts and dates
            for idx, row in df.iterrows():
                similar_transactions = df[
                    (df.index != idx) & 
                    (df.get('amount', '') == row.get('amount', '')) &
                    (df.get('date', '') == row.get('date', ''))
                ]
                
                if len(similar_transactions) > 0:
                    anomalies.append(TransactionAnomaly(
                        transaction_id=str(idx),
                        anomaly_type='potential_duplicate',
                        severity=0.6,
                        description=f'Transaction may be duplicate (same amount and date)',
                        field_name='transaction',
                        confidence=0.7
                    ))
        
        return anomalies
    
    def _detect_statistical_outliers(self, df: pd.DataFrame) -> List[TransactionAnomaly]:
        """Use machine learning to detect statistical outliers"""
        anomalies = []
        
        # Prepare features for ML analysis
        features = self._extract_features_for_ml(df)
        
        if len(features) < 5:  # Need minimum samples
            return anomalies
        
        try:
            # Fit isolation forest
            outlier_predictions = self.isolation_forest.fit_predict(features)
            outlier_scores = self.isolation_forest.decision_function(features)
            
            for idx, (prediction, score) in enumerate(zip(outlier_predictions, outlier_scores)):
                if prediction == -1:  # Outlier detected
                    severity = min(abs(score) / 0.5, 1.0)  # Normalize score
                    anomalies.append(TransactionAnomaly(
                        transaction_id=str(df.index[idx]),
                        anomaly_type='statistical_outlier',
                        severity=severity,
                        description=f'Transaction is a statistical outlier (score: {score:.3f})',
                        field_name='transaction',
                        confidence=0.6
                    ))
        
        except Exception as e:
            logger.warning(f"Statistical outlier detection failed: {e}")
        
        return anomalies
    
    def _extract_features_for_ml(self, df: pd.DataFrame) -> np.ndarray:
        """Extract numerical features for machine learning analysis"""
        features = []
        
        for _, row in df.iterrows():
            feature_vector = []
            
            # Amount feature
            amount = self._extract_numeric_amount(str(row.get('amount', '')))
            feature_vector.append(amount if amount is not None else 0)
            
            # Date features (day of month, month, year)
            date = self._parse_date(str(row.get('date', '')))
            if date:
                feature_vector.extend([date.day, date.month, date.year])
            else:
                feature_vector.extend([0, 0, 0])
            
            # Description length
            desc_length = len(str(row.get('description', '')))
            feature_vector.append(desc_length)
            
            # Confidence score if available
            confidence = float(row.get('confidence', 0.5))
            feature_vector.append(confidence)
            
            features.append(feature_vector)
        
        return np.array(features)
    
    def _generate_statistical_metrics(self, df: pd.DataFrame, anomalies: List[TransactionAnomaly]) -> StatisticalMetrics:
        """Generate comprehensive statistical metrics"""
        
        # Amount statistics
        amounts = [self._extract_numeric_amount(str(row.get('amount', ''))) 
                  for _, row in df.iterrows()]
        valid_amounts = [a for a in amounts if a is not None]
        
        amount_stats = {}
        if valid_amounts:
            amount_stats = {
                'mean': float(np.mean(valid_amounts)),
                'median': float(np.median(valid_amounts)),
                'std': float(np.std(valid_amounts)),
                'min': float(np.min(valid_amounts)),
                'max': float(np.max(valid_amounts)),
                'count': len(valid_amounts)
            }
        
        # Date range
        dates = [self._parse_date(str(row.get('date', ''))) for _, row in df.iterrows()]
        valid_dates = [d for d in dates if d is not None]
        
        date_range = {}
        if valid_dates:
            date_range = {
                'earliest': min(valid_dates).isoformat(),
                'latest': max(valid_dates).isoformat(),
                'span_days': (max(valid_dates) - min(valid_dates)).days
            }
        
        # Description patterns
        descriptions = [str(row.get('description', '')) for _, row in df.iterrows()]
        common_patterns = self._extract_common_patterns(descriptions)
        
        # Confidence distribution
        confidences = [float(row.get('confidence', 0.5)) for _, row in df.iterrows()]
        confidence_dist = {
            'mean': float(np.mean(confidences)),
            'low_confidence_count': sum(1 for c in confidences if c < 0.5),
            'high_confidence_count': sum(1 for c in confidences if c > 0.8)
        }
        
        return StatisticalMetrics(
            total_transactions=len(df),
            anomaly_count=len(anomalies),
            anomaly_rate=len(anomalies) / len(df) if len(df) > 0 else 0.0,
            amount_statistics=amount_stats,
            date_range=date_range,
            description_patterns=common_patterns,
            confidence_distribution=confidence_dist
        )
    
    def _extract_numeric_amount(self, amount_str: str) -> Optional[float]:
        """Extract numeric value from amount string"""
        if not amount_str or amount_str.strip() == '':
            return None
        
        # Remove common currency symbols and whitespace
        cleaned = re.sub(r'[€$£¥₹,\s]', '', amount_str)
        
        # Handle negative amounts
        is_negative = '-' in cleaned or '(' in amount_str
        cleaned = re.sub(r'[-()]', '', cleaned)
        
        try:
            # Try to convert to float
            value = float(cleaned)
            return -value if is_negative else value
        except ValueError:
            return None
    
    def _parse_date(self, date_str: str) -> Optional[datetime]:
        """Parse date string into datetime object"""
        if not date_str or date_str.strip() == '':
            return None
        
        # Common date formats
        formats = [
            '%Y-%m-%d',
            '%d/%m/%Y',
            '%m/%d/%Y',
            '%d-%m-%Y',
            '%Y/%m/%d',
            '%d.%m.%Y',
            '%d %m %Y',
            '%d-%m-%y',
            '%d/%m/%y'
        ]
        
        for fmt in formats:
            try:
                return datetime.strptime(date_str.strip(), fmt)
            except ValueError:
                continue
        
        return None
    
    def _has_suspicious_patterns(self, description: str) -> bool:
        """Check if description contains suspicious patterns"""
        suspicious_patterns = [
            r'[A-Z]{10,}',  # Too many consecutive capitals
            r'\d{10,}',     # Too many consecutive digits
            r'[^\w\s]{5,}', # Too many special characters
            r'^[^a-zA-Z]*$' # No letters at all
        ]
        
        for pattern in suspicious_patterns:
            if re.search(pattern, description):
                return True
        
        return False
    
    def _extract_common_patterns(self, descriptions: List[str]) -> List[str]:
        """Extract common patterns from descriptions"""
        # Simple pattern extraction - could be enhanced with NLP
        patterns = []
        
        # Find common words
        all_words = []
        for desc in descriptions:
            words = re.findall(r'\b\w+\b', desc.lower())
            all_words.extend(words)
        
        if all_words:
            word_counts = pd.Series(all_words).value_counts()
            common_words = word_counts.head(10).index.tolist()
            patterns.extend(common_words)
        
        return patterns[:5]  # Return top 5 patterns
    
    def get_anomaly_summary(self, anomalies: List[TransactionAnomaly]) -> Dict[str, Any]:
        """Generate summary of detected anomalies"""
        if not anomalies:
            return {'total': 0, 'by_type': {}, 'severity_distribution': {}}
        
        # Group by type
        by_type = {}
        for anomaly in anomalies:
            if anomaly.anomaly_type not in by_type:
                by_type[anomaly.anomaly_type] = 0
            by_type[anomaly.anomaly_type] += 1
        
        # Severity distribution
        severity_ranges = {'low': 0, 'medium': 0, 'high': 0}
        for anomaly in anomalies:
            if anomaly.severity < 0.4:
                severity_ranges['low'] += 1
            elif anomaly.severity < 0.7:
                severity_ranges['medium'] += 1
            else:
                severity_ranges['high'] += 1
        
        return {
            'total': len(anomalies),
            'by_type': by_type,
            'severity_distribution': severity_ranges,
            'average_severity': np.mean([a.severity for a in anomalies]),
            'average_confidence': np.mean([a.confidence for a in anomalies])
        }