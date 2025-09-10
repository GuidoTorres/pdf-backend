#!/usr/bin/env python3
"""
Transaction Extractor Service

This service provides AI-based transaction extraction from bank statements,
supporting both table-based and text-based processing with intelligent
column structure detection.

Integrates with the existing PDF processing pipeline and provides consistent
error handling and logging.
"""

import os
import re
import json
import logging
import time
import sys
from typing import List, Dict, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
import pandas as pd
import groq
from transaction_validation_service import TransactionValidationService, ValidationResult


# Configure logging to match existing system
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class ExtractionMethod(Enum):
    """Extraction method used for processing"""
    TABLE_BASED = "table_based"
    TEXT_BASED = "text_based"
    HYBRID = "hybrid"


class ColumnType(Enum):
    """Types of columns detected in tables"""
    DATE = "date"
    DESCRIPTION = "description"
    DEBIT = "debit"
    CREDIT = "credit"
    AMOUNT = "amount"
    BALANCE = "balance"
    UNKNOWN = "unknown"


@dataclass
class ColumnStructure:
    """Structure information for detected table columns"""
    date_columns: List[int]
    description_columns: List[int]
    debit_columns: List[int]
    credit_columns: List[int]
    amount_columns: List[int]
    balance_columns: List[int]
    has_separate_debit_credit: bool
    confidence: float
    # New fields for enhanced amount sign detection
    debit_keywords: List[str]
    credit_keywords: List[str]
    amount_sign_strategy: str  # "columns", "heuristics", "hybrid"
    fallback_strategy: Optional[str] = None
    detection_details: Dict[str, Any] = None


@dataclass
class OriginalStructure:
    """Structure information for original document data"""
    original_headers: List[str]
    column_types: Dict[str, str]
    column_order: List[str]
    table_count: int
    confidence_score: float
    extraction_method: str
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'original_headers': self.original_headers,
            'column_types': self.column_types,
            'column_order': self.column_order,
            'table_count': self.table_count,
            'confidence_score': self.confidence_score,
            'extraction_method': self.extraction_method
        }


