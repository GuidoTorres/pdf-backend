# Statistical Analysis and Adaptive Learning System

This document describes the implementation of Task 11: "Add statistical analysis and adaptive learning" from the document extraction reliability specification.

## Overview

The statistical analysis and adaptive learning system consists of four main components that work together to improve document extraction reliability through intelligent analysis and automatic optimization:

1. **Statistical Analyzer** - Detects anomalies in extracted transactions
2. **Pattern Recognition System** - Identifies document formats and bank types
3. **Adaptive Configuration System** - Learns optimal settings for different document types
4. **Performance Tracking System** - Tracks performance and generates optimization recommendations

## Components

### 1. Statistical Analyzer (`statisticalAnalyzer.py`)

**Purpose**: Implements statistical analysis for anomaly detection in extracted transactions.

**Key Features**:

- Detects amount outliers using Z-score analysis
- Validates date formats and ranges
- Identifies suspicious description patterns
- Uses machine learning (Isolation Forest) for statistical outlier detection
- Provides detailed anomaly reports with confidence scores

**Usage**:

```python
from services.statisticalAnalyzer import StatisticalAnalyzer

analyzer = StatisticalAnalyzer()
anomalies, metrics = analyzer.analyze_transactions(transactions)
```

### 2. Pattern Recognition System (`patternRecognitionSystem.py`)

**Purpose**: Recognizes document formats and bank types for optimal processing strategy selection.

**Key Features**:

- Automatic document format classification (PDF native/scanned, Excel, Word, Image)
- Bank identification using text patterns and transaction analysis
- Document layout type detection (tabular, list, mixed)
- Learning from new documents to improve recognition accuracy
- Optimal extraction strategy recommendations

**Usage**:

```python
from services.patternRecognitionSystem import PatternRecognitionSystem

pattern_system = PatternRecognitionSystem()
doc_classification = pattern_system.identify_document_format(content, metadata)
bank_identification = pattern_system.identify_bank_type(content, transactions)
```

### 3. Adaptive Configuration System (`adaptiveConfigurationSystem.py`)

**Purpose**: Learns optimal settings for different document types and automatically adjusts configuration.

**Key Features**:

- Maintains configuration profiles for different document/bank combinations
- Records performance metrics for each configuration
- Automatically adapts settings based on historical performance
- Provides configuration recommendations for improvement
- Supports A/B testing of different configurations

**Usage**:

```python
from services.adaptiveConfigurationSystem import AdaptiveConfigurationSystem

adaptive_config = AdaptiveConfigurationSystem()
optimal_config = adaptive_config.get_optimal_configuration(doc_type, bank_type, characteristics)
```

### 4. Performance Tracking System (`performanceTrackingSystem.py`)

**Purpose**: Tracks performance metrics and automatically optimizes based on historical results.

**Key Features**:

- Real-time performance tracking during document processing
- Comprehensive performance analysis and trend detection
- Method performance comparison (OCR, table detection, etc.)
- Resource usage analysis (memory, CPU)
- Automatic optimization recommendations
- System health monitoring

**Usage**:

```python
from services.performanceTrackingSystem import PerformanceTrackingSystem

tracker = PerformanceTrackingSystem()
processing_id = tracker.start_processing_tracking(document_info)
# ... process document ...
metrics = tracker.complete_processing_tracking(processing_id, results)
```

### 5. Integration Service (`statisticalAnalysisIntegration.py`)

**Purpose**: Integrates all components into a unified system for comprehensive analysis.

**Key Features**:

- Orchestrates all statistical analysis components
- Provides single entry point for comprehensive document analysis
- Generates combined optimization recommendations
- Manages adaptive learning across all components

**Usage**:

```python
from services.statisticalAnalysisIntegration import StatisticalAnalysisIntegration

integration = StatisticalAnalysisIntegration()
results = integration.analyze_document_and_optimize(content, metadata, transactions)
```

## Requirements Addressed

This implementation addresses the following requirements from the specification:

### Requirement 7.1

✅ **Statistical Analysis for Anomaly Detection**: The `StatisticalAnalyzer` uses statistical methods to detect transactions with outlier values or suspicious patterns that indicate extraction errors.

### Requirement 7.2

✅ **Pattern Analysis for Document Format**: The `PatternRecognitionSystem` uses text pattern analysis to identify document format and structure, automatically optimizing extraction configuration.

### Requirement 7.3

✅ **Error Pattern Analysis**: The system uses frequency analysis to identify recurring error patterns and automatically adjusts OCR and validation configurations.

### Requirement 8.1

✅ **Performance Metrics Recording**: The `PerformanceTrackingSystem` records success metrics for each extraction method and optimizes technique selection for similar documents.

### Requirement 8.2

✅ **Adaptive Configuration**: The `AdaptiveConfigurationSystem` creates optimized configuration profiles for different bank and document types, automatically adjusting parameters based on historical data.

## Installation

The system requires additional dependencies for statistical analysis:

```bash
pip install scipy scikit-learn
```

These dependencies are included in the updated `requirements.txt` file.

## Testing

Run the integration test to verify the system works correctly:

```bash
python backend/test_statistical_analysis_integration.py
```

The test will:

1. Initialize all components
2. Process a sample bank statement
3. Generate statistical analysis and anomaly detection
4. Perform pattern recognition and bank identification
5. Create adaptive configuration profiles
6. Track performance metrics
7. Generate optimization recommendations

## Data Storage

The system stores learned patterns and configurations in:

- `backend/src/models/` - Pattern recognition models and learned patterns
- `backend/src/config/` - Adaptive configuration profiles
- `backend/src/data/performance/` - Performance metrics and history

## Integration with Existing System

To integrate with the existing document processing pipeline:

1. **Import the integration service**:

```python
from services.statisticalAnalysisIntegration import StatisticalAnalysisIntegration
```

2. **Initialize during system startup**:

```python
statistical_system = StatisticalAnalysisIntegration()
```

3. **Use in document processing**:

```python
# After extracting transactions from a document
analysis_results = statistical_system.analyze_document_and_optimize(
    document_content, metadata, transactions
)

# Use the optimal configuration for future similar documents
optimal_config = analysis_results['optimization_recommendations']['configuration']['optimal_config']
```

4. **Monitor system performance**:

```python
# Get system insights
insights = statistical_system.get_system_insights()

# Get automatic optimization recommendations
optimizations = statistical_system.optimize_system_automatically()
```

## Benefits

This implementation provides:

1. **Improved Accuracy**: Automatic anomaly detection helps identify and correct extraction errors
2. **Adaptive Learning**: System learns from experience and improves over time
3. **Optimal Configuration**: Automatically selects best settings for each document type
4. **Performance Monitoring**: Tracks system performance and identifies optimization opportunities
5. **Intelligent Processing**: Uses pattern recognition to apply optimal extraction strategies
6. **Continuous Improvement**: System automatically optimizes based on historical performance data

## Future Enhancements

Potential improvements include:

- Integration with more advanced ML models for pattern recognition
- Real-time anomaly detection during extraction
- Advanced statistical models for trend prediction
- Integration with external data sources for validation
- Enhanced visualization of performance metrics and trends
