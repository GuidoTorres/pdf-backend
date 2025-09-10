"""
Test script for Statistical Analysis Integration
Tests the complete statistical analysis and adaptive learning system
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

from services.statisticalAnalysisIntegration import StatisticalAnalysisIntegration
import json
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_statistical_analysis_integration():
    """Test the complete statistical analysis integration"""
    
    logger.info("Starting Statistical Analysis Integration Test")
    
    # Initialize the integration system
    integration = StatisticalAnalysisIntegration()
    
    # Sample document content
    document_content = {
        'text': 'BANCO SANTANDER\nExtracto de cuenta\nFecha: 15/01/2024\nSaldo anterior: 1,250.50€\nMovimientos:\n15/01/2024 Transferencia recibida 500.00€\n16/01/2024 Compra supermercado -45.30€\n17/01/2024 Cajero automático -50.00€',
        'tables': [
            {
                'data': [
                    ['Fecha', 'Descripción', 'Importe'],
                    ['15/01/2024', 'Transferencia recibida', '500.00€'],
                    ['16/01/2024', 'Compra supermercado', '-45.30€'],
                    ['17/01/2024', 'Cajero automático', '-50.00€']
                ]
            }
        ],
        'confidence': 0.85
    }
    
    # Sample metadata
    metadata = {
        'file_extension': 'pdf',
        'file_size': 245760,  # ~240KB
        'page_count': 1,
        'document_type': 'bank_statement',
        'bank_type': 'santander',
        'format_type': 'pdf_native'
    }
    
    # Sample extracted transactions
    transactions = [
        {
            'date': '15/01/2024',
            'description': 'Transferencia recibida',
            'amount': '500.00€',
            'confidence': 0.9
        },
        {
            'date': '16/01/2024',
            'description': 'Compra supermercado',
            'amount': '-45.30€',
            'confidence': 0.85
        },
        {
            'date': '17/01/2024',
            'description': 'Cajero automático',
            'amount': '-50.00€',
            'confidence': 0.8
        }
    ]
    
    try:
        # Test comprehensive analysis
        logger.info("Testing comprehensive document analysis...")
        results = integration.analyze_document_and_optimize(document_content, metadata, transactions)
        
        logger.info("Analysis Results:")
        logger.info(f"- Processing ID: {results['processing_id']}")
        logger.info(f"- Statistical Analysis: {len(results['analysis_results']['statistical_analysis']['anomalies'])} anomalies detected")
        logger.info(f"- Document Classification: {results['analysis_results']['pattern_recognition']['document_classification']['document_type']}")
        logger.info(f"- Bank Identification: {results['analysis_results']['pattern_recognition']['bank_identification']['bank_name']}")
        logger.info(f"- Performance Recommendations: {len(results['optimization_recommendations']['performance']['recommendations'])} recommendations")
        
        # Test system insights
        logger.info("\nTesting system insights...")
        insights = integration.get_system_insights()
        
        logger.info("System Insights:")
        logger.info(f"- System Health: {insights['system_health']['status']}")
        logger.info(f"- Pattern Recognition: {insights['pattern_recognition']['document_patterns']} document patterns")
        logger.info(f"- Adaptive Configuration: {insights['adaptive_configuration']['total_profiles']} configuration profiles")
        
        # Test automatic optimization
        logger.info("\nTesting automatic optimization...")
        optimization_results = integration.optimize_system_automatically()
        
        logger.info("Optimization Results:")
        logger.info(f"- Applied Optimizations: {len(optimization_results['optimizations_applied'])}")
        logger.info(f"- Performance Recommendations: {len(optimization_results['recommendations']['performance'])}")
        logger.info(f"- Configuration Recommendations: {len(optimization_results['recommendations']['configuration'])}")
        
        # Test learning progress
        logger.info("\nTesting learning progress...")
        learning_progress = integration.get_learning_progress()
        
        logger.info("Learning Progress:")
        logger.info(f"- Pattern Recognition Patterns: {learning_progress['pattern_recognition']['document_patterns']}")
        logger.info(f"- Adaptive Configuration Profiles: {learning_progress['adaptive_configuration']['total_profiles']}")
        logger.info(f"- Performance Tracking Operations: {learning_progress['performance_tracking']['total_operations']}")
        
        logger.info("\n✅ Statistical Analysis Integration Test PASSED")
        
        # Save results for inspection
        with open('backend/test_results_statistical_analysis.json', 'w') as f:
            json.dump({
                'analysis_results': results,
                'system_insights': insights,
                'optimization_results': optimization_results,
                'learning_progress': learning_progress
            }, f, indent=2, default=str)
        
        logger.info("Test results saved to backend/test_results_statistical_analysis.json")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Statistical Analysis Integration Test FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_statistical_analysis_integration()
    sys.exit(0 if success else 1)