@dataclass
class ExtractionResult:
    """Result of transaction extraction with original structure preservation"""
    transactions: List[Dict]
    method: ExtractionMethod
    metadata: Dict[str, Any]
    processing_time: float
    success: bool
    error_message: Optional[str] = None
    # New fields for flexible data extraction
    original_structure: Optional[OriginalStructure] = None
    original_data: Optional[List[Dict]] = None
    original_table: Optional[Dict] = None  # New field for GROQ extracted original table
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary for JSON serialization"""
        result = {
            'transactions': self.transactions,
            'method': self.method.value,
            'metadata': self.metadata,
            'processing_time': self.processing_time,
            'success': self.success,
            'error_message': self.error_message,
            'provider': 'groq_transaction_extractor'
        }
        
        # Add original structure if available
        if self.original_structure:
            result['original_structure'] = self.original_structure.to_dict()
        
        # Add original data if available
        if self.original_data:
            result['original_data'] = self.original_data
            
        # Add original table if available
        if self.original_table:
            result['original_table'] = self.original_table
            
        return result


class TransactionExtractorService:
    """
    AI-based transaction extraction service using Groq API.
    
    This service handles extraction from both structured tables and unstructured text,
    with intelligent column detection and consistent error handling.
    """
    
    def __init__(self, config_path: Optional[str] = None, debug: bool = False, preserve_original_data: bool = True):
        """
        Initialize the Transaction Extractor Service.
        
        Args:
            config_path: Path to configuration file
            debug: Enable debug logging
            preserve_original_data: Enable original data preservation (default: True)
        """
        self.debug = debug
        
        # Load config and handle preserve_original_data priority
        if config_path:
            # If config file is provided, load it and use its preserve_original_data if present
            self.config = self._load_config(config_path)
            if 'preserve_original_data' in self.config:
                self.preserve_original_data = self.config['preserve_original_data']
            else:
                self.preserve_original_data = preserve_original_data
        else:
            # If no config file, use default config but override preserve_original_data with parameter
            self.config = self._get_default_config()
            self.preserve_original_data = preserve_original_data
        
        # Initialize Groq client
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY environment variable is required")
        
        self.groq_client = groq.Groq(api_key=api_key)
        self.model = "meta-llama/llama-4-scout-17b-16e-instruct"
        
        # Initialize validation service
        self.validation_service = TransactionValidationService(config_path, debug)
        
        # Compile column detection patterns
        self._compile_column_patterns()
        
        logger.info(f"TransactionExtractorService initialized (preserve_original_data: {self.preserve_original_data})")
    
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
            "groq_model": "meta-llama/llama-4-scout-17b-16e-instruct",
            "max_retries": 3,
            "retry_delay": 1.0,
            "max_tokens": 4000,
            "temperature": 0.1,
            "preserve_original_data": True,  # Feature flag for original data preservation
            "backward_compatibility_mode": False,  # Strict backward compatibility
            "column_keywords": {
                "date": ["fecha", "fec", "date", "tran date", "post date", "fecha valor", "fecha operación"],
                "description": ["concepto", "descripción", "operación", "referencia", "detalle", "comunicacion", 
                              "description", "details", "memo", "transaction", "operaciones"],
                "debit": ["cargos", "debe", "débito", "salidas", "retiros", "a su cargo", 
                         "debit", "withdrawal", "charge", "payment"],
                "credit": ["abonos", "haber", "crédito", "ingresos", "depósitos", "a su favor", 
                          "credit", "deposit", "payment received"],
                "amount": ["importe", "valor", "monto", "amount", "valor"],
                "balance": ["saldo", "balance", "saldo disponible", "saldo contable", "running balance"]
            },
            "suspicious_patterns": [
                r"test\s*transaction",
                r"dummy\s*data",
                r"sample\s*entry",
                r"^x+$",
                r"^-+$"
            ]
        }
    
    def _compile_column_patterns(self):
        """Compile regex patterns for column detection"""
        self.column_patterns = {}
        for column_type, keywords in self.config["column_keywords"].items():
            patterns = [re.compile(rf'\b{keyword}\b', re.IGNORECASE) for keyword in keywords]
            self.column_patterns[column_type] = patterns
    
    def extract_from_tables(self, tables: List[pd.DataFrame]) -> ExtractionResult:
        """
        Extract transactions from structured table data with original structure preservation.
        
        Args:
            tables: List of pandas DataFrames containing table data
            
        Returns:
            ExtractionResult with extracted transactions, metadata, and original structure
        """
        start_time = time.time()
        
        if not tables:
            return ExtractionResult(
                transactions=[],
                method=ExtractionMethod.TABLE_BASED,
                metadata={"error": "No tables provided"},
                processing_time=0.0,
                success=False,
                error_message="No tables provided for extraction"
            )
        
        try:
            if self.debug:
                logger.debug(f"Processing {len(tables)} tables")
            
            # Conditionally preserve original structure information
            original_structure = None
            original_data = None
            
            if self.preserve_original_data:
                original_structure = self._extract_original_structure(tables)
                original_data = self._extract_original_data(tables)
            
            # Detect column structure
            column_structure = self.detect_column_structure(tables)
            
            # Convert tables to string representation
            tables_str = self._format_tables_for_ai(tables)
            
            # Create AI prompt based on detected structure
            prompt = self._create_table_extraction_prompt(tables_str, column_structure)
            
            # Extract transactions using AI
            transactions, original_table = self._extract_with_groq(prompt, "table extraction")
            
            # Conditionally enhance transactions with original data mapping
            if self.preserve_original_data and original_data and original_structure:
                enhanced_transactions = self._enhance_transactions_with_original_data(
                    transactions, original_data, original_structure
                )
            else:
                enhanced_transactions = transactions
            
            # Validate and enhance transactions
            validated_transactions = self._validate_transactions(enhanced_transactions)
            
            processing_time = time.time() - start_time
            
            # Calculate original values preservation statistics
            transactions_with_credit = sum(1 for t in validated_transactions if t.get('original_credit') is not None)
            transactions_with_debit = sum(1 for t in validated_transactions if t.get('original_debit') is not None)
            transactions_with_amount = sum(1 for t in validated_transactions if t.get('original_amount') is not None)
            
            metadata = {
                "tables_processed": len(tables),
                "column_structure": {
                    "has_separate_debit_credit": column_structure.has_separate_debit_credit,
                    "confidence": column_structure.confidence,
                    "date_columns": column_structure.date_columns,
                    "description_columns": column_structure.description_columns,
                    "debit_columns": column_structure.debit_columns,
                    "credit_columns": column_structure.credit_columns,
                    "amount_columns": column_structure.amount_columns,
                    "balance_columns": column_structure.balance_columns,
                    "debit_keywords": column_structure.debit_keywords,
                    "credit_keywords": column_structure.credit_keywords,
                    "amount_sign_strategy": column_structure.amount_sign_strategy,
                    "fallback_strategy": column_structure.fallback_strategy,
                    "detection_details": column_structure.detection_details
                },
                "raw_transactions": len(transactions),
                "validated_transactions": len(validated_transactions),
                "original_values_preservation": {
                    "transactions_with_original_credit": transactions_with_credit,
                    "transactions_with_original_debit": transactions_with_debit,
                    "transactions_with_original_amount": transactions_with_amount,
                    "total_with_original_values": len([t for t in validated_transactions 
                                                     if any(t.get(field) is not None 
                                                           for field in ['original_credit', 'original_debit', 'original_amount'])])
                },
                "original_structure_preserved": self.preserve_original_data and original_structure is not None,
                "original_headers_count": len(original_structure.original_headers) if original_structure else 0,
                "original_data_rows": len(original_data) if original_data else 0,
                "backward_compatibility_mode": not self.preserve_original_data
            }
            
            if self.debug:
                logger.debug(f"Table extraction completed: {len(validated_transactions)} transactions in {processing_time:.2f}s")
                if original_structure:
                    logger.debug(f"Original structure preserved: {len(original_structure.original_headers)} headers")
                else:
                    logger.debug("Original structure preservation disabled (backward compatibility mode)")
            
            return ExtractionResult(
                transactions=validated_transactions,
                method=ExtractionMethod.TABLE_BASED,
                metadata=metadata,
                processing_time=processing_time,
                success=True,
                original_structure=original_structure if self.preserve_original_data else None,
                original_data=original_data if self.preserve_original_data else None,
                original_table=original_table
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"Error in table extraction: {e}")
            
            return ExtractionResult(
                transactions=[],
                method=ExtractionMethod.TABLE_BASED,
                metadata={"error": str(e)},
                processing_time=processing_time,
                success=False,
                error_message=str(e)
            )
    
    def extract_from_text(self, text: str) -> ExtractionResult:
        """
        Extract transactions from unstructured text with original formatting preservation.
        
        Args:
            text: Raw text content from document
            
        Returns:
            ExtractionResult with extracted transactions, metadata, and original text structure
        """
        start_time = time.time()
        
        if not text or len(text.strip()) < 10:
            return ExtractionResult(
                transactions=[],
                method=ExtractionMethod.TEXT_BASED,
                metadata={"error": "Insufficient text content"},
                processing_time=0.0,
                success=False,
                error_message="Text content is too short or empty"
            )
        
        try:
            if self.debug:
                logger.debug(f"Processing text content: {len(text)} characters")
            
            # Conditionally preserve original text structure
            original_structure = None
            original_data = None
            
            if self.preserve_original_data:
                original_structure = self._extract_text_structure(text)
                original_data = self._extract_original_text_data(text)
            
            # Create AI prompt for text extraction
            prompt = self._create_text_extraction_prompt(text)
            
            # Extract transactions using AI
            transactions, original_table = self._extract_with_groq(prompt, "text extraction")
            
            # Conditionally enhance transactions with original text mapping
            if self.preserve_original_data and original_data and original_structure:
                enhanced_transactions = self._enhance_transactions_with_original_text(
                    transactions, original_data, text
                )
            else:
                enhanced_transactions = transactions
            
            # Validate and enhance transactions
            validated_transactions = self._validate_transactions(enhanced_transactions)
            
            processing_time = time.time() - start_time
            
            # Calculate original values preservation statistics
            transactions_with_credit = sum(1 for t in validated_transactions if t.get('original_credit') is not None)
            transactions_with_debit = sum(1 for t in validated_transactions if t.get('original_debit') is not None)
            transactions_with_amount = sum(1 for t in validated_transactions if t.get('original_amount') is not None)
            
            metadata = {
                "text_length": len(text),
                "raw_transactions": len(transactions),
                "validated_transactions": len(validated_transactions),
                "text_sample": text[:200] + "..." if len(text) > 200 else text,
                "original_values_preservation": {
                    "transactions_with_original_credit": transactions_with_credit,
                    "transactions_with_original_debit": transactions_with_debit,
                    "transactions_with_original_amount": transactions_with_amount,
                    "total_with_original_values": len([t for t in validated_transactions 
                                                     if any(t.get(field) is not None 
                                                           for field in ['original_credit', 'original_debit', 'original_amount'])])
                },
                "original_structure_preserved": self.preserve_original_data and original_structure is not None,
                "original_text_lines": len(text.split('\n')) if self.preserve_original_data else 0,
                "original_data_entries": len(original_data) if original_data else 0,
                "backward_compatibility_mode": not self.preserve_original_data
            }
            
            if self.debug:
                logger.debug(f"Text extraction completed: {len(validated_transactions)} transactions in {processing_time:.2f}s")
                if original_structure:
                    text_lines = text.split('\n')
                    logger.debug(f"Original text structure preserved: {len(text_lines)} lines")
                else:
                    logger.debug("Original text structure preservation disabled (backward compatibility mode)")
            
            return ExtractionResult(
                transactions=validated_transactions,
                method=ExtractionMethod.TEXT_BASED,
                metadata=metadata,
                processing_time=processing_time,
                success=True,
                original_structure=original_structure if self.preserve_original_data else None,
                original_data=original_data if self.preserve_original_data else None,
                original_table=original_table
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"Error in text extraction: {e}")
            
            return ExtractionResult(
                transactions=[],
                method=ExtractionMethod.TEXT_BASED,
                metadata={"error": str(e)},
                processing_time=processing_time,
                success=False,
                error_message=str(e)
            )
    
    def detect_column_structure(self, tables: List[pd.DataFrame]) -> ColumnStructure:
        """
        Enhanced column structure detection with improved credit/debit identification,
        confidence scoring, and fallback strategies.
        
        Args:
            tables: List of pandas DataFrames
            
        Returns:
            ColumnStructure with enhanced column information
        """
        if not tables:
            return ColumnStructure(
                date_columns=[],
                description_columns=[],
                debit_columns=[],
                credit_columns=[],
                amount_columns=[],
                balance_columns=[],
                has_separate_debit_credit=False,
                confidence=0.0,
                debit_keywords=[],
                credit_keywords=[],
                amount_sign_strategy="heuristics",
                fallback_strategy="description_patterns",
                detection_details={"error": "No tables provided"}
            )
        
        detection_details = {
            "tables_analyzed": len(tables),
            "total_columns": 0,
            "column_analysis": [],
            "fallback_used": False,
            "detection_method": "primary"
        }
        
        # Primary detection: Analyze column headers
        primary_result = self._detect_columns_by_headers(tables, detection_details)
        
        # If primary detection has low confidence, try fallback strategies
        if primary_result.confidence < 0.6:
            detection_details["fallback_used"] = True
            fallback_result = self._apply_fallback_strategies(tables, primary_result, detection_details)
            return fallback_result
        
        return primary_result
    
    def _detect_columns_by_headers(self, tables: List[pd.DataFrame], detection_details: Dict) -> ColumnStructure:
        """
        Primary column detection method using header analysis.
        """
        # Collect all column headers with their table context
        column_info = []
        for table_idx, table in enumerate(tables):
            for col_idx, col_name in enumerate(table.columns):
                column_info.append({
                    'table_idx': table_idx,
                    'col_idx': col_idx,
                    'global_idx': len(column_info),
                    'name': str(col_name).lower().strip(),
                    'original_name': str(col_name),
                    'data_sample': self._get_column_data_sample(table, col_idx)
                })
        
        detection_details["total_columns"] = len(column_info)
        detection_details["column_analysis"] = column_info
        
        # Enhanced column classification
        date_columns = []
        description_columns = []
        debit_columns = []
        credit_columns = []
        amount_columns = []
        balance_columns = []
        
        debit_keywords_found = []
        credit_keywords_found = []
        
        for col_info in column_info:
            column_type, keywords = self._classify_column_enhanced(col_info)
            global_idx = col_info['global_idx']
            
            if column_type == ColumnType.DATE:
                date_columns.append(global_idx)
            elif column_type == ColumnType.DESCRIPTION:
                description_columns.append(global_idx)
            elif column_type == ColumnType.DEBIT:
                debit_columns.append(global_idx)
                debit_keywords_found.extend(keywords)
            elif column_type == ColumnType.CREDIT:
                credit_columns.append(global_idx)
                credit_keywords_found.extend(keywords)
            elif column_type == ColumnType.AMOUNT:
                amount_columns.append(global_idx)
            elif column_type == ColumnType.BALANCE:
                balance_columns.append(global_idx)
        
        # Determine strategy and confidence
        has_separate_debit_credit = len(debit_columns) > 0 and len(credit_columns) > 0
        
        if has_separate_debit_credit:
            amount_sign_strategy = "columns"
        elif len(amount_columns) > 0:
            amount_sign_strategy = "hybrid"
        else:
            amount_sign_strategy = "heuristics"
        
        # Enhanced confidence calculation
        confidence = self._calculate_enhanced_confidence(
            date_columns, description_columns, debit_columns, 
            credit_columns, amount_columns, balance_columns,
            column_info, detection_details
        )
        
        if self.debug:
            logger.debug(f"Enhanced column detection - Strategy: {amount_sign_strategy}, "
                        f"Confidence: {confidence:.2f}, Separate D/C: {has_separate_debit_credit}")
            logger.debug(f"Columns - Date: {date_columns}, Desc: {description_columns}, "
                        f"Debit: {debit_columns}, Credit: {credit_columns}")
        
        return ColumnStructure(
            date_columns=date_columns,
            description_columns=description_columns,
            debit_columns=debit_columns,
            credit_columns=credit_columns,
            amount_columns=amount_columns,
            balance_columns=balance_columns,
            has_separate_debit_credit=has_separate_debit_credit,
            confidence=confidence,
            debit_keywords=list(set(debit_keywords_found)),
            credit_keywords=list(set(credit_keywords_found)),
            amount_sign_strategy=amount_sign_strategy,
            fallback_strategy=None,
            detection_details=detection_details
        )
    
    def _get_column_data_sample(self, table: pd.DataFrame, col_idx: int) -> List[str]:
        """
        Get a sample of data from a column for analysis.
        """
        try:
            column_data = table.iloc[:, col_idx]
            # Get first 5 non-null values as strings
            sample = []
            for value in column_data.dropna().head(10):
                str_value = str(value).strip()
                if str_value and str_value.lower() not in ['nan', 'none', '']:
                    sample.append(str_value)
                if len(sample) >= 5:
                    break
            return sample
        except Exception:
            return []
    
    def _classify_column_enhanced(self, col_info: Dict) -> Tuple[ColumnType, List[str]]:
        """
        Enhanced column classification using both header names and data patterns.
        
        Returns:
            Tuple of (ColumnType, keywords_matched)
        """
        column_name = col_info['name']
        data_sample = col_info['data_sample']
        keywords_matched = []
        
        # First, try header-based classification
        for column_type, patterns in self.column_patterns.items():
            for pattern in patterns:
                if pattern.search(column_name):
                    keywords_matched.append(pattern.pattern)
                    return getattr(ColumnType, column_type.upper()), keywords_matched
        
        # If header classification fails, analyze data patterns
        if data_sample:
            data_type = self._analyze_data_patterns(data_sample)
            if data_type != ColumnType.UNKNOWN:
                return data_type, keywords_matched
        
        return ColumnType.UNKNOWN, keywords_matched
    
    def _analyze_data_patterns(self, data_sample: List[str]) -> ColumnType:
        """
        Analyze data patterns to infer column type.
        """
        if not data_sample:
            return ColumnType.UNKNOWN
        
        # Date pattern detection
        date_patterns = [
            r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}',
            r'\d{4}[/-]\d{1,2}[/-]\d{1,2}',
            r'\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)',
            r'\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)'
        ]
        
        # Amount pattern detection
        amount_patterns = [
            r'^\$?\d{1,3}(,\d{3})*(\.\d{2})?$',
            r'^\d+\.\d{2}$',
            r'^\d+,\d{2}$'
        ]
        
        date_matches = 0
        amount_matches = 0
        
        for sample in data_sample:
            # Check date patterns
            for pattern in date_patterns:
                if re.search(pattern, sample, re.IGNORECASE):
                    date_matches += 1
                    break
            
            # Check amount patterns
            for pattern in amount_patterns:
                if re.search(pattern, sample):
                    amount_matches += 1
                    break
        
        # Determine type based on pattern matches
        total_samples = len(data_sample)
        if date_matches / total_samples > 0.6:
            return ColumnType.DATE
        elif amount_matches / total_samples > 0.6:
            return ColumnType.AMOUNT
        
        return ColumnType.UNKNOWN
    
    def _apply_fallback_strategies(self, tables: List[pd.DataFrame], primary_result: ColumnStructure, detection_details: Dict) -> ColumnStructure:
        """
        Apply fallback strategies when primary detection has low confidence.
        """
        detection_details["detection_method"] = "fallback"
        
        # Strategy 1: Positional analysis
        if not primary_result.has_separate_debit_credit:
            positional_result = self._detect_by_position(tables, primary_result, detection_details)
            if positional_result.confidence > primary_result.confidence:
                positional_result.fallback_strategy = "positional_analysis"
                return positional_result
        
        # Strategy 2: Data content analysis
        content_result = self._detect_by_content_analysis(tables, primary_result, detection_details)
        if content_result.confidence > primary_result.confidence:
            content_result.fallback_strategy = "content_analysis"
            return content_result
        
        # Strategy 3: Default to heuristics-only approach
        primary_result.amount_sign_strategy = "heuristics"
        primary_result.fallback_strategy = "heuristics_only"
        primary_result.confidence = max(0.3, primary_result.confidence)  # Minimum confidence for heuristics
        
        return primary_result
    
    def _detect_by_position(self, tables: List[pd.DataFrame], primary_result: ColumnStructure, detection_details: Dict) -> ColumnStructure:
        """
        Fallback strategy: Detect columns by typical positions in bank statements.
        """
        # Common patterns: Date, Description, Debit, Credit, Balance
        # or: Date, Description, Amount, Balance
        
        enhanced_result = primary_result
        
        for table in tables:
            num_cols = len(table.columns)
            
            # Pattern recognition based on column count
            if num_cols >= 4:
                # Assume typical bank statement layout
                if not enhanced_result.date_columns and num_cols > 0:
                    enhanced_result.date_columns = [0]  # First column usually date
                
                if not enhanced_result.description_columns and num_cols > 1:
                    enhanced_result.description_columns = [1]  # Second column usually description
                
                # Look for two adjacent numeric columns (likely debit/credit)
                numeric_columns = self._find_numeric_columns(table)
                if len(numeric_columns) >= 2 and not enhanced_result.has_separate_debit_credit:
                    enhanced_result.debit_columns = [numeric_columns[0]]
                    enhanced_result.credit_columns = [numeric_columns[1]]
                    enhanced_result.has_separate_debit_credit = True
                    enhanced_result.amount_sign_strategy = "columns"
        
        # Recalculate confidence
        enhanced_result.confidence = self._calculate_enhanced_confidence(
            enhanced_result.date_columns, enhanced_result.description_columns,
            enhanced_result.debit_columns, enhanced_result.credit_columns,
            enhanced_result.amount_columns, enhanced_result.balance_columns,
            [], detection_details
        )
        
        return enhanced_result
    
    def _detect_by_content_analysis(self, tables: List[pd.DataFrame], primary_result: ColumnStructure, detection_details: Dict) -> ColumnStructure:
        """
        Fallback strategy: Analyze actual data content to identify column types.
        """
        enhanced_result = primary_result
        
        for table in tables:
            # Analyze each column's content
            for col_idx, column in enumerate(table.columns):
                col_data = table.iloc[:, col_idx].dropna()
                
                if len(col_data) == 0:
                    continue
                
                # Check if column contains mostly negative values (likely debit)
                numeric_values = []
                for value in col_data.head(20):
                    try:
                        # Try to parse as number
                        str_val = str(value).replace(',', '').replace('$', '').strip()
                        if str_val.startswith('(') and str_val.endswith(')'):
                            # Parentheses indicate negative
                            numeric_values.append(-float(str_val[1:-1]))
                        elif str_val.startswith('-'):
                            numeric_values.append(float(str_val))
                        else:
                            numeric_values.append(float(str_val))
                    except (ValueError, TypeError):
                        continue
                
                if len(numeric_values) > 5:
                    negative_ratio = sum(1 for v in numeric_values if v < 0) / len(numeric_values)
                    positive_ratio = sum(1 for v in numeric_values if v > 0) / len(numeric_values)
                    
                    # If mostly negative values, likely debit column
                    if negative_ratio > 0.7 and col_idx not in enhanced_result.debit_columns:
                        enhanced_result.debit_columns.append(col_idx)
                    # If mostly positive values, likely credit column
                    elif positive_ratio > 0.7 and col_idx not in enhanced_result.credit_columns:
                        enhanced_result.credit_columns.append(col_idx)
        
        # Update strategy if we found separate columns
        if enhanced_result.debit_columns and enhanced_result.credit_columns:
            enhanced_result.has_separate_debit_credit = True
            enhanced_result.amount_sign_strategy = "columns"
        
        # Recalculate confidence
        enhanced_result.confidence = self._calculate_enhanced_confidence(
            enhanced_result.date_columns, enhanced_result.description_columns,
            enhanced_result.debit_columns, enhanced_result.credit_columns,
            enhanced_result.amount_columns, enhanced_result.balance_columns,
            [], detection_details
        )
        
        return enhanced_result
    
    def _find_numeric_columns(self, table: pd.DataFrame) -> List[int]:
        """
        Find columns that contain primarily numeric data.
        """
        numeric_columns = []
        
        for col_idx, column in enumerate(table.columns):
            col_data = table.iloc[:, col_idx].dropna()
            
            if len(col_data) == 0:
                continue
            
            numeric_count = 0
            total_count = min(len(col_data), 20)  # Sample first 20 rows
            
            for value in col_data.head(total_count):
                try:
                    str_val = str(value).replace(',', '').replace('$', '').replace('(', '').replace(')', '').strip()
                    float(str_val)
                    numeric_count += 1
                except (ValueError, TypeError):
                    continue
            
            # If more than 70% of values are numeric, consider it a numeric column
            if numeric_count / total_count > 0.7:
                numeric_columns.append(col_idx)
        
        return numeric_columns
    
    def _classify_column(self, column_name: str) -> ColumnType:
        """Classify a column based on its name"""
        column_lower = column_name.lower().strip()
        
        # Check each column type pattern
        for column_type, patterns in self.column_patterns.items():
            for pattern in patterns:
                if pattern.search(column_lower):
                    return getattr(ColumnType, column_type.upper())
        
        return ColumnType.UNKNOWN
    
    def _calculate_enhanced_confidence(self, date_cols, desc_cols, debit_cols, credit_cols, amount_cols, balance_cols, column_info, detection_details) -> float:
        """
        Enhanced confidence calculation with multiple factors.
        """
        confidence = 0.0
        confidence_factors = []
        
        # Essential columns (40% of total confidence)
        if date_cols:
            confidence += 0.15
            confidence_factors.append("date_detected")
        if desc_cols:
            confidence += 0.15
            confidence_factors.append("description_detected")
        if debit_cols or credit_cols or amount_cols:
            confidence += 0.10
            confidence_factors.append("amount_columns_detected")
        
        # Column structure quality (30% of total confidence)
        if debit_cols and credit_cols:
            confidence += 0.20  # Separate debit/credit is ideal
            confidence_factors.append("separate_debit_credit")
        elif amount_cols:
            confidence += 0.10  # Single amount column is okay
            confidence_factors.append("single_amount_column")
        
        # Data quality indicators (20% of total confidence)
        if column_info:
            # Check if we have good data samples
            columns_with_data = sum(1 for col in column_info if col.get('data_sample'))
            if columns_with_data > 0:
                data_quality_score = min(0.15, columns_with_data * 0.03)
                confidence += data_quality_score
                confidence_factors.append(f"data_quality_{data_quality_score:.2f}")
        
        # Completeness bonus (10% of total confidence)
        total_expected_columns = 3  # Date, Description, Amount (minimum)
        detected_essential = len([x for x in [date_cols, desc_cols, (debit_cols or credit_cols or amount_cols)] if x])
        completeness_score = (detected_essential / total_expected_columns) * 0.10
        confidence += completeness_score
        confidence_factors.append(f"completeness_{completeness_score:.2f}")
        
        # Store confidence factors in detection details
        detection_details["confidence_factors"] = confidence_factors
        detection_details["confidence_breakdown"] = {
            "essential_columns": 0.15 * (1 if date_cols else 0) + 0.15 * (1 if desc_cols else 0) + 0.10 * (1 if (debit_cols or credit_cols or amount_cols) else 0),
            "structure_quality": 0.20 if (debit_cols and credit_cols) else (0.10 if amount_cols else 0),
            "data_quality": min(0.15, len(column_info) * 0.03) if column_info else 0,
            "completeness": completeness_score
        }
        
        return min(1.0, confidence)
    
    def _calculate_structure_confidence(self, date_cols, desc_cols, debit_cols, credit_cols, amount_cols, balance_cols) -> float:
        """Legacy confidence calculation method for backward compatibility"""
        return self._calculate_enhanced_confidence(
            date_cols, desc_cols, debit_cols, credit_cols, amount_cols, balance_cols, [], {}
        )
    
    def _format_tables_for_ai(self, tables: List[pd.DataFrame]) -> str:
        """Format tables for AI processing"""
        formatted_tables = []
        
        for i, table in enumerate(tables):
            # Limit table size for AI processing
            if len(table) > 50:
                table_sample = table.head(25).append(table.tail(25))
                formatted_tables.append(f"Table {i+1} (showing first/last 25 rows of {len(table)}):\n{table_sample.to_string()}")
            else:
                formatted_tables.append(f"Table {i+1}:\n{table.to_string()}")
        
        return "\n\n".join(formatted_tables)
    
    def _create_table_extraction_prompt(self, tables_str: str, column_structure: ColumnStructure) -> str:
        """Create AI prompt for table-based extraction with dual format output"""
        if column_structure.has_separate_debit_credit:
            return f"""Extract transactions from these bank statement tables and return BOTH normalized transactions AND the original table structure.

