import Handlebars from 'handlebars';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Register custom helpers
Handlebars.registerHelper('json', (context) => JSON.stringify(context, null, 2));

Handlebars.registerHelper('uppercase', (str: string) => str?.toUpperCase());

Handlebars.registerHelper('lowercase', (str: string) => str?.toLowerCase());

Handlebars.registerHelper(
  'ifEquals',
  function (this: unknown, arg1: unknown, arg2: unknown, options: Handlebars.HelperOptions) {
    return arg1 === arg2 ? options.fn(this) : options.inverse(this);
  }
);

Handlebars.registerHelper(
  'ifNotEquals',
  function (this: unknown, arg1: unknown, arg2: unknown, options: Handlebars.HelperOptions) {
    return arg1 !== arg2 ? options.fn(this) : options.inverse(this);
  }
);

Handlebars.registerHelper('formatDate', (date: Date | string) => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString();
});

Handlebars.registerHelper('formatDateShort', (date: Date | string) => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
});

Handlebars.registerHelper('truncate', (str: string, length: number) => {
  if (!str) return '';
  return str.length > length ? str.substring(0, length) + '...' : str;
});

Handlebars.registerHelper('default', (value: unknown, defaultValue: unknown) => {
  return value ?? defaultValue;
});

Handlebars.registerHelper('length', (arr: unknown[]) => {
  return Array.isArray(arr) ? arr.length : 0;
});

Handlebars.registerHelper('join', (arr: unknown[], separator: string) => {
  if (!Array.isArray(arr)) return '';
  return arr.join(typeof separator === 'string' ? separator : ', ');
});

Handlebars.registerHelper(
  'gt',
  function (this: unknown, a: number, b: number, options: Handlebars.HelperOptions) {
    return a > b ? options.fn(this) : options.inverse(this);
  }
);

Handlebars.registerHelper(
  'lt',
  function (this: unknown, a: number, b: number, options: Handlebars.HelperOptions) {
    return a < b ? options.fn(this) : options.inverse(this);
  }
);

// Template cache
const templateCache = new Map<string, Handlebars.TemplateDelegate>();

/**
 * Initialize all templates from the templates directory
 */
export function initializeTemplates(templatesDir: string): void {
  if (!existsSync(templatesDir)) {
    logger.warn({ templatesDir }, 'Templates directory does not exist');
    return;
  }

  const files = readdirSync(templatesDir).filter((f) => f.endsWith('.hbs'));

  for (const file of files) {
    const templateName = file.replace('.hbs', '');
    const templatePath = join(templatesDir, file);
    const templateSource = readFileSync(templatePath, 'utf-8');

    try {
      templateCache.set(templateName, Handlebars.compile(templateSource));
    } catch (error) {
      logger.error({ template: templateName, error }, 'Failed to compile template');
      throw error;
    }
  }

  logger.info({ count: templateCache.size }, 'Prompt templates loaded');
}

/**
 * Render a template with the given context
 */
export function renderPrompt<T extends object>(
  templateName: string,
  context: T
): string {
  const template = templateCache.get(templateName);
  if (!template) {
    throw new Error(`Template not found: ${templateName}`);
  }
  return template(context);
}

/**
 * Get all available template names
 */
export function getAvailableTemplates(): string[] {
  return Array.from(templateCache.keys());
}

/**
 * Check if a template exists
 */
export function hasTemplate(templateName: string): boolean {
  return templateCache.has(templateName);
}

/**
 * Register an inline template (useful for testing or dynamic templates)
 */
export function registerInlineTemplate(name: string, source: string): void {
  templateCache.set(name, Handlebars.compile(source));
}

// Initialize templates on module load
const TEMPLATES_DIR = join(__dirname, 'templates');
if (existsSync(TEMPLATES_DIR)) {
  initializeTemplates(TEMPLATES_DIR);
}
