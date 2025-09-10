#!/usr/bin/env python3
"""
Excel/CSV Processor using pandas + openpyxl

This module implements specialized processing for Excel and CSV files containing
banking data, with automatic column detection and optimized data extraction.
"""

import logging
import time
import os
from typing import List, Dict, Optional, Tuple, Any, Union
from dataclasses import dataclass
import pandas as pd
import numpy as np
from pathlib import Path
import re
from datetime import datetime, date
import openpyxl
from openpyxl import load_workbook


@dataclass
class ColumnMapping:
    """Mapping of detected banking columns"""
    date_column: Optional[str] = None
    description_column: Optional[str] = None
    amount_column: Optional[str] = None
    balance_column: Optional[str] = None
    reference_column: Optional[str] = None
    type_column: Optional[str] = None
    confidence: float = 0.0
    detected_patterns: Dict[str, str] = None


@dataclass
class Transaction:
    """Banking transaction structure"""
    date: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    balance: Optional[float] = None
    reference: Optional[str] = None
    transaction_type: Optional[str] = None
    confidence: float = 0.0
    raw_data: Dict[str, Any] = None


@dataclass
class ExcelProcessingResult:
    """Result structure for Excel/CSV processing"""
    success: bool
    transactions: List[Transaction]
    column_mapping: ColumnMapping
    total_rows: int
    processed_rows: int
    processing_time: float
    metadata: Dict[str, Any]
    error_message: Optional[str] = None


