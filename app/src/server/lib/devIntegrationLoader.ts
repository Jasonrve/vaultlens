import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { watch } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'dev-guides');

/**
 * Validates that a template path exists and is within TEMPLATES_DIR to prevent directory traversal.
 */
function validateTemplatePath(filename: string): string {
  const safePath = path.join(TEMPLATES_DIR, filename);
  if (!safePath.startsWith(TEMPLATES_DIR)) {
    throw new Error(`Invalid template path: ${filename}`);
  }
  return safePath;
}

/**
 * In-memory cache of template files.
 * Maps template key (e.g. 'approle') to raw markdown content.
 */
let templateCache: Record<string, string> = {};

/**
 * Load all markdown templates from disk into cache.
 */
async function loadTemplates(): Promise<void> {
  try {
    // Ensure templates directory exists
    if (!fs.existsSync(TEMPLATES_DIR)) {
      fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
    }

    const files = fs.readdirSync(TEMPLATES_DIR);
    const newCache: Record<string, string> = {};

    for (const file of files) {
      if (file.endsWith('.md')) {
        const key = file.replace('.md', '');
        const filePath = validateTemplatePath(file);
        const content = fs.readFileSync(filePath, 'utf-8');
        newCache[key] = content;
      }
    }

    templateCache = newCache;
    console.log(`[DevIntegrationLoader] Loaded ${Object.keys(templateCache).length} templates from disk`);
  } catch (error) {
    console.error('[DevIntegrationLoader] Error loading templates:', error);
  }
}

/**
 * Start watching for file changes and reload templates automatically.
 */
function startWatcher(): void {
  try {
    watch(TEMPLATES_DIR, { recursive: false }, async (_eventType, filename) => {
      if (filename?.endsWith('.md')) {
        console.log(`[DevIntegrationLoader] File changed: ${filename}, reloading...`);
        await loadTemplates();
      }
    });
  } catch (error) {
    console.error('[DevIntegrationLoader] Error starting watcher:', error);
  }
}

/**
 * Get a template by key (e.g. 'approle').
 * Returns the raw markdown content with {{VARIABLE}} placeholders.
 */
export function getTemplate(authType: string): string | undefined {
  const key = authType.toLowerCase();
  return templateCache[key];
}

/**
 * Get all available template keys.
 */
export function getAvailableTemplates(): string[] {
  return Object.keys(templateCache);
}

/**
 * Save a template override to disk.
 * This allows admins to customize templates via the UI.
 */
export async function saveTemplateOverride(authType: string, content: string): Promise<void> {
  try {
    const filePath = validateTemplatePath(`${authType.toLowerCase()}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');
    // Reload from disk to update cache
    templateCache[authType.toLowerCase()] = content;
    console.log(`[DevIntegrationLoader] Template override saved: ${authType}`);
  } catch (error) {
    console.error('[DevIntegrationLoader] Error saving template:', error);
    throw error;
  }
}

/**
 * Delete a template override (reset to default by removing the file if it's a custom one).
 * For now, this just removes from cache and reloads from disk.
 */
export async function deleteTemplateOverride(authType: string): Promise<void> {
  try {
    const filePath = validateTemplatePath(`${authType.toLowerCase()}.md`);
    if (fs.existsSync(filePath)) {
      // For now, we just reload from disk
      // In a real scenario, you might want to restore from a backup or git
      await loadTemplates();
    }
  } catch (error) {
    console.error('[DevIntegrationLoader] Error deleting template:', error);
    throw error;
  }
}

/**
 * Substitute {{VARIABLE}} placeholders in a template string.
 */
export function substituteTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

/**
 * Initialize the template system: load from disk and start watching for changes.
 */
export async function initializeTemplates(): Promise<void> {
  await loadTemplates();
  startWatcher();
}

export default {
  getTemplate,
  getAvailableTemplates,
  saveTemplateOverride,
  deleteTemplateOverride,
  substituteTemplate,
  initializeTemplates,
};
