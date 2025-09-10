#!/usr/bin/env python3
"""
NLP Validator using spaCy

This module implements intelligent transaction validation using spaCy for
entity extraction, transaction type classification, and anomaly detection
for banking document processing.
"""

import logging
import time
import re
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass
from datetime import datetime

# spaCy imports
try:
    import spacy
    from spacy.matcher import Matcher
    SPACY_AVAILABLE = True
except ImportError:
    SPACY_AVAILABLE = False


@dataclass
class Entity:
    """Extracted entity information"""
    text: str
    label: str
    start: int
    end: int
    confidence: float
    normalized_value: Optional[str] = None


@dataclass
class ValidationResult:
    """Result of transaction validation"""
    is_valid: bool
    confidence: float
    entities: List[Entity]
    transaction_type: Optional[str]
    anomalies: List[str]
    suggestions: List[str]
    quality_score: float
    metadata: Dict[str, Any]


@dataclass
class ClassificationResult:
    """Result of transaction type classification"""
    transaction_type: str
    confidence: float
    reasoning: str
    alternative_types: List[Tuple[str, float]]


@dataclass
class AnomalyResult:
    """Result of anomaly detection"""
    anomaly_type: str
    description: str
    severity: str  # 'low', 'medium', 'high'
    confidence: float
    affected_field: Optional[str]
    suggested_correction: Optional[str]


