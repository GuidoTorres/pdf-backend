"""
Pattern Recognition System for Document Format and Bank Type Identification
Implements pattern recognition for document classification and bank identification
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
import json
import logging
import re
from collections import Counter
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.naive_bayes import MultinomialNB
from sklearn.model_selection import train_test_split
import pickle
import os

logger = logging.getLogger(__name__)

@dataclass
class DocumentPattern:
    """Represents a recognized document pattern"""
    pattern_id: str
    pattern_type: str  # 'bank_type', 'document_format', 'layout_structure'
    confidence: float
    characteristics: Dict[str, Any]
    sample_count: int
    last_updated: str

@dataclass
class BankIdentification:
    """Represents identified bank information"""
    bank_name: str
    bank_code: Optional[str]
    confidence: float
    identifying_features: List[str]
    document_format: str

@dataclass
class DocumentClassification:
    """Represents document classification result"""
    document_type: str  # 'bank_statement', 'credit_card', 'transaction_list'
    format_type: str    # 'pdf_native', 'pdf_scanned', 'excel', 'image'
    layout_type: str    # 'tabular', 'list', 'mixed'
    confidence: float
    features_used: List[str]

class PatternRecognitionSystem:
    """
    Implements pattern recognition for document format and bank type identification
    Requirements: 7.2, 8.1, 8.2
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or self._get_default_config()
        self.patterns_db = {}
        self.bank_patterns = {}
        self.document_classifier = None
        self.tfidf_vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
        self.models_path = self.config.get('models_path', 'backend/src/models')
        
        # Ensure models directory exists
        os.makedirs(self.models_path, exist_ok=True)
        
        # Load existing patterns and models
        self._load_patterns()
        self._load_models()
        
    def _get_default_config(self) -> Dict:
        """Get default configuration for pattern recognition"""
        return {
            'models_path': 'backend/src/models',
            'min_pattern_samples': 3,
            'similarity_threshold': 0.7,
            'confidence_threshold': 0.6,
            'max_patterns_per_type': 50,
            'pattern_update_threshold': 0.1
        }
    
    def identify_document_format(self, document_content: Dict, metadata: Dict) -> DocumentClassification:
        """
        Identify document format and type based on content and metadata
        
        Args:
            document_content: Extracted content from document
            metadata: Document metadata (file type, size, etc.)
            
        Returns:
            DocumentClassification with identified format and type
        """
        logger.info("Identifying document format and type")
        
        # Extract features for classification
        features = self._extract_document_features(document_content, metadata)
        
        # Classify document type
        doc_type = self._classify_document_type(features)
        
        # Determine format type
        format_type = self._determine_format_type(metadata, features)
        
        # Determine layout type
        layout_type = self._determine_layout_type(features)
        
        # Calculate overall confidence
        confidence = self._calculate_classification_confidence(features, doc_type, format_type, layout_type)
        
        classification = DocumentClassification(
            document_type=doc_type,
            format_type=format_type,
            layout_type=layout_type,
            confidence=confidence,
            features_used=list(features.keys())
        )
        
        # Update patterns with new classification
        self._update_document_patterns(classification, features)
        
        logger.info(f"Document classified as: {doc_type} ({format_type}, {layout_type}) with {confidence:.2f} confidence")
        
        return classification
    
    def identify_bank_type(self, document_content: Dict, transactions: List[Dict]) -> BankIdentification:
        """
        Identify bank type based on document content and transaction patterns
        
        Args:
            document_content: Extracted content from document
            transactions: List of extracted transactions
            
        Returns:
            BankIdentification with identified bank information
        """
        logger.info("Identifying bank type from document content")
        
        # Extract bank identification features
        bank_features = self._extract_bank_features(document_content, transactions)
        
        # Try to identify bank using known patterns
        bank_identification = self._match_bank_patterns(bank_features)
        
        if not bank_identification:
            # Create new bank pattern if not found
            bank_identification = self._create_new_bank_pattern(bank_features)
        
        # Update bank patterns
        self._update_bank_patterns(bank_identification, bank_features)
        
        logger.info(f"Bank identified as: {bank_identification.bank_name} with {bank_identification.confidence:.2f} confidence")
        
        return bank_identification
    
    def learn_document_patterns(self, documents: List[Dict]) -> Dict[str, Any]:
        """
        Learn patterns from a batch of documents for improved recognition
        
        Args:
            documents: List of document data with content and metadata
            
        Returns:
            Learning summary with discovered patterns
        """
        logger.info(f"Learning patterns from {len(documents)} documents")
        
        if len(documents) < self.config['min_pattern_samples']:
            logger.warning(f"Insufficient documents for pattern learning (need at least {self.config['min_pattern_samples']})")
            return {'patterns_learned': 0, 'message': 'Insufficient data'}
        
        # Extract features from all documents
        all_features = []
        all_labels = []
        
        for doc in documents:
            features = self._extract_document_features(doc.get('content', {}), doc.get('metadata', {}))
            all_features.append(features)
            all_labels.append(doc.get('document_type', 'unknown'))
        
        # Cluster similar documents to discover patterns
        patterns_discovered = self._discover_patterns_through_clustering(all_features, all_labels)
        
        # Update pattern database
        patterns_updated = self._update_pattern_database(patterns_discovered)
        
        # Retrain classification models if enough new data
        if patterns_updated > self.config['pattern_update_threshold'] * len(self.patterns_db):
            self._retrain_classification_models()
        
        summary = {
            'documents_processed': len(documents),
            'patterns_discovered': len(patterns_discovered),
            'patterns_updated': patterns_updated,
            'model_retrained': patterns_updated > self.config['pattern_update_threshold'] * len(self.patterns_db)
        }
        
        logger.info(f"Pattern learning completed: {summary}")
        
        return summary
    
    def get_optimal_extraction_strategy(self, document_classification: DocumentClassification, 
                                      bank_identification: BankIdentification) -> Dict[str, Any]:
        """
        Determine optimal extraction strategy based on document and bank patterns
        
        Args:
            document_classification: Classified document information
            bank_identification: Identified bank information
            
        Returns:
            Optimal extraction strategy configuration
        """
        logger.info("Determining optimal extraction strategy")
        
        # Base strategy on document type and format
        base_strategy = self._get_base_strategy(document_classification)
        
        # Customize strategy based on bank-specific patterns
        bank_customizations = self._get_bank_specific_customizations(bank_identification)
        
        # Apply historical performance optimizations
        performance_optimizations = self._get_performance_optimizations(
            document_classification, bank_identification
        )
        
        # Combine all strategies
        optimal_strategy = {
            **base_strategy,
            **bank_customizations,
            **performance_optimizations,
            'confidence': min(document_classification.confidence, bank_identification.confidence),
            'strategy_source': 'pattern_recognition'
        }
        
        logger.info(f"Optimal strategy determined with {optimal_strategy['confidence']:.2f} confidence")
        
        return optimal_strategy
    
    def _extract_document_features(self, content: Dict, metadata: Dict) -> Dict[str, Any]:
        """Extract features from document content and metadata"""
        features = {}
        
        # File metadata features
        features['file_extension'] = metadata.get('file_extension', '').lower()
        features['file_size'] = metadata.get('file_size', 0)
        features['page_count'] = metadata.get('page_count', 1)
        
        # Content structure features
        text_content = content.get('text', '')
        features['text_length'] = len(text_content)
        features['line_count'] = len(text_content.split('\n'))
        features['word_count'] = len(text_content.split())
        
        # Table features
        tables = content.get('tables', [])
        features['table_count'] = len(tables)
        features['has_tables'] = len(tables) > 0
        
        if tables:
            features['avg_table_rows'] = np.mean([len(table.get('data', [])) for table in tables])
            features['avg_table_cols'] = np.mean([len(table.get('data', [[]])[0]) if table.get('data') else 0 for table in tables])
        
        # Text pattern features
        features['has_currency_symbols'] = bool(re.search(r'[€$£¥₹]', text_content))
        features['has_dates'] = bool(re.search(r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}', text_content))
        features['has_amounts'] = bool(re.search(r'\d+[.,]\d{2}', text_content))
        features['has_account_numbers'] = bool(re.search(r'\d{10,}', text_content))
        
        # Language detection (simple)
        spanish_words = ['banco', 'cuenta', 'saldo', 'fecha', 'importe', 'descripción']
        english_words = ['bank', 'account', 'balance', 'date', 'amount', 'description']
        
        spanish_count = sum(1 for word in spanish_words if word in text_content.lower())
        english_count = sum(1 for word in english_words if word in text_content.lower())
        
        features['language_spanish'] = spanish_count
        features['language_english'] = english_count
        features['primary_language'] = 'spanish' if spanish_count > english_count else 'english'
        
        # OCR quality indicators
        features['confidence_score'] = content.get('confidence', 0.5)
        features['ocr_errors'] = self._count_ocr_errors(text_content)
        
        return features
    
    def _extract_bank_features(self, content: Dict, transactions: List[Dict]) -> Dict[str, Any]:
        """Extract bank-specific identification features"""
        features = {}
        
        text_content = content.get('text', '')
        
        # Bank name patterns
        bank_keywords = {
            'santander': ['santander', 'banco santander'],
            'bbva': ['bbva', 'banco bilbao vizcaya'],
            'caixabank': ['caixabank', 'la caixa'],
            'bankia': ['bankia'],
            'sabadell': ['sabadell', 'banco sabadell'],
            'ing': ['ing direct', 'ing bank'],
            'openbank': ['openbank'],
            'unicaja': ['unicaja']
        }
        
        detected_banks = []
        for bank, keywords in bank_keywords.items():
            for keyword in keywords:
                if keyword.lower() in text_content.lower():
                    detected_banks.append(bank)
                    break
        
        features['detected_banks'] = detected_banks
        features['primary_bank'] = detected_banks[0] if detected_banks else 'unknown'
        
        # Account number patterns
        account_numbers = re.findall(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{2}[\s-]?\d{10}\b', text_content)
        features['account_numbers'] = account_numbers
        features['has_iban'] = bool(re.search(r'\bES\d{2}\s?\d{4}\s?\d{4}\s?\d{2}\s?\d{10}\b', text_content))
        
        # Transaction patterns
        if transactions:
            features['transaction_count'] = len(transactions)
            features['avg_transaction_amount'] = np.mean([
                self._extract_numeric_amount(str(t.get('amount', 0))) or 0 
                for t in transactions
            ])
            
            # Common transaction types
            descriptions = [str(t.get('description', '')) for t in transactions]
            common_patterns = self._find_common_transaction_patterns(descriptions)
            features['common_transaction_patterns'] = common_patterns
        
        # Document format indicators
        features['has_logo'] = 'logo' in text_content.lower()
        features['has_header'] = bool(re.search(r'^[A-Z\s]{10,}', text_content))
        features['has_footer'] = 'página' in text_content.lower() or 'page' in text_content.lower()
        
        return features
    
    def _classify_document_type(self, features: Dict[str, Any]) -> str:
        """Classify document type based on features"""
        
        # Rule-based classification
        if features.get('has_tables') and features.get('transaction_count', 0) > 5:
            return 'bank_statement'
        elif features.get('has_amounts') and features.get('has_dates'):
            if features.get('file_extension') in ['xlsx', 'csv']:
                return 'transaction_export'
            else:
                return 'bank_statement'
        elif features.get('has_currency_symbols') and features.get('word_count', 0) < 100:
            return 'receipt'
        else:
            return 'unknown_financial_document'
    
    def _determine_format_type(self, metadata: Dict, features: Dict[str, Any]) -> str:
        """Determine document format type"""
        file_ext = metadata.get('file_extension', '').lower()
        
        if file_ext in ['pdf']:
            # Determine if PDF is native or scanned
            if features.get('confidence_score', 1.0) < 0.8 or features.get('ocr_errors', 0) > 5:
                return 'pdf_scanned'
            else:
                return 'pdf_native'
        elif file_ext in ['xlsx', 'xls']:
            return 'excel'
        elif file_ext in ['csv']:
            return 'csv'
        elif file_ext in ['docx', 'doc']:
            return 'word'
        elif file_ext in ['jpg', 'jpeg', 'png', 'tiff']:
            return 'image'
        else:
            return 'unknown'
    
    def _determine_layout_type(self, features: Dict[str, Any]) -> str:
        """Determine document layout type"""
        if features.get('table_count', 0) > 0:
            if features.get('text_length', 0) > features.get('table_count', 1) * 500:
                return 'mixed'
            else:
                return 'tabular'
        elif features.get('line_count', 0) > 20:
            return 'list'
        else:
            return 'simple'
    
    def _calculate_classification_confidence(self, features: Dict, doc_type: str, 
                                           format_type: str, layout_type: str) -> float:
        """Calculate confidence score for classification"""
        confidence_factors = []
        
        # Base confidence from features
        if features.get('has_amounts') and features.get('has_dates'):
            confidence_factors.append(0.8)
        
        if features.get('has_currency_symbols'):
            confidence_factors.append(0.7)
        
        if features.get('has_tables'):
            confidence_factors.append(0.9)
        
        # OCR quality factor
        ocr_confidence = features.get('confidence_score', 0.5)
        confidence_factors.append(ocr_confidence)
        
        # File format certainty
        if format_type != 'unknown':
            confidence_factors.append(0.9)
        
        return np.mean(confidence_factors) if confidence_factors else 0.5
    
    def _match_bank_patterns(self, bank_features: Dict[str, Any]) -> Optional[BankIdentification]:
        """Match bank features against known patterns"""
        
        detected_banks = bank_features.get('detected_banks', [])
        
        if not detected_banks:
            return None
        
        primary_bank = detected_banks[0]
        
        # Check if we have patterns for this bank
        if primary_bank in self.bank_patterns:
            pattern = self.bank_patterns[primary_bank]
            confidence = self._calculate_bank_confidence(bank_features, pattern)
            
            return BankIdentification(
                bank_name=primary_bank,
                bank_code=pattern.get('bank_code'),
                confidence=confidence,
                identifying_features=pattern.get('identifying_features', []),
                document_format=pattern.get('document_format', 'standard')
            )
        
        return None
    
    def _create_new_bank_pattern(self, bank_features: Dict[str, Any]) -> BankIdentification:
        """Create new bank pattern from features"""
        primary_bank = bank_features.get('primary_bank', 'unknown')
        
        return BankIdentification(
            bank_name=primary_bank,
            bank_code=None,
            confidence=0.6,  # Lower confidence for new patterns
            identifying_features=bank_features.get('detected_banks', []),
            document_format='standard'
        )
    
    def _get_base_strategy(self, classification: DocumentClassification) -> Dict[str, Any]:
        """Get base extraction strategy based on document classification"""
        
        strategies = {
            'bank_statement': {
                'primary_method': 'table_extraction',
                'fallback_method': 'ocr',
                'preprocessing': 'standard',
                'validation_level': 'high'
            },
            'transaction_export': {
                'primary_method': 'structured_data',
                'fallback_method': 'table_extraction',
                'preprocessing': 'minimal',
                'validation_level': 'medium'
            },
            'receipt': {
                'primary_method': 'ocr',
                'fallback_method': 'text_extraction',
                'preprocessing': 'enhanced',
                'validation_level': 'high'
            }
        }
        
        return strategies.get(classification.document_type, strategies['bank_statement'])
    
    def _get_bank_specific_customizations(self, bank_id: BankIdentification) -> Dict[str, Any]:
        """Get bank-specific extraction customizations"""
        
        bank_customizations = {
            'santander': {
                'date_format': 'dd/mm/yyyy',
                'amount_format': 'european',
                'table_detection': 'enhanced'
            },
            'bbva': {
                'date_format': 'dd-mm-yyyy',
                'amount_format': 'european',
                'ocr_language': 'spanish'
            }
        }
        
        return bank_customizations.get(bank_id.bank_name, {})
    
    def _get_performance_optimizations(self, doc_classification: DocumentClassification,
                                     bank_id: BankIdentification) -> Dict[str, Any]:
        """Get performance-based optimizations"""
        
        # This would be based on historical performance data
        # For now, return basic optimizations
        optimizations = {
            'parallel_processing': doc_classification.format_type == 'pdf_native',
            'caching_enabled': True,
            'quality_threshold': 0.8 if bank_id.confidence > 0.8 else 0.6
        }
        
        return optimizations
    
    def _count_ocr_errors(self, text: str) -> int:
        """Count potential OCR errors in text"""
        error_patterns = [
            r'[Il1]{3,}',  # Multiple consecutive similar characters
            r'[O0]{3,}',   # Multiple consecutive O/0
            r'\b[A-Z]{1}[a-z]{1}[A-Z]{1}',  # Mixed case within words
            r'[^\w\s]{3,}' # Multiple consecutive special characters
        ]
        
        error_count = 0
        for pattern in error_patterns:
            error_count += len(re.findall(pattern, text))
        
        return error_count
    
    def _find_common_transaction_patterns(self, descriptions: List[str]) -> List[str]:
        """Find common patterns in transaction descriptions"""
        if not descriptions:
            return []
        
        # Simple pattern extraction
        all_words = []
        for desc in descriptions:
            words = re.findall(r'\b\w+\b', desc.lower())
            all_words.extend(words)
        
        word_counts = Counter(all_words)
        common_patterns = [word for word, count in word_counts.most_common(5) if count > 1]
        
        return common_patterns
    
    def _extract_numeric_amount(self, amount_str: str) -> Optional[float]:
        """Extract numeric value from amount string"""
        if not amount_str:
            return None
        
        # Remove currency symbols and whitespace
        cleaned = re.sub(r'[€$£¥₹,\s]', '', amount_str)
        cleaned = re.sub(r'[-()]', '', cleaned)
        
        try:
            return float(cleaned)
        except ValueError:
            return None
    
    def _calculate_bank_confidence(self, features: Dict, pattern: Dict) -> float:
        """Calculate confidence for bank identification"""
        confidence_factors = []
        
        # Direct bank name match
        if features.get('primary_bank') == pattern.get('bank_name'):
            confidence_factors.append(0.9)
        
        # Account number format match
        if features.get('has_iban') and pattern.get('supports_iban', True):
            confidence_factors.append(0.8)
        
        # Transaction pattern similarity
        feature_patterns = set(features.get('common_transaction_patterns', []))
        known_patterns = set(pattern.get('transaction_patterns', []))
        
        if feature_patterns and known_patterns:
            similarity = len(feature_patterns & known_patterns) / len(feature_patterns | known_patterns)
            confidence_factors.append(similarity)
        
        return np.mean(confidence_factors) if confidence_factors else 0.5
    
    def _discover_patterns_through_clustering(self, features_list: List[Dict], 
                                            labels: List[str]) -> List[DocumentPattern]:
        """Discover new patterns through clustering analysis"""
        # This is a simplified implementation
        # In practice, you'd use more sophisticated clustering
        
        patterns = []
        unique_labels = list(set(labels))
        
        for label in unique_labels:
            label_features = [f for f, l in zip(features_list, labels) if l == label]
            
            if len(label_features) >= self.config['min_pattern_samples']:
                # Create pattern from common features
                pattern = DocumentPattern(
                    pattern_id=f"{label}_{len(self.patterns_db)}",
                    pattern_type='document_type',
                    confidence=0.7,
                    characteristics=self._extract_common_characteristics(label_features),
                    sample_count=len(label_features),
                    last_updated=pd.Timestamp.now().isoformat()
                )
                patterns.append(pattern)
        
        return patterns
    
    def _extract_common_characteristics(self, features_list: List[Dict]) -> Dict[str, Any]:
        """Extract common characteristics from a list of feature dictionaries"""
        if not features_list:
            return {}
        
        characteristics = {}
        
        # For numerical features, use mean
        numerical_features = ['text_length', 'word_count', 'table_count', 'confidence_score']
        for feature in numerical_features:
            values = [f.get(feature, 0) for f in features_list]
            if values:
                characteristics[feature] = np.mean(values)
        
        # For boolean features, use majority
        boolean_features = ['has_tables', 'has_amounts', 'has_dates', 'has_currency_symbols']
        for feature in boolean_features:
            values = [f.get(feature, False) for f in features_list]
            characteristics[feature] = sum(values) > len(values) / 2
        
        # For categorical features, use most common
        categorical_features = ['file_extension', 'primary_language']
        for feature in categorical_features:
            values = [f.get(feature, '') for f in features_list if f.get(feature)]
            if values:
                characteristics[feature] = Counter(values).most_common(1)[0][0]
        
        return characteristics
    
    def _update_document_patterns(self, classification: DocumentClassification, features: Dict):
        """Update document patterns with new classification"""
        pattern_key = f"{classification.document_type}_{classification.format_type}"
        
        if pattern_key not in self.patterns_db:
            self.patterns_db[pattern_key] = DocumentPattern(
                pattern_id=pattern_key,
                pattern_type='document_classification',
                confidence=classification.confidence,
                characteristics=features,
                sample_count=1,
                last_updated=pd.Timestamp.now().isoformat()
            )
        else:
            # Update existing pattern
            existing = self.patterns_db[pattern_key]
            existing.sample_count += 1
            existing.confidence = (existing.confidence + classification.confidence) / 2
            existing.last_updated = pd.Timestamp.now().isoformat()
    
    def _update_bank_patterns(self, bank_id: BankIdentification, features: Dict):
        """Update bank patterns with new identification"""
        if bank_id.bank_name not in self.bank_patterns:
            self.bank_patterns[bank_id.bank_name] = {
                'bank_name': bank_id.bank_name,
                'bank_code': bank_id.bank_code,
                'identifying_features': bank_id.identifying_features,
                'document_format': bank_id.document_format,
                'sample_count': 1,
                'transaction_patterns': features.get('common_transaction_patterns', []),
                'supports_iban': features.get('has_iban', False),
                'last_updated': pd.Timestamp.now().isoformat()
            }
        else:
            # Update existing pattern
            existing = self.bank_patterns[bank_id.bank_name]
            existing['sample_count'] += 1
            existing['last_updated'] = pd.Timestamp.now().isoformat()
            
            # Merge transaction patterns
            new_patterns = set(features.get('common_transaction_patterns', []))
            existing_patterns = set(existing.get('transaction_patterns', []))
            existing['transaction_patterns'] = list(existing_patterns | new_patterns)
    
    def _update_pattern_database(self, new_patterns: List[DocumentPattern]) -> int:
        """Update pattern database with new patterns"""
        updated_count = 0
        
        for pattern in new_patterns:
            if pattern.pattern_id not in self.patterns_db:
                self.patterns_db[pattern.pattern_id] = pattern
                updated_count += 1
            else:
                # Update existing pattern
                existing = self.patterns_db[pattern.pattern_id]
                existing.sample_count += pattern.sample_count
                existing.confidence = (existing.confidence + pattern.confidence) / 2
                existing.last_updated = pattern.last_updated
                updated_count += 1
        
        # Save patterns to disk
        self._save_patterns()
        
        return updated_count
    
    def _retrain_classification_models(self):
        """Retrain classification models with updated patterns"""
        logger.info("Retraining classification models with updated patterns")
        
        # This is a placeholder for model retraining
        # In practice, you'd retrain your ML models here
        
        try:
            # Save updated models
            self._save_models()
            logger.info("Classification models retrained successfully")
        except Exception as e:
            logger.error(f"Failed to retrain models: {e}")
    
    def _load_patterns(self):
        """Load patterns from disk"""
        patterns_file = os.path.join(self.models_path, 'patterns.json')
        bank_patterns_file = os.path.join(self.models_path, 'bank_patterns.json')
        
        try:
            if os.path.exists(patterns_file):
                with open(patterns_file, 'r') as f:
                    data = json.load(f)
                    self.patterns_db = {k: DocumentPattern(**v) for k, v in data.items()}
                logger.info(f"Loaded {len(self.patterns_db)} document patterns")
        except Exception as e:
            logger.warning(f"Failed to load patterns: {e}")
        
        try:
            if os.path.exists(bank_patterns_file):
                with open(bank_patterns_file, 'r') as f:
                    self.bank_patterns = json.load(f)
                logger.info(f"Loaded {len(self.bank_patterns)} bank patterns")
        except Exception as e:
            logger.warning(f"Failed to load bank patterns: {e}")
    
    def _save_patterns(self):
        """Save patterns to disk"""
        patterns_file = os.path.join(self.models_path, 'patterns.json')
        bank_patterns_file = os.path.join(self.models_path, 'bank_patterns.json')
        
        try:
            with open(patterns_file, 'w') as f:
                data = {k: asdict(v) for k, v in self.patterns_db.items()}
                json.dump(data, f, indent=2)
            
            with open(bank_patterns_file, 'w') as f:
                json.dump(self.bank_patterns, f, indent=2)
            
            logger.info("Patterns saved successfully")
        except Exception as e:
            logger.error(f"Failed to save patterns: {e}")
    
    def _load_models(self):
        """Load ML models from disk"""
        # Placeholder for loading trained models
        pass
    
    def _save_models(self):
        """Save ML models to disk"""
        # Placeholder for saving trained models
        pass
    
    def get_pattern_statistics(self) -> Dict[str, Any]:
        """Get statistics about learned patterns"""
        return {
            'document_patterns': len(self.patterns_db),
            'bank_patterns': len(self.bank_patterns),
            'total_samples': sum(p.sample_count for p in self.patterns_db.values()),
            'average_confidence': np.mean([p.confidence for p in self.patterns_db.values()]) if self.patterns_db else 0.0,
            'last_updated': max([p.last_updated for p in self.patterns_db.values()]) if self.patterns_db else None
        }