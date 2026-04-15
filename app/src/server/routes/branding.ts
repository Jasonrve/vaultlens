import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getConfigStorage } from '../lib/config-storage/index.js';
import type { AuthenticatedRequest } from '../types/index.js';

export interface BrandingConfig {
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  appName: string;
}

const DEFAULT_BRANDING: BrandingConfig = {
  logo: '',
  primaryColor: '#1563ff',
  secondaryColor: '#19191a',
  backgroundColor: '#f6f6f6',
  appName: 'VaultLens',
};

const BRANDING_SECTION = 'branding';
const LOGO_BLOB_KEY = 'logo';

async function readBranding(): Promise<BrandingConfig> {
  try {
    const storage = getConfigStorage();
    const data = await storage.get(BRANDING_SECTION);
    if (data) {
      return {
        ...DEFAULT_BRANDING,
        logo: data['logo'] || '',
        primaryColor: data['primaryColor'] || DEFAULT_BRANDING.primaryColor,
        secondaryColor: data['secondaryColor'] || DEFAULT_BRANDING.secondaryColor,
        backgroundColor: data['backgroundColor'] || DEFAULT_BRANDING.backgroundColor,
        appName: data['appName'] || DEFAULT_BRANDING.appName,
      };
    }
  } catch {
    // Fall back to defaults
  }
  return { ...DEFAULT_BRANDING };
}

async function writeBranding(brandingConfig: BrandingConfig): Promise<void> {
  const storage = getConfigStorage();
  await storage.set(BRANDING_SECTION, {
    logo: brandingConfig.logo,
    primaryColor: brandingConfig.primaryColor,
    secondaryColor: brandingConfig.secondaryColor,
    backgroundColor: brandingConfig.backgroundColor,
    appName: brandingConfig.appName,
  });
}

const router = Router();

// Configure multer for logo uploads (max 2MB, images only) — memory storage for config storage abstraction
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPEG, SVG, and WebP images are allowed'));
    }
  },
});

// GET /api/branding — public, no auth required (needed at login screen)
router.get('/', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const branding = await readBranding();
    res.json(branding);
  } catch (error) {
    next(error);
  }
});

// PUT /api/branding — update branding config (colors) — admin only
router.put(
  '/',
  authMiddleware,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Partial<BrandingConfig>;
      const current = await readBranding();

      const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

      if (body.primaryColor !== undefined) {
        if (!hexColorRegex.test(body.primaryColor)) {
          res.status(400).json({ error: 'Invalid primaryColor format' });
          return;
        }
        current.primaryColor = body.primaryColor;
      }
      if (body.secondaryColor !== undefined) {
        if (!hexColorRegex.test(body.secondaryColor)) {
          res.status(400).json({ error: 'Invalid secondaryColor format' });
          return;
        }
        current.secondaryColor = body.secondaryColor;
      }
      if (body.backgroundColor !== undefined) {
        if (!hexColorRegex.test(body.backgroundColor)) {
          res.status(400).json({ error: 'Invalid backgroundColor format' });
          return;
        }
        current.backgroundColor = body.backgroundColor;
      }
      if (body.appName !== undefined) {
        const trimmed = String(body.appName).trim();
        if (trimmed.length === 0 || trimmed.length > 50) {
          res.status(400).json({ error: 'appName must be 1–50 characters' });
          return;
        }
        current.appName = trimmed;
      }

      await writeBranding(current);
      res.json(current);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/branding/logo — upload logo image — admin only
router.post(
  '/logo',
  authMiddleware,
  requireAdmin,
  upload.single('logo'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No logo file provided' });
        return;
      }

      const storage = getConfigStorage();
      await storage.setBlob(LOGO_BLOB_KEY, req.file.buffer, req.file.mimetype);

      const current = await readBranding();
      current.logo = '/api/branding/logo/logo';
      await writeBranding(current);

      res.json({ logo: current.logo });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/branding/logo — remove the logo — admin only
router.delete(
  '/logo',
  authMiddleware,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const storage = getConfigStorage();
      await storage.deleteBlob(LOGO_BLOB_KEY);

      const current = await readBranding();
      current.logo = '';
      await writeBranding(current);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/branding/logo/:filename — serve logo image
router.get(
  '/logo/:filename',
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const storage = getConfigStorage();
      const blob = await storage.getBlob(LOGO_BLOB_KEY);

      if (!blob) {
        res.status(404).json({ error: 'Logo not found' });
        return;
      }

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', blob.mimeType);
      res.send(blob.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
