#!/usr/bin/env python3
"""
Unit tests for EnhancedDocumentProcessor

Tests the main entry point for enhanced document processing including
intelligent strategy selection, component integration, and quality metrics.
"""

import pytest
import os
import sys
import time
import tempfile
import json
from pathlib import Path
from typing import Dict, Any

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

try:
    from src.services.enhancedDocumentProcessor import (
        EnhancedDocumentProcessor, 
        EnhancedProcessingResult,
        ProcessingMetadata,
        QualityMetrics,
        ProcessingStrategy,
        process_enhanced_document,
        process_enhanced_buffer
    )
    PROCESSOR_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Could not import EnhancedDocumentProcessor: {e}")
    PROCESSOR_AVAILABLE = False


@pytest.fixture
def enhanced_processor():
    """Fixture for EnhancedDocumentProcessor"""
    if not PROCESSOR_AVAILABLE:
        pytest.skip("EnhancedDocumentProcessor not available")
    
    return EnhancedDocumentProcessor(debug=True, enable_caching=False)


@pytest.fixture
def sample_pdf_path():
    """Fixture providing path to a sample PDF file"""
    pdf_dir = Path(__file__).parent / "pdf"
    sample_files = list(pdf_dir.glob("*.pdf")) if pdf_dir.exists() else []
    
    if sample_files:
        return str(sample_files[0])
    else:
        # Create a simple test PDF if none available
        return create_test_pdf()


def create_test_pdf() -> str:
    """Create a simple test PDF for testing"""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib import colors
        
        temp_file = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
        temp_path = temp_file.name
        temp_file.close()
        
        doc = SimpleDocTemplate(temp_path, pagesize=letter)
        styles = getSampleStyleSheet()
        story = []
        
        # Add title
        title = Paragraph("Bank Statement", styles['Title'])
        story.append(title)
        
        # Add account info
        account_info = Paragraph("Account: 1234567890<br/>Period: January 2024", styles['Normal'])
        story.append(account_info)
        
        # Add transaction table
        data = [
            ['Date', 'Description', 'Amount', 'Balance'],
            ['2024-01-15', 'ATM Withdrawal', '-$50.00', '$1,450.00'],
            ['2024-01-16', 'Direct Deposit', '+$2,500.00', '$3,950.00'],
            ['2024-01-17', 'Online Purchase', '-$125.75', '$3,824.25'],
            ['2024-01-18', 'Bank Fee', '-$15.00', '$3,809.25'],
            ['2024-01-19', 'Transfer In', '+$500.00', '$4,309.25']
        ]
        
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 12),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        
        story.append(table)
        doc.build(story)
        
        return temp_path
        
    except ImportError:
        # If reportlab not available, return None
        return None


