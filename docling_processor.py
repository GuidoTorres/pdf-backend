import sys
import json
import tempfile
import argparse
import re
from datetime import datetime
import os
import time
from typing import List, Dict, Optional, Tuple, Any
import hashlib
from pathlib import Path

class AdvancedDoclingProcessor:
    def __init__(self, config_path, debug=False):
        self.converter = None
        self.debug = debug
        self.config = self.load_config(config_path)
        self.pattern_cache = {}
        self.bank_configs = {}
        self.initialize_docling()
        self.load_bank_specific_configs()

    def load_config(self, config_path):
        if not os.path.exists(config_path):
            raise FileNotFoundError(f"Config file not found: {config_path}")
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def load_bank_specific_configs(self):
        """Load bank-specific configurations for adaptive processing"""
        config_dir = os.path.dirname(os.path.abspath(__file__))
        bank_config_files = [
            'config_bcp.json',
            'config_chase.json', 
            'config_santander.json',
            'config_bbva.json'
        ]
        
        for config_file in bank_config_files:
            config_path = os.path.join(config_dir, config_file)
            if os.path.exists(config_path):
                try:
                    with open(config_path, 'r', encoding='utf-8') as f:
                        bank_name = config_file.replace('config_', '').replace('.json', '')
                        self.bank_configs[bank_name] = json.load(f)
                        if self.debug: 
                            print(f"[DEBUG] Loaded bank-specific config for {bank_name}", file=sys.stderr)
                except Exception as e:
                    if self.debug: 
                        print(f"[DEBUG] Failed to load {config_file}: {e}", file=sys.stderr)

    def initialize_docling(self):
        try:
            from docling.document_converter import DocumentConverter
            from docling.document_backends import DoclingParseV2DocumentBackend
            from docling.chunking import HierarchicalChunker
            
            # Use the faster V2 backend with hierarchical chunking
            self.converter = DocumentConverter(
                document_backend=DoclingParseV2DocumentBackend()
            )
            
            # Initialize chunker for structural document analysis
            self.chunker = HierarchicalChunker()
            
            if self.debug: 
                print("[DEBUG] Using DoclingParseV2DocumentBackend with HierarchicalChunker.", file=sys.stderr)
        except ImportError as e:
            print(f"[WARNING] Could not load advanced Docling features: {e}. Falling back to basic DocumentConverter.", file=sys.stderr)
            from docling.document_converter import DocumentConverter
            self.converter = DocumentConverter()
            self.chunker = None
        except Exception as e:
            print(f"[WARNING] Error initializing advanced Docling: {e}. Falling back to basic DocumentConverter.", file=sys.stderr)
            from docling.document_converter import DocumentConverter
            self.converter = DocumentConverter()
            self.chunker = None

    def detect_bank_type(self, text: str) -> Optional[str]:
        """Detect the bank type from document text for adaptive configuration"""
        text_lower = text.lower()
        
        bank_indicators = {
            'bcp': ['banco de credito del peru', 'bcp', 'cuenta digital bcp'],
            'chase': ['chase bank', 'jpmorgan chase', 'chase.com'],
            'santander': ['banco santander', 'santander bank'],
            'bbva': ['banco bbva', 'bbva continental']
        }
        
        for bank, indicators in bank_indicators.items():
            if any(indicator in text_lower for indicator in indicators):
                if self.debug: 
                    print(f"[DEBUG] Detected bank type: {bank}", file=sys.stderr)
                return bank
        
        return None

    def get_effective_config(self, bank_type: Optional[str]) -> Dict:
        """Get the effective configuration (base + bank-specific overrides)"""
        effective_config = self.config.copy()
        
        if bank_type and bank_type in self.bank_configs:
            bank_config = self.bank_configs[bank_type]
            # Merge bank-specific config with base config
            for key, value in bank_config.items():
                if isinstance(value, dict) and key in effective_config:
                    effective_config[key].update(value)
                else:
                    effective_config[key] = value
            
            if self.debug: 
                print(f"[DEBUG] Using bank-specific config for {bank_type}", file=sys.stderr)
        
        return effective_config

    def process_document(self, pdf_path):
        try:
            if self.debug: 
                print(f"[DEBUG] Processing document with Advanced Processor: {pdf_path}", file=sys.stderr)
            
            start_time_total = time.time()
            
            # Step 1: Document conversion
            start_time_conversion = time.time()
            conv_result = self.converter.convert(pdf_path)
            end_time_conversion = time.time()
            if self.debug: 
                print(f"[DEBUG] [TIMER] Docling conversion took: {end_time_conversion - start_time_conversion:.2f} seconds", file=sys.stderr)

            doc_data = self._get_doc_data(conv_result)
            
            # Step 2: Bank type detection and adaptive configuration
            all_text = self.extract_full_text(doc_data)
            bank_type = self.detect_bank_type(all_text)
            effective_config = self.get_effective_config(bank_type)
            
            # Step 3: Structural chunking
            start_time_chunking = time.time()
            chunks = self.perform_structural_chunking(doc_data)
            end_time_chunking = time.time()
            if self.debug: 
                print(f"[DEBUG] [TIMER] Structural chunking took: {end_time_chunking - start_time_chunking:.2f} seconds", file=sys.stderr)
            
            # Step 4: Enhanced transaction extraction
            start_time_extraction = time.time()
            transactions = self.extract_transactions_with_chunking(chunks, effective_config, all_text)
            end_time_extraction = time.time()
            if self.debug: 
                print(f"[DEBUG] [TIMER] Transaction extraction took: {end_time_extraction - start_time_extraction:.2f} seconds", file=sys.stderr)
            
            # Step 5: Cross-validation with summary totals
            start_time_validation = time.time()
            validated_transactions, validation_results = self.cross_validate_with_summary(transactions, all_text, effective_config)
            end_time_validation = time.time()
            if self.debug: 
                print(f"[DEBUG] [TIMER] Cross-validation took: {end_time_validation - start_time_validation:.2f} seconds", file=sys.stderr)
            
            # Step 6: Enhanced categorization
            start_time_categorization = time.time()
            categorized_transactions = self.enhance_transaction_categorization(validated_transactions, effective_config)
            end_time_categorization = time.time()
            if self.debug: 
                print(f"[DEBUG] [TIMER] Categorization took: {end_time_categorization - start_time_categorization:.2f} seconds", file=sys.stderr)
            
            end_time_total = time.time()
            if self.debug: 
                print(f"[DEBUG] [TIMER] Total processing time: {end_time_total - start_time_total:.2f} seconds", file=sys.stderr)
            
            return {
                "meta": {
                    "processing_time": round(end_time_total - start_time_total, 2),
                    "total_transactions": len(categorized_transactions),
                    "bank_type": bank_type,
                    "validation_results": validation_results,
                    "chunks_processed": len(chunks)
                },
                "transactions": categorized_transactions,
                "provider": "advanced_docling_processor_v4"
            }
            
        except Exception as e:
            if self.debug: 
                print(f"[ERROR] Error processing document: {e}", file=sys.stderr)
                import traceback
                print(f"[ERROR] Traceback: {traceback.format_exc()}", file=sys.stderr)
            return {"meta": {}, "transactions": [], "error": str(e)}

    def _get_doc_data(self, conv_result):
        if hasattr(conv_result, 'document'):
            document = conv_result.document
            return document.model_dump() if hasattr(document, 'model_dump') else document.dict()
        raise ValueError("Could not extract document structure from Docling.")

    def perform_structural_chunking(self, doc_data) -> List[Dict]:
        """Perform structural chunking to isolate transaction tables"""
        chunks = []
        
        if self.chunker:
            try:
                # Use Docling's hierarchical chunker
                chunked_doc = self.chunker.chunk(doc_data)
                for chunk in chunked_doc.chunks:
                    chunks.append({
                        'text': chunk.text,
                        'type': getattr(chunk, 'type', 'unknown'),
                        'metadata': getattr(chunk, 'metadata', {}),
                        'tables': getattr(chunk, 'tables', [])
                    })
                
                if self.debug: 
                    print(f"[DEBUG] Created {len(chunks)} structural chunks", file=sys.stderr)
                
            except Exception as e:
                if self.debug: 
                    print(f"[DEBUG] Hierarchical chunking failed: {e}, falling back to manual chunking", file=sys.stderr)
                chunks = self.manual_structural_chunking(doc_data)
        else:
            chunks = self.manual_structural_chunking(doc_data)
        
        return chunks

    def manual_structural_chunking(self, doc_data) -> List[Dict]:
        """Manual structural chunking when Docling chunker is not available"""
        chunks = []
        
        # Extract tables as separate chunks
        tables = doc_data.get('tables', [])
        for i, table in enumerate(tables):
            chunks.append({
                'text': self.extract_table_text(table),
                'type': 'table',
                'metadata': {'table_index': i},
                'tables': [table]
            })
        
        # Extract remaining text as text chunks
        full_text = self.extract_full_text(doc_data)
        if full_text:
            chunks.append({
                'text': full_text,
                'type': 'text',
                'metadata': {},
                'tables': []
            })
        
        if self.debug: 
            print(f"[DEBUG] Created {len(chunks)} manual chunks", file=sys.stderr)
        
        return chunks

    def extract_table_text(self, table) -> str:
        """Extract text representation of a table"""
        text_parts = []
        
        if 'data' in table and isinstance(table.get('data'), dict):
            grid = table['data'].get('grid', [])
            for row in grid:
                row_text = []
                for cell in row:
                    if isinstance(cell, dict):
                        cell_text = cell.get('text', '')
                        row_text.append(str(cell_text))
                    else:
                        row_text.append(str(cell))
                text_parts.append(' | '.join(row_text))
        
        return '\n'.join(text_parts)

    def extract_transactions_with_chunking(self, chunks: List[Dict], config: Dict, full_text: str) -> List[Dict]:
        """Extract transactions using structural chunks"""
        transactions = []
        lang_config = config['universal_keywords']
        document_year = self._extract_year_enhanced(full_text)
        
        # Process table chunks first (highest priority)
        for chunk in chunks:
            if chunk['type'] == 'table' and chunk['tables']:
                for table in chunk['tables']:
                    if self.is_transaction_table_advanced(table, lang_config):
                        table_transactions = self.extract_from_table_enhanced(table, lang_config, document_year)
                        transactions.extend(table_transactions)
                        if self.debug: 
                            print(f"[DEBUG] Extracted {len(table_transactions)} transactions from table chunk", file=sys.stderr)
        
        # If no transactions found in tables, try text-based extraction
        if not transactions:
            for chunk in chunks:
                if chunk['type'] == 'text':
                    text_transactions = self.extract_from_text_patterns(chunk['text'], lang_config, document_year)
                    transactions.extend(text_transactions)
                    if self.debug: 
                        print(f"[DEBUG] Extracted {len(text_transactions)} transactions from text chunk", file=sys.stderr)
        
        return transactions

    def is_transaction_table_advanced(self, table, lang_config) -> bool:
        """Advanced heuristics to determine if a table contains transactions"""
        table_text = self.extract_table_text(table).lower()
        
        # Check for transaction-related keywords
        transaction_indicators = (
            lang_config['date_cols'] + 
            lang_config['concept_cols'] + 
            lang_config['debit_cols'] + 
            lang_config['credit_cols'] +
            ['transaction', 'transaccion', 'movimiento', 'operacion']
        )
        
        indicator_count = sum(1 for indicator in transaction_indicators if indicator in table_text)
        
        # Check for date patterns
        date_pattern_count = len(re.findall(r'\d{1,2}[/\-\.]\d{1,2}', table_text))
        
        # Check for amount patterns
        amount_pattern_count = len(re.findall(r'\d+[,\.]\d{2}', table_text))
        
        # Scoring system
        score = indicator_count * 2 + (date_pattern_count > 0) * 3 + (amount_pattern_count > 0) * 3
        
        is_transaction_table = score >= 5
        
        if self.debug: 
            print(f"[DEBUG] Table transaction score: {score}, is_transaction_table: {is_transaction_table}", file=sys.stderr)
        
        return is_transaction_table

    def cross_validate_with_summary(self, transactions: List[Dict], full_text: str, config: Dict) -> Tuple[List[Dict], Dict]:
        """Cross-validate extracted transactions with summary totals"""
        validation_results = {
            'summary_found': False,
            'total_credits_match': False,
            'total_debits_match': False,
            'balance_match': False,
            'discrepancies': []
        }
        
        # Extract summary totals from text
        summary_totals = self.extract_summary_totals(full_text, config)
        
        if summary_totals:
            validation_results['summary_found'] = True
            
            # Calculate totals from extracted transactions
            extracted_credits = sum(t['amount'] for t in transactions if t['type'] == 'credit')
            extracted_debits = sum(t['amount'] for t in transactions if t['type'] == 'debit')
            
            # Compare with summary totals
            if 'total_credits' in summary_totals:
                credit_diff = abs(extracted_credits - summary_totals['total_credits'])
                validation_results['total_credits_match'] = credit_diff < 0.01  # Allow for rounding
                if not validation_results['total_credits_match']:
                    validation_results['discrepancies'].append(
                        f"Credits: extracted {extracted_credits}, summary {summary_totals['total_credits']}"
                    )
            
            if 'total_debits' in summary_totals:
                debit_diff = abs(extracted_debits - summary_totals['total_debits'])
                validation_results['total_debits_match'] = debit_diff < 0.01
                if not validation_results['total_debits_match']:
                    validation_results['discrepancies'].append(
                        f"Debits: extracted {extracted_debits}, summary {summary_totals['total_debits']}"
                    )
            
            if self.debug: 
                print(f"[DEBUG] Validation results: {validation_results}", file=sys.stderr)
        
        # For now, return all transactions even if validation fails
        # In the future, this could trigger re-processing or manual review
        return transactions, validation_results

    def extract_summary_totals(self, text: str, config: Dict) -> Dict:
        """Extract summary totals from document text"""
        totals = {}
        
        # Common patterns for summary totals
        patterns = {
            'total_credits': [
                r'total\s+(?:abonos?|cr[eé]ditos?|ingresos?)[:\s]+([0-9,\.]+)',
                r'(?:abonos?|cr[eé]ditos?|ingresos?)\s+total[:\s]+([0-9,\.]+)',
                r'deposits?\s+&?\s+other\s+credits[:\s]+\$?([0-9,\.]+)'
            ],
            'total_debits': [
                r'total\s+(?:cargos?|d[eé]bitos?|egresos?)[:\s]+([0-9,\.]+)',
                r'(?:cargos?|d[eé]bitos?|egresos?)\s+total[:\s]+([0-9,\.]+)',
                r'withdrawals?\s+&?\s+other\s+debits[:\s]+\$?([0-9,\.]+)'
            ],
            'ending_balance': [
                r'saldo\s+final[:\s]+([0-9,\.]+)',
                r'ending\s+balance[:\s]+\$?([0-9,\.]+)',
                r'balance\s+final[:\s]+([0-9,\.]+)'
            ]
        }
        
        text_lower = text.lower()
        
        for total_type, pattern_list in patterns.items():
            for pattern in pattern_list:
                match = re.search(pattern, text_lower)
                if match:
                    amount_str = match.group(1)
                    amount = self.parse_amount_enhanced(amount_str)
                    if amount is not None:
                        totals[total_type] = amount
                        if self.debug: 
                            print(f"[DEBUG] Found {total_type}: {amount}", file=sys.stderr)
                        break
        
        return totals

    def enhance_transaction_categorization(self, transactions: List[Dict], config: Dict) -> List[Dict]:
        """Enhanced transaction categorization with scoring system"""
        enhanced_transactions = []
        
        # Enhanced categorization rules with scoring
        category_rules = {
            'transfer': {
                'keywords': ['transfer', 'transf', 'yape', 'plin', 'wire', 'ach'],
                'weight': 3
            },
            'payment': {
                'keywords': ['pago', 'payment', 'compra', 'purchase', 'bill pay'],
                'weight': 2
            },
            'deposit': {
                'keywords': ['deposito', 'deposit', 'abono', 'salary', 'payroll'],
                'weight': 2
            },
            'withdrawal': {
                'keywords': ['retiro', 'withdrawal', 'cargo', 'atm'],
                'weight': 2
            },
            'fee': {
                'keywords': ['comision', 'fee', 'mant', 'itf', 'charge', 'service'],
                'weight': 3
            },
            'food': {
                'keywords': ['restaurant', 'pedidosya', 'rappi', 'food', 'dining'],
                'weight': 1
            },
            'shopping': {
                'keywords': ['tienda', 'store', 'market', 'shop', 'retail'],
                'weight': 1
            },
            'utilities': {
                'keywords': ['luz', 'agua', 'gas', 'electric', 'water', 'utility'],
                'weight': 2
            }
        }
        
        for transaction in transactions:
            description_lower = transaction['description'].lower()
            
            # Calculate scores for each category
            category_scores = {}
            for category, rules in category_rules.items():
                score = 0
                for keyword in rules['keywords']:
                    if keyword in description_lower:
                        score += rules['weight']
                category_scores[category] = score
            
            # Assign the category with the highest score
            if category_scores and max(category_scores.values()) > 0:
                best_category = max(category_scores, key=category_scores.get)
                confidence = category_scores[best_category] / sum(category_scores.values())
            else:
                best_category = 'other'
                confidence = 0.0
            
            enhanced_transaction = transaction.copy()
            enhanced_transaction['category'] = best_category
            enhanced_transaction['category_confidence'] = round(confidence, 2)
            enhanced_transaction['amount_formatted'] = f"{transaction['amount']:.2f}"
            
            enhanced_transactions.append(enhanced_transaction)
        
        return enhanced_transactions

    # Include all the enhanced methods from previous versions
    def extract_full_text(self, data):
        """Enhanced text extraction"""
        text_parts = []
        
        if 'texts' in data and isinstance(data['texts'], list):
            for text_item in data['texts']:
                if isinstance(text_item, dict) and 'text' in text_item:
                    text_parts.append(str(text_item['text']))
        
        elif 'pages' in data and isinstance(data['pages'], list):
            for page in data['pages']:
                if 'text' in page and page['text']:
                    text_parts.append(str(page['text']))
        
        if not text_parts:
            def recurse_extract(element):
                if isinstance(element, dict):
                    if 'text' in element and element['text']:
                        text_parts.append(str(element['text']))
                    for value in element.values():
                        recurse_extract(value)
                elif isinstance(element, list):
                    for item in element:
                        recurse_extract(item)
            recurse_extract(data)
        
        return "\n".join(text_parts)

    def _extract_year_enhanced(self, text):
        """Enhanced year extraction"""
        current_year = datetime.now().year
        
        year_patterns = [
            r'\b(20\d{2})\b',
            r'\b(\d{2})\b',
        ]
        
        years_found = []
        
        for pattern in year_patterns:
            matches = re.findall(pattern, text)
            for match in matches:
                year = int(match)
                if len(match) == 2:
                    if year <= 50:
                        year += 2000
                    else:
                        year += 1900
                
                if current_year - 10 <= year <= current_year + 1:
                    years_found.append(year)
        
        if years_found:
            return str(max(years_found))
        
        return str(current_year)

    def extract_from_table_enhanced(self, table, lang_config, document_year):
        """Enhanced table extraction (reuse from previous version)"""
        # Implementation from enhanced_processor_with_ml.py
        rows = self._get_rows_from_table_enhanced(table)
        if not rows:
            return []
        
        table_analysis = self.analyze_table_structure(rows, lang_config)
        
        if table_analysis['is_transaction_table']:
            return self.convert_rows_to_transactions_enhanced(rows, lang_config, document_year, table_analysis)
        
        return []

    def analyze_table_structure(self, rows, lang_config):
        """Analyze table structure (reuse from previous version)"""
        analysis = {
            'is_transaction_table': False,
            'header_row_idx': -1,
            'has_date_column': False,
            'has_amount_column': False,
            'has_description_column': False,
            'table_type': 'unknown'
        }
        
        for i, row in enumerate(rows[:3]):
            row_text = " ".join(str(cell).lower() for cell in row)
            
            date_score = sum(1 for kw in lang_config['date_cols'] if kw in row_text)
            amount_score = sum(1 for kw in (lang_config['debit_cols'] + lang_config['credit_cols'] + lang_config.get('amount_cols', [])) if kw in row_text)
            desc_score = sum(1 for kw in lang_config['concept_cols'] if kw in row_text)
            
            total_score = date_score + amount_score + desc_score
            
            if total_score >= 2:
                analysis['header_row_idx'] = i
                analysis['has_date_column'] = date_score > 0
                analysis['has_amount_column'] = amount_score > 0
                analysis['has_description_column'] = desc_score > 0
                analysis['is_transaction_table'] = True
                break
        
        return analysis

    def convert_rows_to_transactions_enhanced(self, rows, lang_config, year, table_analysis):
        """Enhanced transaction conversion (reuse from previous version)"""
        transactions = []
        header_row_idx = table_analysis['header_row_idx']
        
        if header_row_idx == -1:
            return []
        
        header_row = rows[header_row_idx]
        headers = self.refine_header_indices_enhanced(header_row, lang_config)
        
        for i, row in enumerate(rows[header_row_idx + 1:], start=header_row_idx + 1):
            if not row or all(not str(cell).strip() for cell in row):
                continue
            
            row_text = " ".join(str(cell) for cell in row).lower()
            if any(kw in row_text for kw in lang_config['summary_keywords']):
                continue
            
            transaction = self.extract_transaction_from_row(row, headers, lang_config, year)
            if transaction:
                transactions.append(transaction)
        
        return transactions

    def extract_transaction_from_row(self, row, headers, lang_config, year):
        """Extract transaction from row (reuse from previous version)"""
        date_str = self.get_cell_value_safe(row, headers, 'date')
        concept_str = self.get_cell_value_safe(row, headers, 'concept')
        debit_str = self.get_cell_value_safe(row, headers, 'debit')
        credit_str = self.get_cell_value_safe(row, headers, 'credit')
        amount_str = self.get_cell_value_safe(row, headers, 'amount')
        
        date = self.parse_date_enhanced(date_str, year, lang_config)
        if not date:
            return None
        
        amount, transaction_type = self.parse_amount_with_type(amount_str, debit_str, credit_str)
        if amount is None:
            return None
        
        description = self.clean_description(concept_str)
        if not description:
            description = "Unknown transaction"
        
        return {
            "date": date,
            "description": description,
            "amount": abs(amount),
            "type": transaction_type
        }

    def parse_amount_with_type(self, amount_str, debit_str, credit_str):
        """Parse amount with type (reuse from previous version)"""
        if amount_str:
            amount = self.parse_amount_enhanced(amount_str)
            if amount is not None:
                transaction_type = "debit" if amount < 0 else "credit"
                return abs(amount), transaction_type
        
        if debit_str:
            debit = self.parse_amount_enhanced(debit_str)
            if debit is not None and debit != 0:
                return abs(debit), "debit"
        
        if credit_str:
            credit = self.parse_amount_enhanced(credit_str)
            if credit is not None and credit != 0:
                return abs(credit), "credit"
        
        return None, None

    def parse_amount_enhanced(self, amount_str):
        """Enhanced amount parsing (reuse from previous version)"""
        if not amount_str or not str(amount_str).strip():
            return None
        
        amount_str = str(amount_str).strip()
        
        cache_key = hashlib.md5(amount_str.encode()).hexdigest()
        if cache_key in self.pattern_cache:
            return self.pattern_cache[cache_key]
        
        is_negative = ('-' in amount_str or 
                      ('(' in amount_str and ')' in amount_str) or
                      amount_str.startswith('(') and amount_str.endswith(')'))
        
        clean_amount = re.sub(r'[\$€£¥₹\(\)\-\+\s]', '', amount_str)
        
        if not clean_amount:
            self.pattern_cache[cache_key] = None
            return None
        
        result = self._detect_decimal_format(clean_amount)
        
        if result is not None:
            final_amount = -abs(result) if is_negative else abs(result)
            self.pattern_cache[cache_key] = final_amount
            return final_amount
        
        self.pattern_cache[cache_key] = None
        return None

    def _detect_decimal_format(self, amount_str):
        """Detect decimal format (reuse from previous version)"""
        if ',' in amount_str and '.' in amount_str:
            last_comma = amount_str.rfind(',')
            last_dot = amount_str.rfind('.')
            
            if last_dot > last_comma:
                clean_str = amount_str.replace(',', '')
                try:
                    return float(clean_str)
                except ValueError:
                    return None
            else:
                clean_str = amount_str.replace('.', '').replace(',', '.')
                try:
                    return float(clean_str)
                except ValueError:
                    return None
        
        elif ',' in amount_str:
            comma_parts = amount_str.split(',')
            if len(comma_parts) == 2 and len(comma_parts[1]) <= 2:
                try:
                    return float(amount_str.replace(',', '.'))
                except ValueError:
                    return None
            else:
                try:
                    return float(amount_str.replace(',', ''))
                except ValueError:
                    return None
        
        else:
            try:
                return float(amount_str)
            except ValueError:
                return None

    def parse_date_enhanced(self, date_str, year, lang_config):
        """Enhanced date parsing (reuse from previous version)"""
        if not date_str or not str(date_str).strip():
            return None
        
        date_str = str(date_str).strip()
        
        cache_key = f"{date_str}_{year}"
        if cache_key in self.pattern_cache:
            return self.pattern_cache[cache_key]
        
        for month_abbr, month_num in lang_config['month_map'].items():
            if month_abbr.lower() in date_str.lower():
                day_match = re.search(r'(\d{1,2})', date_str)
                if day_match:
                    day = int(day_match.group(1))
                    try:
                        date_obj = datetime(int(year), month_num, day)
                        result = date_obj.strftime('%Y-%m-%d')
                        self.pattern_cache[cache_key] = result
                        return result
                    except ValueError:
                        pass
        
        date_formats = [
            "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d",
            "%d.%m.%Y", "%Y.%m.%d", "%d/%m/%y", "%m/%d/%y", "%d-%m-%y",
            "%d.%m.%y", "%d/%m", "%m/%d", "%d-%m", "%m-%d", "%d %m %Y",
            "%d %m %y", "%Y %m %d"
        ]
        
        for fmt in date_formats:
            try:
                if '%Y' not in fmt and '%y' not in fmt:
                    date_obj = datetime.strptime(date_str, fmt)
                    date_obj = date_obj.replace(year=int(year))
                else:
                    date_obj = datetime.strptime(date_str, fmt)
                    if date_obj.year < 100:
                        if date_obj.year < 50:
                            date_obj = date_obj.replace(year=date_obj.year + 2000)
                        else:
                            date_obj = date_obj.replace(year=date_obj.year + 1900)
                
                result = date_obj.strftime('%Y-%m-%d')
                self.pattern_cache[cache_key] = result
                return result
            except (ValueError, TypeError):
                continue
        
        self.pattern_cache[cache_key] = None
        return None

    def extract_from_text_patterns(self, text, lang_config, document_year):
        """Extract from text patterns (reuse from previous version)"""
        transactions = []
        lines = text.split('\n')
        
        for i, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue
            
            if self.is_non_transaction_line(line, lang_config):
                continue
            
            transaction = self.extract_transaction_from_line(line, lang_config, document_year)
            if transaction:
                transactions.append(transaction)
        
        return transactions

    def extract_transaction_from_line(self, line, lang_config, document_year):
        """Extract transaction from line (reuse from previous version)"""
        date = self.find_date_in_text_enhanced(line, document_year, lang_config)
        if not date:
            return None
        
        amount, transaction_type = self.find_amount_in_text_enhanced(line)
        if amount is None:
            return None
        
        description = self.extract_description_from_line_enhanced(line, date, amount)
        
        return {
            "date": date,
            "description": description,
            "amount": abs(amount),
            "type": transaction_type
        }

    def find_amount_in_text_enhanced(self, text):
        """Enhanced amount finding (reuse from previous version)"""
        amount_patterns = [
            r'[\$€£¥₹]?\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)',
            r'(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)\s*[\$€£¥₹]?',
        ]
        
        amounts_found = []
        for pattern in amount_patterns:
            matches = re.finditer(pattern, text)
            for match in matches:
                amount_str = match.group(1) if match.groups() else match.group(0)
                amount = self.parse_amount_enhanced(amount_str)
                if amount is not None:
                    start_pos = max(0, match.start() - 20)
                    end_pos = min(len(text), match.end() + 20)
                    context = text[start_pos:end_pos].lower()
                    
                    transaction_type = self.determine_type_from_context(context)
                    amounts_found.append((abs(amount), transaction_type))
        
        if amounts_found:
            return max(amounts_found, key=lambda x: x[0])
        
        return None, None

    def determine_type_from_context(self, context):
        """Determine type from context (reuse from previous version)"""
        debit_indicators = ['cargo', 'debe', 'debit', 'withdrawal', 'pago', 'retiro', 'compra']
        credit_indicators = ['abono', 'haber', 'credit', 'deposit', 'ingreso', 'deposito']
        
        debit_score = sum(1 for indicator in debit_indicators if indicator in context)
        credit_score = sum(1 for indicator in credit_indicators if indicator in context)
        
        if debit_score > credit_score:
            return "debit"
        elif credit_score > debit_score:
            return "credit"
        else:
            return "credit"

    def is_non_transaction_line(self, line, lang_config):
        """Check if line is non-transaction (reuse from previous version)"""
        line_lower = line.lower()
        
        if any(kw in line_lower for kw in ['fecha', 'date', 'descripcion', 'description', 'monto', 'amount']):
            return True
        
        if any(kw in line_lower for kw in lang_config['summary_keywords']):
            return True
        
        if len(line.strip()) < 5:
            return True
        
        return False

    def find_date_in_text_enhanced(self, text, year, lang_config):
        """Enhanced date finding (reuse from previous version)"""
        date = self.parse_date_enhanced(text, year, lang_config)
        if date:
            return date
        
        date_patterns = [
            r'(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})',
            r'(\d{1,2}[/\-\.]\d{1,2})',
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, text)
            if match:
                date_str = match.group(1)
                parsed_date = self.parse_date_enhanced(date_str, year, lang_config)
                if parsed_date:
                    return parsed_date
        
        return None

    def extract_description_from_line_enhanced(self, line, date, amount):
        """Enhanced description extraction (reuse from previous version)"""
        cleaned = re.sub(r'\d{1,2}[/\-\.]\d{1,2}(?:[/\-\.]\d{2,4})?', '', line)
        cleaned = re.sub(r'[\$€£¥₹]?\s*\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?', '', cleaned)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        
        return cleaned if cleaned else "Transaction"

    def _get_rows_from_table_enhanced(self, table):
        """Enhanced table row extraction (reuse from previous version)"""
        if 'data' in table and isinstance(table.get('data'), dict):
            grid = table['data'].get('grid')
            if grid and isinstance(grid, list) and len(grid) > 0:
                if len(grid) > 1:
                    is_jumbled = self.detect_jumbled_table(grid)
                    
                    if is_jumbled:
                        if self.debug: 
                            print(f"[DEBUG] Jumbled table detected. Attempting to untangle.", file=sys.stderr)
                        return self.untangle_rows_enhanced(grid)
                    else:
                        return self.process_docling_grid_enhanced(grid)
                else:
                    return self.process_docling_grid_enhanced(grid)
        
        return []

    def detect_jumbled_table(self, grid):
        """Enhanced jumbled detection (reuse from previous version)"""
        if len(grid) < 2:
            return False
        
        total_length = 0
        cell_count = 0
        
        for row in grid[1:]:
            for cell in row:
                if isinstance(cell, dict):
                    text = cell.get('text', '')
                    total_length += len(str(text))
                    cell_count += 1
        
        if cell_count == 0:
            return False
        
        avg_length = total_length / cell_count
        
        newline_count = 0
        for row in grid[1:]:
            for cell in row:
                if isinstance(cell, dict):
                    text = cell.get('text', '')
                    newline_count += str(text).count('\n')
        
        return avg_length > 30 or newline_count > len(grid) - 1

    def untangle_rows_enhanced(self, grid):
        """Enhanced row untangling (reuse from previous version)"""
        if not grid or len(grid) == 0:
            return []
        
        header = [cell.get('text', '') if isinstance(cell, dict) else str(cell) for cell in grid[0]]
        num_cols = len(header)
        lang_config = self.config['universal_keywords']
        headers = self.refine_header_indices_enhanced(header, lang_config)
        
        untangled_rows = [header]
        
        for row_idx in range(1, len(grid)):
            row_data = grid[row_idx]
            untangled_data = self.untangle_single_row(row_data, num_cols, headers)
            untangled_rows.extend(untangled_data)
        
        return untangled_rows

    def untangle_single_row(self, row_data, num_cols, headers):
        """Untangle single row (reuse from previous version)"""
        jumbled_cells = [[] for _ in range(num_cols)]
        
        for i, cell in enumerate(row_data):
            if i >= num_cols:
                break
            
            text = cell.get('text', '') if isinstance(cell, dict) else str(cell)
            if text.strip():
                if i == headers.get('concept', -1):
                    lines = [line.strip() for line in text.split('\n') if line.strip()]
                    jumbled_cells[i].extend(lines)
                else:
                    words = text.replace('\n', ' ').split()
                    jumbled_cells[i].extend(words)
        
        max_entries = max(len(col) for col in jumbled_cells) if any(jumbled_cells) else 0
        reconstructed_rows = []
        
        for i in range(max_entries):
            new_row = []
            for j in range(num_cols):
                if i < len(jumbled_cells[j]):
                    new_row.append(jumbled_cells[j][i])
                else:
                    new_row.append('')
            
            if any(cell.strip() for cell in new_row):
                reconstructed_rows.append(new_row)
        
        return reconstructed_rows

    def process_docling_grid_enhanced(self, grid):
        """Enhanced grid processing (reuse from previous version)"""
        processed_rows = []
        for row_data in grid:
            if not isinstance(row_data, list):
                continue
            
            new_row = []
            for cell in row_data:
                if isinstance(cell, dict):
                    text = cell.get('text', '')
                    new_row.append(str(text) if text is not None else '')
                else:
                    new_row.append(str(cell) if cell is not None else '')
            
            processed_rows.append(new_row)
        return processed_rows

    def refine_header_indices_enhanced(self, header_row, lang_config):
        """Enhanced header refinement (reuse from previous version)"""
        headers = {'date': -1, 'concept': -1, 'debit': -1, 'credit': -1, 'balance': -1, 'amount': -1}
        row_lower = [str(cell).lower().strip() for cell in header_row]

        for j, cell_content in enumerate(row_lower):
            for header_type, keywords in [
                ('date', lang_config['date_cols']),
                ('concept', lang_config['concept_cols']),
                ('amount', lang_config.get('amount_cols', [])),
                ('debit', lang_config['debit_cols']),
                ('credit', lang_config['credit_cols']),
                ('balance', lang_config['balance_cols'])
            ]:
                if headers[header_type] == -1 and any(k in cell_content for k in keywords):
                    headers[header_type] = j
                    break

        if headers['concept'] == -1:
            concept_candidates = []
            for j, cell in enumerate(row_lower):
                if j not in headers.values() and cell and len(cell) > 3:
                    score = len(cell) + (10 if not cell.replace(' ', '').isdigit() else 0)
                    concept_candidates.append((j, score))
            
            if concept_candidates:
                headers['concept'] = max(concept_candidates, key=lambda x: x[1])[0]

        if headers['amount'] != -1 and headers['debit'] == -1 and headers['credit'] == -1:
            headers['debit'] = headers['amount']
            headers['credit'] = headers['amount']

        return headers

    def get_cell_value_safe(self, row, headers, key):
        """Safe cell value extraction (reuse from previous version)"""
        idx = headers.get(key, -1)
        if idx != -1 and idx < len(row):
            value = row[idx]
            return str(value).strip() if value is not None else ""
        return ""

    def clean_description(self, description):
        """Clean description (reuse from previous version)"""
        if not description:
            return ""
        
        cleaned = re.sub(r'\s+', ' ', str(description)).strip()
        cleaned = re.sub(r'[*]{2,}', '', cleaned)
        cleaned = re.sub(r'[-]{3,}', '', cleaned)
        
        return cleaned


def main():
    parser = argparse.ArgumentParser(description="Advanced Docling PDF Processor with Community Best Practices.")
    parser.add_argument('--stdin', action='store_true')
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('pdf_path', nargs='?')
    args = parser.parse_args()

    config_path = os.path.join(os.path.dirname(__file__), 'parser_config.json')

    try:
        processor = AdvancedDoclingProcessor(config_path, debug=args.debug)
        
        if args.stdin:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(sys.stdin.buffer.read())
                pdf_path = tmp.name
        elif args.pdf_path:
            pdf_path = args.pdf_path
        else:
            raise ValueError("Debe especificar --stdin o una ruta de archivo.")

        result = processor.process_document(pdf_path)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        print(json.dumps({"error": str(e), "meta": {}, "transactions": []}))

if __name__ == '__main__':
    main()