class NLPValidator:
    """
    NLP validator using spaCy for intelligent transaction validation.
    
    Features:
    - Entity extraction for banking terms (amounts, dates, organizations)
    - Transaction type classification using NLP patterns and context
    - Anomaly detection for suspicious or malformed transaction descriptions
    - Multi-language support (Spanish and English)
    """
    
    def __init__(self, model_name: str = "es_core_news_sm", debug: bool = False):
        """
        Initialize the NLP Validator.
        
        Args:
            model_name: spaCy model to use (default: Spanish model)
            debug: Enable debug logging
        """
        self.model_name = model_name
        self.debug = debug
        self.logger = self._setup_logger()
        
        # Initialize spaCy model
        self.nlp = None
        self.matcher = None
        self._initialize_spacy()
        
        # Banking patterns and vocabularies
        self.banking_patterns = self._load_banking_patterns()
        self.transaction_types = self._load_transaction_types()
        self.anomaly_patterns = self._load_anomaly_patterns()
        
        # Validation thresholds
        self.thresholds = {
            'min_confidence': 0.5,
            'entity_confidence': 0.6,
            'classification_confidence': 0.7,
            'anomaly_threshold': 0.8,
            'min_description_length': 3,
            'max_description_length': 200
        }
        
        self.logger.info(f"NLPValidator initialized with model: {model_name}")
    
    def _setup_logger(self) -> logging.Logger:
        """Set up logger with consistent formatting"""
        logger = logging.getLogger(f"{__name__}.NLPValidator")
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        
        logger.setLevel(logging.DEBUG if self.debug else logging.INFO)
        return logger
    
    def _initialize_spacy(self):
        """Initialize spaCy model and matcher"""
        if not SPACY_AVAILABLE:
            self.logger.error("spaCy not available. Please install with: pip install spacy")
            return
        
        try:
            self.logger.info(f"Loading spaCy model: {self.model_name}")
            self.nlp = spacy.load(self.model_name)
            
            # Initialize matcher for pattern-based entity extraction
            self.matcher = Matcher(self.nlp.vocab)
            self._add_banking_patterns()
            
            self.logger.info("spaCy model and matcher initialized successfully")
            
        except OSError as e:
            self.logger.error(f"Failed to load spaCy model '{self.model_name}': {e}")
            self.logger.info("Try installing the model with: python -m spacy download es_core_news_sm")
            self.nlp = None
            self.matcher = None
        except Exception as e:
            self.logger.error(f"Failed to initialize spaCy: {e}")
            self.nlp = None
            self.matcher = None
    
    def validate_with_context(self, transaction: Dict[str, Any]) -> ValidationResult:
        """
        Validate a transaction with contextual analysis.
        
        Args:
            transaction: Transaction dictionary with fields like 'description', 'amount', 'date'
            
        Returns:
            ValidationResult with validation details and suggestions
        """
        if self.nlp is None:
            return ValidationResult(
                is_valid=False,
                confidence=0.0,
                entities=[],
                transaction_type=None,
                anomalies=["spaCy model not available"],
                suggestions=["Install spaCy model: python -m spacy download es_core_news_sm"],
                quality_score=0.0,
                metadata={'error': 'spaCy not initialized'}
            )
        
        try:
            start_time = time.time()
            
            # Extract text for analysis
            description = transaction.get('description', '').strip()
            
            if not description:
                return ValidationResult(
                    is_valid=False,
                    confidence=0.0,
                    entities=[],
                    transaction_type=None,
                    anomalies=["Empty transaction description"],
                    suggestions=["Provide transaction description"],
                    quality_score=0.0,
                    metadata={'error': 'No description provided'}
                )
            
            # Process text with spaCy
            doc = self.nlp(description)
            
            # Extract entities
            entities = self.extract_entities(description)
            
            # Classify transaction type
            classification = self.classify_transaction_type(description)
            
            # Detect anomalies
            anomalies = self.detect_anomalies([transaction])
            transaction_anomalies = [a for a in anomalies if a.affected_field in ['description', 'amount', 'date']]
            
            # Calculate confidence and quality
            confidence = self._calculate_confidence(entities, classification, transaction_anomalies)
            quality_score = self._calculate_quality_score(description, entities, classification)
            
            # Generate suggestions
            suggestions = self._generate_suggestions(transaction, entities, classification)
            
            # Determine if transaction is valid
            is_valid = (
                confidence >= self.thresholds['min_confidence'] and
                len([a for a in transaction_anomalies if a.severity == 'high']) == 0
            )
            
            processing_time = time.time() - start_time
            
            metadata = {
                'processing_time': processing_time,
                'spacy_model': self.model_name,
                'doc_length': len(doc),
                'tokens_processed': len([token for token in doc if not token.is_space])
            }
            
            return ValidationResult(
                is_valid=is_valid,
                confidence=confidence,
                entities=entities,
                transaction_type=classification.transaction_type if classification else None,
                anomalies=[a.description for a in transaction_anomalies],
                suggestions=suggestions,
                quality_score=quality_score,
                metadata=metadata
            )
            
        except Exception as e:
            self.logger.error(f"Transaction validation failed: {e}", exc_info=True)
            return ValidationResult(
                is_valid=False,
                confidence=0.0,
                entities=[],
                transaction_type=None,
                anomalies=[f"Validation error: {str(e)}"],
                suggestions=["Check transaction data format"],
                quality_score=0.0,
                metadata={'error': str(e)}
            )
    
    def extract_entities(self, text: str) -> List[Entity]:
        """
        Extract banking-related entities from text.
        
        Args:
            text: Input text to analyze
            
        Returns:
            List of extracted entities
        """
        if self.nlp is None:
            return []
        
        try:
            doc = self.nlp(text)
            entities = []
            
            # Extract named entities from spaCy
            for ent in doc.ents:
                entity = Entity(
                    text=ent.text,
                    label=ent.label_,
                    start=ent.start_char,
                    end=ent.end_char,
                    confidence=self._calculate_entity_confidence(ent),
                    normalized_value=self._normalize_entity_value(ent)
                )
                entities.append(entity)
            
            # Extract custom banking entities
            banking_entities = self._extract_banking_entities(text)
            entities.extend(banking_entities)
            
            # Remove overlaps and sort
            entities = self._remove_overlapping_entities(entities)
            
            return entities
            
        except Exception as e:
            self.logger.error(f"Entity extraction failed: {e}", exc_info=True)
            return []
    
    def classify_transaction_type(self, description: str) -> Optional[ClassificationResult]:
        """
        Classify transaction type using NLP patterns and context.
        
        Args:
            description: Transaction description
            
        Returns:
            ClassificationResult with predicted type and confidence
        """
        if self.nlp is None or not description.strip():
            return None
        
        try:
            # Score each transaction type
            type_scores = {}
            
            for trans_type, patterns in self.transaction_types.items():
                score = 0.0
                matched_patterns = []
                
                # Check keyword patterns
                for keyword in patterns.get('keywords', []):
                    if keyword.lower() in description.lower():
                        score += patterns.get('keyword_weight', 1.0)
                        matched_patterns.append(f"keyword: {keyword}")
                
                # Check regex patterns
                for pattern in patterns.get('regex_patterns', []):
                    if re.search(pattern, description, re.IGNORECASE):
                        score += patterns.get('regex_weight', 1.5)
                        matched_patterns.append(f"regex: {pattern}")
                
                if score > 0:
                    type_scores[trans_type] = {
                        'score': score,
                        'patterns': matched_patterns
                    }
            
            if not type_scores:
                return ClassificationResult(
                    transaction_type="unknown",
                    confidence=0.0,
                    reasoning="No matching patterns found",
                    alternative_types=[]
                )
            
            # Sort by score and normalize
            sorted_types = sorted(type_scores.items(), key=lambda x: x[1]['score'], reverse=True)
            max_score = sorted_types[0][1]['score']
            
            # Normalize scores to 0-1 range
            normalized_scores = [
                (trans_type, min(1.0, info['score'] / max_score))
                for trans_type, info in sorted_types
            ]
            
            best_type, best_confidence = normalized_scores[0]
            alternatives = normalized_scores[1:3]  # Top 2 alternatives
            
            reasoning = f"Matched patterns: {', '.join(type_scores[best_type]['patterns'])}"
            
            return ClassificationResult(
                transaction_type=best_type,
                confidence=best_confidence,
                reasoning=reasoning,
                alternative_types=alternatives
            )
            
        except Exception as e:
            self.logger.error(f"Transaction classification failed: {e}", exc_info=True)
            return None
    
    def detect_anomalies(self, transactions: List[Dict[str, Any]]) -> List[AnomalyResult]:
        """
        Detect anomalies in transaction data.
        
        Args:
            transactions: List of transaction dictionaries
            
        Returns:
            List of detected anomalies
        """
        if self.nlp is None:
            return []
        
        anomalies = []
        
        try:
            for i, transaction in enumerate(transactions):
                # Individual transaction anomalies
                transaction_anomalies = self._detect_individual_anomalies(transaction, i)
                anomalies.extend(transaction_anomalies)
            
            return anomalies
            
        except Exception as e:
            self.logger.error(f"Anomaly detection failed: {e}", exc_info=True)
            return []
    
    def _load_banking_patterns(self) -> Dict[str, Any]:
        """Load banking-specific patterns and vocabularies"""
        return {
            'amount_patterns': [
                r'\$\s*\d+(?:,\d{3})*(?:\.\d{2})?',  # $1,234.56
                r'€\s*\d+(?:,\d{3})*(?:\.\d{2})?',   # €1,234.56
                r'\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|MXN|COP|PEN)',  # 1,234.56 USD
            ],
            'date_patterns': [
                r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}',    # DD/MM/YYYY or MM/DD/YYYY
                r'\d{2,4}[/-]\d{1,2}[/-]\d{1,2}',    # YYYY/MM/DD
            ],
            'bank_entities': [
                'banco', 'bank', 'credit union', 'caja', 'cooperativa',
                'visa', 'mastercard', 'american express', 'amex'
            ],
            'transaction_indicators': [
                'transferencia', 'transfer', 'pago', 'payment', 'retiro', 'withdrawal',
                'deposito', 'deposit', 'compra', 'purchase', 'cargo', 'charge'
            ]
        }
    
    def _load_transaction_types(self) -> Dict[str, Dict[str, Any]]:
        """Load transaction type classification patterns"""
        return {
            'transfer': {
                'keywords': ['transferencia', 'transfer', 'envio', 'remesa'],
                'regex_patterns': [r'transf\w*', r'envio\s+de\s+dinero'],
                'keyword_weight': 2.0,
                'regex_weight': 1.5,
            },
            'payment': {
                'keywords': ['pago', 'payment', 'factura', 'bill', 'servicio'],
                'regex_patterns': [r'pago\s+(?:de|a)', r'factura\s+\w+'],
                'keyword_weight': 2.0,
                'regex_weight': 1.5,
            },
            'purchase': {
                'keywords': ['compra', 'purchase', 'tienda', 'store', 'comercio'],
                'regex_patterns': [r'compra\s+en', r'purchase\s+at'],
                'keyword_weight': 1.8,
                'regex_weight': 1.5,
            },
            'withdrawal': {
                'keywords': ['retiro', 'withdrawal', 'cajero', 'atm'],
                'regex_patterns': [r'retiro\s+(?:en|de)', r'atm\s+withdrawal'],
                'keyword_weight': 2.5,
                'regex_weight': 2.0,
            },
            'deposit': {
                'keywords': ['deposito', 'deposit', 'ingreso', 'abono'],
                'regex_patterns': [r'dep[oó]sito', r'ingreso\s+de'],
                'keyword_weight': 2.0,
                'regex_weight': 1.5,
            },
            'fee': {
                'keywords': ['comision', 'fee', 'cargo', 'charge', 'mantenimiento'],
                'regex_patterns': [r'comisi[oó]n', r'cargo\s+por'],
                'keyword_weight': 2.2,
                'regex_weight': 1.8,
            }
        }
    
    def _load_anomaly_patterns(self) -> Dict[str, Any]:
        """Load anomaly detection patterns"""
        return {
            'suspicious_keywords': [
                'urgente', 'urgent', 'inmediato', 'immediate', 'secreto', 'secret',
                'confidencial', 'confidential', 'premio', 'prize', 'ganador', 'winner'
            ],
            'malformed_patterns': [
                r'[A-Z]{10,}',  # Too many consecutive capitals
                r'\d{10,}',     # Too many consecutive digits
                r'[^\w\s]{5,}', # Too many consecutive special characters
            ]
        }
    
    def _add_banking_patterns(self):
        """Add banking-specific patterns to the matcher"""
        if not self.matcher:
            return
        
        # Amount patterns
        amount_pattern = [
            {"TEXT": {"REGEX": r"\$|€|USD|EUR|MXN|COP|PEN"}},
            {"TEXT": {"REGEX": r"\d+(?:,\d{3})*(?:\.\d{2})?"}},
        ]
        self.matcher.add("AMOUNT", [amount_pattern])
    
    def _extract_banking_entities(self, text: str) -> List[Entity]:
        """Extract custom banking entities using regex patterns"""
        entities = []
        
        # Extract amounts
        for pattern in self.banking_patterns['amount_patterns']:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                entity = Entity(
                    text=match.group(),
                    label="MONEY",
                    start=match.start(),
                    end=match.end(),
                    confidence=0.9,
                    normalized_value=self._normalize_amount(match.group())
                )
                entities.append(entity)
        
        # Extract dates
        for pattern in self.banking_patterns['date_patterns']:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                entity = Entity(
                    text=match.group(),
                    label="DATE",
                    start=match.start(),
                    end=match.end(),
                    confidence=0.8,
                    normalized_value=self._normalize_date(match.group())
                )
                entities.append(entity)
        
        return entities
    
    def _calculate_entity_confidence(self, ent) -> float:
        """Calculate confidence score for a spaCy entity"""
        base_confidence = {
            'PERSON': 0.8,
            'ORG': 0.7,
            'MONEY': 0.9,
            'DATE': 0.8,
            'GPE': 0.6,
            'CARDINAL': 0.7,
        }.get(ent.label_, 0.5)
        
        return base_confidence
    
    def _normalize_entity_value(self, ent) -> Optional[str]:
        """Normalize entity value for consistency"""
        if ent.label_ == "MONEY":
            return self._normalize_amount(ent.text)
        elif ent.label_ == "DATE":
            return self._normalize_date(ent.text)
        elif ent.label_ in ["PERSON", "ORG"]:
            return ent.text.title()
        else:
            return ent.text
    
    def _normalize_amount(self, amount_text: str) -> str:
        """Normalize amount to standard format"""
        # Remove currency symbols and spaces
        cleaned = re.sub(r'[^\d,.]', '', amount_text)
        
        # Handle different decimal separators
        if ',' in cleaned and '.' in cleaned:
            # Determine which is decimal separator
            if cleaned.rfind(',') > cleaned.rfind('.'):
                # Comma is decimal separator (European format)
                cleaned = cleaned.replace('.', '').replace(',', '.')
            else:
                # Dot is decimal separator (US format)
                cleaned = cleaned.replace(',', '')
        elif ',' in cleaned:
            # Could be thousands separator or decimal separator
            if len(cleaned.split(',')[-1]) == 2:
                # Likely decimal separator
                cleaned = cleaned.replace(',', '.')
            else:
                # Likely thousands separator
                cleaned = cleaned.replace(',', '')
        
        try:
            return f"{float(cleaned):.2f}"
        except ValueError:
            return amount_text
    
    def _normalize_date(self, date_text: str) -> str:
        """Normalize date to ISO format"""
        try:
            # Try common formats
            for fmt in ['%d/%m/%Y', '%m/%d/%Y', '%Y/%m/%d', '%d-%m-%Y', '%Y-%m-%d']:
                try:
                    parsed_date = datetime.strptime(date_text, fmt)
                    return parsed_date.strftime('%Y-%m-%d')
                except ValueError:
                    continue
            
            return date_text  # Return original if parsing fails
        except Exception:
            return date_text
    
    def _remove_overlapping_entities(self, entities: List[Entity]) -> List[Entity]:
        """Remove overlapping entities, keeping the one with higher confidence"""
        if not entities:
            return entities
        
        # Sort by start position
        sorted_entities = sorted(entities, key=lambda e: e.start)
        
        filtered_entities = []
        for entity in sorted_entities:
            # Check for overlap with existing entities
            overlaps = False
            for existing in filtered_entities:
                if (entity.start < existing.end and entity.end > existing.start):
                    # There's an overlap
                    if entity.confidence > existing.confidence:
                        # Replace existing with current
                        filtered_entities.remove(existing)
                        filtered_entities.append(entity)
                    overlaps = True
                    break
            
            if not overlaps:
                filtered_entities.append(entity)
        
        return sorted(filtered_entities, key=lambda e: e.start)
    
    def _calculate_confidence(self, entities: List[Entity], 
                            classification: Optional[ClassificationResult],
                            anomalies: List[AnomalyResult]) -> float:
        """Calculate overall validation confidence"""
        confidence_factors = []
        
        # Entity extraction confidence (40% weight)
        if entities:
            avg_entity_confidence = sum(e.confidence for e in entities) / len(entities)
            confidence_factors.append(avg_entity_confidence * 0.4)
        else:
            confidence_factors.append(0.5 * 0.4)  # Neutral if no entities
        
        # Classification confidence (35% weight)
        if classification:
            confidence_factors.append(classification.confidence * 0.35)
        else:
            confidence_factors.append(0.3 * 0.35)  # Low if no classification
        
        # Anomaly score (25% weight) - fewer anomalies = higher confidence
        high_severity_anomalies = len([a for a in anomalies if a.severity == 'high'])
        anomaly_confidence = max(0.0, 1.0 - (high_severity_anomalies * 0.3))
        confidence_factors.append(anomaly_confidence * 0.25)
        
        return sum(confidence_factors)
    
    def _calculate_quality_score(self, description: str, entities: List[Entity],
                               classification: Optional[ClassificationResult]) -> float:
        """Calculate overall quality score for the transaction"""
        quality_factors = []
        
        # Description quality (50% weight)
        desc_quality = self._assess_description_quality(description)
        quality_factors.append(desc_quality * 0.5)
        
        # Entity richness (30% weight)
        entity_quality = min(1.0, len(entities) / 3.0)  # Normalize to 0-1
        quality_factors.append(entity_quality * 0.3)
        
        # Classification quality (20% weight)
        if classification and classification.confidence > 0.5:
            class_quality = classification.confidence
        else:
            class_quality = 0.3
        quality_factors.append(class_quality * 0.2)
        
        return sum(quality_factors)
    
    def _assess_description_quality(self, description: str) -> float:
        """Assess the quality of transaction description"""
        if not description:
            return 0.0
        
        quality_score = 0.5  # Base score
        
        # Length factor
        if 10 <= len(description) <= 100:
            quality_score += 0.2
        elif len(description) > 100:
            quality_score += 0.1
        
        # Word count factor
        words = description.split()
        if 3 <= len(words) <= 15:
            quality_score += 0.2
        
        # Contains meaningful information
        if any(keyword in description.lower() for keyword in 
               ['pago', 'compra', 'transferencia', 'retiro', 'deposito']):
            quality_score += 0.1
        
        return min(1.0, quality_score)
    
    def _generate_suggestions(self, transaction: Dict[str, Any], entities: List[Entity],
                            classification: Optional[ClassificationResult]) -> List[str]:
        """Generate suggestions for improving transaction data"""
        suggestions = []
        
        # Entity-based suggestions
        money_entities = [e for e in entities if e.label == 'MONEY']
        if not money_entities:
            suggestions.append("Include amount information in description")
        
        date_entities = [e for e in entities if e.label == 'DATE']
        if not date_entities:
            suggestions.append("Include date information if available")
        
        # Classification suggestions
        if not classification or classification.confidence < 0.5:
            suggestions.append("Add more specific transaction type keywords")
        
        return suggestions[:5]  # Limit to top 5 suggestions
    
    def _detect_individual_anomalies(self, transaction: Dict[str, Any], index: int) -> List[AnomalyResult]:
        """Detect anomalies in a single transaction"""
        anomalies = []
        description = transaction.get('description', '').strip()
        
        if not description:
            return anomalies
        
        # Check for suspicious keywords
        for keyword in self.anomaly_patterns['suspicious_keywords']:
            if keyword.lower() in description.lower():
                anomalies.append(AnomalyResult(
                    anomaly_type="suspicious_content",
                    description=f"Contains suspicious keyword: '{keyword}'",
                    severity="medium",
                    confidence=0.8,
                    affected_field="description",
                    suggested_correction=f"Review transaction containing '{keyword}'"
                ))
        
        # Check for malformed patterns
        for pattern in self.anomaly_patterns['malformed_patterns']:
            if re.search(pattern, description):
                anomalies.append(AnomalyResult(
                    anomaly_type="malformed_text",
                    description="Contains unusual character patterns",
                    severity="low",
                    confidence=0.6,
                    affected_field="description",
                    suggested_correction="Check for OCR errors or data corruption"
                ))
        
        return anomalies
    
    def get_supported_languages(self) -> List[str]:
        """Get list of supported languages"""
        return ['es', 'en']  # Spanish and English
    
    def is_model_available(self) -> bool:
        """Check if spaCy model is available and loaded"""
        return self.nlp is not None
    
    def get_validator_info(self) -> Dict[str, Any]:
        """Get information about the NLP validator"""
        return {
            'validator': 'spaCy NLP Validator',
            'model': self.model_name,
            'model_available': self.is_model_available(),
            'supported_languages': self.get_supported_languages(),
            'spacy_available': SPACY_AVAILABLE,
            'thresholds': self.thresholds,
            'transaction_types': list(self.transaction_types.keys()),
            'banking_patterns_loaded': len(self.banking_patterns),
            'matcher_patterns': len(self.matcher.patterns) if self.matcher else 0
        }