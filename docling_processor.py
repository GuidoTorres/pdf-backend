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
import camelot
import pandas as pd
import numpy as np
import groq

import uuid

import fitz  # PyMuPDF

class EnhancedPdfProcessor:
    def __init__(self, config_path, debug=False):
        self.debug = debug
        self.config = self.load_config(config_path)
        self.pattern_cache = {}
        self.bank_configs = {}
        self.load_bank_specific_configs()
        self.groq_client = groq.Groq(api_key=os.environ.get("GROQ_API_KEY"))

    def load_config(self, config_path):
        if not os.path.exists(config_path):
            raise FileNotFoundError(f"Config file not found: {config_path}")
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def load_bank_specific_configs(self):
        config_dir = os.path.dirname(os.path.abspath(__file__))
        bank_config_files = [
            'config_bcp.json', 'config_chase.json', 
            'config_santander.json', 'config_bbva.json'
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

    def process_document(self, pdf_path):
        start_time_total = time.time()
        if self.debug:
            print(f"[DEBUG] Processing document with Camelot: {pdf_path}", file=sys.stderr)

        try:
            # Attempt to process with 'lattice' first, as it's often more accurate for structured tables.
            try:
                tables = camelot.read_pdf(pdf_path, flavor='lattice', pages='all')
                if self.debug:
                    print(f"[DEBUG] Camelot 'lattice' found {len(tables)} tables.", file=sys.stderr)
            except Exception as e:
                tables = []
                if self.debug:
                    print(f"[DEBUG] Camelot 'lattice' failed with error: {e}", file=sys.stderr)

            # If lattice returns no tables, fall back to stream
            if not tables:
                if self.debug:
                    print("[DEBUG] 'lattice' found no tables, attempting 'stream' flavor.", file=sys.stderr)
                try:
                    tables = camelot.read_pdf(pdf_path, flavor='stream', pages='all', row_tol=10)
                    if self.debug:
                        print(f"[DEBUG] Camelot 'stream' found {len(tables)} tables.", file=sys.stderr)
                except Exception as e:
                    if self.debug:
                        print(f"[DEBUG] Camelot 'stream' failed with error: {e}", file=sys.stderr)
                    tables = []

            all_tables_dfs = [table.df for table in tables]
            
            if all_tables_dfs:
                transactions = self.extract_transactions_with_groq(all_tables_dfs)
            else:
                if self.debug:
                    print("[DEBUG] No tables found with Camelot, falling back to raw text extraction.", file=sys.stderr)
                transactions = self.extract_transactions_from_raw_text(pdf_path)

            end_time_total = time.time()
            return {
                "meta": {
                    "processing_time": round(end_time_total - start_time_total, 2),
                    "total_transactions": len(transactions),
                    "bank_type": None,
                    "is_scanned": False,
                    "tables_found": len(all_tables_dfs),
                },
                "transactions": transactions,
                "provider": "groq_llama4_maverick"
            }

        except Exception as e:
            import traceback
            print(f"[ERROR] Error processing document with Groq: {e}", file=sys.stderr)
            print(f"[ERROR] Traceback: {traceback.format_exc() }", file=sys.stderr)
            return {"meta": {}, "transactions": [], "error": str(e)}

    def process_plain_text(self, text_content: str):
        start_time_total = time.time()
        if self.debug:
            print(f"[DEBUG] Processing plain text content.", file=sys.stderr)

        try:
            transactions = self.extract_transactions_with_groq_from_text(text_content)

            end_time_total = time.time()
            return {
                "meta": {
                    "processing_time": round(end_time_total - start_time_total, 2),
                    "total_transactions": len(transactions),
                    "bank_type": None,
                    "is_scanned": False,
                    "tables_found": 0,
                },
                "transactions": transactions,
                "provider": "groq_llama4_maverick"
            }
        except Exception as e:
            import traceback
            print(f"[ERROR] Error processing plain text with Groq: {e}", file=sys.stderr)
            print(f"[ERROR] Traceback: {traceback.format_exc() }", file=sys.stderr)
            return {"meta": {}, "transactions": [], "error": str(e)}

    def extract_transactions_with_groq_from_text(self, text_content: str) -> List[Dict]:
        prompt = f"""Analyze the following text from a bank statement. The text contains sections for deposits, withdrawals, and checks. Extract all transactions into a single valid JSON array. Each transaction must be an object with the following keys: 'date', 'description', 'amount', and 'type'. 

- 'date': The date of the transaction in 'YYYY-MM-DD' format. The year is not present in the text, assume the current year 2025. The format is MM/DD.
- 'description': A detailed description of the transaction.
- 'amount': The transaction amount as a float.
- 'type': Should be 'credit' for deposits and other credits, and 'debit' for withdrawals, fees, and checks paid.

Your response must be only the JSON array, wrapped in a ```json code block, with no additional text, explanations, or formatting outside of the code block.

Here is the bank statement text:
---
{text_content}
---
"""

        if self.debug:
            print(f"[DEBUG] Sending the following to Groq:\n{prompt}", file=sys.stderr)

        try:
            chat_completion = self.groq_client.chat.completions.create(
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="meta-llama/llama-4-scout-17b-16e-instruct",
            )

            response_content = chat_completion.choices[0].message.content
            
            if self.debug:
                print(f"[DEBUG] Groq response:\n{response_content}", file=sys.stderr)

            # Extract the JSON part from the response
            json_match = re.search(r"```json\n(\[.*\])\n```", response_content, re.DOTALL)
            if json_match:
                transactions = json.loads(json_match.group(1))
                for transaction in transactions:
                    transaction['id'] = str(uuid.uuid4())
                return transactions
            else:
                if self.debug:
                    print("[DEBUG] No JSON found in Groq response.", file=sys.stderr)
                return []

        except Exception as e:
            print(f"[ERROR] Groq API call failed: {e}", file=sys.stderr)
            return []

    def extract_transactions_from_raw_text(self, pdf_path: str) -> List[Dict]:
        try:
            doc = fitz.open(pdf_path)
            raw_text = ""
            for page in doc:
                raw_text += page.get_text()
            doc.close()

            if self.debug:
                print(f"[DEBUG] Extracted raw text:\n{raw_text}", file=sys.stderr)

            # Re-use the Groq text extraction logic, but this time with the raw text
            return self.extract_transactions_with_groq_from_text(raw_text)
        except Exception as e:
            print(f"[ERROR] Failed to extract raw text with PyMuPDF: {e}", file=sys.stderr)
            return []

    def extract_transactions_with_groq(self, tables: List[pd.DataFrame]) -> List[Dict]:
        if not tables:
            return []

        # Combine all tables into a single string representation
        tables_str = "\n".join([df.to_string() for df in tables])

        prompt = f"""Analyze the following table(s) from a bank statement and extract the transactions into a valid JSON array. Each transaction must be an object with the following keys: 'date', 'description', 'amount', and 'type'. The 'date' must be in 'YYYY-MM-DD' format. The 'description' must be a string. The 'amount' must be a float. The 'type' must be either 'debit' or 'credit'. Your response must be only the JSON array, wrapped in a ```json code block, with no additional text, explanations, or formatting outside of the code block.

{tables_str}

"""

        if self.debug:
            print(f"[DEBUG] Sending the following to Groq:\n{prompt}", file=sys.stderr)

        try:
            chat_completion = self.groq_client.chat.completions.create(
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="meta-llama/llama-4-scout-17b-16e-instruct",
            )

            response_content = chat_completion.choices[0].message.content
            
            if self.debug:
                print(f"[DEBUG] Groq response:\n{response_content}", file=sys.stderr)

            # Extract the JSON part from the response
            json_match = re.search(r"```json\n(\[.*\])\n```", response_content, re.DOTALL)
            if json_match:
                transactions = json.loads(json_match.group(1))
                for transaction in transactions:
                    transaction['id'] = str(uuid.uuid4())
                return transactions
            else:
                if self.debug:
                    print("[DEBUG] No JSON found in Groq response.", file=sys.stderr)
                return []

        except Exception as e:
            print(f"[ERROR] Groq API call failed: {e}", file=sys.stderr)
            return []

        except Exception as e:
            print(f"[ERROR] Groq API call failed: {e}", file=sys.stderr)
            return []

class AdvancedDoclingProcessor(EnhancedPdfProcessor):
    def __init__(self, config_path, debug=False):
        super().__init__(config_path, debug)
        if debug:
            print("[INFO] Initialized in compatibility mode. Using Groq Processor.", file=sys.stderr)

def main():
    parser = argparse.ArgumentParser(description="PDF Processor using Groq.")
    parser.add_argument('--stdin', action='store_true')
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('--text-file', type=str, help='Path to a text file to process.')
    parser.add_argument('pdf_path', nargs='?')
    args = parser.parse_args()

    config_path = os.path.join(os.path.dirname(__file__), 'parser_config.json')

    try:
        processor = EnhancedPdfProcessor(config_path, debug=args.debug)
        
        if args.text_file:
            with open(args.text_file, 'r', encoding='utf-8') as f:
                text_content = f.read()
            result = processor.process_plain_text(text_content)
        elif args.stdin:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(sys.stdin.buffer.read())
                pdf_path = tmp.name
            result = processor.process_document(pdf_path)
        elif args.pdf_path:
            pdf_path = args.pdf_path
            result = processor.process_document(pdf_path)
        else:
            raise ValueError("Must specify --stdin, --text-file, or a file path.")

        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        print(json.dumps({"error": str(e), "meta": {}, "transactions": []}))
    finally:
        if 'pdf_path' in locals() and args.stdin and os.path.exists(pdf_path):
            os.remove(pdf_path)

if __name__ == '__main__':
    main()
