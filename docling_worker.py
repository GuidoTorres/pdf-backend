#!/usr/bin/env python3
"""
Docling Processor Flask Worker

This script acts as a web server that receives requests to process PDFs.
It can accept either a file path or a base64-encoded file content.
"""

import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'python_libs'))

import json
import base64
import tempfile
from flask import Flask, request, jsonify
from docling_processor import AdvancedDoclingProcessor

app = Flask(__name__)

# Load configuration and initialize the processor once at startup
config_path = os.path.join(os.path.dirname(__file__), 'parser_config.json')
try:
    processor = AdvancedDoclingProcessor(config_path, debug=True)
    print("[DoclingWorker] AdvancedDoclingProcessor initialized successfully.")
except Exception as e:
    print(f"[DoclingWorker] CRITICAL: Failed to initialize AdvancedDoclingProcessor: {e}", file=sys.stderr)
    processor = None

@app.route('/process', methods=['POST'])
def process_pdf():
    if not processor:
        return jsonify({"error": "Processor not initialized. Check worker logs."}), 500

    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON request"}), 400

    debug = data.get('debug', True)
    file_path = data.get('file_path')
    file_content_b64 = data.get('file_content_b64')

    if not file_path and not file_content_b64:
        return jsonify({"error": "Request must include either 'file_path' or 'file_content_b64'"}), 400

    if file_content_b64:
        # Handle base64 content
        try:
            pdf_content = base64.b64decode(file_content_b64)
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
                tmp_file.write(pdf_content)
                file_path = tmp_file.name
            print(f"[DoclingWorker] Received base64 content, saved to temporary file: {file_path}")
        except (base64.binascii.Error, TypeError) as e:
            return jsonify({"error": f"Invalid base64 content: {e}"}), 400
    elif not os.path.exists(file_path):
        return jsonify({"error": f"File not found: {file_path}"}), 404
    else:
        print(f"[DoclingWorker] Received request to process path: {file_path}")

    try:
        result = processor.process_document(file_path)
        print(f"[DoclingWorker] Successfully processed {file_path}")
        return jsonify(result)
    except Exception as e:
        import traceback
        print(f"[DoclingWorker] Error processing {file_path}: {e}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        return jsonify({"error": str(e), "transactions": [], "meta": {}}), 500
    finally:
        # Clean up the temporary file if it was created from base64 content
        if file_content_b64 and os.path.exists(file_path):
            try:
                os.remove(file_path)
                print(f"[DoclingWorker] Cleaned up temporary file: {file_path}")
            except OSError as e:
                print(f"[DoclingWorker] Error cleaning up temporary file {file_path}: {e}", file=sys.stderr)

if __name__ == '__main__':
    # The server will run on port 5001 by default, which is what the Node.js service expects.
    app.run(host='0.0.0.0', port=3005, debug=True)