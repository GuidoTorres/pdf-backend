#!/usr/bin/env python3
"""
Transaction Validation Service

This service provides unified validation, enhancement, and quality scoring
for financial transactions extracted from bank statements.
"""

import re
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from enum import Enum
import unicodedata

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TransactionType(Enum):
    DEBIT = "debit"
    CREDIT = "credit"
    UNKNOWN = "unknown"


class ValidationErrorType(Enum):
    INVALID_DATE = "invalid_date"
    INVALID_AMOUNT = "invalid_amount"
    MISSING_DESCRIPTION = "missing_description"
    INVALID_TYPE = "invalid_type"
    SUSPICIOUS_PATTERN = "suspicious_pattern"
    SIGN_DETECTION_CONFLICT = "sign_detection_conflict"
    MISSING_SIGN_DETECTION_METHOD = "missing_sign_detection_method"
    INVALID_ORIGINAL_VALUES = "invalid_original_values"


@dataclass
class ValidationResult:
    """Result of transaction validation"""
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    quality_score: float
    sign_detection_quality: float
    amount_consistency_score: float
    enhanced_transaction: Optional[Dict] = None


@dataclass
class TransactionEnhancement:
    """Enhancement applied to a transaction"""
    field: str
    original_value: Any
    enhanced_value: Any
    confidence: float
    method: str


