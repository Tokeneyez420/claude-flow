/**
 * File Organizer Utility
 * Organizes files by type, date, size, or custom rules
 */

import { promises as fs } from 'node:fs';
import { join, extname, basename, dirname, relative } from 'node:path';
import PQueue from 'p-queue';
import { generateId } from './helpers.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type OrganizeStrategy = 'type' | 'date' | 'size' | 'custom';

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
  isDirectory: boolean;
}

export interface OrganizeOptions {
  /** Organization strategy */
  strategy: OrganizeStrategy;
  /** Source directory to organize */
  sourceDir: string;
  /** Target directory for organized files (defaults to sourceDir) */
  targetDir?: string;
  /** Whether to move or copy files */
  action: 'move' | 'copy';
  /** Perform dry run without actual file operations */
  dryRun?: boolean;
  /** Recursively scan subdirectories */
  recursive?: boolean;
  /** File patterns to include (glob-like: *.ts, *.js) */
  include?: string[];
  /** File patterns to exclude */
  exclude?: string[];
  /** Custom rules for organization */
  rules?: OrganizeRule[];
  /** Date format for date-based organization */
  dateFormat?: 'year' | 'year-month' | 'year-month-day';
  /** Size thresholds for size-based organization (in bytes) */
  sizeThresholds?: SizeThresholds;
  /** Conflict resolution strategy */
  onConflict?: 'skip' | 'overwrite' | 'rename';
  /** Progress callback */
  onProgress?: (progress: OrganizeProgress) => void;
}

export interface OrganizeRule {
  /** Rule name for identification */
  name: string;
  /** Condition to match files */
  match: (file: FileInfo) => boolean;
  /** Target folder name or path generator */
  targetFolder: string | ((file: FileInfo) => string);
  /** Priority (higher = evaluated first) */
  priority?: number;
}

export interface SizeThresholds {
  tiny?: number;    // Default: 10KB
  small?: number;   // Default: 100KB
  medium?: number;  // Default: 1MB
  large?: number;   // Default: 10MB
  // Anything above large is 'huge'
}

export interface OrganizeProgress {
  total: number;
  processed: number;
  current: string;
  action: 'scanning' | 'organizing' | 'complete';
}

export interface OrganizeResult {
  success: boolean;
  totalFiles: number;
  organized: number;
  skipped: number;
  errors: OrganizeError[];
  operations: FileOperation[];
  duration: number;
}

export interface FileOperation {
  source: string;
  destination: string;
  action: 'move' | 'copy' | 'skip';
  success: boolean;
  error?: string;
}

export interface OrganizeError {
  file: string;
  error: string;
}

// ============================================================================
// Default Category Mappings
// ============================================================================

