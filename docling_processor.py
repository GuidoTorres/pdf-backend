#!/usr/bin/env python3
"""
Context-Aware and Configurable Docling PDF Processor
"""

import sys
import json
import tempfile
import argparse
import re
from datetime import datetime
import os
import time

class ContextAwareProcessor:
    def __init__(self, config_path, debug=False):
        self.converter = None
        self.debug = debug
        self.config = self.load_config(config_path)
        self.initialize_docling()

    def load_config(self, config_path):
        if not os.path.exists(config_path):
            raise FileNotFoundError(f"Config file not found: {config_path}")
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def initialize_docling(self):
        try:
            from docling.document_converter import DocumentConverter
            self.converter = DocumentConverter()
        except ImportError as e:
            raise ImportError(f"Docling dependency missing: {e}")

    def process_document(self, pdf_path):
        try:
            if self.debug: print(f"[DEBUG] Processing document with DocumentConverter: {pdf_path}", file=sys.stderr)
            
            start_time_conversion = time.time()
            conv_result = self.converter.convert(pdf_path)
            end_time_conversion = time.time()
            if self.debug: print(f"[DEBUG] [TIMER] Docling conversion took: {end_time_conversion - start_time_conversion:.2f} seconds", file=sys.stderr)

            doc_data = self._get_doc_data(conv_result)
            
            start_time_extraction = time.time()
            transactions = self.extract_transactions(doc_data)
            end_time_extraction = time.time()
            if self.debug: print(f"[DEBUG] [TIMER] Transaction extraction took: {end_time_extraction - start_time_extraction:.2f} seconds", file=sys.stderr)
            
            return {
                "meta": {},
                "transactions": transactions,
                "provider": "docling_context_aware_v2"
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

    def extract_transactions(self, doc_data):
        all_text = self.extract_full_text(doc_data)
        lang_config = self.config['universal_keywords']
        document_year = self._extract_year(all_text)

        transactions = []
        tables = doc_data.get('tables', [])
        for table in tables:
            rows = self._get_rows_from_table(table)
            if self.debug: print(f"[DEBUG] Table rows processed: {rows}", file=sys.stderr)
            if rows:
                table_text = "\n".join([" ".join(map(str, row)) for row in rows])
                is_debit = any(kw in table_text.lower() for kw in lang_config.get('debit_table_keywords', []))
                is_credit = any(kw in table_text.lower() for kw in lang_config.get('credit_table_keywords', []))
                
                table_transactions = self.convert_rows_to_transactions(rows, lang_config, document_year, is_debit, is_credit)
                transactions.extend(table_transactions)
        return transactions

    def extract_full_text(self, data):
        text_parts = []
        if 'pages' in data and isinstance(data['pages'], list):
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

    def _extract_year(self, text):
        current_year = datetime.now().year
        for year in range(current_year, current_year - 15, -1):
            if str(year) in text:
                return str(year)
        match = re.search(r'\b(20\d{2})\b', text)
        if match: return match.group(1)
        return str(current_year)

    def _get_rows_from_table(self, table):
        if 'data' in table and isinstance(table.get('data'), dict):
            grid = table['data'].get('grid')
            if grid and isinstance(grid, list) and len(grid) > 1:
                # Check if the table is jumbled by looking for long text in data cells
                is_jumbled = any(len(str(cell.get('text', ''))) > 50 for cell in grid[1])
                if is_jumbled:
                    if self.debug: print(f"[DEBUG] Jumbled table detected. Attempting to untangle.", file=sys.stderr)
                    return self.untangle_rows_by_header(grid)
                return self.process_docling_grid(grid)
        return []

    def untangle_rows_by_header(self, grid):
        header = [cell.get('text', '') for cell in grid[0]]
        num_cols = len(header)
        lang_config = self.config['universal_keywords']
        header_indices = self.refine_header_indices(header, lang_config)
        concept_col_idx = header_indices.get('concept', -1)

        untangled_rows = [header]
        jumbled_data_cells = [[] for _ in range(num_cols)]

        # The jumbled data is often concentrated in the second row of the grid
        row_data = grid[1]
        for i, cell in enumerate(row_data):
            text = cell.get('text', '')
            if isinstance(text, str):
                # Do not split the concept column's content
                if i == concept_col_idx:
                    # Split by newline if it exists, otherwise keep as a single block
                    jumbled_data_cells[i].extend(text.split('\n'))
                else:
                    jumbled_data_cells[i].extend(text.split())

        num_reconstructed_rows = max(len(col) for col in jumbled_data_cells) if any(jumbled_data_cells) else 0
        if self.debug: print(f"[DEBUG] Reconstructing {num_reconstructed_rows} rows from jumbled data.", file=sys.stderr)

        for i in range(num_reconstructed_rows):
            new_row = []
            for j in range(num_cols):
                if i < len(jumbled_data_cells[j]):
                    new_row.append(jumbled_data_cells[j][i])
                else:
                    new_row.append('')
            untangled_rows.append(new_row)
            
        return untangled_rows

    def process_docling_grid(self, grid):
        processed_rows = []
        for row_data in grid:
            if not isinstance(row_data, list): continue
            new_row = [str(cell.get('text', '')) if isinstance(cell, dict) else '' for cell in row_data]
            processed_rows.append(new_row)
        return processed_rows

    def convert_rows_to_transactions(self, rows, lang_config, year, is_debit=False, is_credit=False):
        transactions = []
        if not rows: return []

        current_headers = None
        header_row = rows[0]
        is_header, current_headers = self.is_header_row(header_row, lang_config)
        if not is_header: 
            if self.debug: print(f"[DEBUG] No header found in first row: {header_row}", file=sys.stderr)
            return []
        if self.debug: print(f"[DEBUG] Header identified: {header_row} -> {current_headers}", file=sys.stderr)

        for i, row in enumerate(rows[1:]): # Skip header row
            if self.debug: print(f"\n[DEBUG] Processing row {i+1}: {row}", file=sys.stderr)

            if not row or all(not cell for cell in row):
                if self.debug: print("[DEBUG] -> Skipping empty row.", file=sys.stderr)
                continue
            
            row_text = " ".join(map(str, row)).lower()
            if any(kw in row_text for kw in lang_config['summary_keywords']):
                if self.debug: print(f"[DEBUG] -> Skipping summary row: {row}", file=sys.stderr)
                continue

            date_str = self.get_cell_value(row, current_headers, 'date')
            concept_str = self.get_cell_value(row, current_headers, 'concept')
            debit_str = self.get_cell_value(row, current_headers, 'debit')
            credit_str = self.get_cell_value(row, current_headers, 'credit')
            amount_str = self.get_cell_value(row, current_headers, 'amount')

            if self.debug: 
                print(f"[DEBUG]   Raw Date: '{date_str}' | Raw Concept: '{concept_str}' | Raw Debit: '{debit_str}' | Raw Credit: '{credit_str}' | Raw Amount: '{amount_str}'", file=sys.stderr)

            date = self.parse_date(date_str, year, lang_config)
            if not date:
                if self.debug: print(f"[DEBUG] -> Skipping row, could not parse date: '{date_str}'", file=sys.stderr)
                continue

            amount = None
            if amount_str:
                amount = self.parse_amount(amount_str)
            
            if amount is None:
                debit = self.parse_amount(debit_str)
                credit = self.parse_amount(credit_str)
                if debit is not None:
                    amount = -debit
                elif credit is not None:
                    amount = credit
            
            if is_debit and amount is not None and amount > 0:
                amount = -amount

            if self.debug: print(f"[DEBUG]   Parsed Date: {date} | Parsed Amount: {amount}", file=sys.stderr)

            if amount is None:
                if self.debug: print(f"[DEBUG] -> Skipping row, no valid amount found.", file=sys.stderr)
                continue

            final_concept = concept_str.strip()
            if self.debug: print(f"[DEBUG]   Final Description: '{final_concept}'", file=sys.stderr)

            transactions.append({"date": date, "description": final_concept, "amount": amount})
            if self.debug: print(f"[DEBUG] -> Transaction Added: {{'date': '{date}', 'description': '{final_concept}', 'amount': {amount}}}", file=sys.stderr)

        return transactions

    def is_header_row(self, row, lang_config):
        row_lower = [str(cell).lower() for cell in row]
        score = 0
        all_header_keys = lang_config['date_cols'] + lang_config['concept_cols'] + \
                          lang_config['debit_cols'] + lang_config['credit_cols'] + \
                          lang_config['balance_cols']

        for cell_content in row_lower:
            if any(key in cell_content for key in all_header_keys):
                score += 1
        
        num_count = sum(c.isdigit() for c in " ".join(row_lower))
        min_cols = self.config.get('min_header_columns', 2)

        if score >= min_cols and num_count < 5 and len(row) > 1:
            return True, self.refine_header_indices(row, lang_config)
        
        return False, None

    def refine_header_indices(self, header_row, lang_config):
        headers = {'date': -1, 'concept': -1, 'debit': -1, 'credit': -1, 'balance': -1, 'amount': -1}
        row_lower = [str(cell).lower() for cell in header_row]

        for j, cell_content in enumerate(row_lower):
            if headers['date'] == -1 and any(k in cell_content for k in lang_config['date_cols']):
                headers['date'] = j
            elif headers['concept'] == -1 and any(k in cell_content for k in lang_config['concept_cols']):
                headers['concept'] = j
            elif headers['amount'] == -1 and any(k in cell_content for k in lang_config.get('amount_cols', [])):
                headers['amount'] = j
            elif headers['debit'] == -1 and any(k in cell_content for k in lang_config['debit_cols']):
                headers['debit'] = j
            elif headers['credit'] == -1 and any(k in cell_content for k in lang_config['credit_cols']):
                headers['credit'] = j

        if headers['concept'] == -1:
            concept_candidates = [(j, cell) for j, cell in enumerate(row_lower) if j not in headers.values() and cell]
            if concept_candidates:
                headers['concept'] = max(concept_candidates, key=lambda item: len(item[1]))[0]

        if self.debug: print(f"[DEBUG] Refined headers: {headers}", file=sys.stderr)
        return headers

    def get_cell_value(self, row, headers, key):
        idx = headers.get(key, -1)
        return row[idx] if idx != -1 and idx < len(row) else ""

    def parse_date(self, date_str, year, lang_config):
        date_str = str(date_str).strip()
        if not date_str: return None

        for month_abbr, month_num in lang_config['month_map'].items():
            if month_abbr.lower() in date_str.lower():
                day_match = re.search(r'(\d{1,2})', date_str)
                if day_match:
                    day = int(day_match.group(1))
                    try: 
                        date_with_year = f"{day}-{month_num}-{year}"
                        return datetime.strptime(date_with_year, '%d-%m-%Y').strftime('%Y-%m-%d')
                    except ValueError: pass
        
        for fmt in ["%d/%m", "%d-%m", "%m-%d", "%m/%d"]:
            try:
                date_obj = datetime.strptime(date_str, fmt)
                date_obj = date_obj.replace(year=int(year))
                return date_obj.strftime('%Y-%m-%d')
            except (ValueError, TypeError): continue

        return None
    
    def parse_amount(self, amount_str):
        if not isinstance(amount_str, str) or not amount_str.strip(): return None
        amount_str = amount_str.strip().replace('$', '').replace('+', '')
        is_negative = '-' in amount_str or ('(' in amount_str and ')' in amount_str)
        amount_str = re.sub(r'[^0-9.,]', '', amount_str)
        if not amount_str: return None
        if ',' in amount_str and '.' in amount_str:
            if amount_str.rfind('.') > amount_str.rfind(','): amount_str = amount_str.replace(',', '')
            else: amount_str = amount_str.replace('.', '').replace(',', '.')
        elif ',' in amount_str: amount_str = amount_str.replace(',', '.')
        try:
            amount = float(amount_str)
            return -abs(amount) if is_negative else abs(amount)
        except (ValueError, TypeError): return None

def main():
    parser = argparse.ArgumentParser(description="Procesa un PDF usando Docling con configuración externa.")
    parser.add_argument('--stdin', action='store_true')
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('pdf_path', nargs='?')
    args = parser.parse_args()

    config_path = os.path.join(os.path.dirname(__file__), 'parser_config.json')

    try:
        processor = ContextAwareProcessor(config_path, debug=args.debug)
        
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