class TransactionValidationService:
    """
    Unified service for transaction validation, enhancement, and quality scoring.
    
    This service consolidates all validation logic to ensure consistency
    across the entire system.
    """
    
    def __init__(self, config_path: Optional[str] = None, debug: bool = False):
        self.debug = debug
        self.config = self._load_config(config_path) if config_path else self._get_default_config()
        
        # Compile regex patterns for performance
        self._compile_patterns()
        
        # Load transaction type patterns
        self._load_transaction_patterns()
        
        logger.info("TransactionValidationService initialized")
    
    def _load_config(self, config_path: str) -> Dict:
        """Load configuration from file"""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load config from {config_path}: {e}")
            return self._get_default_config()
    
    def _get_default_config(self) -> Dict:
        """Get default configuration"""
        return {
            "date_formats": [
                "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y",
                "%Y/%m/%d", "%d.%m.%Y", "%Y.%m.%d", "%d %b %Y",
                "%b %d, %Y", "%B %d, %Y",
                # Short formats without year (common in bank statements)
                "%m/%d", "%d/%m", "%m-%d", "%d-%m", "%m.%d", "%d.%m"
            ],
            "amount_patterns": [
                r"^-?\$?[\d,]+\.?\d*$",
                r"^-?[\d,]+\.?\d*\s*\$?$",
                r"^-?\$?\s*[\d,]+\.?\d*$"
            ],
            "quality_weights": {
                "date_validity": 0.20,
                "amount_validity": 0.20,
                "description_quality": 0.15,
                "type_confidence": 0.15,
                "completeness": 0.10,
                "sign_detection_quality": 0.15,
                "amount_consistency": 0.05
            },
            "min_description_length": 3,
            "max_description_length": 500,
            "suspicious_patterns": [
                r"test\s*transaction",
                r"dummy\s*data",
                r"sample\s*entry",
                r"^x+$",
                r"^-+$"
            ],
            "sign_detection_methods": ["columns", "heuristics", "hybrid"],
            "amount_conflict_threshold": 0.01  # 1% difference threshold
        }
    
    def _compile_patterns(self):
        """Compile regex patterns for performance"""
        self.amount_patterns = [
            re.compile(pattern, re.IGNORECASE) 
            for pattern in self.config["amount_patterns"]
        ]
        
        self.suspicious_patterns = [
            re.compile(pattern, re.IGNORECASE)
            for pattern in self.config["suspicious_patterns"]
        ]
    
    def _load_transaction_patterns(self):
        """Load patterns for transaction type detection"""
        self.debit_patterns = [
            # ATM and withdrawals
            re.compile(r'\b(atm|cajero|retiro|withdrawal)\b', re.IGNORECASE),
            # Payments and transfers
            re.compile(r'\b(pago|payment|transferencia|transfer|envio)\b', re.IGNORECASE),
            # Purchases
            re.compile(r'\b(compra|purchase|pos|tarjeta)\b', re.IGNORECASE),
            # Fees and charges
            re.compile(r'\b(comision|fee|cargo|charge|mantenimiento)\b', re.IGNORECASE),
            # Checks
            re.compile(r'\b(cheque|check)\b', re.IGNORECASE)
        ]
        
        self.credit_patterns = [
            # Deposits
            re.compile(r'\b(deposito|deposit|ingreso|abono)\b', re.IGNORECASE),
            # Salary and income
            re.compile(r'\b(salario|salary|nomina|sueldo|income)\b', re.IGNORECASE),
            # Transfers received
            re.compile(r'\b(recibido|received|transferencia\s+recibida)\b', re.IGNORECASE),
            # Interest
            re.compile(r'\b(interes|interest|rendimiento)\b', re.IGNORECASE),
            # Refunds
            re.compile(r'\b(devolucion|refund|reembolso)\b', re.IGNORECASE)
        ]
    
    def validate_transaction(self, transaction: Dict) -> ValidationResult:
        """
        Validate a single transaction and return detailed results.
        
        Args:
            transaction: Dictionary containing transaction data
            
        Returns:
            ValidationResult with validation status and details
        """
        errors = []
        warnings = []
        quality_scores = {}
        
        # Validate required fields
        required_fields = ['date', 'description', 'amount']
        for field in required_fields:
            if field not in transaction or transaction[field] is None:
                errors.append(f"Missing required field: {field}")
        
        if errors:
            return ValidationResult(
                is_valid=False,
                errors=errors,
                warnings=warnings,
                quality_score=0.0
            )
        
        # Validate date
        date_result = self._validate_date(transaction['date'])
        if not date_result['is_valid']:
            errors.extend(date_result['errors'])
        quality_scores['date_validity'] = date_result['quality_score']
        
        # Validate amount
        amount_result = self._validate_amount(transaction['amount'])
        if not amount_result['is_valid']:
            errors.extend(amount_result['errors'])
        quality_scores['amount_validity'] = amount_result['quality_score']
        
        # Validate description
        desc_result = self._validate_description(transaction['description'])
        if not desc_result['is_valid']:
            errors.extend(desc_result['errors'])
        warnings.extend(desc_result['warnings'])
        quality_scores['description_quality'] = desc_result['quality_score']
        
        # Validate transaction type if provided
        type_result = self._validate_transaction_type(transaction)
        warnings.extend(type_result['warnings'])
        quality_scores['type_confidence'] = type_result['quality_score']
        
        # Validate sign detection consistency
        sign_result = self._validate_sign_detection(transaction)
        if not sign_result['is_valid']:
            errors.extend(sign_result['errors'])
        warnings.extend(sign_result['warnings'])
        quality_scores['sign_detection_quality'] = sign_result['quality_score']
        
        # Validate amount consistency
        consistency_result = self._validate_amount_consistency(transaction)
        warnings.extend(consistency_result['warnings'])
        quality_scores['amount_consistency'] = consistency_result['quality_score']
        
        # Calculate completeness score
        quality_scores['completeness'] = self._calculate_completeness_score(transaction)
        
        # Calculate overall quality score
        overall_quality = self._calculate_overall_quality(quality_scores)
        
        is_valid = len(errors) == 0
        
        return ValidationResult(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            quality_score=overall_quality,
            sign_detection_quality=quality_scores.get('sign_detection_quality', 0.0),
            amount_consistency_score=quality_scores.get('amount_consistency', 0.0)
        )
    
    def enhance_transaction(self, transaction: Dict) -> Dict:
        """
        Enhance transaction data with improved values and additional fields.
        
        Args:
            transaction: Original transaction dictionary
            
        Returns:
            Enhanced transaction dictionary
        """
        enhanced = transaction.copy()
        enhancements = []
        
        # Enhance date
        date_enhancement = self._enhance_date(transaction.get('date'))
        if date_enhancement:
            enhanced['date'] = date_enhancement.enhanced_value
            enhancements.append(date_enhancement)
        
        # Enhance amount
        amount_enhancement = self._enhance_amount(transaction.get('amount'))
        if amount_enhancement:
            enhanced['amount'] = amount_enhancement.enhanced_value
            enhancements.append(amount_enhancement)
        
        # Enhance description
        desc_enhancement = self._enhance_description(transaction.get('description'))
        if desc_enhancement:
            enhanced['description'] = desc_enhancement.enhanced_value
            enhancements.append(desc_enhancement)
        
        # Determine transaction type if not already provided
        if 'type' not in enhanced or not enhanced['type']:
            type_result = self.determine_transaction_type(
                enhanced.get('description', ''), 
                enhanced.get('amount', 0)
            )
            enhanced['type'] = type_result[0]
            enhanced['type_confidence'] = type_result[1]
        
        # Ensure sign detection method is present
        if 'sign_detection_method' not in enhanced:
            enhanced['sign_detection_method'] = 'heuristics'  # Default fallback
            enhanced['confidence'] = enhanced.get('type_confidence', 0.5)
        
        # Add quality score
        validation_result = self.validate_transaction(enhanced)
        enhanced['quality_score'] = validation_result.quality_score
        
        # Add enhancement metadata
        enhanced['enhancements'] = [
            {
                'field': e.field,
                'method': e.method,
                'confidence': e.confidence
            } for e in enhancements
        ]
        
        # Validate and enhance sign detection
        sign_enhancement = self._enhance_sign_detection(enhanced)
        if sign_enhancement:
            enhanced.update(sign_enhancement)
        
        # Add processing timestamp
        enhanced['processed_at'] = datetime.now().isoformat()
        
        return enhanced
    
    def _enhance_sign_detection(self, transaction: Dict) -> Optional[Dict]:
        """Enhance sign detection information and validate consistency"""
        enhancements = {}
        
        # Validate amount consistency and add warnings if needed
        amount = transaction.get('amount')
        original_credit = transaction.get('original_credit')
        original_debit = transaction.get('original_debit')
        original_amount = transaction.get('original_amount')
        
        if amount is not None and (original_credit is not None or original_debit is not None):
            amount_float = self._parse_amount(amount)
            credit_val = self._parse_amount(original_credit) if original_credit is not None else 0
            debit_val = self._parse_amount(original_debit) if original_debit is not None else 0
            
            if amount_float is not None and (credit_val is not None or debit_val is not None):
                if credit_val is None:
                    credit_val = 0
                if debit_val is None:
                    debit_val = 0
                
                expected_amount = credit_val - debit_val
                
                # Calculate consistency score
                if abs(amount_float) > 0 and abs(expected_amount) > 0:
                    difference_ratio = abs(abs(amount_float) - abs(expected_amount)) / max(abs(amount_float), abs(expected_amount))
                    consistency_score = max(0.0, 1.0 - difference_ratio)
                else:
                    consistency_score = 1.0 if amount_float == expected_amount else 0.0
                
                enhancements['amount_consistency_score'] = round(consistency_score, 3)
                
                # Add debug information
                enhancements['debug_info'] = {
                    'calculated_amount': amount_float,
                    'expected_from_credit_debit': expected_amount,
                    'original_credit': credit_val,
                    'original_debit': debit_val,
                    'consistency_score': consistency_score
                }
        
        # Enhance confidence score based on available information
        current_confidence = transaction.get('confidence', 0.5)
        sign_method = transaction.get('sign_detection_method', 'heuristics')
        
        # Adjust confidence based on method and available data
        if sign_method == 'columns' and (original_credit is not None or original_debit is not None):
            # Column-based detection with original values should have higher confidence
            enhanced_confidence = min(0.95, current_confidence + 0.1)
        elif sign_method == 'hybrid':
            # Hybrid method should have moderate confidence
            enhanced_confidence = min(0.85, current_confidence + 0.05)
        else:
            # Heuristics-only should have lower confidence
            enhanced_confidence = min(0.75, current_confidence)
        
        if enhanced_confidence != current_confidence:
            enhancements['confidence'] = round(enhanced_confidence, 3)
        
        return enhancements if enhancements else None
    
    def validate_transactions_batch(self, transactions: List[Dict]) -> Dict:
        """
        Validate a batch of transactions and provide summary statistics.
        
        Args:
            transactions: List of transaction dictionaries
            
        Returns:
            Dictionary with validation results and statistics
        """
        results = []
        total_transactions = len(transactions)
        valid_count = 0
        total_quality = 0.0
        total_sign_quality = 0.0
        total_consistency = 0.0
        
        warnings_summary = {}
        errors_summary = {}
        
        for transaction in transactions:
            result = self.validate_transaction(transaction)
            results.append(result)
            
            if result.is_valid:
                valid_count += 1
            
            total_quality += result.quality_score
            total_sign_quality += result.sign_detection_quality
            total_consistency += result.amount_consistency_score
            
            # Aggregate warnings and errors
            for warning in result.warnings:
                warnings_summary[warning] = warnings_summary.get(warning, 0) + 1
            
            for error in result.errors:
                errors_summary[error] = errors_summary.get(error, 0) + 1
        
        return {
            'total_transactions': total_transactions,
            'valid_transactions': valid_count,
            'invalid_transactions': total_transactions - valid_count,
            'validation_rate': valid_count / total_transactions if total_transactions > 0 else 0,
            'average_quality_score': total_quality / total_transactions if total_transactions > 0 else 0,
            'average_sign_detection_quality': total_sign_quality / total_transactions if total_transactions > 0 else 0,
            'average_consistency_score': total_consistency / total_transactions if total_transactions > 0 else 0,
            'warnings_summary': warnings_summary,
            'errors_summary': errors_summary,
            'individual_results': results
        }
    
    def determine_transaction_type(self, description: str, amount: float) -> Tuple[str, float]:
        """
        Determine transaction type based on description and amount.
        
        Args:
            description: Transaction description
            amount: Transaction amount
            
        Returns:
            Tuple of (transaction_type, confidence_score)
        """
        if not description:
            return (TransactionType.UNKNOWN.value, 0.0)
        
        description_clean = self._clean_text(description)
        
        # Check for explicit debit patterns
        debit_matches = sum(1 for pattern in self.debit_patterns if pattern.search(description_clean))
        credit_matches = sum(1 for pattern in self.credit_patterns if pattern.search(description_clean))
        
        # Amount-based heuristics
        amount_float = self._parse_amount(amount)
        amount_suggests_debit = amount_float < 0
        amount_suggests_credit = amount_float > 0
        
        # Calculate confidence based on pattern matches and amount
        total_patterns = len(self.debit_patterns) + len(self.credit_patterns)
        
        if debit_matches > credit_matches:
            confidence = min(0.9, 0.5 + (debit_matches / total_patterns))
            if amount_suggests_debit:
                confidence = min(0.95, confidence + 0.2)
            return (TransactionType.DEBIT.value, confidence)
        elif credit_matches > debit_matches:
            confidence = min(0.9, 0.5 + (credit_matches / total_patterns))
            if amount_suggests_credit:
                confidence = min(0.95, confidence + 0.2)
            return (TransactionType.CREDIT.value, confidence)
        else:
            # No clear pattern match, use amount as primary indicator
            if amount_suggests_debit:
                return (TransactionType.DEBIT.value, 0.6)
            elif amount_suggests_credit:
                return (TransactionType.CREDIT.value, 0.6)
            else:
                return (TransactionType.UNKNOWN.value, 0.0)
    
    def _validate_date(self, date_value: Any) -> Dict:
        """Validate date field"""
        if not date_value:
            return {
                'is_valid': False,
                'errors': ['Date is required'],
                'quality_score': 0.0
            }
        
        # Try to parse date with various formats
        parsed_date = self._parse_date(date_value)
        if not parsed_date:
            return {
                'is_valid': False,
                'errors': ['Invalid date format'],
                'quality_score': 0.0
            }
        
        # Check if date is reasonable (not too far in future/past)
        now = datetime.now()
        if parsed_date > now + timedelta(days=365):  # Allow up to 1 year in future
            return {
                'is_valid': True,
                'errors': [],
                'quality_score': 0.8,
                'warnings': ['Date is more than 1 year in the future']
            }
        
        if parsed_date < now - timedelta(days=365 * 10):  # 10 years ago
            return {
                'is_valid': True,
                'errors': [],
                'quality_score': 0.7,  # Valid but old
                'warnings': ['Date is more than 10 years old']
            }
        
        return {
            'is_valid': True,
            'errors': [],
            'quality_score': 1.0
        }
    
    def _validate_amount(self, amount_value: Any) -> Dict:
        """Validate amount field"""
        if amount_value is None:
            return {
                'is_valid': False,
                'errors': ['Amount is required'],
                'quality_score': 0.0
            }
        
        # Try to parse amount
        parsed_amount = self._parse_amount(amount_value)
        if parsed_amount is None:
            return {
                'is_valid': False,
                'errors': ['Invalid amount format'],
                'quality_score': 0.0
            }
        
        # Check for reasonable amount range
        if abs(parsed_amount) > 1000000:  # 1 million
            return {
                'is_valid': True,
                'errors': [],
                'quality_score': 0.8,
                'warnings': ['Amount is unusually large']
            }
        
        if parsed_amount == 0:
            return {
                'is_valid': True,
                'errors': [],
                'quality_score': 0.9,
                'warnings': ['Amount is zero']
            }
        
        return {
            'is_valid': True,
            'errors': [],
            'quality_score': 1.0
        }
    
    def _validate_description(self, description: Any) -> Dict:
        """Validate description field"""
        if not description:
            return {
                'is_valid': False,
                'errors': ['Description is required'],
                'quality_score': 0.0
            }
        
        desc_str = str(description).strip()
        min_length = self.config['min_description_length']
        max_length = self.config['max_description_length']
        
        if len(desc_str) < min_length:
            return {
                'is_valid': False,
                'errors': [f'Description too short (minimum {min_length} characters)'],
                'quality_score': 0.0
            }
        
        if len(desc_str) > max_length:
            return {
                'is_valid': False,
                'errors': [f'Description too long (maximum {max_length} characters)'],
                'quality_score': 0.0
            }
        
        warnings = []
        quality_score = 1.0
        
        # Check for suspicious patterns
        for pattern in self.suspicious_patterns:
            if pattern.search(desc_str):
                warnings.append('Description matches suspicious pattern')
                quality_score = min(quality_score, 0.5)
                break
        
        # Check description quality
        if len(desc_str) < 10:
            quality_score = min(quality_score, 0.8)
            warnings.append('Description is very short')
        
        # Check for meaningful content
        if re.match(r'^[^a-zA-Z]*$', desc_str):
            quality_score = min(quality_score, 0.6)
            warnings.append('Description contains no letters')
        
        return {
            'is_valid': True,
            'errors': [],
            'warnings': warnings,
            'quality_score': quality_score
        }
    
    def _validate_transaction_type(self, transaction: Dict) -> Dict:
        """Validate transaction type field"""
        warnings = []
        
        # If type is provided, validate it
        if 'type' in transaction and transaction['type']:
            provided_type = transaction['type'].lower()
            valid_types = [t.value for t in TransactionType]
            
            if provided_type not in valid_types:
                warnings.append(f'Invalid transaction type: {provided_type}')
                return {'warnings': warnings, 'quality_score': 0.0}
        
        # Determine type and confidence
        description = transaction.get('description', '')
        amount = transaction.get('amount', 0)
        
        determined_type, confidence = self.determine_transaction_type(description, amount)
        
        # If type was provided, check consistency
        if 'type' in transaction and transaction['type']:
            provided_type = transaction['type'].lower()
            if provided_type != determined_type and confidence > 0.7:
                warnings.append(f'Provided type ({provided_type}) conflicts with determined type ({determined_type})')
                confidence = min(confidence, 0.5)
        
        return {
            'warnings': warnings,
            'quality_score': confidence
        }
    
    def _validate_sign_detection(self, transaction: Dict) -> Dict:
        """Validate sign detection consistency and quality"""
        errors = []
        warnings = []
        quality_score = 1.0
        
        # Check if sign detection method is provided
        sign_method = transaction.get('sign_detection_method')
        if not sign_method:
            # Set default sign detection method instead of failing
            sign_method = 'heuristics'
            warnings.append('No sign_detection_method provided, using default: heuristics')
            quality_score = 0.7  # Reduce quality but don't fail
        
        # Validate sign detection method
        valid_methods = self.config['sign_detection_methods']
        if sign_method not in valid_methods:
            errors.append(f'Invalid sign_detection_method: {sign_method}. Must be one of: {valid_methods}')
            return {
                'is_valid': False,
                'errors': errors,
                'warnings': warnings,
                'quality_score': 0.0
            }
        
        # Check confidence score if provided
        confidence = transaction.get('confidence')
        if confidence is not None:
            if not isinstance(confidence, (int, float)) or not (0 <= confidence <= 1):
                warnings.append('Invalid confidence score: must be between 0 and 1')
                quality_score = min(quality_score, 0.8)
            else:
                # Use confidence as part of quality score
                quality_score = min(quality_score, confidence)
                
                # Add warnings for low confidence
                if confidence < 0.5:
                    warnings.append(f'Low sign detection confidence: {confidence:.2f}')
                elif confidence < 0.7:
                    warnings.append(f'Medium sign detection confidence: {confidence:.2f}')
        else:
            # No confidence provided, reduce quality score
            quality_score = min(quality_score, 0.7)
            warnings.append('No confidence score provided for sign detection')
        
        # Validate transaction type consistency
        transaction_type = transaction.get('type')
        amount = transaction.get('amount', 0)
        
        if transaction_type and amount != 0:
            amount_float = self._parse_amount(amount)
            if amount_float is not None:
                # Check if type matches amount sign
                if transaction_type == 'credit' and amount_float < 0:
                    warnings.append('Transaction type is credit but amount is negative')
                    quality_score = min(quality_score, 0.6)
                elif transaction_type == 'debit' and amount_float > 0:
                    warnings.append('Transaction type is debit but amount is positive')
                    quality_score = min(quality_score, 0.6)
        
        return {
            'is_valid': True,
            'errors': errors,
            'warnings': warnings,
            'quality_score': quality_score
        }
    
    def _validate_amount_consistency(self, transaction: Dict) -> Dict:
        """Validate consistency between original and calculated amounts"""
        warnings = []
        quality_score = 1.0
        
        amount = transaction.get('amount')
        original_credit = transaction.get('original_credit')
        original_debit = transaction.get('original_debit')
        original_amount = transaction.get('original_amount')
        
        if amount is None:
            return {'warnings': warnings, 'quality_score': quality_score}
        
        amount_float = self._parse_amount(amount)
        if amount_float is None:
            return {'warnings': warnings, 'quality_score': quality_score}
        
        # Check consistency with original credit/debit values
        if original_credit is not None or original_debit is not None:
            credit_val = self._parse_amount(original_credit) if original_credit is not None else 0
            debit_val = self._parse_amount(original_debit) if original_debit is not None else 0
            
            if credit_val is None:
                credit_val = 0
            if debit_val is None:
                debit_val = 0
            
            # Calculate expected amount based on credit/debit
            expected_amount = credit_val - debit_val
            
            # Check for conflicts
            threshold = self.config['amount_conflict_threshold']
            if abs(amount_float) > 0 and abs(expected_amount) > 0:
                difference_ratio = abs(abs(amount_float) - abs(expected_amount)) / max(abs(amount_float), abs(expected_amount))
                
                if difference_ratio > threshold:
                    warnings.append(
                        f'Amount conflict: calculated amount ({amount_float}) differs from '
                        f'credit/debit calculation ({expected_amount}) by {difference_ratio:.1%}'
                    )
                    quality_score = min(quality_score, 0.7)
                    
                    # Log the conflict for debugging
                    logger.warning(
                        f"Amount consistency conflict detected: "
                        f"amount={amount_float}, credit={credit_val}, debit={debit_val}, "
                        f"expected={expected_amount}, difference_ratio={difference_ratio:.3f}"
                    )
        
        # Check consistency with original amount
        if original_amount is not None:
            original_amount_float = self._parse_amount(original_amount)
            if original_amount_float is not None:
                threshold = self.config['amount_conflict_threshold']
                if abs(amount_float) > 0 and abs(original_amount_float) > 0:
                    difference_ratio = abs(abs(amount_float) - abs(original_amount_float)) / max(abs(amount_float), abs(original_amount_float))
                    
                    if difference_ratio > threshold:
                        warnings.append(
                            f'Original amount conflict: calculated amount ({amount_float}) differs from '
                            f'original amount ({original_amount_float}) by {difference_ratio:.1%}'
                        )
                        quality_score = min(quality_score, 0.8)
        
        # Check for missing original values
        if original_credit is None and original_debit is None and original_amount is None:
            warnings.append('No original amount values provided for validation')
            quality_score = min(quality_score, 0.9)
        
        return {
            'warnings': warnings,
            'quality_score': quality_score
        }
    
    def _calculate_completeness_score(self, transaction: Dict) -> float:
        """Calculate completeness score based on available fields"""
        required_fields = ['date', 'description', 'amount']
        optional_fields = ['type', 'category', 'reference', 'balance']
        sign_detection_fields = ['sign_detection_method', 'confidence']
        original_value_fields = ['original_credit', 'original_debit', 'original_amount']
        
        required_score = sum(1 for field in required_fields if transaction.get(field))
        optional_score = sum(1 for field in optional_fields if transaction.get(field))
        sign_detection_score = sum(1 for field in sign_detection_fields if transaction.get(field))
        original_values_score = sum(1 for field in original_value_fields if transaction.get(field))
        
        # Weight different field categories
        total_score = (
            (required_score / len(required_fields)) * 0.6 +  # Required fields most important
            (optional_score / len(optional_fields)) * 0.15 +  # Optional fields
            (sign_detection_score / len(sign_detection_fields)) * 0.15 +  # Sign detection info
            (original_values_score / len(original_value_fields)) * 0.10  # Original values for debugging
        )
        
        return min(1.0, total_score)
    
    def _calculate_overall_quality(self, quality_scores: Dict[str, float]) -> float:
        """Calculate overall quality score using weighted average"""
        weights = self.config['quality_weights']
        total_score = 0.0
        total_weight = 0.0
        
        for metric, score in quality_scores.items():
            if metric in weights:
                weight = weights[metric]
                total_score += score * weight
                total_weight += weight
        
        return total_score / total_weight if total_weight > 0 else 0.0
    
    def _enhance_date(self, date_value: Any) -> Optional[TransactionEnhancement]:
        """Enhance date format - preserve original format"""
        if not date_value:
            return None
        
        parsed_date = self._parse_date(date_value)
        if not parsed_date:
            return None
        
        # Don't change the original date format - preserve as-is
        # Original logic converted to ISO format, but we want to keep original
        return None  # No enhancement needed, keep original date
    
    def _enhance_amount(self, amount_value: Any) -> Optional[TransactionEnhancement]:
        """Enhance amount format"""
        if amount_value is None:
            return None
        
        parsed_amount = self._parse_amount(amount_value)
        if parsed_amount is None:
            return None
        
        # Standardize to float with 2 decimal places
        standardized_amount = round(parsed_amount, 2)
        
        if amount_value != standardized_amount:
            return TransactionEnhancement(
                field='amount',
                original_value=amount_value,
                enhanced_value=standardized_amount,
                confidence=0.98,
                method='numeric_standardization'
            )
        
        return None
    
    def _enhance_description(self, description: Any) -> Optional[TransactionEnhancement]:
        """Enhance description text"""
        if not description:
            return None
        
        original = str(description)
        enhanced = self._clean_text(original)
        
        # Additional enhancements
        enhanced = self._normalize_description(enhanced)
        
        if original != enhanced:
            return TransactionEnhancement(
                field='description',
                original_value=original,
                enhanced_value=enhanced,
                confidence=0.85,
                method='text_normalization'
            )
        
        return None
    
    def _parse_date(self, date_value: Any) -> Optional[datetime]:
        """Parse date from various formats"""
        if isinstance(date_value, datetime):
            return date_value
        
        if not date_value:
            return None
        
        date_str = str(date_value).strip()
        
        for date_format in self.config['date_formats']:
            try:
                parsed = datetime.strptime(date_str, date_format)
                # If format doesn't include year, assume current year
                if '%Y' not in date_format:
                    current_year = datetime.now().year
                    parsed = parsed.replace(year=current_year)
                return parsed
            except ValueError:
                continue
        
        return None
    
    def _parse_amount(self, amount_value: Any) -> Optional[float]:
        """Parse amount from various formats"""
        if isinstance(amount_value, (int, float)):
            return float(amount_value)
        
        if not amount_value:
            return None
        
        amount_str = str(amount_value).strip()
        
        # Remove currency symbols and normalize
        amount_str = re.sub(r'[$€£¥]', '', amount_str)
        amount_str = amount_str.replace(',', '')
        amount_str = amount_str.strip()
        
        try:
            return float(amount_str)
        except ValueError:
            return None
    
    def _clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        if not text:
            return ""
        
        # Normalize unicode characters
        text = unicodedata.normalize('NFKD', text)
        
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text.strip())
        
        return text
    
    def _normalize_description(self, description: str) -> str:
        """Normalize transaction description"""
        if not description:
            return ""
        
        # Convert to title case for better readability
        normalized = description.title()
        
        # Fix common abbreviations
        abbreviations = {
            'Atm': 'ATM',
            'Pos': 'POS',
            'Ach': 'ACH',
            'Eft': 'EFT',
            'Usa': 'USA',
            'Llc': 'LLC',
            'Inc': 'Inc.',
            'Corp': 'Corp.'
        }
        
        for abbrev, replacement in abbreviations.items():
            normalized = re.sub(r'\b' + abbrev + r'\b', replacement, normalized)
        
        return normalized


