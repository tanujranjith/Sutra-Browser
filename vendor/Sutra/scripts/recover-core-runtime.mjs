#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkCoreRuntime, checkCoreRuntimeSource } from './lib/core-runtime-integrity.mjs';

const repoRoot = resolve('.');
const sourcePath = resolve(repoRoot, 'src/core/app.js');
const candidatePath = resolve(repoRoot, '.deploy/src/core/app.js');

function replaceExactly(source, before, after, label) {
  const matches = source.split(before).length - 1;
  if (matches !== 1) throw new Error(`${label}: expected one recovery anchor, found ${matches}`);
  return source.replace(before, after);
}

const candidate = checkCoreRuntime({ appPath: candidatePath });
if (!candidate.ok) throw new Error(`Recovery candidate is not valid:\n- ${candidate.failures.join('\n- ')}`);

const original = readFileSync(candidatePath, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
let text = original.replace(/\r\n/g, '\n');

if (!text.includes('const scheduledDetailsByItemId = new Map();')) {
text = replaceExactly(text, `            const scheduledItemIds = new Set();
            try {
                (Array.isArray(timeBlocks) ? timeBlocks : []).forEach(block => {
                    if (!block || typeof block !== 'object') return;
                    ['taskId', 'homeworkId', 'assignmentId', 'plannerTaskId', 'sourceId'].forEach(key => {
                        const value = block[key];
                        if (value !== undefined && value !== null && String(value).trim()) scheduledItemIds.add(String(value));
                    });
                });
            } catch (err) { /* timeline links are optional */ }`, `            const scheduledItemIds = new Set();
            const scheduledDetailsByItemId = new Map();
            const linkedTimelineBlockIds = new Set();
            try {
                const taskById = new Map((Array.isArray(tasks) ? tasks : []).filter(Boolean).map(task => [String(task.id || ''), task]));
                const addScheduledDetail = (itemId, block) => {
                    const normalizedId = String(itemId || '').trim();
                    const scheduledAt = normalizeDeadlineDate(block && block.date, block && block.start);
                    if (!normalizedId || !scheduledAt) return;
                    const label = scheduledAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                    const existing = scheduledDetailsByItemId.get(normalizedId) || [];
                    if (!existing.some(detail => detail.at.getTime() === scheduledAt.getTime())) {
                        existing.push({ at: scheduledAt, label });
                        scheduledDetailsByItemId.set(normalizedId, existing);
                    }
                };
                (Array.isArray(timeBlocks) ? timeBlocks : []).forEach(block => {
                    if (!block || typeof block !== 'object') return;
                    const blockId = String(block.id || '').trim();
                    let isLinkedWorkBlock = false;
                    ['taskId', 'homeworkId', 'assignmentId', 'plannerTaskId', 'sourceId'].forEach(key => {
                        const value = block[key];
                        if (value !== undefined && value !== null && String(value).trim()) {
                            const itemId = String(value);
                            scheduledItemIds.add(itemId);
                            addScheduledDetail(itemId, block);
                            isLinkedWorkBlock = true;
                        }
                    });
                    const autoTaskMatch = String(block.autoSourceKey || '').match(/^auto:task:([^:]+):\\d{4}-\\d{2}-\\d{2}$/);
                    if (autoTaskMatch) {
                        const taskId = String(autoTaskMatch[1]);
                        scheduledItemIds.add(taskId);
                        addScheduledDetail(taskId, block);
                        const sourceTask = taskById.get(taskId);
                        if (sourceTask && sourceTask.origin === 'homework' && sourceTask.homeworkSourceId) {
                            const homeworkId = String(sourceTask.homeworkSourceId);
                            scheduledItemIds.add(homeworkId);
                            addScheduledDetail(homeworkId, block);
                        }
                        isLinkedWorkBlock = true;
                    }
                    const homeworkDueMatch = blockId.match(/^hw_block_(v[12])_(.+)$/);
                    if (homeworkDueMatch || block.source === 'hw_due') {
                        if (homeworkDueMatch) scheduledItemIds.add(String(homeworkDueMatch[2]));
                        isLinkedWorkBlock = true;
                    }
                    if (isLinkedWorkBlock && blockId) linkedTimelineBlockIds.add(blockId);
                });
            } catch (err) { /* timeline links are optional */ }

            const getScheduledSummary = (itemIds) => {
                const details = [];
                (Array.isArray(itemIds) ? itemIds : []).forEach(itemId => {
                    (scheduledDetailsByItemId.get(String(itemId || '')) || []).forEach(detail => details.push(detail));
                });
                const unique = details
                    .filter((detail, index, list) => list.findIndex(other => other.at.getTime() === detail.at.getTime()) === index)
                    .sort((a, b) => a.at - b.at);
                if (!unique.length) return '';
                return \`Scheduled \${unique[0].label}\${unique.length > 1 ? \` +\${unique.length - 1}\` : ''}\`;
            };`, 'Radar timeline linkage');

text = replaceExactly(text,
  `                    if (!task || task.completed) return;
                    const due = normalizeDeadlineDate(task.dueDate, task.dueTime);`,
  `                    if (!task || task.completed) return;
                    // Homework owns the canonical deadline record; its task-store mirror exists for connected task views only.
                    if (task.origin === 'homework') return;
                    const due = normalizeDeadlineDate(task.dueDate, task.dueTime);`,
  'Homework mirror suppression'
);
text = replaceExactly(text,
  `                        scheduled: scheduledItemIds.has(String(task.id || '')) || task.scheduled === true,
                        status: task.completed ? 'done' : 'open',`,
  `                        scheduled: scheduledItemIds.has(String(task.id || '')) || task.scheduled === true,
                        scheduleSummary: getScheduledSummary([task.id]),
                        status: task.completed ? 'done' : 'open',`,
  'Task schedule summary'
);
text = replaceExactly(text,
  `                            scheduled: scheduledItemIds.has(String(hw.id || '')) || hw.scheduled === true,
                            status: hw.done ? 'done' : 'open',`,
  `                            scheduled: scheduledItemIds.has(String(hw.id || '')) || hw.scheduled === true,
                            scheduleSummary: getScheduledSummary([hw.id, \`hw_v2_\${hw.id}\`, \`hw_v1_\${hw.id}\`]),
                            status: hw.done ? 'done' : 'open',`,
  'Homework schedule summary'
);
text = replaceExactly(text,
  `                    if (block.source === 'ap_study_exam' || block.source === 'ap_study_session') return;
                    const due = normalizeDeadlineDate(block.date, block.start);`,
  `                    if (block.source === 'ap_study_exam' || block.source === 'ap_study_session') return;
                    if (linkedTimelineBlockIds.has(String(block.id || ''))) return;
                    const due = normalizeDeadlineDate(block.date, block.start);`,
  'Linked timeline suppression'
);
text = replaceExactly(text,
  `                    }[item.source] || 'today');
                setActiveView(view);`,
  `                    }[item.source] || 'today');
                setActiveView(view, { allowDisabled: item.source === 'apexam' });`,
  'AP contextual navigation'
);
}

const repaired = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
const result = checkCoreRuntimeSource(repaired, { appPath: sourcePath, bytes: Buffer.byteLength(repaired, 'utf8') });
if (!result.ok) throw new Error(`Recovered runtime failed validation:\n- ${result.failures.join('\n- ')}`);

writeFileSync(sourcePath, repaired, 'utf8');
if (!existsSync(sourcePath)) throw new Error('Recovery write did not produce src/core/app.js');
console.log(`Recovered src/core/app.js from verified deploy candidate (${result.passes.length} assertions).`);
