import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureLocationIsConfigured } from './location-helpers.js';

const setupDir = path.dirname(fileURLToPath(import.meta.url));
const storageStatePath = path.resolve(setupDir, '.auth/state.json');

export default async function globalSetup(config) {
  const baseURL = config.projects[0].use.baseURL;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await ensureLocationIsConfigured(page, { baseURL });

  await fs.promises.mkdir(path.dirname(storageStatePath), { recursive: true });
  await page.context().storageState({ path: storageStatePath });
  await browser.close();
}
