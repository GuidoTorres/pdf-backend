#!/usr/bin/env python3
"""
Docling Processing Worker
"""

import os
import json
from flask import Flask, request, jsonify
from docling_processor import ContextAwareProcessor

# --- Configuración --- #
# Usamos una variable de entorno para el modo debug, con un valor por defecto.
DEBUG_MODE = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
HOST = '127.0.0.1'
PORT = 5001

# --- Inicialización de la Aplicación Flask --- #
app = Flask(__name__)

# --- Carga del Modelo (se ejecuta una sola vez al iniciar el worker) --- #
print("Initializing Docling model...")
config_path = os.path.join(os.path.dirname(__file__), 'parser_config.json')
processor = ContextAwareProcessor(config_path, debug=DEBUG_MODE)
print("Docling model initialized successfully.")

# --- Definición de Endpoints de la API --- #
@app.route('/process', methods=['POST'])
def process_pdf_endpoint():
    """Endpoint para procesar un fichero PDF."""
    if 'file_path' not in request.json:
        return jsonify({"error": "Missing 'file_path' in request body"}), 400

    pdf_path = request.json['file_path']

    if not os.path.exists(pdf_path):
        return jsonify({"error": f"File not found: {pdf_path}"}), 404

    try:
        # Usamos la instancia del procesador que ya está en memoria
        result = processor.process_document(pdf_path)
        return jsonify(result)
    except Exception as e:
        # Si algo falla, devolvemos un error claro
        return jsonify({"error": str(e), "transactions": [], "meta": {}}), 500

# --- Arranque del Servidor --- #
if __name__ == '__main__':
    # app.run() es ideal para desarrollo, pero para producción
    # se recomienda usar un servidor WSGI como Gunicorn o Waitress.
    app.run(host=HOST, port=PORT, debug=DEBUG_MODE)