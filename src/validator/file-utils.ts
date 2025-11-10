import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

/**
 * Utility functions for file operations
 * Single Responsibility: Only handles file I/O
 */
export const FileUtils = {
  /**
   * Read a file as UTF-8 text
   * @param filePath
   */
  async readFile(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      throw new Error(
        `Error reading file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },

  /**
   * Find all .txt files in a directory (recursively)
   * @param directory
   */
  async findRecordFiles(directory: string): Promise<string[]> {
    const files: string[] = [];

    async function walkDir(dir: string): Promise<void> {
      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);

          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else if (entry.isFile() && extname(entry.name) === '.txt') {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }

    await walkDir(directory);
    return files;
  },

  /**
   * Check if a path is a file or directory
   * @param filePath
   */
  async getPathType(
    filePath: string,
  ): Promise<'file' | 'directory' | 'none'> {
    try {
      const stats = await stat(filePath);
      return stats.isDirectory() ? 'directory' : 'file';
    } catch {
      return 'none';
    }
  },

  /**
   * Resolve file paths (handles both files and directories)
   * @param paths
   */
  async resolvePaths(paths: string[]): Promise<string[]> {
    const resolvedFiles: string[] = [];

    for (const path of paths) {
      const type = await this.getPathType(path);
      if (type === 'file' && extname(path) === '.txt') {
        resolvedFiles.push(path);
      } else if (type === 'directory') {
        const files = await this.findRecordFiles(path);
        resolvedFiles.push(...files);
      }
    }

    return resolvedFiles;
  },
};
