#!/usr/bin/env python3
"""
Modern Table Detector using pdfplumber

This module implements a modern table detection system using pdfplumber
to replace Camelot functionality with improved accuracy and robustness.
"""

import logging
import time
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass
import pandas as pd
import pdfplumber
import numpy as np
from pathlib import Path


@dataclass
class TableResult:
    """Result structure for detected tables"""
    data: pd.DataFrame
    confidence: float
    page_number: int
    bbox: Tuple[float, float, float, float]  # (x0, y0, x1, y1)
    method_used: str
    quality_metrics: Dict[str, float]


@dataclass
class TableExtractionResult:
    """Complete result of table extraction process"""
    success: bool
    tables: List[TableResult]
    total_tables: int
    processing_time: float
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = None


class ModernTableDetector:
    """
    Modern table detector using pdfplumber with adaptive settings
    and confidence scoring based on table structure quality.
    """
    
    def __init__(self, debug: bool = False):
        """
        Initialize the Modern Table Detector.
        
        Args:
            debug: Enable debug logging
        """
        self.debug = debug
        self.logger = self._setup_logger()
        
        # Adaptive settings for different table types
        self.detection_strategies = {
            'lines': {
                'vertical_strategy': 'lines',
                'horizontal_strategy': 'lines',
                'snap_tolerance': 3,
                'join_tolerance': 3,
                'edge_min_length': 3,
                'min_words_vertical': 3,
                'min_words_horizontal': 1
            },
            'text': {
                'vertical_strategy': 'text',
                'horizontal_strategy': 'text',
                'snap_tolerance': 5,
                'join_tolerance': 5,
                'intersection_tolerance': 3,
                'text_tolerance': 3,
                'text_x_tolerance': 3,
                'text_y_tolerance': 3
            },
            'explicit': {
                'vertical_strategy': 'explicit',
                'horizontal_strategy': 'explicit',
                'explicit_vertical_lines': [],
                'explicit_horizontal_lines': [],
                'snap_tolerance': 2,
                'join_tolerance': 2
            }
        }
        
        # Quality thresholds
        self.quality_thresholds = {
            'min_rows': 2,
            'min_cols': 2,
            'min_filled_cells': 0.3,  # 30% of cells should have content
            'max_empty_rows': 0.5,    # Max 50% empty rows
            'min_confidence': 0.4     # Minimum confidence score
        }
        
        self.logger.info("ModernTableDetector initialized with pdfplumber")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.ModernTableDetector")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def detect_tables(self, pdf_path: str) -> List[TableResult]:
        """
        Detect tables in PDF using optimized pdfplumber settings.
        
        Args:
            pdf_path: Path to the PDF file
            
        Returns:
            List of TableResult objects
        """
        if not Path(pdf_path).exists():
            self.logger.error(f"PDF file not found: {pdf_path}")
            return []
        
        try:
            self.logger.info(f"Starting table detection for: {pdf_path}")
            
            tables = []
            with pdfplumber.open(pdf_path) as pdf:
                for page_num, page in enumerate(pdf.pages, 1):
                    self.logger.debug(f"Processing page {page_num}")
                    page_tables = self._detect_tables_on_page(page, page_num)
                    tables.extend(page_tables)
            
            self.logger.info(f"Detected {len(tables)} tables across {len(pdf.pages)} pages")
            return tables
            
        except Exception as e:
            self.logger.error(f"Table detection failed: {e}", exc_info=True)
            return []
    
    def extract_tables_with_confidence(self, pdf_path: str) -> TableExtractionResult:
        """
        Extract tables with comprehensive confidence scoring and metadata.
        
        Args:
            pdf_path: Path to the PDF file
            
        Returns:
            TableExtractionResult with detailed results and metadata
        """
        start_time = time.time()
        
        # Check if file exists first
        if not Path(pdf_path).exists():
            processing_time = time.time() - start_time
            error_msg = f"PDF file not found: {pdf_path}"
            self.logger.error(error_msg)
            return TableExtractionResult(
                success=False,
                tables=[],
                total_tables=0,
                processing_time=processing_time,
                error_message=error_msg
            )
        
        try:
            tables = self.detect_tables(pdf_path)
            processing_time = time.time() - start_time
            
            # Filter tables by confidence
            high_confidence_tables = [
                table for table in tables 
                if table.confidence >= self.quality_thresholds['min_confidence']
            ]
            
            metadata = {
                'total_pages_processed': self._get_page_count(pdf_path),
                'tables_found': len(tables),
                'high_confidence_tables': len(high_confidence_tables),
                'average_confidence': np.mean([t.confidence for t in tables]) if tables else 0.0,
                'detection_strategies_used': list(set(t.method_used for t in tables)),
                'quality_distribution': self._calculate_quality_distribution(tables)
            }
            
            return TableExtractionResult(
                success=True,
                tables=high_confidence_tables,
                total_tables=len(tables),
                processing_time=processing_time,
                metadata=metadata
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_msg = f"Table extraction failed: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            
            return TableExtractionResult(
                success=False,
                tables=[],
                total_tables=0,
                processing_time=processing_time,
                error_message=error_msg
            )
    
    def get_table_structure(self, pdf_path: str) -> Dict[str, Any]:
        """
        Analyze table structure and provide detailed information.
        
        Args:
            pdf_path: Path to the PDF file
            
        Returns:
            Dictionary with table structure analysis
        """
        try:
            tables = self.detect_tables(pdf_path)
            
            if not tables:
                return {
                    'has_tables': False,
                    'table_count': 0,
                    'structure_analysis': 'No tables detected'
                }
            
            structure_info = {
                'has_tables': True,
                'table_count': len(tables),
                'tables_by_page': {},
                'overall_quality': np.mean([t.confidence for t in tables]),
                'structure_types': [],
                'recommended_extraction_method': self._recommend_extraction_method(tables)
            }
            
            # Analyze each table
            for table in tables:
                page_key = f"page_{table.page_number}"
                if page_key not in structure_info['tables_by_page']:
                    structure_info['tables_by_page'][page_key] = []
                
                table_info = {
                    'rows': len(table.data),
                    'columns': len(table.data.columns),
                    'confidence': table.confidence,
                    'method': table.method_used,
                    'quality_metrics': table.quality_metrics,
                    'bbox': table.bbox
                }
                structure_info['tables_by_page'][page_key].append(table_info)
                
                # Determine structure type
                if table.quality_metrics.get('has_clear_borders', False):
                    structure_info['structure_types'].append('bordered')
                elif table.quality_metrics.get('text_alignment_score', 0) > 0.7:
                    structure_info['structure_types'].append('aligned_text')
                else:
                    structure_info['structure_types'].append('loose_structure')
            
            structure_info['structure_types'] = list(set(structure_info['structure_types']))
            
            return structure_info
            
        except Exception as e:
            self.logger.error(f"Structure analysis failed: {e}", exc_info=True)
            return {
                'has_tables': False,
                'error': str(e)
            }
    
    def _detect_tables_on_page(self, page, page_num: int) -> List[TableResult]:
        """
        Detect tables on a single page using multiple strategies.
        
        Args:
            page: pdfplumber page object
            page_num: Page number
            
        Returns:
            List of TableResult objects for this page
        """
        page_tables = []
        
        # Try different detection strategies in order of preference
        for strategy_name, settings in self.detection_strategies.items():
            try:
                self.logger.debug(f"Trying {strategy_name} strategy on page {page_num}")
                
                # Skip explicit strategy if no lines are defined
                if strategy_name == 'explicit' and not settings.get('explicit_vertical_lines'):
                    continue
                
                tables = page.find_tables(table_settings=settings)
                
                for table_idx, table in enumerate(tables):
                    try:
                        # Extract table data
                        table_data = table.extract()
                        if not table_data or len(table_data) < 2:
                            continue
                        
                        # Convert to DataFrame
                        df = pd.DataFrame(table_data[1:], columns=table_data[0])
                        
                        # Calculate confidence and quality metrics
                        confidence, quality_metrics = self._calculate_table_confidence(df, table, strategy_name)
                        
                        # Only keep tables that meet minimum quality standards
                        if confidence >= self.quality_thresholds['min_confidence']:
                            table_result = TableResult(
                                data=df,
                                confidence=confidence,
                                page_number=page_num,
                                bbox=table.bbox,
                                method_used=strategy_name,
                                quality_metrics=quality_metrics
                            )
                            page_tables.append(table_result)
                            
                            self.logger.debug(
                                f"Found table on page {page_num} using {strategy_name}: "
                                f"{len(df)} rows, {len(df.columns)} cols, confidence: {confidence:.2f}"
                            )
                    
                    except Exception as e:
                        self.logger.debug(f"Failed to process table {table_idx} with {strategy_name}: {e}")
                        continue
                
                # If we found good tables with this strategy, we can stop trying others
                if page_tables and strategy_name in ['lines', 'text']:
                    break
                    
            except Exception as e:
                self.logger.debug(f"Strategy {strategy_name} failed on page {page_num}: {e}")
                continue
        
        # Remove duplicate tables (same position, similar content)
        page_tables = self._remove_duplicate_tables(page_tables)
        
        return page_tables
    
    def _calculate_table_confidence(self, df: pd.DataFrame, table_obj, method: str) -> Tuple[float, Dict[str, float]]:
        """
        Calculate confidence score and quality metrics for a detected table.
        
        Args:
            df: DataFrame containing table data
            table_obj: pdfplumber table object
            method: Detection method used
            
        Returns:
            Tuple of (confidence_score, quality_metrics)
        """
        metrics = {}
        
        # Basic structure metrics
        total_cells = len(df) * len(df.columns)
        # Count non-empty, non-null cells (excluding empty strings)
        filled_cells = 0
        for col in df.columns:
            for value in df[col]:
                if pd.notna(value) and str(value).strip() != '':
                    filled_cells += 1
        empty_cells = total_cells - filled_cells
        
        metrics['fill_ratio'] = filled_cells / total_cells if total_cells > 0 else 0
        metrics['empty_ratio'] = empty_cells / total_cells if total_cells > 0 else 1
        
        # Row and column metrics
        metrics['row_count'] = len(df)
        metrics['column_count'] = len(df.columns)
        metrics['has_header'] = self._has_likely_header(df)
        
        # Content quality metrics
        metrics['numeric_columns'] = self._count_numeric_columns(df)
        metrics['text_consistency'] = self._calculate_text_consistency(df)
        metrics['alignment_score'] = self._calculate_alignment_score(df)
        
        # Structure quality metrics
        metrics['has_clear_borders'] = method == 'lines'
        metrics['text_alignment_score'] = 0.8 if method == 'text' else 0.5
        
        # Calculate overall confidence
        confidence_factors = []
        
        # Structure factor (40% weight)
        structure_score = 0.0
        if metrics['row_count'] >= self.quality_thresholds['min_rows']:
            structure_score += 0.3
        if metrics['column_count'] >= self.quality_thresholds['min_cols']:
            structure_score += 0.3
        if metrics['fill_ratio'] >= self.quality_thresholds['min_filled_cells']:
            structure_score += 0.4
        confidence_factors.append(('structure', structure_score, 0.4))
        
        # Content factor (30% weight)
        content_score = 0.0
        if metrics['has_header']:
            content_score += 0.3
        if metrics['numeric_columns'] > 0:
            content_score += 0.4
        content_score += min(metrics['text_consistency'], 0.3)
        confidence_factors.append(('content', content_score, 0.3))
        
        # Method factor (20% weight)
        method_scores = {'lines': 0.9, 'text': 0.7, 'explicit': 0.8}
        method_score = method_scores.get(method, 0.5)
        confidence_factors.append(('method', method_score, 0.2))
        
        # Alignment factor (10% weight)
        alignment_score = metrics['alignment_score']
        confidence_factors.append(('alignment', alignment_score, 0.1))
        
        # Calculate weighted confidence
        total_confidence = sum(score * weight for _, score, weight in confidence_factors)
        
        # Apply penalties for poor quality
        if metrics['empty_ratio'] > self.quality_thresholds['max_empty_rows']:
            total_confidence *= 0.7
        
        if metrics['row_count'] < 2 or metrics['column_count'] < 2:
            total_confidence *= 0.5
        
        # Ensure confidence is between 0 and 1
        total_confidence = max(0.0, min(1.0, total_confidence))
        
        # Store confidence breakdown for debugging
        metrics['confidence_breakdown'] = {
            factor: score * weight for factor, score, weight in confidence_factors
        }
        
        return total_confidence, metrics
    
    def _has_likely_header(self, df: pd.DataFrame) -> bool:
        """Check if the table likely has a header row"""
        if len(df) < 2:
            return False
        
        # Check if first row has different characteristics than others
        first_row = df.iloc[0]
        other_rows = df.iloc[1:]
        
        # Header likely if first row has more text and less numbers
        first_row_text_ratio = sum(1 for cell in first_row if isinstance(cell, str) and not str(cell).replace('.', '').replace(',', '').isdigit()) / len(first_row)
        
        if first_row_text_ratio > 0.7:
            return True
        
        return False
    
    def _count_numeric_columns(self, df: pd.DataFrame) -> int:
        """Count columns that appear to contain numeric data"""
        numeric_count = 0
        
        for col in df.columns:
            numeric_cells = 0
            total_cells = 0
            
            for value in df[col].dropna():
                total_cells += 1
                if self._is_numeric_value(str(value)):
                    numeric_cells += 1
            
            if total_cells > 0 and numeric_cells / total_cells > 0.5:
                numeric_count += 1
        
        return numeric_count
    
    def _is_numeric_value(self, value: str) -> bool:
        """Check if a string value represents a number (including currency)"""
        # Remove common currency symbols and separators
        cleaned = value.replace('$', '').replace(',', '').replace('€', '').replace('£', '').strip()
        
        try:
            float(cleaned)
            return True
        except ValueError:
            return False
    
    def _calculate_text_consistency(self, df: pd.DataFrame) -> float:
        """Calculate text consistency score (0-1)"""
        if df.empty:
            return 0.0
        
        consistency_scores = []
        
        for col in df.columns:
            non_null_values = df[col].dropna().astype(str)
            if len(non_null_values) == 0:
                continue
            
            # Check length consistency
            lengths = [len(val) for val in non_null_values]
            if lengths:
                length_std = np.std(lengths)
                avg_length = np.mean(lengths)
                length_consistency = 1.0 - min(1.0, length_std / max(avg_length, 1))
                consistency_scores.append(length_consistency)
        
        return np.mean(consistency_scores) if consistency_scores else 0.0
    
    def _calculate_alignment_score(self, df: pd.DataFrame) -> float:
        """Calculate alignment score based on data patterns"""
        if df.empty:
            return 0.0
        
        # Simple heuristic: well-aligned tables have consistent data types per column
        alignment_score = 0.0
        
        for col in df.columns:
            non_null_values = df[col].dropna().astype(str)
            if len(non_null_values) < 2:
                continue
            
            # Check if column has consistent data type
            numeric_count = sum(1 for val in non_null_values if self._is_numeric_value(val))
            text_count = len(non_null_values) - numeric_count
            
            # Good alignment if column is mostly one type
            type_consistency = max(numeric_count, text_count) / len(non_null_values)
            alignment_score += type_consistency
        
        return alignment_score / len(df.columns) if len(df.columns) > 0 else 0.0
    
    def _remove_duplicate_tables(self, tables: List[TableResult]) -> List[TableResult]:
        """Remove duplicate tables based on position and content similarity"""
        if len(tables) <= 1:
            return tables
        
        unique_tables = []
        
        for table in tables:
            is_duplicate = False
            
            for existing_table in unique_tables:
                # Check position overlap
                if self._tables_overlap(table.bbox, existing_table.bbox):
                    # Check content similarity
                    if self._tables_similar_content(table.data, existing_table.data):
                        # Keep the one with higher confidence
                        if table.confidence > existing_table.confidence:
                            unique_tables.remove(existing_table)
                            unique_tables.append(table)
                        is_duplicate = True
                        break
            
            if not is_duplicate:
                unique_tables.append(table)
        
        return unique_tables
    
    def _tables_overlap(self, bbox1: Tuple[float, float, float, float], 
                       bbox2: Tuple[float, float, float, float], 
                       threshold: float = 0.5) -> bool:
        """Check if two table bounding boxes overlap significantly"""
        x1_1, y1_1, x2_1, y2_1 = bbox1
        x1_2, y1_2, x2_2, y2_2 = bbox2
        
        # Calculate intersection area
        x_overlap = max(0, min(x2_1, x2_2) - max(x1_1, x1_2))
        y_overlap = max(0, min(y2_1, y2_2) - max(y1_1, y1_2))
        intersection_area = x_overlap * y_overlap
        
        # Calculate areas
        area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
        area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
        
        # Check if overlap is significant
        overlap_ratio = intersection_area / min(area1, area2) if min(area1, area2) > 0 else 0
        return overlap_ratio > threshold
    
    def _tables_similar_content(self, df1: pd.DataFrame, df2: pd.DataFrame, 
                               threshold: float = 0.8) -> bool:
        """Check if two tables have similar content"""
        if df1.shape != df2.shape:
            return False
        
        if df1.empty or df2.empty:
            return df1.empty and df2.empty
        
        # Compare cell by cell
        total_cells = df1.shape[0] * df1.shape[1]
        similar_cells = 0
        
        for i in range(df1.shape[0]):
            for j in range(df1.shape[1]):
                val1 = str(df1.iloc[i, j]).strip().lower()
                val2 = str(df2.iloc[i, j]).strip().lower()
                
                if val1 == val2:
                    similar_cells += 1
        
        similarity_ratio = similar_cells / total_cells if total_cells > 0 else 0
        return similarity_ratio > threshold
    
    def _get_page_count(self, pdf_path: str) -> int:
        """Get total number of pages in PDF"""
        try:
            with pdfplumber.open(pdf_path) as pdf:
                return len(pdf.pages)
        except Exception:
            return 0
    
    def _calculate_quality_distribution(self, tables: List[TableResult]) -> Dict[str, int]:
        """Calculate distribution of table qualities"""
        if not tables:
            return {'high': 0, 'medium': 0, 'low': 0}
        
        distribution = {'high': 0, 'medium': 0, 'low': 0}
        
        for table in tables:
            if table.confidence >= 0.8:
                distribution['high'] += 1
            elif table.confidence >= 0.6:
                distribution['medium'] += 1
            else:
                distribution['low'] += 1
        
        return distribution
    
    def _recommend_extraction_method(self, tables: List[TableResult]) -> str:
        """Recommend best extraction method based on detected tables"""
        if not tables:
            return 'text_fallback'
        
        method_scores = {}
        for table in tables:
            method = table.method_used
            if method not in method_scores:
                method_scores[method] = []
            method_scores[method].append(table.confidence)
        
        # Calculate average confidence per method
        method_averages = {
            method: np.mean(scores) 
            for method, scores in method_scores.items()
        }
        
        # Return method with highest average confidence
        best_method = max(method_averages.items(), key=lambda x: x[1])
        return best_method[0]