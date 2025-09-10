#!/usr/bin/env python3
"""
AI Enhanced Transaction Processor

Extends the basic transaction extraction with intelligent AI-powered features:
- Smart transaction classification
- Anomaly detection
- Entity extraction
- Data cleaning and normalization
"""

import os
import json
import logging
import time
from typing import List, Dict, Optional, Any
from dataclasses import dataclass
import groq
from transaction_extractor_service import TransactionExtractorService

logger = logging.getLogger(__name__)

@dataclass
class EnhancedTransaction:
    """Enhanced transaction with AI-powered insights"""
    # Basic fields
    date: str
    description: str
    amount: float
    type: str
    
    # AI-enhanced fields
    category: Optional[str] = None
    subcategory: Optional[str] = None
    merchant_name: Optional[str] = None
    merchant_type: Optional[str] = None
    location: Optional[str] = None
    is_recurring: Optional[bool] = None
    confidence_score: Optional[float] = None
    anomaly_score: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'date': self.date,
            'description': self.description,
            'amount': self.amount,
            'type': self.type,
            'category': self.category,
            'subcategory': self.subcategory,
            'merchant_name': self.merchant_name,
            'merchant_type': self.merchant_type,
            'location': self.location,
            'is_recurring': self.is_recurring,
            'confidence_score': self.confidence_score,
            'anomaly_score': self.anomaly_score
        }