Return this EXACT JSON format:
```json
{{
  "transactions": [
    {{"date": "2025-01-01", "description": "example transaction", "amount": 100.0, "type": "debit", "original_credit": null, "original_debit": 100.0, "original_amount": null}}
  ],
  "originalTable": {{
    "headers": ["Fecha", "Concepto", "Debe", "Haber", "Saldo"],
    "rows": [
      ["10/02", "POS PURCHASE", "", "65.73", "828.74"],
      ["10/03", "DEPOSIT", "763.01", "", "1591.75"]
    ]
  }}
}}
```

NORMALIZED TRANSACTIONS RULES:
- Use the column structure to determine transaction type
- If amount appears in debit/cargo/debe columns → type: "debit"
- If amount appears in credit/abono/haber columns → type: "credit"
- Empty cells or zeros should be ignored
- Only extract actual transaction rows, skip headers and totals
- PRESERVE ORIGINAL VALUES: Extract separate credit and debit amounts from their respective columns

ORIGINAL TABLE RULES:
- headers: Extract the exact column names as they appear in the table
- rows: Preserve the exact data format and structure from each transaction row
- Keep empty cells as empty strings ""
- Maintain the same column order as in the original table
- Skip header rows and summary lines, only include transaction data rows

FIELD DEFINITIONS:
- amount: Final calculated amount (positive number)
- type: "debit" or "credit" based on which column has the value
- original_credit: Raw value from credit/abono/haber column (null if empty)
- original_debit: Raw value from debit/cargo/debe column (null if empty)  
- original_amount: Raw value from general amount column (null if separate debit/credit columns are used)