# Convenience functions for standalone usage
def validate_transaction(transaction: Dict, config_path: Optional[str] = None) -> ValidationResult:
    """
    Standalone function to validate a single transaction.
    
    Args:
        transaction: Transaction dictionary to validate
        config_path: Optional path to configuration file
        
    Returns:
        ValidationResult object
    """
    service = TransactionValidationService(config_path)
    return service.validate_transaction(transaction)


def validate_transactions_batch(transactions: List[Dict], config_path: Optional[str] = None) -> Dict:
    """
    Standalone function to validate a batch of transactions.
    
    Args:
        transactions: List of transaction dictionaries to validate
        config_path: Optional path to configuration file
        
    Returns:
        Dictionary with validation results and statistics
    """
    service = TransactionValidationService(config_path)
    return service.validate_transactions_batch(transactions)


def enhance_transaction(transaction: Dict, config_path: Optional[str] = None) -> Dict:
    """
    Standalone function to enhance a single transaction.
    
    Args:
        transaction: Transaction dictionary to enhance
        config_path: Optional path to configuration file
        
    Returns:
        Enhanced transaction dictionary
    """
    service = TransactionValidationService(config_path)
    return service.enhance_transaction(transaction)


if __name__ == "__main__":
    # Example usage with enhanced transaction structure
    sample_transaction = {
        "date": "2024-01-15",
        "description": "ATM WITHDRAWAL 123 MAIN ST",
        "amount": -50.00,
        "type": "debit",
        "original_debit": 50.00,
        "original_credit": None,
        "original_amount": 50.00,
        "sign_detection_method": "columns",
        "confidence": 0.85
    }
    
    service = TransactionValidationService(debug=True)
    
    # Validate transaction
    result = service.validate_transaction(sample_transaction)
    print("Validation Result:")
    print(f"Valid: {result.is_valid}")
    print(f"Quality Score: {result.quality_score:.3f}")
    print(f"Sign Detection Quality: {result.sign_detection_quality:.3f}")
    print(f"Amount Consistency Score: {result.amount_consistency_score:.3f}")
    print(f"Errors: {result.errors}")
    print(f"Warnings: {result.warnings}")
    
    # Enhance transaction
    enhanced = service.enhance_transaction(sample_transaction)
    print("\nEnhanced Transaction:")
    print(json.dumps(enhanced, indent=2))
    
    # Example with conflicting amounts
    print("\n" + "="*50)
    print("Example with amount conflict:")
    
    conflicting_transaction = {
        "date": "2024-01-16",
        "description": "DEPOSIT FROM EMPLOYER",
        "amount": 1000.00,  # Positive amount
        "type": "credit",
        "original_debit": 1200.00,  # Conflicting: should be credit
        "original_credit": None,
        "original_amount": 1200.00,
        "sign_detection_method": "hybrid",
        "confidence": 0.65
    }
    
    conflict_result = service.validate_transaction(conflicting_transaction)
    print(f"Valid: {conflict_result.is_valid}")
    print(f"Quality Score: {conflict_result.quality_score:.3f}")
    print(f"Sign Detection Quality: {conflict_result.sign_detection_quality:.3f}")
    print(f"Amount Consistency Score: {conflict_result.amount_consistency_score:.3f}")
    print(f"Warnings: {conflict_result.warnings}")
    
    # Batch validation example
    print("\n" + "="*50)
    print("Batch validation example:")
    
    batch_transactions = [sample_transaction, conflicting_transaction]
    batch_result = service.validate_transactions_batch(batch_transactions)
    
    print(f"Total transactions: {batch_result['total_transactions']}")
    print(f"Valid transactions: {batch_result['valid_transactions']}")
    print(f"Validation rate: {batch_result['validation_rate']:.1%}")
    print(f"Average quality score: {batch_result['average_quality_score']:.3f}")
    print(f"Average sign detection quality: {batch_result['average_sign_detection_quality']:.3f}")
    print(f"Average consistency score: {batch_result['average_consistency_score']:.3f}")
    print(f"Warnings summary: {batch_result['warnings_summary']}")