class AIEnhancedProcessor:
    """
    AI-Enhanced Transaction Processor that adds intelligence beyond basic extraction
    """
    
    def __init__(self, config_path: Optional[str] = None, debug: bool = False):
        self.debug = debug
        self.config = self._load_config(config_path) if config_path else self._get_default_config()
        
        # Initialize Groq client
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY environment variable is required")
        
        self.groq_client = groq.Groq(api_key=api_key)
        self.model = "meta-llama/llama-4-scout-17b-16e-instruct"
        
        logger.info("AIEnhancedProcessor initialized")
    
    def _load_config(self, config_path: str) -> Dict:
        """Load configuration from file"""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load config: {e}")
            return self._get_default_config()
    
    def _get_default_config(self) -> Dict:
        """Get default configuration"""
        return {
            "categories": [
                "alimentación", "transporte", "servicios", "entretenimiento", 
                "salud", "educación", "compras", "vivienda", "seguros", "otros"
            ],
            "merchant_types": [
                "restaurante", "supermercado", "gasolinera", "farmacia", 
                "banco", "tienda", "servicio", "gobierno", "otros"
            ],
            "anomaly_thresholds": {
                "amount_multiplier": 3.0,  # 3x el promedio usual
                "frequency_threshold": 0.1  # Menos del 10% de frecuencia usual
            }
        }
    
    def enhance_transactions(self, transactions: List[Dict]) -> List[EnhancedTransaction]:
        """
        Enhance basic transactions with AI-powered insights
        
        Args:
            transactions: List of basic transactions
            
        Returns:
            List of enhanced transactions with AI insights
        """
        if not transactions:
            return []
        
        enhanced_transactions = []
        
        for i, transaction in enumerate(transactions):
            try:
                if self.debug:
                    logger.debug(f"Enhancing transaction {i+1}/{len(transactions)}")
                
                enhanced = self._enhance_single_transaction(transaction, transactions)
                enhanced_transactions.append(enhanced)
                
            except Exception as e:
                logger.warning(f"Failed to enhance transaction {i+1}: {e}")
                # Fallback to basic transaction
                enhanced = EnhancedTransaction(
                    date=transaction.get('date', ''),
                    description=transaction.get('description', ''),
                    amount=transaction.get('amount', 0.0),
                    type=transaction.get('type', 'unknown')
                )
                enhanced_transactions.append(enhanced)
        
        return enhanced_transactions
    
    def _enhance_single_transaction(self, transaction: Dict, all_transactions: List[Dict]) -> EnhancedTransaction:
        """Enhance a single transaction with AI"""
        
        # Step 1: Clean and extract entities
        cleaned_data = self._clean_transaction_with_ai(transaction)
        
        # Step 2: Classify transaction
        classification = self._classify_transaction_with_ai(
            cleaned_data['description'], 
            cleaned_data['amount']
        )
        
        # Step 3: Detect anomalies
        anomaly_score = self._detect_anomaly_with_ai(transaction, all_transactions)
        
        return EnhancedTransaction(
            date=cleaned_data['date'],
            description=cleaned_data['description'],
            amount=cleaned_data['amount'],
            type=cleaned_data['type'],
            category=classification.get('category'),
            subcategory=classification.get('subcategory'),
            merchant_name=cleaned_data.get('merchant_name'),
            merchant_type=classification.get('merchant_type'),
            location=cleaned_data.get('location'),
            is_recurring=classification.get('is_recurring'),
            confidence_score=classification.get('confidence', 0.0),
            anomaly_score=anomaly_score
        )
    
    def _clean_transaction_with_ai(self, transaction: Dict) -> Dict:
        """Clean and extract entities from transaction using AI"""
        
        prompt = f"""
        Limpia y extrae información de esta transacción bancaria:
        
        Fecha: {transaction.get('date', '')}
        Descripción: {transaction.get('description', '')}
        Monto: {transaction.get('amount', 0)}
        Tipo: {transaction.get('type', '')}
        
        Tareas:
        1. Limpiar la descripción (quitar códigos innecesarios, corregir OCR)
        2. Extraer nombre del comercio si está disponible
        3. Extraer ubicación si está disponible
        4. Normalizar formato de fecha
        5. Corregir errores obvios
        
        Devuelve JSON:
        {{
            "date": "YYYY-MM-DD",
            "description": "descripción limpia",
            "amount": número,
            "type": "debit/credit",
            "merchant_name": "nombre del comercio o null",
            "location": "ubicación o null"
        }}
        """
        
        try:
            response = self._call_groq_api(prompt, "transaction cleaning")
            cleaned = self._parse_json_response(response)
            
            # Fallback to original if parsing fails
            if not cleaned:
                return transaction
                
            return cleaned
            
        except Exception as e:
            logger.warning(f"AI cleaning failed: {e}")
            return transaction
    
    def _classify_transaction_with_ai(self, description: str, amount: float) -> Dict:
        """Classify transaction using AI"""
        
        categories = ", ".join(self.config["categories"])
        merchant_types = ", ".join(self.config["merchant_types"])
        
        prompt = f"""
        Clasifica esta transacción bancaria:
        
        Descripción: {description}
        Monto: {amount}
        
        Categorías disponibles: {categories}
        Tipos de comercio: {merchant_types}
        
        Analiza y devuelve JSON:
        {{
            "category": "categoría principal",
            "subcategory": "subcategoría específica",
            "merchant_type": "tipo de comercio",
            "is_recurring": true/false,
            "confidence": 0.0-1.0,
            "reasoning": "breve explicación"
        }}
        
        Considera patrones como:
        - Palabras clave en la descripción
        - Rangos de montos típicos
        - Patrones de comercios conocidos
        """
        
        try:
            response = self._call_groq_api(prompt, "transaction classification")
            classification = self._parse_json_response(response)
            return classification or {}
            
        except Exception as e:
            logger.warning(f"AI classification failed: {e}")
            return {}
    
    def _detect_anomaly_with_ai(self, transaction: Dict, all_transactions: List[Dict]) -> float:
        """Detect anomalies using AI analysis"""
        
        # Simple statistical anomaly detection first
        amounts = [t.get('amount', 0) for t in all_transactions if t.get('type') == transaction.get('type')]
        if not amounts:
            return 0.0
        
        avg_amount = sum(amounts) / len(amounts)
        current_amount = transaction.get('amount', 0)
        
        # Basic anomaly score based on amount deviation
        if avg_amount > 0:
            deviation = abs(current_amount - avg_amount) / avg_amount
            anomaly_score = min(1.0, deviation / 3.0)  # Normalize to 0-1
        else:
            anomaly_score = 0.0
        
        # TODO: Enhance with AI-based pattern analysis
        # For now, return statistical anomaly score
        return anomaly_score
    
    def analyze_spending_patterns(self, transactions: List[Dict]) -> Dict:
        """Analyze spending patterns using AI"""
        
        if not transactions:
            return {"error": "No transactions to analyze"}
        
        # Prepare transaction summary for AI
        summary = {
            "total_transactions": len(transactions),
            "date_range": {
                "start": min(t.get('date', '') for t in transactions),
                "end": max(t.get('date', '') for t in transactions)
            },
            "total_debits": sum(t.get('amount', 0) for t in transactions if t.get('type') == 'debit'),
            "total_credits": sum(t.get('amount', 0) for t in transactions if t.get('type') == 'credit'),
            "sample_transactions": transactions[:10]  # First 10 for analysis
        }
        
        prompt = f"""
        Analiza estos patrones de gasto y proporciona insights:
        
        Resumen: {json.dumps(summary, indent=2)}
        
        Proporciona análisis en JSON:
        {{
            "spending_summary": {{
                "total_spent": número,
                "average_transaction": número,
                "most_frequent_category": "categoría"
            }},
            "insights": [
                "insight 1",
                "insight 2"
            ],
            "recommendations": [
                "recomendación 1",
                "recomendación 2"
            ],
            "alerts": [
                "alerta si hay algo inusual"
            ]
        }}
        """
        
        try:
            response = self._call_groq_api(prompt, "spending analysis")
            analysis = self._parse_json_response(response)
            return analysis or {"error": "Failed to analyze patterns"}
            
        except Exception as e:
            logger.error(f"Spending analysis failed: {e}")
            return {"error": str(e)}
    
    def _call_groq_api(self, prompt: str, operation: str) -> str:
        """Call Groq API with error handling"""
        try:
            chat_completion = self.groq_client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model=self.model,
                temperature=0.1,
                max_tokens=2000
            )
            return chat_completion.choices[0].message.content
            
        except Exception as e:
            logger.error(f"Groq API call failed for {operation}: {e}")
            raise
    
    def _parse_json_response(self, response: str) -> Optional[Dict]:
        """Parse JSON from AI response"""
        try:
            # Look for JSON in code blocks
            import re
            json_match = re.search(r"```json\n(.*?)\n```", response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
            
            # Look for JSON object
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(0))
            
            return None
            
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON response: {e}")
            return None