class ExcelProcessor:
    """
    Specialized processor for Excel and CSV files containing banking data.
    Uses pandas + openpyxl for optimal performance and automatic column detection.
    """
    
    def __init__(self, debug: bool = False):
        """
        Initialize the Excel Processor.
        
        Args:
            debug: Enable debug logging
        """
        self.debug = debug
        self.logger = self._setup_logger()
        
        # Banking column patterns (Spanish and English)
        self.column_patterns = {
            'date': [
                r'fecha', r'date', r'fec\w*', r'dat\w*',
                r'operaci[oó]n', r'operation', r'valor',
                r'movimiento', r'movement'
            ],
            'description': [
                r'descripci[oó]n', r'description', r'desc\w*',
                r'concepto', r'concept', r'detalle', r'detail',
                r'movimiento', r'movement', r'operaci[oó]n',
                r'transacci[oó]n', r'transaction', r'observaci\w*'
            ],
            'amount': [
                r'importe', r'amount', r'monto', r'valor',
                r'cantidad', r'quantity', r'debe', r'haber',
                r'debit', r'credit', r'cargo', r'abono',
                r'ingreso', r'income', r'gasto', r'expense'
            ],
            'balance': [
                r'saldo', r'balance', r'disponible', r'available',
                r'total', r'acumulado', r'accumulated'
            ],
            'reference': [
                r'referencia', r'reference', r'ref\w*', r'n[uú]mero',
                r'number', r'num\w*', r'id', r'identificador',
                r'c[oó]digo', r'code'
            ],
            'type': [
                r'tipo', r'type', r'categor[ií]a', r'category',
                r'clase', r'class', r'modalidad', r'mode'
            ]
        }
        
        # Date format patterns
        self.date_patterns = [
            r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}',  # DD/MM/YYYY or DD-MM-YYYY
            r'\d{2,4}[/-]\d{1,2}[/-]\d{1,2}',  # YYYY/MM/DD or YYYY-MM-DD
            r'\d{1,2}\s+\w+\s+\d{2,4}',        # DD Month YYYY
            r'\w+\s+\d{1,2},?\s+\d{2,4}'       # Month DD, YYYY
        ]
        
        # Amount patterns (including currency symbols)
        self.amount_patterns = [
            r'[-+]?\$?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?',  # Currency amounts
            r'[-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*€',    # Euro amounts
            r'[-+]?\d+(?:[.,]\d{2})?'                           # Simple decimal
        ]
        
        # Quality thresholds
        self.quality_thresholds = {
            'min_rows': 5,
            'min_date_match_ratio': 0.7,
            'min_amount_match_ratio': 0.8,
            'min_column_confidence': 0.6,
            'max_empty_ratio': 0.3
        }
        
        self.logger.info("ExcelProcessor initialized")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.ExcelProcessor")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def process_excel(self, file_path: str, sheet_name: Optional[str] = None) -> ExcelProcessingResult:
        """
        Process Excel file and extract banking transactions.
        
        Args:
            file_path: Path to Excel file
            sheet_name: Specific sheet name to process (None for first sheet)
            
        Returns:
            ExcelProcessingResult with extracted transactions
        """
        if not Path(file_path).exists():
            return ExcelProcessingResult(
                success=False,
                transactions=[],
                column_mapping=ColumnMapping(),
                total_rows=0,
                processed_rows=0,
                processing_time=0.0,
                metadata={},
                error_message=f"File not found: {file_path}"
            )
        
        start_time = time.time()
        
        try:
            self.logger.info(f"Processing Excel file: {file_path}")
            
            # Load Excel file
            if file_path.endswith('.xlsx') or file_path.endswith('.xls'):
                if sheet_name is not None:
                    df = pd.read_excel(file_path, sheet_name=sheet_name, engine='openpyxl')
                else:
                    df = pd.read_excel(file_path, engine='openpyxl')
                
                # Handle case where pd.read_excel returns a dict of DataFrames
                if isinstance(df, dict):
                    # Take the first sheet if multiple sheets returned
                    df = list(df.values())[0]
            else:
                return ExcelProcessingResult(
                    success=False,
                    transactions=[],
                    column_mapping=ColumnMapping(),
                    total_rows=0,
                    processed_rows=0,
                    processing_time=time.time() - start_time,
                    metadata={},
                    error_message=f"Unsupported file format: {file_path}"
                )
            
            # Detect banking columns
            column_mapping = self.detect_banking_columns(df)
            
            if column_mapping.confidence < self.quality_thresholds['min_column_confidence']:
                return ExcelProcessingResult(
                    success=False,
                    transactions=[],
                    column_mapping=column_mapping,
                    total_rows=len(df),
                    processed_rows=0,
                    processing_time=time.time() - start_time,
                    metadata={'low_confidence': True},
                    error_message=f"Low confidence in column detection: {column_mapping.confidence:.2f}"
                )
            
            # Extract transactions
            transactions = self.extract_transactions(df, column_mapping)
            
            processing_time = time.time() - start_time
            
            # Calculate metadata
            metadata = {
                'file_type': 'excel',
                'sheet_name': sheet_name,
                'original_columns': list(df.columns),
                'detected_columns': {
                    'date': column_mapping.date_column,
                    'description': column_mapping.description_column,
                    'amount': column_mapping.amount_column,
                    'balance': column_mapping.balance_column,
                    'reference': column_mapping.reference_column,
                    'type': column_mapping.type_column
                },
                'column_confidence': column_mapping.confidence,
                'transaction_success_rate': len([t for t in transactions if t.confidence > 0.5]) / len(transactions) if transactions else 0,
                'average_transaction_confidence': np.mean([t.confidence for t in transactions]) if transactions else 0,
                'date_range': self._get_date_range(transactions),
                'amount_range': self._get_amount_range(transactions)
            }
            
            return ExcelProcessingResult(
                success=True,
                transactions=transactions,
                column_mapping=column_mapping,
                total_rows=len(df),
                processed_rows=len(transactions),
                processing_time=processing_time,
                metadata=metadata
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_msg = f"Excel processing failed: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            return ExcelProcessingResult(
                success=False,
                transactions=[],
                column_mapping=ColumnMapping(),
                total_rows=0,
                processed_rows=0,
                processing_time=processing_time,
                metadata={},
                error_message=error_msg
            )
    
    def process_csv(self, file_path: str, encoding: str = 'utf-8', delimiter: str = None) -> ExcelProcessingResult:
        """
        Process CSV file and extract banking transactions.
        
        Args:
            file_path: Path to CSV file
            encoding: File encoding (default: utf-8)
            delimiter: CSV delimiter (auto-detected if None)
            
        Returns:
            ExcelProcessingResult with extracted transactions
        """
        if not Path(file_path).exists():
            return ExcelProcessingResult(
                success=False,
                transactions=[],
                column_mapping=ColumnMapping(),
                total_rows=0,
                processed_rows=0,
                processing_time=0.0,
                metadata={},
                error_message=f"File not found: {file_path}"
            )
        
        start_time = time.time()
        
        try:
            self.logger.info(f"Processing CSV file: {file_path}")
            
            # Auto-detect delimiter if not provided
            if delimiter is None:
                delimiter = self._detect_csv_delimiter(file_path, encoding)
            
            # Load CSV file
            df = pd.read_csv(file_path, encoding=encoding, delimiter=delimiter)
            
            # Process similar to Excel
            column_mapping = self.detect_banking_columns(df)
            
            if column_mapping.confidence < self.quality_thresholds['min_column_confidence']:
                return ExcelProcessingResult(
                    success=False,
                    transactions=[],
                    column_mapping=column_mapping,
                    total_rows=len(df),
                    processed_rows=0,
                    processing_time=time.time() - start_time,
                    metadata={'low_confidence': True},
                    error_message=f"Low confidence in column detection: {column_mapping.confidence:.2f}"
                )
            
            transactions = self.extract_transactions(df, column_mapping)
            processing_time = time.time() - start_time
            
            metadata = {
                'file_type': 'csv',
                'encoding': encoding,
                'delimiter': delimiter,
                'original_columns': list(df.columns),
                'detected_columns': {
                    'date': column_mapping.date_column,
                    'description': column_mapping.description_column,
                    'amount': column_mapping.amount_column,
                    'balance': column_mapping.balance_column,
                    'reference': column_mapping.reference_column,
                    'type': column_mapping.type_column
                },
                'column_confidence': column_mapping.confidence,
                'transaction_success_rate': len([t for t in transactions if t.confidence > 0.5]) / len(transactions) if transactions else 0,
                'average_transaction_confidence': np.mean([t.confidence for t in transactions]) if transactions else 0,
                'date_range': self._get_date_range(transactions),
                'amount_range': self._get_amount_range(transactions)
            }
            
            return ExcelProcessingResult(
                success=True,
                transactions=transactions,
                column_mapping=column_mapping,
                total_rows=len(df),
                processed_rows=len(transactions),
                processing_time=processing_time,
                metadata=metadata
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_msg = f"CSV processing failed: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            return ExcelProcessingResult(
                success=False,
                transactions=[],
                column_mapping=ColumnMapping(),
                total_rows=0,
                processed_rows=0,
                processing_time=processing_time,
                metadata={},
                error_message=error_msg
            )
    
    def detect_banking_columns(self, df: pd.DataFrame) -> ColumnMapping:
        """
        Automatically detect banking-related columns in the DataFrame.
        
        Args:
            df: Input DataFrame
            
        Returns:
            ColumnMapping with detected columns and confidence score
        """
        if df.empty:
            return ColumnMapping(confidence=0.0)
        
        self.logger.debug(f"Detecting columns in DataFrame with shape: {df.shape}")
        self.logger.debug(f"Available columns: {list(df.columns)}")
        
        detected_columns = {}
        column_scores = {}
        
        # Analyze each column
        for column in df.columns:
            column_str = str(column).lower().strip()
            sample_data = df[column].dropna().head(10).astype(str)
            
            # Score each column type
            scores = {}
            
            # Date column detection
            scores['date'] = self._score_date_column(column_str, sample_data)
            
            # Description column detection
            scores['description'] = self._score_description_column(column_str, sample_data)
            
            # Amount column detection
            scores['amount'] = self._score_amount_column(column_str, sample_data)
            
            # Balance column detection
            scores['balance'] = self._score_balance_column(column_str, sample_data)
            
            # Reference column detection
            scores['reference'] = self._score_reference_column(column_str, sample_data)
            
            # Type column detection
            scores['type'] = self._score_type_column(column_str, sample_data)
            
            column_scores[column] = scores
        
        # Select best column for each type
        for column_type in ['date', 'description', 'amount', 'balance', 'reference', 'type']:
            best_column = None
            best_score = 0.0
            
            for column, scores in column_scores.items():
                if scores[column_type] > best_score:
                    best_score = scores[column_type]
                    best_column = column
            
            if best_score >= 0.3:  # Minimum threshold
                detected_columns[f'{column_type}_column'] = best_column
                detected_columns[f'{column_type}_score'] = best_score
        
        # Calculate overall confidence
        required_columns = ['date', 'description', 'amount']
        found_required = sum(1 for col in required_columns if f'{col}_column' in detected_columns)
        confidence = found_required / len(required_columns)
        
        # Bonus for additional columns
        optional_columns = ['balance', 'reference', 'type']
        found_optional = sum(1 for col in optional_columns if f'{col}_column' in detected_columns)
        confidence += (found_optional / len(optional_columns)) * 0.2
        
        # Quality bonus based on scores
        avg_score = np.mean([score for key, score in detected_columns.items() if key.endswith('_score')])
        confidence = (confidence * 0.8) + (avg_score * 0.2)
        
        confidence = min(confidence, 1.0)
        
        mapping = ColumnMapping(
            date_column=detected_columns.get('date_column'),
            description_column=detected_columns.get('description_column'),
            amount_column=detected_columns.get('amount_column'),
            balance_column=detected_columns.get('balance_column'),
            reference_column=detected_columns.get('reference_column'),
            type_column=detected_columns.get('type_column'),
            confidence=confidence,
            detected_patterns={k: v for k, v in detected_columns.items() if k.endswith('_score')}
        )
        
        self.logger.info(f"Column detection completed with confidence: {confidence:.2f}")
        self.logger.debug(f"Detected mapping: {mapping}")
        
        return mapping
    
    def extract_transactions(self, df: pd.DataFrame, mapping: ColumnMapping) -> List[Transaction]:
        """
        Extract transactions from DataFrame using the provided column mapping.
        
        Args:
            df: Input DataFrame
            mapping: Column mapping
            
        Returns:
            List of Transaction objects
        """
        if df.empty or not mapping.date_column:
            return []
        
        transactions = []
        
        for index, row in df.iterrows():
            try:
                # Extract basic fields
                transaction = Transaction()
                transaction.raw_data = row.to_dict()
                
                # Extract date
                if mapping.date_column and mapping.date_column in row:
                    transaction.date = self._parse_date(row[mapping.date_column])
                
                # Extract description
                if mapping.description_column and mapping.description_column in row:
                    transaction.description = self._clean_text(str(row[mapping.description_column]))
                
                # Extract amount
                if mapping.amount_column and mapping.amount_column in row:
                    transaction.amount = self._parse_amount(row[mapping.amount_column])
                
                # Extract balance
                if mapping.balance_column and mapping.balance_column in row:
                    transaction.balance = self._parse_amount(row[mapping.balance_column])
                
                # Extract reference
                if mapping.reference_column and mapping.reference_column in row:
                    transaction.reference = self._clean_text(str(row[mapping.reference_column]))
                
                # Extract type
                if mapping.type_column and mapping.type_column in row:
                    transaction.transaction_type = self._clean_text(str(row[mapping.type_column]))
                
                # Calculate transaction confidence
                transaction.confidence = self._calculate_transaction_confidence(transaction)
                
                # Only include transactions with minimum data
                if transaction.date or transaction.description or transaction.amount is not None:
                    transactions.append(transaction)
                
            except Exception as e:
                self.logger.debug(f"Failed to process row {index}: {e}")
                continue
        
        self.logger.info(f"Extracted {len(transactions)} transactions from {len(df)} rows")
        return transactions
    
    def _score_date_column(self, column_name: str, sample_data: pd.Series) -> float:
        """Score how likely a column is to contain dates"""
        score = 0.0
        
        # Check column name
        for pattern in self.column_patterns['date']:
            if re.search(pattern, column_name, re.IGNORECASE):
                score += 0.4
                break
        
        # Check data content
        date_matches = 0
        for value in sample_data:
            if self._looks_like_date(str(value)):
                date_matches += 1
        
        if len(sample_data) > 0:
            data_score = date_matches / len(sample_data)
            score += data_score * 0.6
        
        return min(score, 1.0)
    
    def _score_description_column(self, column_name: str, sample_data: pd.Series) -> float:
        """Score how likely a column is to contain descriptions"""
        score = 0.0
        
        # Check column name
        for pattern in self.column_patterns['description']:
            if re.search(pattern, column_name, re.IGNORECASE):
                score += 0.4
                break
        
        # Check data content (text length and variety)
        if len(sample_data) > 0:
            avg_length = np.mean([len(str(val)) for val in sample_data])
            unique_ratio = len(sample_data.unique()) / len(sample_data)
            
            # Good descriptions are longer and varied
            length_score = min(avg_length / 50, 1.0) * 0.3  # Normalize to 50 chars
            variety_score = unique_ratio * 0.3
            
            score += length_score + variety_score
        
        return min(score, 1.0)
    
    def _score_amount_column(self, column_name: str, sample_data: pd.Series) -> float:
        """Score how likely a column is to contain amounts"""
        score = 0.0
        
        # Check column name
        for pattern in self.column_patterns['amount']:
            if re.search(pattern, column_name, re.IGNORECASE):
                score += 0.4
                break
        
        # Check data content
        numeric_matches = 0
        for value in sample_data:
            if self._looks_like_amount(str(value)):
                numeric_matches += 1
        
        if len(sample_data) > 0:
            data_score = numeric_matches / len(sample_data)
            score += data_score * 0.6
        
        return min(score, 1.0)
    
    def _score_balance_column(self, column_name: str, sample_data: pd.Series) -> float:
        """Score how likely a column is to contain balance"""
        score = 0.0
        
        # Check column name
        for pattern in self.column_patterns['balance']:
            if re.search(pattern, column_name, re.IGNORECASE):
                score += 0.5
                break
        
        # Check data content (should be numeric and potentially increasing)
        numeric_matches = 0
        for value in sample_data:
            if self._looks_like_amount(str(value)):
                numeric_matches += 1
        
        if len(sample_data) > 0:
            data_score = numeric_matches / len(sample_data)
            score += data_score * 0.5
        
        return min(score, 1.0)
    
    def _score_reference_column(self, column_name: str, sample_data: pd.Series) -> float:
        """Score how likely a column is to contain references"""
        score = 0.0
        
        # Check column name
        for pattern in self.column_patterns['reference']:
            if re.search(pattern, column_name, re.IGNORECASE):
                score += 0.5
                break
        
        # Check data content (should be alphanumeric, relatively short, unique)
        if len(sample_data) > 0:
            avg_length = np.mean([len(str(val)) for val in sample_data])
            unique_ratio = len(sample_data.unique()) / len(sample_data)
            
            # Good references are short and unique
            length_score = max(0, 1.0 - (avg_length - 10) / 20) * 0.25  # Optimal around 10 chars
            uniqueness_score = unique_ratio * 0.25
            
            score += length_score + uniqueness_score
        
        return min(score, 1.0)
    
    def _score_type_column(self, column_name: str, sample_data: pd.Series) -> float:
        """Score how likely a column is to contain transaction types"""
        score = 0.0
        
        # Check column name
        for pattern in self.column_patterns['type']:
            if re.search(pattern, column_name, re.IGNORECASE):
                score += 0.5
                break
        
        # Check data content (should have limited unique values)
        if len(sample_data) > 0:
            unique_count = len(sample_data.unique())
            total_count = len(sample_data)
            
            # Good type columns have few unique values relative to total
            if unique_count <= 10 and total_count > unique_count * 2:
                score += 0.5
        
        return min(score, 1.0)
    
    def _looks_like_date(self, value: str) -> bool:
        """Check if a value looks like a date"""
        if pd.isna(value) or str(value).strip() == '':
            return False
        
        value_str = str(value).strip()
        
        # Try pandas date parsing first
        try:
            pd.to_datetime(value_str)
            return True
        except:
            pass
        
        # Check against date patterns
        for pattern in self.date_patterns:
            if re.search(pattern, value_str):
                return True
        
        return False
    
    def _looks_like_amount(self, value: str) -> bool:
        """Check if a value looks like a monetary amount"""
        if pd.isna(value) or str(value).strip() == '':
            return False
        
        value_str = str(value).strip()
        
        # Try direct numeric conversion
        try:
            float(value_str.replace(',', '').replace('$', '').replace('€', ''))
            return True
        except:
            pass
        
        # Check against amount patterns
        for pattern in self.amount_patterns:
            if re.search(pattern, value_str):
                return True
        
        return False
    
    def _parse_date(self, value) -> Optional[str]:
        """Parse date value to standardized format"""
        if pd.isna(value):
            return None
        
        try:
            # Try pandas parsing
            parsed_date = pd.to_datetime(value)
            return parsed_date.strftime('%Y-%m-%d')
        except:
            # Return as string if parsing fails
            return str(value).strip() if str(value).strip() else None
    
    def _parse_amount(self, value) -> Optional[float]:
        """Parse amount value to float"""
        if pd.isna(value):
            return None
        
        try:
            # Clean the value
            cleaned = str(value).replace('$', '').replace('€', '').replace(',', '').strip()
            
            # Handle negative amounts in parentheses
            if cleaned.startswith('(') and cleaned.endswith(')'):
                cleaned = '-' + cleaned[1:-1]
            
            return float(cleaned)
        except:
            return None
    
    def _clean_text(self, value: str) -> Optional[str]:
        """Clean text value"""
        if pd.isna(value) or str(value).strip() == '':
            return None
        
        cleaned = str(value).strip()
        return cleaned if cleaned else None
    
    def _calculate_transaction_confidence(self, transaction: Transaction) -> float:
        """Calculate confidence score for a transaction"""
        score = 0.0
        
        # Date presence and validity
        if transaction.date:
            score += 0.3
            if self._looks_like_date(transaction.date):
                score += 0.1
        
        # Description presence and quality
        if transaction.description:
            score += 0.2
            if len(transaction.description) > 5:
                score += 0.1
        
        # Amount presence and validity
        if transaction.amount is not None:
            score += 0.3
            if transaction.amount != 0:
                score += 0.1
        
        # Additional fields
        if transaction.balance is not None:
            score += 0.1
        if transaction.reference:
            score += 0.05
        if transaction.transaction_type:
            score += 0.05
        
        return min(score, 1.0)
    
    def _detect_csv_delimiter(self, file_path: str, encoding: str) -> str:
        """Auto-detect CSV delimiter"""
        try:
            with open(file_path, 'r', encoding=encoding) as file:
                first_line = file.readline()
                
            # Common delimiters
            delimiters = [',', ';', '\t', '|']
            delimiter_counts = {}
            
            for delimiter in delimiters:
                delimiter_counts[delimiter] = first_line.count(delimiter)
            
            # Return delimiter with highest count
            best_delimiter = max(delimiter_counts.items(), key=lambda x: x[1])
            return best_delimiter[0] if best_delimiter[1] > 0 else ','
            
        except:
            return ','  # Default to comma
    
    def _get_date_range(self, transactions: List[Transaction]) -> Dict[str, Optional[str]]:
        """Get date range from transactions"""
        dates = [t.date for t in transactions if t.date]
        if not dates:
            return {'min_date': None, 'max_date': None}
        
        try:
            parsed_dates = [pd.to_datetime(date) for date in dates]
            return {
                'min_date': min(parsed_dates).strftime('%Y-%m-%d'),
                'max_date': max(parsed_dates).strftime('%Y-%m-%d')
            }
        except:
            return {'min_date': min(dates), 'max_date': max(dates)}
    
    def _get_amount_range(self, transactions: List[Transaction]) -> Dict[str, Optional[float]]:
        """Get amount range from transactions"""
        amounts = [t.amount for t in transactions if t.amount is not None]
        if not amounts:
            return {'min_amount': None, 'max_amount': None, 'total_amount': None}
        
        return {
            'min_amount': min(amounts),
            'max_amount': max(amounts),
            'total_amount': sum(amounts)
        }
    
    def get_supported_formats(self) -> List[str]:
        """Get list of supported file formats"""
        return ['.xlsx', '.xls', '.csv']
    
    def validate_file_format(self, file_path: str) -> bool:
        """Validate if file format is supported"""
        file_ext = Path(file_path).suffix.lower()
        return file_ext in self.get_supported_formats()