class TestEnhancedDocumentProcessor:
    """Test suite for EnhancedDocumentProcessor"""
    
    def test_initialization(self, enhanced_processor):
        """Test that EnhancedDocumentProcessor initializes correctly"""
        assert enhanced_processor is not None
        assert hasattr(enhanced_processor, 'format_detector')
        assert hasattr(enhanced_processor, 'table_detector')
        assert hasattr(enhanced_processor, 'ocr_engine')
        assert hasattr(enhanced_processor, 'image_preprocessor')
        assert hasattr(enhanced_processor, 'nlp_validator')
        assert hasattr(enhanced_processor, 'strategies')
        
        # Test configuration
        assert enhanced_processor.config is not None
        assert 'primary_tools' in enhanced_processor.config
        assert 'quality_thresholds' in enhanced_processor.config
    
    def test_get_supported_formats(self, enhanced_processor):
        """Test getting supported formats"""
        formats = enhanced_processor.get_supported_formats()
        
        assert isinstance(formats, list)
        assert len(formats) > 0
        assert 'pdf' in formats
        assert 'jpg' in formats
        assert 'xlsx' in formats
        assert 'docx' in formats
    
    def test_processing_strategies_initialization(self, enhanced_processor):
        """Test that processing strategies are properly initialized"""
        strategies = enhanced_processor.strategies
        
        assert isinstance(strategies, dict)
        assert 'pdf' in strategies
        assert 'image' in strategies
        assert 'excel' in strategies
        assert 'word' in strategies
        
        # Test PDF strategy
        pdf_strategy = strategies['pdf']
        assert isinstance(pdf_strategy, ProcessingStrategy)
        assert pdf_strategy.format_type == 'pdf'
        assert pdf_strategy.primary_method == 'modern_pipeline'
        assert pdf_strategy.parallel_processing is True
    
    def test_process_document_nonexistent_file(self, enhanced_processor):
        """Test processing non-existent file"""
        result = enhanced_processor.process_document("nonexistent_file.pdf")
        
        assert isinstance(result, EnhancedProcessingResult)
        assert result.success is False
        assert result.error_message is not None
        assert "not found" in result.error_message.lower()
        assert len(result.transactions) == 0
        assert result.confidence_score == 0.0
    
    def test_process_document_with_pdf(self, enhanced_processor, sample_pdf_path):
        """Test processing a PDF document"""
        if sample_pdf_path is None:
            pytest.skip("No sample PDF available for testing")
        
        result = enhanced_processor.process_document(sample_pdf_path)
        
        assert isinstance(result, EnhancedProcessingResult)
        assert result.processing_time > 0
        assert isinstance(result.metadata, ProcessingMetadata)
        assert isinstance(result.metadata.quality_metrics, QualityMetrics)
        
        # Check metadata
        assert result.metadata.format_detected in ['pdf', 'unknown']
        assert result.metadata.strategy_used is not None
        assert len(result.metadata.components_used) > 0
        
        # Check quality metrics
        quality = result.metadata.quality_metrics
        assert 0.0 <= quality.overall_confidence <= 1.0
        assert 0.0 <= quality.completeness <= 1.0
        assert 0.0 <= quality.consistency <= 1.0
        assert isinstance(quality.component_scores, dict)
        
        print(f"PDF Processing Results:")
        print(f"  Success: {result.success}")
        print(f"  Transactions: {len(result.transactions)}")
        print(f"  Confidence: {result.confidence_score:.2f}")
        print(f"  Processing time: {result.processing_time:.2f}s")
        print(f"  Strategy used: {result.metadata.strategy_used}")
        print(f"  Components used: {result.metadata.components_used}")
    
    def test_process_from_buffer(self, enhanced_processor, sample_pdf_path):
        """Test processing document from buffer"""
        if sample_pdf_path is None:
            pytest.skip("No sample PDF available for testing")
        
        # Read PDF into buffer
        with open(sample_pdf_path, 'rb') as f:
            pdf_buffer = f.read()
        
        result = enhanced_processor.process_from_buffer(pdf_buffer, "test_document.pdf")
        
        assert isinstance(result, EnhancedProcessingResult)
        assert result.processing_time > 0
        assert isinstance(result.metadata, ProcessingMetadata)
        
        print(f"Buffer Processing Results:")
        print(f"  Success: {result.success}")
        print(f"  Transactions: {len(result.transactions)}")
        print(f"  Confidence: {result.confidence_score:.2f}")
    
    def test_process_empty_buffer(self, enhanced_processor):
        """Test processing empty buffer"""
        result = enhanced_processor.process_from_buffer(b"", "empty.pdf")
        
        assert isinstance(result, EnhancedProcessingResult)
        assert result.success is False
        assert "empty" in result.error_message.lower()
        assert len(result.transactions) == 0
    
    def test_quality_metrics_calculation(self, enhanced_processor):
        """Test quality metrics calculation"""
        # Create mock result for testing
        class MockResult:
            def __init__(self):
                self.success = True
                self.transactions = [
                    {
                        'date': '2024-01-15',
                        'amount': '$100.00',
                        'description': 'Test transaction',
                        'confidence': 0.9,
                        'validation': {
                            'is_valid': True,
                            'confidence': 0.85,
                            'quality_score': 0.8,
                            'anomalies': []
                        }
                    },
                    {
                        'date': '2024-01-16',
                        'amount': '$200.00',
                        'description': 'Another transaction',
                        'confidence': 0.7,
                        'validation': {
                            'is_valid': True,
                            'confidence': 0.75,
                            'quality_score': 0.7,
                            'anomalies': ['minor_issue']
                        }
                    }
                ]
                self.components_used = ['modern_table_detector', 'nlp_validator']
                self.tables_found = 1
        
        mock_result = MockResult()
        quality_metrics = enhanced_processor._calculate_comprehensive_quality_metrics(mock_result)
        
        assert isinstance(quality_metrics, QualityMetrics)
        assert 0.0 <= quality_metrics.overall_confidence <= 1.0
        assert 0.0 <= quality_metrics.completeness <= 1.0
        assert quality_metrics.anomaly_count == 1  # One transaction has an anomaly
        assert quality_metrics.high_confidence_ratio > 0.0
        assert isinstance(quality_metrics.component_scores, dict)
        
        print(f"Quality Metrics Test:")
        print(f"  Overall confidence: {quality_metrics.overall_confidence:.2f}")
        print(f"  Completeness: {quality_metrics.completeness:.2f}")
        print(f"  Consistency: {quality_metrics.consistency:.2f}")
        print(f"  Anomaly count: {quality_metrics.anomaly_count}")
    
    def test_recommendations_generation(self, enhanced_processor):
        """Test recommendations generation"""
        # Create mock result with low quality
        class MockResult:
            def __init__(self):
                self.success = True
                self.transactions = [{'description': 'incomplete transaction'}]
                self.components_used = ['modern_ocr_engine']
                self.fallback_used = True
        
        mock_result = MockResult()
        
        # Create low quality metrics
        quality_metrics = QualityMetrics(
            overall_confidence=0.4,
            text_quality=0.3,
            table_quality=0.0,
            ocr_quality=0.3,
            validation_score=0.5,
            completeness=0.2,
            consistency=0.6,
            processing_method='ocr',
            component_scores={},
            anomaly_count=2,
            high_confidence_ratio=0.1
        )
        
        strategy = ProcessingStrategy(
            format_type='pdf',
            primary_method='modern_pipeline',
            fallback_methods=[],
            quality_threshold=0.7,
            parallel_processing=True,
            preprocessing_required=False
        )
        
        recommendations = enhanced_processor._generate_recommendations(mock_result, quality_metrics, strategy)
        
        assert isinstance(recommendations, list)
        assert len(recommendations) > 0
        
        # Should recommend manual review due to low confidence
        assert any('manual review' in rec.lower() for rec in recommendations)
        
        # Should mention OCR quality issues
        assert any('ocr' in rec.lower() for rec in recommendations)
        
        # Should mention fallback usage
        assert any('fallback' in rec.lower() for rec in recommendations)
        
        print(f"Generated Recommendations:")
        for i, rec in enumerate(recommendations, 1):
            print(f"  {i}. {rec}")
    
    def test_processing_statistics(self, enhanced_processor):
        """Test processing statistics tracking"""
        initial_stats = enhanced_processor.get_processing_stats()
        
        assert isinstance(initial_stats, dict)
        assert 'documents_processed' in initial_stats
        assert 'total_processing_time' in initial_stats
        assert 'component_usage' in initial_stats
        assert 'cache_hit_rate' in initial_stats
        assert 'fallback_rate' in initial_stats
        
        # Initial values should be zero
        assert initial_stats['documents_processed'] == 0
        assert initial_stats['total_processing_time'] == 0.0
        assert initial_stats['cache_hit_rate'] == 0.0
    
    def test_error_handling(self, enhanced_processor):
        """Test error handling and error result creation"""
        error_result = enhanced_processor._create_error_result(
            "Test error message", 
            "TEST_ERROR", 
            {"test_detail": "test_value"}
        )
        
        assert isinstance(error_result, EnhancedProcessingResult)
        assert error_result.success is False
        assert error_result.error_message == "Test error message"
        assert error_result.confidence_score == 0.0
        assert len(error_result.transactions) == 0
        
        # Check metadata
        assert isinstance(error_result.metadata, ProcessingMetadata)
        assert error_result.metadata.total_transactions == 0
        assert error_result.metadata.format_detected == "unknown"
        assert isinstance(error_result.metadata.quality_metrics, QualityMetrics)
        assert error_result.metadata.quality_metrics.overall_confidence == 0.0
    
    def test_result_serialization(self, enhanced_processor):
        """Test result serialization to dictionary"""
        # Create a mock result
        metadata = ProcessingMetadata(
            processing_time=1.5,
            total_transactions=2,
            tables_found=1,
            text_regions_found=3,
            format_detected='pdf',
            strategy_used='modern_pipeline',
            components_used=['modern_table_detector'],
            preprocessing_applied=False,
            fallback_used=False,
            quality_metrics=QualityMetrics(
                overall_confidence=0.8,
                text_quality=0.9,
                table_quality=0.8,
                ocr_quality=0.7,
                validation_score=0.85,
                completeness=0.9,
                consistency=0.8,
                processing_method='table_detection',
                component_scores={'table': 0.8},
                anomaly_count=0,
                high_confidence_ratio=0.8
            ),
            recommendations=['Good quality processing']
        )
        
        result = EnhancedProcessingResult(
            success=True,
            transactions=[{'test': 'transaction'}],
            metadata=metadata,
            processing_time=1.5,
            confidence_score=0.8
        )
        
        result_dict = result.to_dict()
        
        assert isinstance(result_dict, dict)
        assert result_dict['success'] is True
        assert result_dict['confidence_score'] == 0.8
        assert result_dict['processing_time'] == 1.5
        assert len(result_dict['transactions']) == 1
        assert 'meta' in result_dict
        assert result_dict['provider'] == 'enhanced_document_processor'
        
        # Test JSON serialization
        json_str = json.dumps(result_dict)
        assert isinstance(json_str, str)
        assert len(json_str) > 0
    
    def test_context_manager(self, enhanced_processor):
        """Test context manager functionality"""
        with enhanced_processor as processor:
            assert processor is not None
            stats = processor.get_processing_stats()
            assert isinstance(stats, dict)
        
        # After context exit, cleanup should have been called
        # (We can't easily test this without side effects, but we can verify it doesn't crash)
    
    def test_convenience_functions(self, sample_pdf_path):
        """Test convenience functions"""
        if not PROCESSOR_AVAILABLE:
            pytest.skip("EnhancedDocumentProcessor not available")
        
        if sample_pdf_path is None:
            pytest.skip("No sample PDF available for testing")
        
        # Test process_enhanced_document
        result_dict = process_enhanced_document(sample_pdf_path, debug=True)
        
        assert isinstance(result_dict, dict)
        assert 'success' in result_dict
        assert 'transactions' in result_dict
        assert 'meta' in result_dict
        assert 'confidence_score' in result_dict
        
        # Test process_enhanced_buffer
        with open(sample_pdf_path, 'rb') as f:
            buffer = f.read()
        
        buffer_result_dict = process_enhanced_buffer(buffer, "test.pdf", debug=True)
        
        assert isinstance(buffer_result_dict, dict)
        assert 'success' in buffer_result_dict
        assert 'transactions' in buffer_result_dict