Tables with separate debit/credit columns:
{tables_str}
"""
        else:
            return f"""Extract transactions from these bank statement tables and return BOTH normalized transactions AND the original table structure.

Return this EXACT JSON format:
```json
{{
  "transactions": [
    {{"date": "2025-01-01", "description": "example transaction", "amount": 100.0, "type": "debit", "original_credit": null, "original_debit": null, "original_amount": 100.0}}
  ],
  "originalTable": {{
    "headers": ["Fecha", "Concepto", "Importe", "Saldo"],
    "rows": [
      ["10/02", "POS PURCHASE", "65.73", "828.74"],
      ["10/03", "DEPOSIT", "763.01", "1591.75"]
    ]
  }}
}}
```

NORMALIZED TRANSACTIONS RULES:
- Extract each transaction with date, description, amount, and type
- date: Keep the exact date format as it appears in the document (e.g. '10/02', '12/25', etc.)
- amount: Use positive numbers only
- type: "debit" for money out (negative amounts, payments, withdrawals), "credit" for money in (positive amounts, deposits)
- Skip header rows, totals, and summary lines
- PRESERVE ORIGINAL VALUES: Extract the raw amount value from the table

ORIGINAL TABLE RULES:
- headers: Extract the exact column names as they appear in the table
- rows: Preserve the exact data format and structure from each transaction row
- Keep empty cells as empty strings ""
- Maintain the same column order as in the original table
- Skip header rows and summary lines, only include transaction data rows

FIELD DEFINITIONS:
- amount: Final calculated amount (positive number)
- type: "debit" or "credit" based on transaction analysis
- original_credit: null (no separate credit column detected)
- original_debit: null (no separate debit column detected)
- original_amount: Raw amount value from the table (preserve original sign if present)

Tables:
{tables_str}
"""
    
    def _create_text_extraction_prompt(self, text: str) -> str:
        """Create AI prompt for text-based extraction with dual format output"""
        return f"""Extract transactions from this bank statement text and return BOTH normalized transactions AND the original table structure.

INSTRUCTIONS:
1. Extract normalized transactions with standardized fields
2. Extract the original table structure preserving the exact format as it appears in the PDF

Return this EXACT JSON format:
```json
{{
  "transactions": [
    {{"date": "2025-01-01", "description": "example transaction", "amount": 100.0, "type": "debit", "original_credit": null, "original_debit": null, "original_amount": 100.0}}
  ],
  "originalTable": {{
    "headers": ["Fecha", "Concepto", "Debe", "Haber", "Saldo"],
    "rows": [
      ["10/02", "POS PURCHASE", "", "65.73", "828.74"],
      ["10/03", "DEPOSIT", "763.01", "", "1591.75"]
    ]
  }}
}}
```

