import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const assistantStyles = readFileSync(new URL('../../styles/views/assistant-view.css', import.meta.url), 'utf8');

test('Assistant phone layout reserves fixed bottom chrome for the composer', () => {
  assert.match(assistantStyles, /@media \(max-width: 640px\)[\s\S]*?#view-assistantview \{[\s\S]*?padding: 0 0 calc\(var\(--sutra-mobile-nav-height, 4\.75rem\) \+ 4\.75rem\) !important;/);
  assert.match(assistantStyles, /#view-assistantview \.asst-shell \{[\s\S]*?height: 100%;/);
});

test('Assistant quick actions stay one scrollable row on phones', () => {
  assert.match(assistantStyles, /#view-assistantview \.asst-chips \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow-x: auto;/);
  assert.match(assistantStyles, /#view-assistantview \.asst-chip \{ flex: 0 0 auto; \}/);
});

test('Assistant workspace page hides redundant floating controls', () => {
  assert.match(assistantStyles, /body\[data-view="assistantview"\] #chatbotBtn,[\s\S]*?body\[data-view="assistantview"\] #feedbackFabBtn,[\s\S]*?body\[data-view="assistantview"\] #focusModeQuickToggle \{[\s\S]*?display: none !important;/);
});
