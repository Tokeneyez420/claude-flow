/**
 * Unit tests for file organizer utility
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
} from '../../../test.utils';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileOrganizer,
  FileInfo,
  organizeByType,
  organizeByDate,
  organizeBySize,
  organizeWithRules,
  byExtension,
  byNamePattern,
  bySizeRange,
  byAge,
  modifiedToday,
} from '../../../src/utils/file-organizer.ts';
import { cleanupTestEnv, setupTestEnv } from '../../test.config';

describe('FileOrganizer', () => {
  let testDir: string;
  let organizer: FileOrganizer;

  beforeEach(async () => {
    setupTestEnv();
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `file-organizer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    organizer = new FileOrganizer();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    await cleanupTestEnv();
  });

  describe('organize by type', () => {
    it('should organize files by extension category', async () => {
      // Create test files
      await fs.writeFile(join(testDir, 'document.pdf'), 'pdf content');
      await fs.writeFile(join(testDir, 'image.jpg'), 'jpg content');
      await fs.writeFile(join(testDir, 'code.ts'), 'typescript content');
      await fs.writeFile(join(testDir, 'unknown.xyz'), 'unknown content');

      const result = await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        action: 'move',
      });

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(4);
      expect(result.organized).toBe(4);
      expect(result.errors.length).toBe(0);

      // Check files are in correct folders
      const documentsExists = await fs.access(join(testDir, 'documents', 'document.pdf')).then(() => true).catch(() => false);
      const imagesExists = await fs.access(join(testDir, 'images', 'image.jpg')).then(() => true).catch(() => false);
      const codeExists = await fs.access(join(testDir, 'code', 'code.ts')).then(() => true).catch(() => false);
      const otherExists = await fs.access(join(testDir, 'other', 'unknown.xyz')).then(() => true).catch(() => false);

      expect(documentsExists).toBe(true);
      expect(imagesExists).toBe(true);
      expect(codeExists).toBe(true);
      expect(otherExists).toBe(true);
    });

    it('should handle dry run without moving files', async () => {
      await fs.writeFile(join(testDir, 'test.pdf'), 'content');

      const result = await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        action: 'move',
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(1);
      expect(result.operations[0].action).toBe('move');

      // File should still be in original location
      const originalExists = await fs.access(join(testDir, 'test.pdf')).then(() => true).catch(() => false);
      expect(originalExists).toBe(true);
    });

    it('should copy files when action is copy', async () => {
      await fs.writeFile(join(testDir, 'test.pdf'), 'content');

      const result = await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        action: 'copy',
      });

      expect(result.success).toBe(true);

      // Both original and copy should exist
      const originalExists = await fs.access(join(testDir, 'test.pdf')).then(() => true).catch(() => false);
      const copyExists = await fs.access(join(testDir, 'documents', 'test.pdf')).then(() => true).catch(() => false);

      expect(originalExists).toBe(true);
      expect(copyExists).toBe(true);
    });
  });

  describe('organize by date', () => {
    it('should organize files by modification date', async () => {
      await fs.writeFile(join(testDir, 'today.txt'), 'content');

      const result = await organizer.organize({
        strategy: 'date',
        sourceDir: testDir,
        action: 'move',
        dateFormat: 'year-month',
      });

      expect(result.success).toBe(true);
      expect(result.organized).toBe(1);

      // File should be in year/month folder
      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const expectedPath = join(testDir, year, month, 'today.txt');

      const fileExists = await fs.access(expectedPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should support different date formats', async () => {
      await fs.writeFile(join(testDir, 'file.txt'), 'content');

      const result = await organizer.organize({
        strategy: 'date',
        sourceDir: testDir,
        action: 'move',
        dateFormat: 'year',
      });

      expect(result.success).toBe(true);

      const year = new Date().getFullYear().toString();
      const fileExists = await fs.access(join(testDir, year, 'file.txt')).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });

  describe('organize by size', () => {
    it('should organize files by size categories', async () => {
      // Tiny file (< 10KB)
      await fs.writeFile(join(testDir, 'tiny.txt'), 'small');

      // Small file (> 10KB, < 100KB)
      await fs.writeFile(join(testDir, 'small.txt'), 'x'.repeat(20 * 1024));

      const result = await organizer.organize({
        strategy: 'size',
        sourceDir: testDir,
        action: 'move',
      });

      expect(result.success).toBe(true);
      expect(result.organized).toBe(2);

      const tinyExists = await fs.access(join(testDir, 'tiny', 'tiny.txt')).then(() => true).catch(() => false);
      const smallExists = await fs.access(join(testDir, 'small', 'small.txt')).then(() => true).catch(() => false);

      expect(tinyExists).toBe(true);
      expect(smallExists).toBe(true);
    });

    it('should respect custom size thresholds', async () => {
      await fs.writeFile(join(testDir, 'file.txt'), 'x'.repeat(500));

      const result = await organizer.organize({
        strategy: 'size',
        sourceDir: testDir,
        action: 'move',
        sizeThresholds: {
          tiny: 100,
          small: 1000,
        },
      });

      expect(result.success).toBe(true);

      // 500 bytes should be in 'small' category (> 100, < 1000)
      const smallExists = await fs.access(join(testDir, 'small', 'file.txt')).then(() => true).catch(() => false);
      expect(smallExists).toBe(true);
    });
  });

  describe('organize with custom rules', () => {
    it('should apply custom rules in priority order', async () => {
      await fs.writeFile(join(testDir, 'important.txt'), 'content');
      await fs.writeFile(join(testDir, 'normal.txt'), 'content');

      const result = await organizer.organize({
        strategy: 'custom',
        sourceDir: testDir,
        action: 'move',
        rules: [
          {
            name: 'important',
            match: (file) => file.name.includes('important'),
            targetFolder: 'priority',
            priority: 10,
          },
          {
            name: 'all-text',
            match: (file) => file.extension === '.txt',
            targetFolder: 'text-files',
            priority: 1,
          },
        ],
      });

      expect(result.success).toBe(true);

      // 'important.txt' should be in 'priority' (higher priority rule)
      // 'normal.txt' should be in 'text-files'
      const priorityExists = await fs.access(join(testDir, 'priority', 'important.txt')).then(() => true).catch(() => false);
      const textExists = await fs.access(join(testDir, 'text-files', 'normal.txt')).then(() => true).catch(() => false);

      expect(priorityExists).toBe(true);
      expect(textExists).toBe(true);
    });

    it('should use uncategorized for files not matching any rule', async () => {
      await fs.writeFile(join(testDir, 'file.xyz'), 'content');

      const result = await organizer.organize({
        strategy: 'custom',
        sourceDir: testDir,
        action: 'move',
        rules: [
          {
            name: 'text-only',
            match: (file) => file.extension === '.txt',
            targetFolder: 'text',
          },
        ],
      });

      expect(result.success).toBe(true);

      const uncategorizedExists = await fs.access(join(testDir, 'uncategorized', 'file.xyz')).then(() => true).catch(() => false);
      expect(uncategorizedExists).toBe(true);
    });
  });

  describe('file filtering', () => {
    it('should include only matching files', async () => {
      await fs.writeFile(join(testDir, 'include.ts'), 'content');
      await fs.writeFile(join(testDir, 'exclude.js'), 'content');

      const result = await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        action: 'move',
        include: ['*.ts'],
      });

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(1);
    });

    it('should exclude matching files', async () => {
      await fs.writeFile(join(testDir, 'keep.ts'), 'content');
      await fs.writeFile(join(testDir, 'skip.test.ts'), 'content');

      const result = await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        action: 'move',
        exclude: ['*.test.ts'],
      });

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(1);
    });

    it('should scan recursively when enabled', async () => {
      await fs.mkdir(join(testDir, 'subdir'), { recursive: true });
      await fs.writeFile(join(testDir, 'root.txt'), 'content');
      await fs.writeFile(join(testDir, 'subdir', 'nested.txt'), 'content');

      const result = await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        action: 'move',
        recursive: true,
      });

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(2);
    });
  });

  describe('conflict handling', () => {
    it('should skip conflicts when onConflict is skip', async () => {
      await fs.mkdir(join(testDir, 'documents'), { recursive: true });
      await fs.writeFile(join(testDir, 'test.pdf'), 'new content');
      await fs.writeFile(join(testDir, 'documents', 'test.pdf'), 'existing content');

      const result = await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        targetDir: testDir,
        action: 'move',
        onConflict: 'skip',
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(1);

      // Original file should still exist
      const originalExists = await fs.access(join(testDir, 'test.pdf')).then(() => true).catch(() => false);
      expect(originalExists).toBe(true);
    });

    it('should rename file when onConflict is rename', async () => {
      await fs.mkdir(join(testDir, 'documents'), { recursive: true });
      await fs.writeFile(join(testDir, 'test.pdf'), 'new content');
      await fs.writeFile(join(testDir, 'documents', 'test.pdf'), 'existing content');

      const result = await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        targetDir: testDir,
        action: 'move',
        onConflict: 'rename',
      });

      expect(result.success).toBe(true);
      expect(result.organized).toBe(1);

      // Both files should exist in documents folder
      const files = await fs.readdir(join(testDir, 'documents'));
      expect(files.length).toBe(2);
    });

    it('should overwrite when onConflict is overwrite', async () => {
      await fs.mkdir(join(testDir, 'documents'), { recursive: true });
      await fs.writeFile(join(testDir, 'test.pdf'), 'new content');
      await fs.writeFile(join(testDir, 'documents', 'test.pdf'), 'existing content');

      const result = await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        targetDir: testDir,
        action: 'move',
        onConflict: 'overwrite',
      });

      expect(result.success).toBe(true);

      const content = await fs.readFile(join(testDir, 'documents', 'test.pdf'), 'utf8');
      expect(content).toBe('new content');
    });
  });

  describe('progress callback', () => {
    it('should call progress callback during organization', async () => {
      await fs.writeFile(join(testDir, 'file1.txt'), 'content');
      await fs.writeFile(join(testDir, 'file2.txt'), 'content');

      const progressCalls: any[] = [];

      await organizer.organize({
        strategy: 'type',
        sourceDir: testDir,
        action: 'move',
        onProgress: (progress) => {
          progressCalls.push({ ...progress });
        },
      });

      // Should have scanning, organizing, and complete calls
      expect(progressCalls.length > 0).toBe(true);
      expect(progressCalls[0].action).toBe('scanning');
      expect(progressCalls[progressCalls.length - 1].action).toBe('complete');
    });
  });

  describe('preview', () => {
    it('should preview without making changes', async () => {
      await fs.writeFile(join(testDir, 'test.pdf'), 'content');

      const result = await organizer.preview({
        strategy: 'type',
        sourceDir: testDir,
        action: 'move',
      });

      expect(result.success).toBe(true);
      expect(result.operations.length).toBe(1);

      // File should still be in original location
      const originalExists = await fs.access(join(testDir, 'test.pdf')).then(() => true).catch(() => false);
      expect(originalExists).toBe(true);
    });
  });

  describe('getSuggestedFolder', () => {
    it('should return correct folder for type strategy', () => {
      const file: FileInfo = {
        path: '/test/file.pdf',
        name: 'file.pdf',
        extension: '.pdf',
        size: 1000,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      const folder = organizer.getSuggestedFolder(file, {
        strategy: 'type',
        sourceDir: '/test',
        action: 'move',
      });

      expect(folder).toBe('documents');
    });

    it('should return other for unknown extensions', () => {
      const file: FileInfo = {
        path: '/test/file.xyz',
        name: 'file.xyz',
        extension: '.xyz',
        size: 1000,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      const folder = organizer.getSuggestedFolder(file, {
        strategy: 'type',
        sourceDir: '/test',
        action: 'move',
      });

      expect(folder).toBe('other');
    });
  });
});

describe('Rule Builders', () => {
  describe('byExtension', () => {
    it('should match files by extension', () => {
      const rule = byExtension(['.ts', '.js'], 'code');

      const tsFile: FileInfo = {
        path: '/test/file.ts',
        name: 'file.ts',
        extension: '.ts',
        size: 100,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      const txtFile: FileInfo = {
        path: '/test/file.txt',
        name: 'file.txt',
        extension: '.txt',
        size: 100,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      expect(rule.match(tsFile)).toBe(true);
      expect(rule.match(txtFile)).toBe(false);
      expect(rule.targetFolder).toBe('code');
    });

    it('should handle extensions without leading dot', () => {
      const rule = byExtension(['ts', 'js'], 'code');

      const file: FileInfo = {
        path: '/test/file.ts',
        name: 'file.ts',
        extension: '.ts',
        size: 100,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      expect(rule.match(file)).toBe(true);
    });
  });

  describe('byNamePattern', () => {
    it('should match files by name pattern', () => {
      const rule = byNamePattern(/^test-.*\.ts$/, 'tests');

      const testFile: FileInfo = {
        path: '/test/test-something.ts',
        name: 'test-something.ts',
        extension: '.ts',
        size: 100,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      const normalFile: FileInfo = {
        path: '/test/something.ts',
        name: 'something.ts',
        extension: '.ts',
        size: 100,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      expect(rule.match(testFile)).toBe(true);
      expect(rule.match(normalFile)).toBe(false);
    });
  });

  describe('bySizeRange', () => {
    it('should match files within size range', () => {
      const rule = bySizeRange(1000, 10000, 'medium');

      const smallFile: FileInfo = {
        path: '/test/small.txt',
        name: 'small.txt',
        extension: '.txt',
        size: 500,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      const mediumFile: FileInfo = {
        path: '/test/medium.txt',
        name: 'medium.txt',
        extension: '.txt',
        size: 5000,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      expect(rule.match(smallFile)).toBe(false);
      expect(rule.match(mediumFile)).toBe(true);
    });
  });

  describe('byAge', () => {
    it('should match files by age in days', () => {
      const rule = byAge(0, 7, 'recent');

      const recentFile: FileInfo = {
        path: '/test/recent.txt',
        name: 'recent.txt',
        extension: '.txt',
        size: 100,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      const oldFile: FileInfo = {
        path: '/test/old.txt',
        name: 'old.txt',
        extension: '.txt',
        size: 100,
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        modifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        isDirectory: false,
      };

      expect(rule.match(recentFile)).toBe(true);
      expect(rule.match(oldFile)).toBe(false);
    });
  });

  describe('modifiedToday', () => {
    it('should match files modified today', () => {
      const rule = modifiedToday('today');

      const todayFile: FileInfo = {
        path: '/test/today.txt',
        name: 'today.txt',
        extension: '.txt',
        size: 100,
        createdAt: new Date(),
        modifiedAt: new Date(),
        isDirectory: false,
      };

      const oldFile: FileInfo = {
        path: '/test/old.txt',
        name: 'old.txt',
        extension: '.txt',
        size: 100,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        modifiedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        isDirectory: false,
      };

      expect(rule.match(todayFile)).toBe(true);
      expect(rule.match(oldFile)).toBe(false);
    });
  });
});

describe('Convenience Functions', () => {
  let testDir: string;

  beforeEach(async () => {
    setupTestEnv();
    testDir = join(tmpdir(), `file-organizer-conv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    await cleanupTestEnv();
  });

  describe('organizeByType', () => {
    it('should organize files by type', async () => {
      await fs.writeFile(join(testDir, 'doc.pdf'), 'content');

      const result = await organizeByType(testDir);

      expect(result.success).toBe(true);
      expect(result.organized).toBe(1);
    });
  });

  describe('organizeByDate', () => {
    it('should organize files by date', async () => {
      await fs.writeFile(join(testDir, 'file.txt'), 'content');

      const result = await organizeByDate(testDir, 'year');

      expect(result.success).toBe(true);
      expect(result.organized).toBe(1);
    });
  });

  describe('organizeBySize', () => {
    it('should organize files by size', async () => {
      await fs.writeFile(join(testDir, 'file.txt'), 'content');

      const result = await organizeBySize(testDir);

      expect(result.success).toBe(true);
      expect(result.organized).toBe(1);
    });
  });

  describe('organizeWithRules', () => {
    it('should organize files with custom rules', async () => {
      await fs.writeFile(join(testDir, 'readme.md'), 'content');

      const result = await organizeWithRules(testDir, [
        byExtension(['.md'], 'markdown'),
      ]);

      expect(result.success).toBe(true);
      expect(result.organized).toBe(1);

      const exists = await fs.access(join(testDir, 'markdown', 'readme.md')).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });
});