NORMALIZED TRANSACTIONS RULES:
- date: Standardize date format (YYYY-MM-DD preferred, but keep original if unclear)
- description: Clean and meaningful transaction description
- amount: Positive number only
- type: "debit" for money out, "credit" for money in
- original_credit/original_debit/original_amount: Raw values as they appear

ORIGINAL TABLE RULES:
- headers: Extract the exact column names as they appear in the document
- rows: Preserve the exact data format and structure from each transaction line
- Keep empty cells as empty strings ""
- Maintain the same column order as in the original document
- If the document doesn't have clear columns, create logical ones based on the data structure

TRANSACTION TYPE DETECTION:
- Look for negative amounts (-) or keywords like "pago", "retiro", "cargo", "withdrawal", "payment" = debit
- Look for positive amounts (+) or keywords like "deposito", "abono", "ingreso", "deposit", "income" = credit

Bank statement text:
{text}
"""
    
    def _extract_with_groq(self, prompt: str, operation_type: str) -> Tuple[List[Dict], Optional[Dict]]:
        """
        Extract transactions using Groq API with retry logic and consistent error handling.
        
        Args:
            prompt: AI prompt for extraction
            operation_type: Type of operation for logging
            
        Returns:
            List of extracted transactions
            
        Raises:
            Exception: If all retry attempts fail
        """
        max_retries = self.config.get("max_retries", 3)
        retry_delay = self.config.get("retry_delay", 1.0)
        
        last_error = None
        
        for attempt in range(max_retries):
            try:
                if self.debug:
                    logger.debug(f"[TransactionExtractor] Groq API call attempt {attempt + 1}/{max_retries} for {operation_type}")
                
                # Send progress update to stdout (matching existing pattern)
                print(f"🤖 GROQ API - Intento {attempt + 1}/{max_retries} para {operation_type}...")
                sys.stdout.flush()
                
                chat_completion = self.groq_client.chat.completions.create(
                    messages=[{"role": "user", "content": prompt}],
                    model=self.model,
                    temperature=self.config.get("temperature", 0.1),
                    max_tokens=self.config.get("max_tokens", 4000)
                )
                
                response_content = chat_completion.choices[0].message.content
                
                if self.debug:
                    logger.debug(f"[TransactionExtractor] Groq response length: {len(response_content)} characters")
                
                print(f"✅ GROQ RESPUESTA - Longitud: {len(response_content)} caracteres")
                
                # Extract JSON from response
                transactions, original_table = self._parse_groq_response(response_content)
                
                if self.debug:
                    logger.debug(f"[TransactionExtractor] Extracted {len(transactions)} transactions from Groq response")
                    # Log original values preservation
                    for i, transaction in enumerate(transactions[:3]):  # Log first 3 for debugging
                        logger.debug(f"Transaction {i+1} original values - "
                                   f"Credit: {transaction.get('original_credit')}, "
                                   f"Debit: {transaction.get('original_debit')}, "
                                   f"Amount: {transaction.get('original_amount')}")
                
                print(f"🎯 TRANSACCIONES EXTRAÍDAS: {len(transactions)}")
                
                # Log preservation of original values
                transactions_with_originals = sum(1 for t in transactions 
                                                if any(t.get(field) is not None 
                                                      for field in ['original_credit', 'original_debit', 'original_amount']))
                print(f"📊 VALORES ORIGINALES PRESERVADOS: {transactions_with_originals}/{len(transactions)} transacciones")
                
                # Log original table extraction
                if original_table:
                    headers_count = len(original_table.get('headers', []))
                    rows_count = len(original_table.get('rows', []))
                    print(f"📋 TABLA ORIGINAL EXTRAÍDA: {headers_count} columnas, {rows_count} filas")
                else:
                    print("⚠️  No se extrajo tabla original (formato legacy)")
                
                return transactions, original_table
                
            except groq.RateLimitError as e:
                last_error = f"Groq API rate limit exceeded: {e}"
                logger.warning(f"[TransactionExtractor] Rate limit on attempt {attempt + 1}: {e}")
                print(f"⚠️  LÍMITE DE VELOCIDAD GROQ - Esperando...")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (attempt + 2))  # Longer wait for rate limits
                    
            except groq.APIError as e:
                last_error = f"Groq API error: {e}"
                logger.warning(f"[TransactionExtractor] API error on attempt {attempt + 1}: {e}")
                print(f"❌ ERROR API GROQ: {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (attempt + 1))
                    
            except Exception as e:
                last_error = f"Unexpected error: {e}"
                logger.warning(f"[TransactionExtractor] Unexpected error on attempt {attempt + 1}: {e}")
                print(f"❌ ERROR INESPERADO: {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (attempt + 1))
        
        # All attempts failed
        error_msg = f"Groq API failed after {max_retries} attempts. Last error: {last_error}"
        logger.error(f"[TransactionExtractor] {error_msg}")
        print(f"💥 GROQ FALLÓ COMPLETAMENTE: {error_msg}")
        raise Exception(error_msg)
    
    def _parse_groq_response(self, response_content: str) -> Tuple[List[Dict], Optional[Dict]]:
        """Parse JSON response from Groq API and extract both transactions and original table"""
        # Look for dual format JSON block in response
        dual_json_match = re.search(r"```json\n(\{.*?\})\n```", response_content, re.DOTALL)
        
        if dual_json_match:
            try:
                full_response = json.loads(dual_json_match.group(1))
                if isinstance(full_response, dict) and 'transactions' in full_response:
                    # New dual format
                    transactions = full_response['transactions']
                    original_table = full_response.get('originalTable', None)
                    
                    if isinstance(transactions, list):
                        # Ensure all transactions have the required original value fields
                        enhanced_transactions = []
                        for transaction in transactions:
                            enhanced_transaction = self._ensure_original_fields(transaction)
                            enhanced_transactions.append(enhanced_transaction)
                        return enhanced_transactions, original_table
                    else:
                        logger.warning("Groq response transactions is not a list")
                        return [], original_table
                else:
                    logger.warning("Groq response does not contain transactions field")
                    return [], None
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse dual format JSON from Groq response: {e}")
        
        # Fallback: Look for legacy array format
        legacy_json_match = re.search(r"```json\n(\[.*?\])\n```", response_content, re.DOTALL)
        
        if legacy_json_match:
            try:
                transactions = json.loads(legacy_json_match.group(1))
                if isinstance(transactions, list):
                    # Ensure all transactions have the required original value fields
                    enhanced_transactions = []
                    for transaction in transactions:
                        enhanced_transaction = self._ensure_original_fields(transaction)
                        enhanced_transactions.append(enhanced_transaction)
                    return enhanced_transactions, None
                else:
                    logger.warning("Groq legacy response is not a list")
                    return [], None
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse legacy JSON from Groq response: {e}")
                return [], None
        else:
            # Try to find JSON without code blocks
            try:
                # Look for array pattern (legacy)
                array_match = re.search(r'\[.*?\]', response_content, re.DOTALL)
                if array_match:
                    transactions = json.loads(array_match.group(0))
                    if isinstance(transactions, list):
                        # Ensure all transactions have the required original value fields
                        enhanced_transactions = []
                        for transaction in transactions:
                            enhanced_transaction = self._ensure_original_fields(transaction)
                            enhanced_transactions.append(enhanced_transaction)
                        return enhanced_transactions, None
            except json.JSONDecodeError:
                pass
            
            logger.warning("No valid JSON found in Groq response")
            return [], None
    
    def _ensure_original_fields(self, transaction: Dict) -> Dict:
        """
        Ensure transaction has all required original value fields and enhanced metadata.
        
        Args:
            transaction: Raw transaction from AI response
            
        Returns:
            Enhanced transaction with guaranteed original value fields and metadata
        """
        enhanced = transaction.copy()
        
        # Ensure original value fields exist
        if 'original_credit' not in enhanced:
            enhanced['original_credit'] = None
        if 'original_debit' not in enhanced:
            enhanced['original_debit'] = None
        if 'original_amount' not in enhanced:
            enhanced['original_amount'] = None
            
        # Ensure original_data field exists (will be populated later)
        if 'original_data' not in enhanced:
            enhanced['original_data'] = {}
            
        # Add sign detection method metadata
        if 'sign_detection_method' not in enhanced:
            # Determine method based on available original values
            if enhanced['original_credit'] is not None or enhanced['original_debit'] is not None:
                enhanced['sign_detection_method'] = 'columns'
            else:
                enhanced['sign_detection_method'] = 'heuristics'
        
        # Add confidence score if not present
        if 'confidence' not in enhanced:
            enhanced['confidence'] = self._calculate_extraction_confidence(enhanced)
            
        # Add structure metadata placeholder (will be enhanced later)
        if 'structure_metadata' not in enhanced:
            enhanced['structure_metadata'] = {
                'has_original_data': bool(enhanced.get('original_data')),
                'extraction_method': 'ai_based',
                'confidence_score': enhanced['confidence']
            }
        
        # Add transformation metadata
        enhanced['transformation_metadata'] = {
            'normalized_amount': enhanced.get('amount'),
            'normalized_type': enhanced.get('type'),
            'original_values_preserved': any([
                enhanced['original_credit'] is not None,
                enhanced['original_debit'] is not None, 
                enhanced['original_amount'] is not None
            ]),
            'transformation_applied': True,
            'preservation_quality': self._calculate_preservation_quality(enhanced)
        }
        
        if self.debug:
            logger.debug(f"Enhanced transaction with original fields: {enhanced.get('description', 'Unknown')[:50]}...")
            logger.debug(f"Original values - Credit: {enhanced['original_credit']}, "
                        f"Debit: {enhanced['original_debit']}, Amount: {enhanced['original_amount']}")
            logger.debug(f"Preservation quality: {enhanced['transformation_metadata']['preservation_quality']:.2f}")
        
        return enhanced
    
    def _calculate_extraction_confidence(self, transaction: Dict) -> float:
        """
        Calculate confidence score for extracted transaction based on available data.
        
        Args:
            transaction: Transaction dictionary
            
        Returns:
            Confidence score between 0.0 and 1.0
        """
        confidence = 0.0
        
        # Base confidence for having required fields
        if transaction.get('date'):
            confidence += 0.25
        if transaction.get('description'):
            confidence += 0.25
        if transaction.get('amount') is not None:
            confidence += 0.25
        if transaction.get('type'):
            confidence += 0.25
        
        # Bonus for having original values (better for debugging)
        original_values_count = sum(1 for field in ['original_credit', 'original_debit', 'original_amount'] 
                                  if transaction.get(field) is not None)
        if original_values_count > 0:
            confidence += 0.1 * original_values_count
        
        # Cap at 1.0
        return min(confidence, 1.0)
    
    def _calculate_preservation_quality(self, transaction: Dict) -> float:
        """
        Calculate the quality of original data preservation for a transaction.
        
        Args:
            transaction: Enhanced transaction with original fields
            
        Returns:
            Quality score between 0.0 and 1.0
        """
        quality = 0.0
        
        # Base quality for having normalized fields
        if transaction.get('amount') is not None:
            quality += 0.3
        if transaction.get('type'):
            quality += 0.2
        if transaction.get('date'):
            quality += 0.2
        if transaction.get('description'):
            quality += 0.2
        
        # Bonus for original value preservation
        original_fields = ['original_credit', 'original_debit', 'original_amount']
        preserved_count = sum(1 for field in original_fields if transaction.get(field) is not None)
        quality += (preserved_count / len(original_fields)) * 0.1
        
        return min(quality, 1.0)
    
    def _calculate_preservation_confidence(self, transaction: Dict, original_structure: OriginalStructure) -> float:
        """
        Calculate confidence score for data preservation quality.
        
        Args:
            transaction: Enhanced transaction
            original_structure: Original structure metadata
            
        Returns:
            Confidence score between 0.0 and 1.0
        """
        confidence = 0.0
        
        # Base confidence from structure detection
        confidence += original_structure.confidence_score * 0.4
        
        # Confidence from original data mapping
        if transaction.get('original_data'):
            mapped_columns = len(transaction['original_data'])
            total_columns = len(original_structure.original_headers)
            if total_columns > 0:
                mapping_ratio = mapped_columns / total_columns
                confidence += mapping_ratio * 0.3
        
        # Confidence from transaction completeness
        required_fields = ['date', 'description', 'amount', 'type']
        present_fields = sum(1 for field in required_fields if transaction.get(field))
        confidence += (present_fields / len(required_fields)) * 0.3
        
        return min(confidence, 1.0)
    
    def _calculate_text_preservation_quality(self, transaction: Dict, original_text: str) -> float:
        """
        Calculate the quality of text preservation for a transaction.
        
        Args:
            transaction: Enhanced transaction
            original_text: Original text content
            
        Returns:
            Quality score between 0.0 and 1.0
        """
        quality = 0.0
        
        # Base quality for having original line
        if transaction.get('original_data', {}).get('original_line'):
            quality += 0.4
        
        # Quality for having parsed columns
        parsed_columns = transaction.get('original_data', {}).get('parsed_columns_count', 0)
        if parsed_columns > 0:
            quality += min(0.3, parsed_columns * 0.1)
        
        # Quality for transaction completeness
        required_fields = ['date', 'description', 'amount', 'type']
        present_fields = sum(1 for field in required_fields if transaction.get(field))
        quality += (present_fields / len(required_fields)) * 0.3
        
        return min(quality, 1.0)
    
    def _calculate_text_preservation_confidence(self, transaction: Dict, original_text: str) -> float:
        """
        Calculate confidence score for text preservation.
        
        Args:
            transaction: Enhanced transaction
            original_text: Original text content
            
        Returns:
            Confidence score between 0.0 and 1.0
        """
        confidence = 0.0
        
        # Base confidence from text structure
        confidence += 0.3  # Default text confidence
        
        # Confidence from original line mapping
        if transaction.get('original_data', {}).get('original_line'):
            confidence += 0.4
        
        # Confidence from transaction quality
        quality = self._calculate_text_preservation_quality(transaction, original_text)
        confidence += quality * 0.3
        
        return min(confidence, 1.0)
    
    def _extract_original_structure(self, tables: List[pd.DataFrame]) -> OriginalStructure:
        """
        Extract and preserve original table structure information.
        
        Args:
            tables: List of pandas DataFrames
            
        Returns:
            OriginalStructure with preserved metadata
        """
        original_headers = []
        column_types = {}
        column_order = []
        
        for table_idx, table in enumerate(tables):
            for col_name in table.columns:
                original_name = str(col_name)
                if original_name not in original_headers:
                    original_headers.append(original_name)
                    column_order.append(original_name)
                    
                    # Infer column type from data
                    col_data = table[col_name].dropna()
                    if len(col_data) > 0:
                        column_types[original_name] = self._infer_column_type(col_data)
                    else:
                        column_types[original_name] = "unknown"
        
        # Calculate confidence based on structure detection
        column_structure = self.detect_column_structure(tables)
        
        return OriginalStructure(
            original_headers=original_headers,
            column_types=column_types,
            column_order=column_order,
            table_count=len(tables),
            confidence_score=column_structure.confidence,
            extraction_method="table_based"
        )
    
    def _extract_original_data(self, tables: List[pd.DataFrame]) -> List[Dict]:
        """
        Extract original data from tables preserving exact column names and values.
        
        Args:
            tables: List of pandas DataFrames
            
        Returns:
            List of dictionaries with original column names and values
        """
        original_data = []
        
        for table_idx, table in enumerate(tables):
            for row_idx, row in table.iterrows():
                row_data = {
                    "_table_index": table_idx,
                    "_row_index": row_idx
                }
                
                # Preserve original column names and values
                for col_name in table.columns:
                    original_value = row[col_name]
                    # Convert to string to preserve formatting, handle NaN
                    if pd.isna(original_value):
                        row_data[str(col_name)] = None
                    else:
                        row_data[str(col_name)] = str(original_value)
                
                original_data.append(row_data)
        
        return original_data
    
    def _extract_text_structure(self, text: str) -> OriginalStructure:
        """
        Extract and preserve original text structure information.
        
        Args:
            text: Raw text content
            
        Returns:
            OriginalStructure with text-based metadata
        """
        lines = text.split('\n')
        
        # Analyze text patterns to identify potential columns
        potential_headers = []
        column_types = {}
        
        # Look for header-like patterns in first few lines
        for line in lines[:10]:
            if line.strip():
                # Split by common delimiters
                parts = re.split(r'[\t\s]{2,}|[|,;]', line.strip())
                if len(parts) > 1:
                    for part in parts:
                        clean_part = part.strip()
                        if clean_part and len(clean_part) < 50:  # Reasonable header length
                            if clean_part not in potential_headers:
                                potential_headers.append(clean_part)
                                column_types[clean_part] = "text"
        
        return OriginalStructure(
            original_headers=potential_headers,
            column_types=column_types,
            column_order=potential_headers,
            table_count=1,  # Text is treated as one table
            confidence_score=0.7,  # Default confidence for text
            extraction_method="text_based"
        )
    
    def _extract_original_text_data(self, text: str) -> List[Dict]:
        """
        Extract original text data preserving formatting and structure.
        
        Args:
            text: Raw text content
            
        Returns:
            List of dictionaries with original text structure
        """
        lines = text.split('\n')
        original_data = []
        
        for line_idx, line in enumerate(lines):
            if line.strip():  # Skip empty lines
                line_data = {
                    "_line_index": line_idx,
                    "_original_line": line,
                    "_line_content": line.strip()
                }
                
                # Try to parse structured data from line
                parts = re.split(r'[\t\s]{2,}|[|,;]', line.strip())
                if len(parts) > 1:
                    for part_idx, part in enumerate(parts):
                        line_data[f"column_{part_idx}"] = part.strip()
                
                original_data.append(line_data)
        
        return original_data
    
    def _enhance_transactions_with_original_data(self, transactions: List[Dict], 
                                               original_data: List[Dict], 
                                               original_structure: OriginalStructure) -> List[Dict]:
        """
        Enhance transactions with original data mapping and comprehensive metadata.
        
        Args:
            transactions: Extracted transactions
            original_data: Original table data
            original_structure: Original structure metadata
            
        Returns:
            Enhanced transactions with original data fields and metadata
        """
        enhanced_transactions = []
        
        for transaction in transactions:
            enhanced_transaction = transaction.copy()
            
            # Add original data field containing raw column values
            enhanced_transaction['original_data'] = {}
            
            # Try to find matching original data row
            matching_row = self._find_matching_original_row(transaction, original_data)
            if matching_row:
                # Include all original column values
                for header in original_structure.original_headers:
                    if header in matching_row:
                        enhanced_transaction['original_data'][header] = matching_row[header]
                
                # Add row metadata
                enhanced_transaction['original_data']['_source_table'] = matching_row.get('_table_index', 0)
                enhanced_transaction['original_data']['_source_row'] = matching_row.get('_row_index', 0)
            
            # Add comprehensive structure metadata
            enhanced_transaction['structure_metadata'] = {
                'original_headers': original_structure.original_headers,
                'column_types': original_structure.column_types,
                'column_order': original_structure.column_order,
                'table_count': original_structure.table_count,
                'extraction_confidence': original_structure.confidence_score,
                'extraction_method': original_structure.extraction_method,
                'has_original_mapping': bool(matching_row),
                'original_columns_count': len(original_structure.original_headers),
                'preserved_columns_count': len([h for h in original_structure.original_headers 
                                              if h in enhanced_transaction['original_data']])
            }
            
            # Add preservation statistics
            enhanced_transaction['preservation_stats'] = {
                'original_data_available': bool(matching_row),
                'columns_preserved': len(enhanced_transaction['original_data']),
                'preservation_ratio': (len(enhanced_transaction['original_data']) / 
                                     max(1, len(original_structure.original_headers))),
                'confidence_score': self._calculate_preservation_confidence(
                    enhanced_transaction, original_structure
                )
            }
            
            enhanced_transactions.append(enhanced_transaction)
        
        return enhanced_transactions
    
    def _enhance_transactions_with_original_text(self, transactions: List[Dict], 
                                               original_data: List[Dict], 
                                               original_text: str) -> List[Dict]:
        """
        Enhance transactions with original text mapping and comprehensive metadata.
        
        Args:
            transactions: Extracted transactions
            original_data: Original text data
            original_text: Original text content
            
        Returns:
            Enhanced transactions with original text fields and metadata
        """
        enhanced_transactions = []
        text_lines = original_text.split('\n')
        
        for transaction in transactions:
            enhanced_transaction = transaction.copy()
            
            # Add original data field containing text formatting
            enhanced_transaction['original_data'] = {}
            
            # Try to find matching original text line
            matching_line = self._find_matching_text_line(transaction, original_data)
            if matching_line:
                enhanced_transaction['original_data']['original_line'] = matching_line.get('_original_line', '')
                enhanced_transaction['original_data']['line_content'] = matching_line.get('_line_content', '')
                enhanced_transaction['original_data']['line_index'] = matching_line.get('_line_index', -1)
                
                # Include parsed columns if available
                column_count = 0
                for key, value in matching_line.items():
                    if key.startswith('column_'):
                        enhanced_transaction['original_data'][key] = value
                        column_count += 1
                
                enhanced_transaction['original_data']['parsed_columns_count'] = column_count
            
            # Add comprehensive text structure metadata
            enhanced_transaction['structure_metadata'] = {
                'extraction_method': 'text_based',
                'original_text_length': len(original_text),
                'text_lines_count': len(text_lines),
                'non_empty_lines': len([line for line in text_lines if line.strip()]),
                'has_original_mapping': bool(matching_line),
                'text_preservation_quality': self._calculate_text_preservation_quality(
                    enhanced_transaction, original_text
                )
            }
            
            # Add preservation statistics for text
            enhanced_transaction['preservation_stats'] = {
                'original_data_available': bool(matching_line),
                'original_line_preserved': bool(enhanced_transaction['original_data'].get('original_line')),
                'parsed_columns_available': enhanced_transaction['original_data'].get('parsed_columns_count', 0) > 0,
                'confidence_score': self._calculate_text_preservation_confidence(
                    enhanced_transaction, original_text
                )
            }
            
            enhanced_transactions.append(enhanced_transaction)
        
        return enhanced_transactions
    
    def _find_matching_original_row(self, transaction: Dict, original_data: List[Dict]) -> Optional[Dict]:
        """
        Find the original data row that matches the extracted transaction.
        
        Args:
            transaction: Extracted transaction
            original_data: List of original data rows
            
        Returns:
            Matching original data row or None
        """
        transaction_desc = transaction.get('description', '').lower()
        transaction_amount = transaction.get('amount', 0)
        
        for row in original_data:
            # Try to match by description similarity
            for col_name, col_value in row.items():
                if col_name.startswith('_'):  # Skip metadata columns
                    continue
                    
                if col_value and isinstance(col_value, str):
                    if transaction_desc in col_value.lower() or col_value.lower() in transaction_desc:
                        return row
            
            # Try to match by amount
            for col_name, col_value in row.items():
                if col_name.startswith('_'):
                    continue
                    
                if col_value:
                    try:
                        # Clean and parse amount
                        clean_value = str(col_value).replace(',', '').replace('$', '').strip()
                        if clean_value.startswith('(') and clean_value.endswith(')'):
                            clean_value = clean_value[1:-1]
                        
                        amount = abs(float(clean_value))
                        if abs(amount - transaction_amount) < 0.01:  # Close match
                            return row
                    except (ValueError, TypeError):
                        continue
        
        return None
    
    def _find_matching_text_line(self, transaction: Dict, original_data: List[Dict]) -> Optional[Dict]:
        """
        Find the original text line that matches the extracted transaction.
        
        Args:
            transaction: Extracted transaction
            original_data: List of original text data
            
        Returns:
            Matching original text line or None
        """
        transaction_desc = transaction.get('description', '').lower().replace(' ', '').replace('-', '').replace('_', '')
        transaction_date = str(transaction.get('date', '')).strip()
        transaction_amount = transaction.get('amount', 0)
        
        best_match = None
        best_score = 0
        
        for line_data in original_data:
            line_content = line_data.get('_line_content', '').lower()
            score = 0
            
            # 1. Check date matching (high priority)
            if transaction_date and transaction_date in line_content:
                score += 50
            
            # 2. Check amount matching (high priority)  
            amount_str = str(transaction_amount)
            if amount_str in line_content or f"{transaction_amount:.2f}" in line_content:
                score += 40
            
            # 3. Check description matching with fuzzy logic
            line_desc = line_content.replace(' ', '').replace('-', '').replace('_', '')
            
            # Exact description match (after normalization)
            if transaction_desc and transaction_desc in line_desc:
                score += 30
            elif line_desc and line_desc in transaction_desc:
                score += 25
            else:
                # Fuzzy matching: check if key words match
                trans_words = set(transaction_desc.split())
                line_words = set(line_desc.split())
                if trans_words and line_words:
                    common_words = trans_words.intersection(line_words)
                    if common_words:
                        score += len(common_words) * 10
            
            # 4. If we have a good match, return it
            if score > best_score:
                best_score = score
                best_match = line_data
                
            # If we have a very strong match (date + amount + some description), use it immediately
            if score >= 90:
                break
        
        # Return best match if it's reasonably good
        return best_match if best_score >= 40 else None
    
    def _infer_column_type(self, col_data: pd.Series) -> str:
        """
        Infer the type of a column based on its data.
        
        Args:
            col_data: Pandas Series with column data
            
        Returns:
            String representing the inferred type
        """
        # Sample first few values
        sample_values = col_data.head(10).astype(str).tolist()
        
        # Check for date patterns
        date_patterns = [
            r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}',
            r'\d{4}[/-]\d{1,2}[/-]\d{1,2}'
        ]
        
        date_matches = 0
        for value in sample_values:
            for pattern in date_patterns:
                if re.search(pattern, value):
                    date_matches += 1
                    break
        
        if date_matches / len(sample_values) > 0.5:
            return "date"
        
        # Check for numeric patterns
        numeric_count = 0
        for value in sample_values:
            try:
                float(str(value).replace(',', '').replace('$', '').strip())
                numeric_count += 1
            except (ValueError, TypeError):
                pass
        
        if numeric_count / len(sample_values) > 0.7:
            return "numeric"
        
        # Default to text
        return "text"
    
    def _validate_transactions(self, transactions: List[Dict]) -> List[Dict]:
        """
        Validate and enhance extracted transactions.
        IMPORTANT: Preserve all transactions to maintain count consistency with original data.
        
        Args:
            transactions: List of raw transactions from AI
            
        Returns:
            List of validated and enhanced transactions (same count as input)
        """
        validated_transactions = []
        
        for i, transaction in enumerate(transactions):
            try:
                # Validate transaction
                validation_result = self.validation_service.validate_transaction(transaction)
                
                if validation_result.is_valid:
                    # Enhance valid transaction
                    enhanced_transaction = self.validation_service.enhance_transaction(transaction)
                    validated_transactions.append(enhanced_transaction)
                    
                    if self.debug:
                        logger.debug(f"Transaction {i+1} validated successfully (quality: {validation_result.quality_score:.2f})")
                else:
                    # PRESERVE invalid transactions with validation metadata to maintain count consistency
                    invalid_transaction = transaction.copy()
                    invalid_transaction['_validation_status'] = 'invalid'
                    invalid_transaction['_validation_errors'] = validation_result.errors
                    invalid_transaction['_quality_score'] = validation_result.quality_score
                    
                    # Apply basic enhancement even for invalid transactions
                    try:
                        enhanced_invalid = self.validation_service.enhance_transaction(invalid_transaction)
                        validated_transactions.append(enhanced_invalid)
                    except Exception:
                        # If enhancement fails, append original with validation metadata
                        validated_transactions.append(invalid_transaction)
                    
                    if self.debug:
                        logger.debug(f"Transaction {i+1} validation failed but preserved: {validation_result.errors}")
                    
            except Exception as e:
                logger.warning(f"Error validating transaction {i+1}: {e}")
                # Even on exception, preserve the transaction with error metadata
                error_transaction = transaction.copy()
                error_transaction['_validation_status'] = 'error'
                error_transaction['_validation_error'] = str(e)
                validated_transactions.append(error_transaction)
        
        return validated_transactions


# Convenience functions for standalone usage
def extract_from_tables(tables: List[pd.DataFrame], config_path: Optional[str] = None, debug: bool = False, preserve_original_data: bool = True) -> ExtractionResult:
    """
    Standalone function to extract transactions from tables.
    
    Args:
        tables: List of pandas DataFrames
        config_path: Optional path to configuration file
        debug: Enable debug logging
        preserve_original_data: Enable original data preservation (default: True)
        
    Returns:
        ExtractionResult object
    """
    service = TransactionExtractorService(config_path, debug, preserve_original_data)
    return service.extract_from_tables(tables)


def extract_from_text(text: str, config_path: Optional[str] = None, debug: bool = False, preserve_original_data: bool = True) -> ExtractionResult:
    """
    Standalone function to extract transactions from text.
    
    Args:
        text: Raw text content
        config_path: Optional path to configuration file
        debug: Enable debug logging
        preserve_original_data: Enable original data preservation (default: True)
        
    Returns:
        ExtractionResult object
    """
    service = TransactionExtractorService(config_path, debug, preserve_original_data)
    return service.extract_from_text(text)


def main():
    """Main function for command-line usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Transaction Extractor Service")
    parser.add_argument('--json', action='store_true', help='Accept JSON input from stdin')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    parser.add_argument('--config', type=str, help='Path to configuration file')
    parser.add_argument('--test', action='store_true', help='Run test examples')
    
    args = parser.parse_args()
    
    if args.test:
        # Run test examples
        run_test_examples(args.debug)
        return
    
    if args.json:
        # Read JSON input from stdin
        try:
            input_data = json.loads(sys.stdin.read())
            process_json_input(input_data, args.config, args.debug)
        except json.JSONDecodeError as e:
            print(json.dumps({
                "success": False,
                "error_message": f"Invalid JSON input: {e}",
                "transactions": [],
                "metadata": {}
            }))
            sys.exit(1)
        except Exception as e:
            print(json.dumps({
                "success": False,
                "error_message": str(e),
                "transactions": [],
                "metadata": {}
            }))
            sys.exit(1)
    else:
        print("Usage: python transaction_extractor_service.py --json < input.json")
        print("       python transaction_extractor_service.py --test")
        sys.exit(1)


