import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

class TempFileManager {
  constructor() {
    this.tempFiles = new Set();
    this.tempDirs = new Set();
  }

  /**
   * Crea un archivo temporal y ejecuta un callback con su ruta
   * @param {Buffer} buffer - Contenido del archivo
   * @param {string} extension - Extensión del archivo
   * @param {Function} callback - Función a ejecutar con la ruta del archivo
   * @returns {Promise<any>} Resultado del callback
   */
  async withTempFile(buffer, extension, callback) {
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `${uuidv4()}.${extension}`);
    this.tempFiles.add(tempFilePath);

    try {
      await fs.writeFile(tempFilePath, buffer);
      return await callback(tempFilePath);
    } finally {
      await this.cleanup(tempFilePath);
    }
  }

  /**
   * Crea un directorio temporal y ejecuta un callback con su ruta
   * @param {Function} callback - Función a ejecutar con la ruta del directorio
   * @returns {Promise<any>} Resultado del callback
   */
  async withTempDir(callback) {
    const tempDir = os.tmpdir();
    const tempDirPath = path.join(tempDir, `temp_${uuidv4()}`);
    this.tempDirs.add(tempDirPath);

    try {
      await fs.mkdir(tempDirPath, { recursive: true });
      return await callback(tempDirPath);
    } finally {
      await this.cleanupDir(tempDirPath);
    }
  }

  /**
   * Limpia un archivo temporal específico
   * @param {string} filePath - Ruta del archivo a limpiar
   */
  async cleanup(filePath) {
    try {
      await fs.unlink(filePath);
      this.tempFiles.delete(filePath);
    } catch (err) {
      console.error(`Failed to delete temp file: ${filePath}`, err);
    }
  }

  /**
   * Limpia un directorio temporal específico
   * @param {string} dirPath - Ruta del directorio a limpiar
   */
  async cleanupDir(dirPath) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      this.tempDirs.delete(dirPath);
    } catch (err) {
      console.error(`Failed to delete temp directory: ${dirPath}`, err);
    }
  }

  /**
   * Limpia todos los archivos y directorios temporales
   */
  async cleanupAll() {
    const cleanupPromises = [
      ...Array.from(this.tempFiles).map(file => this.cleanup(file)),
      ...Array.from(this.tempDirs).map(dir => this.cleanupDir(dir))
    ];

    await Promise.allSettled(cleanupPromises);
  }
}

// Instancia singleton para uso global
const tempFileManager = new TempFileManager();

// Limpieza automática al cerrar la aplicación
process.on('exit', () => {
  tempFileManager.cleanupAll();
});

process.on('SIGINT', async () => {
  await tempFileManager.cleanupAll();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await tempFileManager.cleanupAll();
  process.exit(0);
});

export default tempFileManager;
export { TempFileManager };