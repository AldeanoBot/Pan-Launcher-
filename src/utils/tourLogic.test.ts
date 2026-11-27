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
  await t.test('clamps step index safely within valid range', () => {
    assert.equal(clampStepIndex(-5, 8), 0);
    assert.equal(clampStepIndex(0, 8), 0);
    assert.equal(clampStepIndex(4, 8), 4);
    assert.equal(clampStepIndex(99, 8), 7);
    assert.equal(clampStepIndex(Number.NaN, 8), 0);
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

  await t.test('browser public/js/tour.js exposes matching steps and positioning logic', () => {
    const code = fs.readFileSync(path.resolve(process.cwd(), 'public/js/tour.js'), 'utf8');
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
        getElementById: () => null,
        querySelector: () => null,
        createElement: () => ({}),
        addEventListener: () => {},
        removeEventListener: () => {},
        body: { appendChild: () => {} },
      },
    };
    (context.window as Record<string, unknown>).window = context.window;
    vm.runInNewContext(code, context);
    const tour = ((context.window as Record<string, unknown>).Nexus as Record<string, unknown>).tour as {
      steps: Array<{ id: string }>;
      shouldAutoStart: () => boolean;
      computePopoverPosition: typeof computePopoverPosition;
    };
    assert.equal(tour.steps.length, TOUR_STEPS.length);
    assert.deepEqual([...tour.steps].map((s) => s.id), TOUR_STEPS.map((s) => s.id));
    assert.equal(tour.shouldAutoStart(), true);
  });
});