def process_json_input(input_data: Dict, config_path: Optional[str], debug: bool):
    """Process JSON input and return results"""
    try:
        service = TransactionExtractorService(config_path, debug)
        
        method = input_data.get('method', 'text')
        
        if method == 'tables':
            # Convert table data back to DataFrames
            tables_data = input_data.get('tables', [])
            tables = []
            
            for table_data in tables_data:
                if isinstance(table_data, dict) and 'data' in table_data:
                    # Handle structured table data
                    df = pd.DataFrame(table_data['data'])
                    if 'columns' in table_data:
                        df.columns = table_data['columns']
                    tables.append(df)
                elif isinstance(table_data, list):
                    # Handle raw table data
                    df = pd.DataFrame(table_data)
                    tables.append(df)
            
            result = service.extract_from_tables(tables)
            
        elif method == 'text':
            text = input_data.get('text', '')
            result = service.extract_from_text(text)
            
        elif method == 'detect_columns':
            # Column structure detection
            tables_data = input_data.get('tables', [])
            tables = []
            
            for table_data in tables_data:
                if isinstance(table_data, dict) and 'data' in table_data:
                    df = pd.DataFrame(table_data['data'])
                    if 'columns' in table_data:
                        df.columns = table_data['columns']
                    tables.append(df)
                elif isinstance(table_data, list):
                    df = pd.DataFrame(table_data)
                    tables.append(df)
            
            column_structure = service.detect_column_structure(tables)
            
            result_dict = {
                "success": True,
                "column_structure": {
                    "date_columns": column_structure.date_columns,
                    "description_columns": column_structure.description_columns,
                    "debit_columns": column_structure.debit_columns,
                    "credit_columns": column_structure.credit_columns,
                    "amount_columns": column_structure.amount_columns,
                    "balance_columns": column_structure.balance_columns,
                    "has_separate_debit_credit": column_structure.has_separate_debit_credit,
                    "confidence": column_structure.confidence,
                    "debit_keywords": column_structure.debit_keywords,
                    "credit_keywords": column_structure.credit_keywords,
                    "amount_sign_strategy": column_structure.amount_sign_strategy,
                    "fallback_strategy": column_structure.fallback_strategy,
                    "detection_details": column_structure.detection_details
                },
                "metadata": {
                    "tables_analyzed": len(tables),
                    "method": "detect_columns"
                }
            }
            
            print("___RESULT_START___")
            print(json.dumps(result_dict, ensure_ascii=False))
            print("___RESULT_END___")
            return
            
        else:
            raise ValueError(f"Unknown method: {method}")
        
        # Output result
        print("___RESULT_START___")
        print(json.dumps(result.to_dict(), ensure_ascii=False))
        print("___RESULT_END___")
        
    except Exception as e:
        error_result = {
            "success": False,
            "error_message": str(e),
            "transactions": [],
            "metadata": {"error": str(e)},
            "processing_time": 0.0,
            "method": input_data.get('method', 'unknown'),
            "provider": "groq_transaction_extractor"
        }
        
        print("___RESULT_START___")
        print(json.dumps(error_result, ensure_ascii=False))
        print("___RESULT_END___")


