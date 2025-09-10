#!/usr/bin/env python3
"""
Amount Sign Calculator

This module provides intelligent amount sign detection for bank statement transactions.
It supports multiple detection strategies including column-based detection, 
heuristics-based detection using description patterns, and hybrid approaches.

The calculator determines whether a transaction is a credit (positive) or debit (negative)
based on available information from the PDF extraction process.
"""

import re
import logging
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class SignDetectionStrategy(Enum):
    """Strategy used for amount sign detection"""
    COLUMNS = "columns"        # Use separate credit/debit columns
    HEURISTICS = "heuristics"  # Use description-based heuristics
    HYBRID = "hybrid"          # Combine both methods


class TransactionType(Enum):
    """Type of transaction based on sign"""
    CREDIT = "credit"   # Positive amount (income)
    DEBIT = "debit"     # Negative amount (expense)


@dataclass
class SignDetectionResult:
    """Result of amount sign detection"""
    signed_amount: float
    transaction_type: TransactionType
    confidence: float
    method_used: SignDetectionStrategy
    debug_info: Dict[str, Any]
    warnings: List[str]


class AmountSignCalculator:
    """
    Calculator for determining the correct sign of transaction amounts.
    
    This class implements multiple strategies for detecting whether a transaction
    is a credit (positive) or debit (negative) based on available data from
    PDF extraction including column structure and description patterns.
    """
    
    def __init__(self, debug: bool = False):
        """
        Initialize the Amount Sign Calculator.
        
        Args:
            debug: Enable debug logging
        """
        self.debug = debug
        
        # Compile description patterns for heuristics-based detection
        self._compile_description_patterns()
        
        logger.info("AmountSignCalculator initialized")
    
    def _compile_description_patterns(self):
        """Compile regex patterns for description-based sign detection"""
        
        # Patterns that typically indicate DEBIT transactions (expenses)
        self.debit_patterns = [
            # Spanish patterns
            r'\bpago\b', r'\bretiro\b', r'\bcargo\b', r'\bcomisión\b',
            r'\btransferencia\s+enviada\b', r'\bcompra\b', r'\bdébito\b',
            r'\bgasto\b', r'\bservicio\b', r'\bcuota\b', r'\bmensualidad\b',
            r'\binterés\b', r'\bmulta\b', r'\bpenalización\b',
            # English patterns
            r'\bpayment\b', r'\bwithdrawal\b', r'\bcharge\b', r'\bfee\b',
            r'\bdebit\b', r'\bpurchase\b', r'\bexpense\b', r'\bservice\b',
            r'\binterest\b', r'\bpenalty\b', r'\bfine\b',
            # Common transaction codes
            r'\batm\b', r'\bpos\b', r'\bcard\b', r'\btarjeta\b'
        ]
        
        # Patterns that typically indicate CREDIT transactions (income)
        self.credit_patterns = [
            # Spanish patterns
            r'\bdepósito\b', r'\babono\b', r'\bingreso\b', r'\bcrédito\b',
            r'\btransferencia\s+recibida\b', r'\bnómina\b', r'\bsalario\b',
            r'\bpago\s+recibido\b', r'\breembolso\b', r'\bdevoluci[óo]n\b',
            r'\binterés\s+ganado\b', r'\bdividendo\b',
            # English patterns
            r'\bdeposit\b', r'\bcredit\b', r'\bincome\b', r'\bsalary\b',
            r'\btransfer\s+received\b', r'\bpayment\s+received\b',
            r'\brefund\b', r'\breturn\b', r'\binterest\s+earned\b',
            r'\bdividend\b', r'\bbonus\b'
        ]
        
        # Compile patterns for better performance
        self.compiled_debit_patterns = [
            re.compile(pattern, re.IGNORECASE) for pattern in self.debit_patterns
        ]
        self.compiled_credit_patterns = [
            re.compile(pattern, re.IGNORECASE) for pattern in self.credit_patterns
        ]
    
    def calculate_transaction_sign(
        self,
        transaction_data: Dict,
        column_structure: Optional[Dict] = None
    ) -> SignDetectionResult:
        """
        Calculate the final signed amount for a transaction.
        
        Args:
            transaction_data: Dictionary containing transaction information
                Expected keys: 'amount', 'description', 'credit', 'debit'
            column_structure: Information about detected column structure
                Expected keys: 'has_separate_debit_credit', 'amount_sign_strategy'
        
        Returns:
            SignDetectionResult with signed amount and detection metadata
        """
        debug_info = {
            "input_data": transaction_data.copy(),
            "column_structure": column_structure,
            "detection_steps": []
        }
        warnings = []
        
        try:
            # Extract relevant data
            raw_amount = self._extract_numeric_value(transaction_data.get('amount'))
            credit_amount = self._extract_numeric_value(transaction_data.get('credit'))
            debit_amount = self._extract_numeric_value(transaction_data.get('debit'))
            description = str(transaction_data.get('description', '')).strip()
            
            debug_info["extracted_values"] = {
                "raw_amount": raw_amount,
                "credit_amount": credit_amount,
                "debit_amount": debit_amount,
                "description": description
            }
            
            # Determine detection strategy
            strategy = self._determine_strategy(column_structure, credit_amount, debit_amount)
            debug_info["detection_steps"].append(f"Strategy determined: {strategy.value}")
            
            # Apply appropriate detection method
            if strategy == SignDetectionStrategy.COLUMNS:
                result = self._detect_by_columns(
                    raw_amount, credit_amount, debit_amount, description, debug_info, warnings
                )
            elif strategy == SignDetectionStrategy.HEURISTICS:
                result = self._detect_by_heuristics(
                    raw_amount, description, debug_info, warnings
                )
            else:  # HYBRID
                result = self._detect_by_hybrid(
                    raw_amount, credit_amount, debit_amount, description, debug_info, warnings
                )
            
            # Set the method used
            result.method_used = strategy
            result.debug_info = debug_info
            result.warnings = warnings
            
            if self.debug:
                logger.debug(f"Sign detection completed: {result.signed_amount} "
                           f"({result.transaction_type.value}) with confidence {result.confidence:.2f}")
            
            return result
            
        except Exception as e:
            logger.error(f"Error in sign calculation: {e}")
            
            # Return fallback result
            fallback_amount = abs(raw_amount) if raw_amount else 0.0
            return SignDetectionResult(
                signed_amount=-fallback_amount,  # Default to debit for safety
                transaction_type=TransactionType.DEBIT,
                confidence=0.1,
                method_used=SignDetectionStrategy.HEURISTICS,
                debug_info={"error": str(e), "fallback_used": True},
                warnings=[f"Error in sign detection: {e}"]
            )
    
    def _extract_numeric_value(self, value: Any) -> Optional[float]:
        """
        Extract numeric value from various input formats.
        
        Args:
            value: Input value (could be string, number, None)
            
        Returns:
            Float value or None if extraction fails
        """
        if value is None or value == '':
            return None
        
        try:
            # Handle different input types
            if isinstance(value, (int, float)):
                return float(value)
            
            # Handle string values
            str_value = str(value).strip()
            if not str_value or str_value.lower() in ['nan', 'none', 'null', '']:
                return None
            
            # Remove common formatting
            cleaned = str_value.replace(',', '').replace('$', '').replace('€', '').replace('£', '')
            
            # Handle parentheses (negative values)
            if cleaned.startswith('(') and cleaned.endswith(')'):
                cleaned = '-' + cleaned[1:-1]
            
            # Check if the original string (after basic cleaning) looks like a number
            # This prevents extracting numbers from mixed alphanumeric strings
            basic_clean = str_value.replace(',', '').replace('$', '').replace('€', '').replace('£', '').strip()
            
            # If the string contains letters mixed with numbers, reject it
            if re.search(r'[a-zA-Z]', basic_clean) and re.search(r'\d', basic_clean):
                return None
            
            # Handle multiple spaces and special characters
            # Only keep digits, dots, and minus signs
            cleaned = re.sub(r'[^\d\.\-]', '', cleaned)
            
            # Check if the cleaned string is a valid number format
            if cleaned and re.match(r'^-?\d*\.?\d+$', cleaned):
                return float(cleaned)
            
        except (ValueError, TypeError) as e:
            if self.debug:
                logger.debug(f"Failed to extract numeric value from '{value}': {e}")
        
        return None
    
    def _determine_strategy(
        self,
        column_structure: Optional[Dict],
        credit_amount: Optional[float],
        debit_amount: Optional[float]
    ) -> SignDetectionStrategy:
        """
        Determine the best strategy for sign detection based on available data.
        """
        # If we have explicit column structure information
        if column_structure:
            strategy = column_structure.get('amount_sign_strategy', 'heuristics')
            if strategy == 'columns' and (credit_amount is not None or debit_amount is not None):
                return SignDetectionStrategy.COLUMNS
            elif strategy == 'hybrid':
                return SignDetectionStrategy.HYBRID
        
        # If we have credit/debit values, prefer column-based detection
        if credit_amount is not None or debit_amount is not None:
            return SignDetectionStrategy.COLUMNS
        
        # Default to heuristics
        return SignDetectionStrategy.HEURISTICS
    
    def _detect_by_columns(
        self,
        raw_amount: Optional[float],
        credit_amount: Optional[float],
        debit_amount: Optional[float],
        description: str,
        debug_info: Dict,
        warnings: List[str]
    ) -> SignDetectionResult:
        """
        Detect transaction sign using separate credit/debit columns.
        """
        debug_info["detection_steps"].append("Using column-based detection")
        
        # Check if both credit and debit are present first
        if (credit_amount is not None and credit_amount > 0 and 
            debit_amount is not None and debit_amount > 0):
            warnings.append("Both credit and debit amounts present - using net amount")
            net_amount = credit_amount - debit_amount
            transaction_type = TransactionType.CREDIT if net_amount >= 0 else TransactionType.DEBIT
            debug_info["detection_steps"].append(f"Net amount calculated: {net_amount}")
            
            return SignDetectionResult(
                signed_amount=net_amount,
                transaction_type=transaction_type,
                confidence=0.7,
                method_used=SignDetectionStrategy.COLUMNS,
                debug_info={},
                warnings=warnings
            )
        
        # Priority: credit/debit columns over raw amount
        if credit_amount is not None and credit_amount > 0:
            debug_info["detection_steps"].append(f"Credit amount found: {credit_amount}")
            return SignDetectionResult(
                signed_amount=abs(credit_amount),
                transaction_type=TransactionType.CREDIT,
                confidence=0.9,
                method_used=SignDetectionStrategy.COLUMNS,
                debug_info={},
                warnings=[]
            )
        
        if debit_amount is not None and debit_amount > 0:
            debug_info["detection_steps"].append(f"Debit amount found: {debit_amount}")
            return SignDetectionResult(
                signed_amount=-abs(debit_amount),
                transaction_type=TransactionType.DEBIT,
                confidence=0.9,
                method_used=SignDetectionStrategy.COLUMNS,
                debug_info={},
                warnings=[]
            )
        

        
        # Fallback to raw amount with heuristics
        if raw_amount is not None:
            debug_info["detection_steps"].append("No clear credit/debit columns - falling back to heuristics")
            return self._detect_by_heuristics(raw_amount, description, debug_info, warnings)
        
        # Last resort - return zero
        warnings.append("No amount data available")
        return SignDetectionResult(
            signed_amount=0.0,
            transaction_type=TransactionType.DEBIT,
            confidence=0.1,
            method_used=SignDetectionStrategy.COLUMNS,
            debug_info={},
            warnings=[]
        )
    
    def _detect_by_heuristics(
        self,
        raw_amount: Optional[float],
        description: str,
        debug_info: Dict,
        warnings: List[str]
    ) -> SignDetectionResult:
        """
        Detect transaction sign using description-based heuristics.
        """
        debug_info["detection_steps"].append("Using heuristics-based detection")
        
        if raw_amount is None or raw_amount == 0:
            warnings.append("No amount available for heuristics detection")
            return SignDetectionResult(
                signed_amount=0.0,
                transaction_type=TransactionType.DEBIT,
                confidence=0.1,
                method_used=SignDetectionStrategy.HEURISTICS,
                debug_info={},
                warnings=[]
            )
        
        # Analyze description patterns
        debit_matches = []
        credit_matches = []
        
        # Check for debit patterns
        for pattern in self.compiled_debit_patterns:
            matches = pattern.findall(description)
            if matches:
                debit_matches.extend(matches)
        
        # Check for credit patterns
        for pattern in self.compiled_credit_patterns:
            matches = pattern.findall(description)
            if matches:
                credit_matches.extend(matches)
        
        debug_info["pattern_analysis"] = {
            "debit_matches": debit_matches,
            "credit_matches": credit_matches,
            "description_analyzed": description
        }
        
        # Determine transaction type based on pattern matches
        if credit_matches and not debit_matches:
            # Clear credit indicators
            debug_info["detection_steps"].append(f"Credit patterns matched: {credit_matches}")
            return SignDetectionResult(
                signed_amount=abs(raw_amount),
                transaction_type=TransactionType.CREDIT,
                confidence=0.8,
                method_used=SignDetectionStrategy.HEURISTICS,
                debug_info={},
                warnings=[]
            )
        
        elif debit_matches and not credit_matches:
            # Clear debit indicators
            debug_info["detection_steps"].append(f"Debit patterns matched: {debit_matches}")
            return SignDetectionResult(
                signed_amount=-abs(raw_amount),
                transaction_type=TransactionType.DEBIT,
                confidence=0.8,
                method_used=SignDetectionStrategy.HEURISTICS,
                debug_info={},
                warnings=[]
            )
        
        elif credit_matches and debit_matches:
            # Conflicting patterns - use pattern strength
            warnings.append(f"Conflicting patterns found: credit={credit_matches}, debit={debit_matches}")
            
            # Simple heuristic: more matches wins
            if len(credit_matches) > len(debit_matches):
                transaction_type = TransactionType.CREDIT
                signed_amount = abs(raw_amount)
            else:
                transaction_type = TransactionType.DEBIT
                signed_amount = -abs(raw_amount)
            
            debug_info["detection_steps"].append(f"Conflict resolved by match count")
            
            return SignDetectionResult(
                signed_amount=signed_amount,
                transaction_type=transaction_type,
                confidence=0.5,
                method_used=SignDetectionStrategy.HEURISTICS,
                debug_info={},
                warnings=[]
            )
        
        else:
            # No clear patterns - default to debit (conservative approach)
            debug_info["detection_steps"].append("No clear patterns found - defaulting to debit")
            warnings.append("No clear transaction type patterns found in description")
            
            return SignDetectionResult(
                signed_amount=-abs(raw_amount),
                transaction_type=TransactionType.DEBIT,
                confidence=0.3,
                method_used=SignDetectionStrategy.HEURISTICS,
                debug_info={},
                warnings=[]
            )
    
    def _detect_by_hybrid(
        self,
        raw_amount: Optional[float],
        credit_amount: Optional[float],
        debit_amount: Optional[float],
        description: str,
        debug_info: Dict,
        warnings: List[str]
    ) -> SignDetectionResult:
        """
        Detect transaction sign using hybrid approach (columns + heuristics).
        """
        debug_info["detection_steps"].append("Using hybrid detection approach")
        
        column_result = None
        
        # First try column-based detection
        if credit_amount is not None or debit_amount is not None:
            column_result = self._detect_by_columns(
                raw_amount, credit_amount, debit_amount, description, debug_info, warnings
            )
            
            # If column detection has high confidence, still check heuristics for comparison
            if column_result.confidence >= 0.8:
                debug_info["detection_steps"].append("High confidence from column detection")
                # Still run heuristics for comparison in hybrid mode
                heuristic_result = self._detect_by_heuristics(raw_amount, description, debug_info, warnings)
                
                # Check for agreement between methods
                if column_result.transaction_type == heuristic_result.transaction_type:
                    # Methods agree - high confidence
                    debug_info["detection_steps"].append("Column and heuristic methods agree")
                    return SignDetectionResult(
                        signed_amount=column_result.signed_amount,
                        transaction_type=column_result.transaction_type,
                        confidence=min(0.95, column_result.confidence + 0.1),
                        method_used=SignDetectionStrategy.HYBRID,
                        debug_info={},
                        warnings=warnings
                    )
                else:
                    # Methods disagree - reduce confidence
                    debug_info["detection_steps"].append("Column and heuristic methods disagree")
                    warnings.append("Column and heuristic detection methods disagree")
                    
                    result = column_result
                    result.confidence *= 0.8  # Reduce confidence due to disagreement
                    result.method_used = SignDetectionStrategy.HYBRID
                    result.warnings = warnings
                    return result
        
        # Try heuristics-based detection
        heuristic_result = self._detect_by_heuristics(raw_amount, description, debug_info, warnings)
        
        # If we have both results, compare them
        if column_result and column_result.confidence > 0.5:
            # Check for agreement between methods
            if column_result.transaction_type == heuristic_result.transaction_type:
                # Methods agree - high confidence
                debug_info["detection_steps"].append("Column and heuristic methods agree")
                return SignDetectionResult(
                    signed_amount=column_result.signed_amount,
                    transaction_type=column_result.transaction_type,
                    confidence=min(0.95, column_result.confidence + 0.1),
                    method_used=SignDetectionStrategy.HYBRID,
                    debug_info={},
                    warnings=warnings
                )
            else:
                # Methods disagree - use higher confidence result
                debug_info["detection_steps"].append("Column and heuristic methods disagree")
                warnings.append("Column and heuristic detection methods disagree")
                
                if column_result.confidence >= heuristic_result.confidence:
                    result = column_result
                else:
                    result = heuristic_result
                
                result.confidence *= 0.8  # Reduce confidence due to disagreement
                result.method_used = SignDetectionStrategy.HYBRID
                result.warnings = warnings
                return result
        
        # Only heuristic result available
        heuristic_result.method_used = SignDetectionStrategy.HYBRID
        heuristic_result.warnings = warnings
        return heuristic_result
    
    def batch_calculate_signs(
        self,
        transactions: List[Dict],
        column_structure: Optional[Dict] = None
    ) -> List[SignDetectionResult]:
        """
        Calculate signs for multiple transactions in batch.
        
        Args:
            transactions: List of transaction dictionaries
            column_structure: Column structure information
            
        Returns:
            List of SignDetectionResult objects
        """
        results = []
        
        for i, transaction in enumerate(transactions):
            try:
                result = self.calculate_transaction_sign(transaction, column_structure)
                results.append(result)
                
                if self.debug and i % 10 == 0:
                    logger.debug(f"Processed {i+1}/{len(transactions)} transactions")
                    
            except Exception as e:
                logger.error(f"Error processing transaction {i}: {e}")
                # Add fallback result
                results.append(SignDetectionResult(
                    signed_amount=0.0,
                    transaction_type=TransactionType.DEBIT,
                    confidence=0.1,
                    method_used=SignDetectionStrategy.HEURISTICS,
                    debug_info={"error": str(e), "transaction_index": i},
                    warnings=[f"Failed to process transaction: {e}"]
                ))
        
        if self.debug:
            logger.debug(f"Batch processing completed: {len(results)} results")
        
        return results
    
    def get_detection_statistics(self, results: List[SignDetectionResult]) -> Dict[str, Any]:
        """
        Generate statistics about sign detection results.
        
        Args:
            results: List of SignDetectionResult objects
            
        Returns:
            Dictionary with detection statistics
        """
        if not results:
            return {"error": "No results provided"}
        
        total_transactions = len(results)
        credit_count = sum(1 for r in results if r.transaction_type == TransactionType.CREDIT)
        debit_count = sum(1 for r in results if r.transaction_type == TransactionType.DEBIT)
        
        # Confidence statistics
        confidences = [r.confidence for r in results]
        avg_confidence = sum(confidences) / len(confidences)
        min_confidence = min(confidences)
        max_confidence = max(confidences)
        
        # Method usage statistics
        method_counts = {}
        for result in results:
            method = result.method_used.value
            method_counts[method] = method_counts.get(method, 0) + 1
        
        # Warning statistics
        total_warnings = sum(len(r.warnings) for r in results)
        transactions_with_warnings = sum(1 for r in results if r.warnings)
        
        return {
            "total_transactions": total_transactions,
            "credit_transactions": credit_count,
            "debit_transactions": debit_count,
            "credit_percentage": (credit_count / total_transactions) * 100,
            "debit_percentage": (debit_count / total_transactions) * 100,
            "confidence_stats": {
                "average": round(avg_confidence, 3),
                "minimum": round(min_confidence, 3),
                "maximum": round(max_confidence, 3)
            },
            "method_usage": method_counts,
            "warning_stats": {
                "total_warnings": total_warnings,
                "transactions_with_warnings": transactions_with_warnings,
                "warning_percentage": (transactions_with_warnings / total_transactions) * 100
            }
        }