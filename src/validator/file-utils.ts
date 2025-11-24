import { readFile } from 'node:fs/promises';

/**
 * Utility functions for file operations
 * Simplified for single-file validation
 */
export const FileUtils = {
  /**
   * Read a file as UTF-8 text
   * @param filePath - Absolute path to the file
   * @returns File content as string
   */
  async readFile(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const wrappedError = new Error(
        `Error reading file ${filePath}: ${message}`,
      );
      (wrappedError as { cause?: unknown }).cause = error;
      throw wrappedError;
    }
  },
};
