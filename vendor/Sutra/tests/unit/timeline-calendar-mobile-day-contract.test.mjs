import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../../styles/views/timeline-calendar.css', import.meta.url), 'utf8');

test('phone Day view fills its time-grid container instead of inheriting Month-cell alignment', () => {
  assert.match(styles, /\.sutra-calendar-time-day\.sutra-calendar-time-view \{[\s\S]*display: block/);
  assert.match(styles, /\.sutra-calendar-time-day\.sutra-calendar-time-view \.sutra-calendar-time-grid \{ min-width: 100%; grid-template-columns: 48px minmax\(0, 1fr\); \}/);
  assert.doesNotMatch(styles, /\.sutra-calendar-day\.sutra-calendar-time-view/);
});
