export type SecretGenerationMode = 'password' | 'passphrase' | 'api-token' | 'uuid' | 'hex' | 'base64';

export interface SecretGenerationOptions {
  mode: SecretGenerationMode;
  length: number;
  words: number;
  separator: string;
  capitalize: boolean;
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  customCharacters: string;
  encoding: 'standard' | 'url';
}

export const DEFAULT_SECRET_OPTIONS: SecretGenerationOptions = {
  mode: 'password',
  length: 24,
  words: 4,
  separator: '-',
  capitalize: false,
  lowercase: true,
  uppercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
  customCharacters: '',
  encoding: 'url',
};

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}:,.?';
const AMBIGUOUS = '0O1lI|`\'"';
const WORDS = [
  'amber', 'anchor', 'apple', 'atlas', 'bamboo', 'beacon', 'breeze', 'canyon',
  'cedar', 'cobalt', 'comet', 'coral', 'crystal', 'delta', 'ember', 'falcon',
  'forest', 'frost', 'harbor', 'hazel', 'island', 'juniper', 'lagoon', 'maple',
  'meadow', 'meteor', 'north', 'ocean', 'olive', 'orbit', 'pebble', 'pine',
  'planet', 'quartz', 'raven', 'river', 'saffron', 'shadow', 'silver', 'spruce',
  'star', 'stone', 'summit', 'thunder', 'violet', 'willow', 'winter', 'zenith',
];

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomIndex(size: number): number {
  if (size < 1) throw new Error('Character set cannot be empty');
  const limit = 256 - (256 % size);
  for (;;) {
    const byte = randomBytes(1)[0]!;
    if (byte < limit) return byte % size;
  }
}

function pick(characters: string): string {
  return characters[randomIndex(characters.length)]!;
}

function cleanCharacters(characters: string, excludeAmbiguous: boolean): string {
  const unique = [...new Set(characters)].join('');
  return excludeAmbiguous ? [...unique].filter((char) => !AMBIGUOUS.includes(char)).join('') : unique;
}

function passwordCharacters(options: SecretGenerationOptions): string {
  const categories = [
    options.lowercase ? LOWERCASE : '',
    options.uppercase ? UPPERCASE : '',
    options.numbers ? NUMBERS : '',
    options.symbols ? SYMBOLS : '',
    options.customCharacters,
  ].join('');
  const characters = cleanCharacters(categories, options.excludeAmbiguous);
  if (!characters) throw new Error('Select at least one character set');
  return characters;
}

function generatePassword(options: SecretGenerationOptions): string {
  if (!Number.isInteger(options.length) || options.length < 4 || options.length > 512) {
    throw new Error('Password length must be between 4 and 512');
  }
  const characters = passwordCharacters(options);
  const required = [
    options.lowercase ? cleanCharacters(LOWERCASE, options.excludeAmbiguous) : '',
    options.uppercase ? cleanCharacters(UPPERCASE, options.excludeAmbiguous) : '',
    options.numbers ? cleanCharacters(NUMBERS, options.excludeAmbiguous) : '',
    options.symbols ? cleanCharacters(SYMBOLS, options.excludeAmbiguous) : '',
  ].filter(Boolean);
  if (required.length > options.length) throw new Error('Password length is too short for selected character sets');
  const output = required.map(pick);
  while (output.length < options.length) output.push(pick(characters));
  for (let i = output.length - 1; i > 0; i -= 1) {
    const swap = randomIndex(i + 1);
    [output[i], output[swap]] = [output[swap]!, output[i]!];
  }
  return output.join('');
}

function generatePassphrase(options: SecretGenerationOptions): string {
  if (!Number.isInteger(options.words) || options.words < 3 || options.words > 12) {
    throw new Error('Passphrase word count must be between 3 and 12');
  }
  if (options.separator.length > 4) throw new Error('Passphrase separator is too long');
  return Array.from({ length: options.words }, () => {
    const word = pick(WORDS);
    return options.capitalize ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word;
  }).join(options.separator);
}

function encodeBytes(bytes: Uint8Array, encoding: 'standard' | 'url'): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  const base64 = btoa(binary);
  return encoding === 'url' ? base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') : base64;
}

export function generateSecret(options: SecretGenerationOptions): string {
  switch (options.mode) {
    case 'password': return generatePassword(options);
    case 'passphrase': return generatePassphrase(options);
    case 'api-token': {
      if (!Number.isInteger(options.length) || options.length < 16 || options.length > 512) {
        throw new Error('API token length must be between 16 and 512');
      }
      return encodeBytes(randomBytes(Math.ceil(options.length * 0.75)), 'url').slice(0, options.length);
    }
    case 'uuid': return crypto.randomUUID();
    case 'hex': {
      if (!Number.isInteger(options.length) || options.length < 4 || options.length > 512) throw new Error('Hex length must be between 4 and 512');
      return [...randomBytes(Math.ceil(options.length / 2))].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, options.length);
    }
    case 'base64': {
      if (!Number.isInteger(options.length) || options.length < 4 || options.length > 512) throw new Error('Base64 length must be between 4 and 512');
      return encodeBytes(randomBytes(Math.ceil(options.length * 0.75)), options.encoding).slice(0, options.length);
    }
  }
}

export function generateSecrets(options: SecretGenerationOptions, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('Generate between 1 and 50 values');
  return Array.from({ length: count }, () => generateSecret(options));
}
