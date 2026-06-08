const toPathUrl = (baseURL, path) => {
  if (!baseURL) return path;
  return new URL(path, baseURL).toString();
};

export const completeLocationWizardIfVisible = async (page, { waitForMs = 5000 } = {}) => {
  const wizardGate = page.locator('[role="dialog"]').filter({
    has: page.getByRole('button', { name: /^next$/i }),
  }).first();

  let wizardVisible = await wizardGate.isVisible().catch(() => false);
  if (!wizardVisible && waitForMs > 0) {
    wizardVisible = await wizardGate.waitFor({ state: 'visible', timeout: waitForMs })
      .then(() => true)
      .catch(() => false);
  }
  if (!wizardVisible) {
    return false;
  }

  const titledWizardDialog = page.locator('[role="dialog"]').filter({ hasText: /ground station/i }).first();
  const hasTitledDialog = await titledWizardDialog.isVisible().catch(() => false);
  const wizardDialog = hasTitledDialog ? titledWizardDialog : page.locator('[role="dialog"]').first();

  const stationNameInput = wizardDialog.getByLabel(/station name/i);
  if (await stationNameInput.count()) {
    const currentName = (await stationNameInput.inputValue().catch(() => '')).trim();
    if (!currentName) {
      await stationNameInput.fill('Ground Station');
    }
  }

  const nextButton = wizardDialog.getByRole('button', { name: /^next$/i }).first();
  await nextButton.waitFor({ state: 'visible' });
  await nextButton.click();

  const enterCoordinatesButton = wizardDialog.getByRole('button', { name: /enter coordinates/i }).first();
  const canEnterCoordinates = await enterCoordinatesButton.isVisible().catch(() => false);
  if (canEnterCoordinates) {
    await enterCoordinatesButton.click();
    const manualDialog = page.locator('[role="dialog"]').filter({
      has: page.getByRole('button', { name: /apply coordinates/i }),
    }).first();
    await manualDialog.waitFor({ state: 'visible' });
    await manualDialog.getByLabel(/latitude/i).fill('37.9838');
    await manualDialog.getByLabel(/longitude/i).fill('23.7275');
    await manualDialog.getByRole('button', { name: /apply coordinates/i }).click();
    await manualDialog.waitFor({ state: 'hidden', timeout: 10000 });
  }

  if (!(await nextButton.isEnabled())) {
    const mapCanvas = wizardDialog.locator('.maplibregl-canvas').first();
    await mapCanvas.waitFor({ state: 'visible' });
    const box = await mapCanvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await mapCanvas.click();
    }
    await page.waitForTimeout(600);
  }

  if (!(await nextButton.isEnabled())) {
    throw new Error('Location wizard did not enable Next after selecting coordinates.');
  }
  await nextButton.click();

  const finishButton = wizardDialog.getByRole('button', { name: /save and continue|save location/i }).first();
  await finishButton.waitFor({ state: 'visible', timeout: 10000 });
  if (!(await finishButton.isEnabled())) {
    throw new Error('Location wizard finish button is disabled.');
  }
  await finishButton.click();
  await wizardDialog.waitFor({ state: 'hidden', timeout: 15000 });

  return true;
};

export const ensureLocationIsConfigured = async (page, { baseURL } = {}) => {
  const locationUrl = toPathUrl(baseURL, '/admin/system/location');

  await page.goto(locationUrl);
  await page.waitForLoadState('domcontentloaded');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const wizardCompleted = await completeLocationWizardIfVisible(page, { waitForMs: attempt === 0 ? 5000 : 1200 });
    if (wizardCompleted) {
      break;
    }

    const saveButtonVisible = await page.getByRole('button', { name: /save location/i }).first()
      .isVisible()
      .catch(() => false);
    if (saveButtonVisible) {
      break;
    }
  }

  await page.goto(locationUrl);
  await page.waitForLoadState('domcontentloaded');

  const mapCanvas = page.locator('.maplibregl-canvas').first();
  await mapCanvas.waitFor({ state: 'visible' });

  const marker = page.locator('.maplibregl-marker');
  if ((await marker.count()) > 0) {
    return;
  }

  const box = await mapCanvas.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await mapCanvas.click();
  }
  await page.waitForTimeout(500);

  const saveButton = page.getByRole('button', { name: /save location/i }).first();
  const saveVisible = await saveButton.waitFor({ state: 'visible', timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  if (!saveVisible) {
    const wizardCompleted = await completeLocationWizardIfVisible(page, { waitForMs: 1500 });
    if (wizardCompleted) {
      return;
    }
    throw new Error('Save location button is not visible and wizard did not appear.');
  }

  if (!(await saveButton.isEnabled()) && box) {
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.42);
    await page.waitForTimeout(500);
  }

  if (!(await saveButton.isEnabled())) {
    throw new Error('Save location button is still disabled after map interaction.');
  }

  await saveButton.click();
  await page.waitForTimeout(1000);
};
