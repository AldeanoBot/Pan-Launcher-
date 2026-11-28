import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  TOUR_STEPS,
  clampStepIndex,
  computePopoverPosition,
  shouldAutoStartTour,
} from './tourLogic';

test('tourLogic', async (t) => {
  await t.test('includes resourcepacks step directly after mods step', () => {
    const modsIdx = TOUR_STEPS.findIndex((s) => s.id === 'mods');
    const rpacksIdx = TOUR_STEPS.findIndex((s) => s.id === 'resourcepacks');
    assert.ok(modsIdx >= 0, 'mods step must exist');
    assert.equal(rpacksIdx, modsIdx + 1, 'resourcepacks step must follow mods');
    assert.equal(TOUR_STEPS.length, 9);
  });

  await t.test('clamps step index safely within valid range', () => {
    assert.equal(clampStepIndex(-5, 9), 0);
    assert.equal(clampStepIndex(0, 9), 0);
    assert.equal(clampStepIndex(4, 9), 4);
    assert.equal(clampStepIndex(99, 9), 8);
    assert.equal(clampStepIndex(Number.NaN, 9), 0);
  });

  await t.test('evaluates first-install auto-start and query overrides', () => {
    assert.equal(shouldAutoStartTour(null, ''), true);
    assert.equal(shouldAutoStartTour('', ''), true);
    assert.equal(shouldAutoStartTour('done', ''), false);
    assert.equal(shouldAutoStartTour('done', '?tour=1'), true);
    assert.equal(shouldAutoStartTour(null, '?notour=1'), false);
  });

  await t.test('keeps spotlight popover clamped within desktop and mobile viewports', () => {
    // Sidebar item on desktop 1440x900
    const rightSide = computePopoverPosition(
      { left: 16, top: 180, width: 210, height: 38 },
      { width: 340, height: 210 },
      { width: 1440, height: 900 },
      'right'
    );
    assert.equal(rightSide.placement, 'right');
    assert.ok(rightSide.left >= 220);
    assert.ok(rightSide.top >= 14 && rightSide.top + 210 <= 886);

    // Bottom edge fallback to top
    const bottomEdge = computePopoverPosition(
      { left: 500, top: 810, width: 180, height: 48 },
      { width: 340, height: 210 },
      { width: 1440, height: 900 },
      'bottom'
    );
    assert.equal(bottomEdge.placement, 'top');
    assert.ok(bottomEdge.top + 210 <= 810);

    // Narrow mobile viewport 390x844
    const mobile = computePopoverPosition(
      { left: 260, top: 90, width: 110, height: 40 },
      { width: 320, height: 200 },
      { width: 390, height: 844 },
      'right'
    );
    assert.ok(mobile.left >= 14 && mobile.left + 320 <= 390 - 14);
    assert.ok(mobile.top >= 14 && mobile.top + 200 <= 844 - 14);
  });

  await t.test('browser public/js/tour.js exposes matching steps, i18n titles, and getActiveIndex', () => {
    const i18nCode = fs.readFileSync(path.resolve(process.cwd(), 'public/js/i18n.js'), 'utf8');
    const tourCode = fs.readFileSync(path.resolve(process.cwd(), 'public/js/tour.js'), 'utf8');
    const storage = new Map<string, string>();
    const context: Record<string, unknown> = {
      window: {
        Nexus: {},
        location: { search: '' },
        localStorage: {
          getItem: (k: string) => storage.get(k) || null,
          setItem: (k: string, v: string) => { storage.set(k, v); },
          removeItem: (k: string) => { storage.delete(k); },
        },
        innerWidth: 1440,
        innerHeight: 900,
        addEventListener: () => {},
        removeEventListener: () => {},
        setTimeout: (fn: () => void) => { fn(); return 1; },
      },
      document: {
        documentElement: { lang: 'es' },
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({}),
        addEventListener: () => {},
        removeEventListener: () => {},
        body: { appendChild: () => {} },
      },
    };
    (context.window as Record<string, unknown>).window = context.window;
    vm.runInNewContext(i18nCode, context);
    vm.runInNewContext(tourCode, context);
    const nexus = (context.window as Record<string, unknown>).Nexus as {
      i18n: { setLang: (lang: string, opts?: Record<string, unknown>) => string };
      tour: {
        steps: Array<{ id: string }>;
        shouldAutoStart: () => boolean;
        getActiveIndex: () => number;
        computePopoverPosition: typeof computePopoverPosition;
      };
    };
    assert.equal(nexus.tour.steps.length, TOUR_STEPS.length);
    assert.deepEqual([...nexus.tour.steps].map((s) => s.id), TOUR_STEPS.map((s) => s.id));
    assert.equal(nexus.tour.shouldAutoStart(), true);
    assert.equal(typeof nexus.tour.getActiveIndex, 'function');
  });
});