class TestEnhancedProcessorIntegration:
    """Integration tests for EnhancedDocumentProcessor"""
    
    def test_full_processing_pipeline(self, enhanced_processor, sample_pdf_path):
        """Test complete processing pipeline integration"""
        if sample_pdf_path is None:
            pytest.skip("No sample PDF available for testing")
        
        start_time = time.time()
        result = enhanced_processor.process_document(sample_pdf_path)
        end_time = time.time()
        
        # Verify result structure
        assert isinstance(result, EnhancedProcessingResult)
        assert result.processing_time > 0
        assert result.processing_time <= (end_time - start_time) + 1.0  # Allow some margin
        
        # Verify metadata completeness
        metadata = result.metadata
        assert metadata.format_detected is not None
        assert metadata.strategy_used is not None
        assert len(metadata.components_used) > 0
        assert isinstance(metadata.quality_metrics, QualityMetrics)
        assert isinstance(metadata.recommendations, list)
        
        # Verify quality metrics are reasonable
        quality = metadata.quality_metrics
        assert 0.0 <= quality.overall_confidence <= 1.0
        assert 0.0 <= quality.completeness <= 1.0
        assert 0.0 <= quality.consistency <= 1.0
        assert quality.anomaly_count >= 0
        assert 0.0 <= quality.high_confidence_ratio <= 1.0
        
        # Print comprehensive results
        print(f"\n=== FULL PIPELINE INTEGRATION TEST ===")
        print(f"Success: {result.success}")
        print(f"Processing time: {result.processing_time:.2f}s")
        print(f"Transactions found: {len(result.transactions)}")
        print(f"Overall confidence: {result.confidence_score:.2f}")
        print(f"Format detected: {metadata.format_detected}")
        print(f"Strategy used: {metadata.strategy_used}")
        print(f"Components used: {', '.join(metadata.components_used)}")
        print(f"Tables found: {metadata.tables_found}")
        print(f"Text regions found: {metadata.text_regions_found}")
        print(f"Preprocessing applied: {metadata.preprocessing_applied}")
        print(f"Fallback used: {metadata.fallback_used}")
        
        print(f"\nQuality Metrics:")
        print(f"  Overall confidence: {quality.overall_confidence:.2f}")
        print(f"  Text quality: {quality.text_quality:.2f}")
        print(f"  Table quality: {quality.table_quality:.2f}")
        print(f"  OCR quality: {quality.ocr_quality:.2f}")
        print(f"  Validation score: {quality.validation_score:.2f}")
        print(f"  Completeness: {quality.completeness:.2f}")
        print(f"  Consistency: {quality.consistency:.2f}")
        print(f"  Anomaly count: {quality.anomaly_count}")
        print(f"  High confidence ratio: {quality.high_confidence_ratio:.2f}")
        
        if metadata.recommendations:
            print(f"\nRecommendations:")
            for i, rec in enumerate(metadata.recommendations, 1):
                print(f"  {i}. {rec}")
        
        # Update processor stats
        stats = enhanced_processor.get_processing_stats()
        print(f"\nProcessor Statistics:")
        print(f"  Documents processed: {stats['documents_processed']}")
        print(f"  Total processing time: {stats['total_processing_time']:.2f}s")
        print(f"  Average processing time: {stats['average_processing_time']:.2f}s")
        print(f"  Component usage: {stats['component_usage']}")


def run_tests():
    """Run all tests"""
    if not PROCESSOR_AVAILABLE:
        print("EnhancedDocumentProcessor not available. Skipping tests.")
        return False
    
    # Run pytest
    import subprocess
    result = subprocess.run([
        'python', '-m', 'pytest', __file__, '-v', '-s', '--tb=short'
    ], capture_output=False)
    
    return result.returncode == 0


if __name__ == "__main__":
    success = run_tests()
    exit(0 if success else 1)