
import camelot
import sys
import os

def check_pdf_tables(pdf_path):
    """
    Analyzes a PDF with Camelot to diagnose table detection issues.
    """
    if not os.path.exists(pdf_path):
        print(f"Error: File not found at '{pdf_path}'")
        return

    print(f"--- Analyzing PDF: {pdf_path} ---")

    # --- Test 1: Lattice ---
    print("\n[INFO] Trying flavor='lattice' (for tables with clear lines)...")
    try:
        tables_lattice = camelot.read_pdf(pdf_path, flavor='lattice', pages='all')
        print(f"[SUCCESS] Lattice found {len(tables_lattice)} tables.")
        if tables_lattice:
            print("Displaying first table found by Lattice:")
            print(tables_lattice[0].df)
            
            # Generate a visual debug plot
            output_plot_path = 'debug_lattice_output.png'
            tables_lattice[0].plot(kind='grid', filename=output_plot_path)
            print(f"[VISUAL] Saved lattice debug plot to '{output_plot_path}'")

    except Exception as e:
        print(f"[ERROR] Lattice failed: {e}")

    # --- Test 2: Stream ---
    print("\n[INFO] Trying flavor='stream' (for tables without lines)...")
    try:
        tables_stream = camelot.read_pdf(pdf_path, flavor='stream', pages='all')
        print(f"[SUCCESS] Stream found {len(tables_stream)} tables.")
        if tables_stream:
            print("Displaying first table found by Stream:")
            print(tables_stream[0].df)

            # Generate a visual debug plot
            output_plot_path = 'debug_stream_output.png'
            tables_stream[0].plot(kind='text', filename=output_plot_path)
            print(f"[VISUAL] Saved stream debug plot to '{output_plot_path}'")
            
    except Exception as e:
        print(f"[ERROR] Stream failed: {e}")

    print("\n--- Analysis Complete ---")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 check_camelot.py <path_to_your_pdf>")
    else:
        check_pdf_tables(sys.argv[1])