# Integration with existing processor
def enhance_extraction_result(extraction_result: Dict, config_path: Optional[str] = None, debug: bool = False) -> Dict:
    """
    Enhance existing extraction results with AI insights
    
    Args:
        extraction_result: Result from TransactionExtractorService
        config_path: Optional config path
        debug: Enable debug logging
        
    Returns:
        Enhanced result with AI insights
    """
    try:
        enhancer = AIEnhancedProcessor(config_path, debug)
        
        transactions = extraction_result.get('transactions', [])
        enhanced_transactions = enhancer.enhance_transactions(transactions)
        
        # Convert to dict format
        enhanced_dict = [t.to_dict() for t in enhanced_transactions]
        
        # Add spending analysis
        spending_analysis = enhancer.analyze_spending_patterns(transactions)
        
        # Update result
        enhanced_result = extraction_result.copy()
        enhanced_result['transactions'] = enhanced_dict
        enhanced_result['ai_insights'] = {
            'spending_analysis': spending_analysis,
            'enhancement_applied': True,
            'enhanced_count': len(enhanced_dict)
        }
        
        return enhanced_result
        
    except Exception as e:
        logger.error(f"Enhancement failed: {e}")
        # Return original result if enhancement fails
        return extraction_result

if __name__ == "__main__":
    # Example usage
    sample_transactions = [
        {
            "date": "2025-01-15",
            "description": "COMPRA SUPERMERCADO XYZ MADRID",
            "amount": 45.67,
            "type": "debit"
        },
        {
            "date": "2025-01-14", 
            "description": "TRANSFERENCIA NOMINA EMPRESA ABC",
            "amount": 2500.00,
            "type": "credit"
        }
    ]
    
    enhancer = AIEnhancedProcessor(debug=True)
    enhanced = enhancer.enhance_transactions(sample_transactions)
    
    for transaction in enhanced:
        print(json.dumps(transaction.to_dict(), indent=2, ensure_ascii=False))