def run_test_examples(debug: bool = False):
    """Run test examples"""
    try:
        service = TransactionExtractorService(debug=debug)
        
        print("🧪 EJECUTANDO EJEMPLOS DE PRUEBA")
        
        # Test with sample table
        sample_table = pd.DataFrame({
            'Fecha': ['01/01/2025', '02/01/2025'],
            'Descripción': ['ATM Withdrawal', 'Salary Deposit'],
            'Debe': [50.0, 0.0],
            'Haber': [0.0, 2500.0]
        })
        
        print("\n📊 PRUEBA DE EXTRACCIÓN DE TABLAS:")
        result = service.extract_from_tables([sample_table])
        print(f"✅ Éxito: {result.success}")
        print(f"📝 Transacciones: {len(result.transactions)}")
        print(f"⏱️  Tiempo: {result.processing_time:.2f}s")
        
        # Test text extraction
        sample_text = """
        Bank Statement
        01/01/2025 ATM Withdrawal -50.00
        02/01/2025 Salary Deposit +2500.00
        03/01/2025 Grocery Store -75.50
        """
        
        print("\n📄 PRUEBA DE EXTRACCIÓN DE TEXTO:")
        result = service.extract_from_text(sample_text)
        print(f"✅ Éxito: {result.success}")
        print(f"📝 Transacciones: {len(result.transactions)}")
        print(f"⏱️  Tiempo: {result.processing_time:.2f}s")
        
        if result.success and result.transactions:
            print("\n🎯 TRANSACCIONES EXTRAÍDAS:")
            for i, transaction in enumerate(result.transactions[:3], 1):
                print(f"  {i}. {transaction.get('date')} - {transaction.get('description')} - ${transaction.get('amount')} ({transaction.get('type')})")
        
        print("\n🎉 PRUEBAS COMPLETADAS")
        
    except Exception as e:
        print(f"❌ ERROR EN PRUEBAS: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()