const FILE_TYPE_CATEGORIES: Record<string, string[]> = {
  'documents': ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx', '.csv'],
  'images': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff', '.raw', '.heic'],
  'videos': ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg'],
  'audio': ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.aiff'],
  'archives': ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz'],
  'code': ['.ts', '.js', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt'],
  'web': ['.html', '.htm', '.css', '.scss', '.sass', '.less', '.jsx', '.tsx', '.vue', '.svelte'],
  'data': ['.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.env', '.sql'],
  'fonts': ['.ttf', '.otf', '.woff', '.woff2', '.eot'],
  'executables': ['.exe', '.msi', '.dmg', '.app', '.deb', '.rpm', '.sh', '.bat', '.cmd'],
};

const DEFAULT_SIZE_THRESHOLDS: Required<SizeThresholds> = {
  tiny: 10 * 1024,           // 10KB
  small: 100 * 1024,         // 100KB
  medium: 1024 * 1024,       // 1MB
  large: 10 * 1024 * 1024,   // 10MB
};

// ============================================================================
// File Organizer Class
// ============================================================================

export class FileOrganizer {
  private queue: PQueue;
  private abortController: AbortController | null = null;

  constructor(private concurrency = 10) {
    this.queue = new PQueue({ concurrency });
  }

  /**
   * Organize files according to the specified options
   */
  async organize(options: OrganizeOptions): Promise<OrganizeResult> {
    const startTime = Date.now();
    this.abortController = new AbortController();

    const result: OrganizeResult = {
      success: true,
      totalFiles: 0,
      organized: 0,
      skipped: 0,
      errors: [],
      operations: [],
      duration: 0,
    };

    try {
      // Validate options
      this.validateOptions(options);

      // Scan files
      options.onProgress?.({
        total: 0,
        processed: 0,
        current: options.sourceDir,
        action: 'scanning',
      });

      const files = await this.scanDirectory(options.sourceDir, options);
      result.totalFiles = files.length;

      if (files.length === 0) {
        result.duration = Date.now() - startTime;
        return result;
      }

      // Organize files
      const targetDir = options.targetDir || options.sourceDir;

      for (let i = 0; i < files.length; i++) {
        if (this.abortController.signal.aborted) {
          break;
        }

        const file = files[i];
        options.onProgress?.({
          total: files.length,
          processed: i,
          current: file.path,
          action: 'organizing',
        });

        const operation = await this.processFile(file, targetDir, options);
        result.operations.push(operation);

        if (operation.success) {
          if (operation.action === 'skip') {
            result.skipped++;
          } else {
            result.organized++;
          }
        } else {
          result.errors.push({ file: file.path, error: operation.error || 'Unknown error' });
        }
      }

      options.onProgress?.({
        total: files.length,
        processed: files.length,
        current: '',
        action: 'complete',
      });

    } catch (error) {
      result.success = false;
      result.errors.push({
        file: options.sourceDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Cancel ongoing organization
   */
  cancel(): void {
    this.abortController?.abort();
    this.queue.clear();
  }

  /**
   * Preview organization without making changes
   */
  async preview(options: OrganizeOptions): Promise<OrganizeResult> {
    return this.organize({ ...options, dryRun: true });
  }

  /**
   * Get suggested organization for a single file
   */
  getSuggestedFolder(file: FileInfo, options: OrganizeOptions): string {
    switch (options.strategy) {
      case 'type':
        return this.getTypeFolderName(file);
      case 'date':
        return this.getDateFolderName(file, options.dateFormat || 'year-month');
      case 'size':
        return this.getSizeFolderName(file, options.sizeThresholds);
      case 'custom':
        return this.getCustomFolderName(file, options.rules || []);
      default:
        return 'other';
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private validateOptions(options: OrganizeOptions): void {
    if (!options.sourceDir) {
      throw new Error('Source directory is required');
    }

    if (options.strategy === 'custom' && (!options.rules || options.rules.length === 0)) {
      throw new Error('Custom strategy requires at least one rule');
    }
  }

  private async scanDirectory(
    dir: string,
    options: OrganizeOptions,
    files: FileInfo[] = []
  ): Promise<FileInfo[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (options.recursive) {
            await this.scanDirectory(fullPath, options, files);
          }
        } else if (entry.isFile()) {
          if (this.shouldIncludeFile(entry.name, options)) {
            const stats = await fs.stat(fullPath);
            files.push({
              path: fullPath,
              name: entry.name,
              extension: extname(entry.name).toLowerCase(),
              size: stats.size,
              createdAt: stats.birthtime,
              modifiedAt: stats.mtime,
              isDirectory: false,
            });
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }

    return files;
  }

  private shouldIncludeFile(filename: string, options: OrganizeOptions): boolean {
    const ext = extname(filename).toLowerCase();

    // Check exclude patterns
    if (options.exclude) {
      for (const pattern of options.exclude) {
        if (this.matchPattern(filename, pattern)) {
          return false;
        }
      }
    }

    // Check include patterns
    if (options.include && options.include.length > 0) {
      for (const pattern of options.include) {
        if (this.matchPattern(filename, pattern)) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  private matchPattern(filename: string, pattern: string): boolean {
    // Simple glob-like matching
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`, 'i').test(filename);
  }

  private async processFile(
    file: FileInfo,
    targetDir: string,
    options: OrganizeOptions
  ): Promise<FileOperation> {
    const folderName = this.getSuggestedFolder(file, options);
    const destinationDir = join(targetDir, folderName);
    let destinationPath = join(destinationDir, file.name);

    // Handle conflicts
    if (!options.dryRun) {
      try {
        await fs.access(destinationPath);
        // File exists
        switch (options.onConflict || 'rename') {
          case 'skip':
            return {
              source: file.path,
              destination: destinationPath,
              action: 'skip',
              success: true,
            };
          case 'rename':
            destinationPath = this.generateUniqueName(destinationPath);
            break;
          case 'overwrite':
            // Continue with overwrite
            break;
        }
      } catch {
        // File doesn't exist, continue
      }
    }

    // Perform operation
    if (options.dryRun) {
      return {
        source: file.path,
        destination: destinationPath,
        action: options.action,
        success: true,
      };
    }

    try {
      await fs.mkdir(destinationDir, { recursive: true });

      if (options.action === 'move') {
        await fs.rename(file.path, destinationPath);
      } else {
        await fs.copyFile(file.path, destinationPath);
      }

      return {
        source: file.path,
        destination: destinationPath,
        action: options.action,
        success: true,
      };
    } catch (error) {
      return {
        source: file.path,
        destination: destinationPath,
        action: options.action,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private generateUniqueName(path: string): string {
    const dir = dirname(path);
    const ext = extname(path);
    const base = basename(path, ext);
    const uniqueId = generateId().slice(0, 8);
    return join(dir, `${base}_${uniqueId}${ext}`);
  }

  private getTypeFolderName(file: FileInfo): string {
    const ext = file.extension.toLowerCase();

    for (const [category, extensions] of Object.entries(FILE_TYPE_CATEGORIES)) {
      if (extensions.includes(ext)) {
        return category;
      }
    }

    return 'other';
  }

  private getDateFolderName(
    file: FileInfo,
    format: 'year' | 'year-month' | 'year-month-day'
  ): string {
    const date = file.modifiedAt;
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');

    switch (format) {
      case 'year':
        return year;
      case 'year-month':
        return join(year, month);
      case 'year-month-day':
        return join(year, month, day);
      default:
        return year;
    }
  }

  private getSizeFolderName(file: FileInfo, thresholds?: SizeThresholds): string {
    const t = { ...DEFAULT_SIZE_THRESHOLDS, ...thresholds };

    if (file.size < t.tiny) return 'tiny';
    if (file.size < t.small) return 'small';
    if (file.size < t.medium) return 'medium';
    if (file.size < t.large) return 'large';
    return 'huge';
  }

  private getCustomFolderName(file: FileInfo, rules: OrganizeRule[]): string {
    // Sort by priority (higher first)
    const sortedRules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const rule of sortedRules) {
      if (rule.match(file)) {
        return typeof rule.targetFolder === 'function'
          ? rule.targetFolder(file)
          : rule.targetFolder;
      }
    }

    return 'uncategorized';
  }
}

// ============================================================================
// Preset Rule Builders
// ============================================================================

/**
 * Create a rule that matches files by extension
 */
export function byExtension(extensions: string[], targetFolder: string): OrganizeRule {
  const normalizedExts = extensions.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`);
  return {
    name: `extension:${extensions.join(',')}`,
    match: (file) => normalizedExts.includes(file.extension.toLowerCase()),
    targetFolder,
  };
}

/**
 * Create a rule that matches files by name pattern
 */
export function byNamePattern(pattern: RegExp, targetFolder: string): OrganizeRule {
  return {
    name: `pattern:${pattern.source}`,
    match: (file) => pattern.test(file.name),
    targetFolder,
  };
}

/**
 * Create a rule that matches files by size range
 */
export function bySizeRange(
  minBytes: number,
  maxBytes: number,
  targetFolder: string
): OrganizeRule {
  return {
    name: `size:${minBytes}-${maxBytes}`,
    match: (file) => file.size >= minBytes && file.size < maxBytes,
    targetFolder,
  };
}

/**
 * Create a rule that matches files by age (days since modified)
 */
export function byAge(minDays: number, maxDays: number, targetFolder: string): OrganizeRule {
  return {
    name: `age:${minDays}-${maxDays}days`,
    match: (file) => {
      const ageMs = Date.now() - file.modifiedAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      return ageDays >= minDays && ageDays < maxDays;
    },
    targetFolder,
  };
}

/**
 * Create a rule that matches files modified today
 */
export function modifiedToday(targetFolder: string): OrganizeRule {
  return {
    name: 'modified:today',
    match: (file) => {
      const today = new Date();
      return (
        file.modifiedAt.getDate() === today.getDate() &&
        file.modifiedAt.getMonth() === today.getMonth() &&
        file.modifiedAt.getFullYear() === today.getFullYear()
      );
    },
    targetFolder,
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick organize by file type
 */
export async function organizeByType(
  sourceDir: string,
  options?: Partial<OrganizeOptions>
): Promise<OrganizeResult> {
  const organizer = new FileOrganizer();
  return organizer.organize({
    strategy: 'type',
    sourceDir,
    action: 'move',
    ...options,
  });
}

/**
 * Quick organize by date
 */
export async function organizeByDate(
  sourceDir: string,
  dateFormat: 'year' | 'year-month' | 'year-month-day' = 'year-month',
  options?: Partial<OrganizeOptions>
): Promise<OrganizeResult> {
  const organizer = new FileOrganizer();
  return organizer.organize({
    strategy: 'date',
    sourceDir,
    action: 'move',
    dateFormat,
    ...options,
  });
}

/**
 * Quick organize by size
 */
export async function organizeBySize(
  sourceDir: string,
  options?: Partial<OrganizeOptions>
): Promise<OrganizeResult> {
  const organizer = new FileOrganizer();
  return organizer.organize({
    strategy: 'size',
    sourceDir,
    action: 'move',
    ...options,
  });
}

/**
 * Organize with custom rules
 */
export async function organizeWithRules(
  sourceDir: string,
  rules: OrganizeRule[],
  options?: Partial<OrganizeOptions>
): Promise<OrganizeResult> {
  const organizer = new FileOrganizer();
  return organizer.organize({
    strategy: 'custom',
    sourceDir,
    action: 'move',
    rules,
    ...options,
  });
}

// ============================================================================
// Export Default
// ============================================================================

export default FileOrganizer;
