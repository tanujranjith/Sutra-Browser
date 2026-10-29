/* ==========================================================================
   Sutra Starter Packs — local data
   ==========================================================================
   Starter Packs are LOCAL data only. Each pack describes a set of artifacts
   (notes, courses, review decks, timeline blocks, tasks, college-checklist
   rows) that the Starter Packs controller (src/core/app.js) can PREVIEW and
   then create on demand using the existing in-app create functions. Nothing
   here is remote, fetched, or executed — it is plain declarative data that the
   user reviews before anything is written, and every applied pack can be
   undone as a batch.

   Artifact schema (all fields optional unless noted):
     courses:          [{ name*, type:'class'|'ap'|'activity', color }]
     notes:            [{ title*, content (HTML string) }]
     decks:            [{ name*, subject, description, cards:[{prompt*, answer*}] }]
     timeBlocks:       [{ title*, daysFromNow, start:'HH:MM', end:'HH:MM', category }]
     tasks:            [{ title*, daysFromNow, priority:'high'|'medium'|'low' }]
     collegeChecklist: [{ college* }]

   Custom packs can be imported/exported as the same JSON shape.
   ========================================================================== */

(function (global) {
    'use strict';

    var PACKS = [
        {
            id: 'ap-student',
            name: 'AP Student',
            icon: '📚',
            description: 'AP courses, a study plan note, a key-formulas review deck, and recurring exam-prep blocks.',
            tags: ['student', 'ap'],
            artifacts: {
                courses: [
                    { name: 'AP Calculus BC', type: 'ap', color: '#7c9cf2' },
                    { name: 'AP US History', type: 'ap', color: '#e0a05f' },
                    { name: 'AP Biology', type: 'ap', color: '#67b08a' }
                ],
                notes: [
                    {
                        title: 'AP Study Plan',
                        content: '<h2>AP Study Plan</h2>'
                            + '<h3>Goals</h3><ul><li>Target scores per subject</li><li>Weekly review hours</li></ul>'
                            + '<h3>Weak areas</h3><ul><li></li></ul>'
                            + '<h3>Exam dates</h3><p>Add each AP exam date in AP Study.</p>'
                    }
                ],
                decks: [
                    {
                        name: 'AP Calc — Key Formulas',
                        subject: 'AP Calculus',
                        description: 'Core formulas and theorems.',
                        cards: [
                            { prompt: 'Fundamental Theorem of Calculus (Part 1)', answer: "d/dx ∫ₐˣ f(t) dt = f(x)" },
                            { prompt: 'Derivative of sin(x)', answer: 'cos(x)' },
                            { prompt: 'Integration by parts', answer: '∫u dv = uv − ∫v du' },
                            { prompt: 'Chain rule', answer: "d/dx f(g(x)) = f'(g(x))·g'(x)" }
                        ]
                    }
                ],
                timeBlocks: [
                    { title: 'AP review block', daysFromNow: 1, start: '17:00', end: '18:00', category: 'study' },
                    { title: 'AP practice FRQs', daysFromNow: 3, start: '17:00', end: '18:00', category: 'study' }
                ],
                tasks: [
                    { title: 'Set AP exam dates in AP Study', daysFromNow: 1, priority: 'high' }
                ]
            }
        },
        {
            id: 'college-apps',
            name: 'College Apps',
            icon: '🎓',
            description: 'A college checklist, essay note, and submission-prep tasks to organize application season.',
            tags: ['college'],
            artifacts: {
                notes: [
                    {
                        title: 'College Essay — Personal Statement',
                        content: '<h2>Personal Statement</h2>'
                            + '<h3>Prompt</h3><p></p>'
                            + '<h3>Angle / story</h3><p></p>'
                            + '<h3>Outline</h3><ul><li></li></ul>'
                            + '<h3>Draft</h3><p></p>'
                    }
                ],
                collegeChecklist: [
                    { college: 'Reach School' },
                    { college: 'Match School' },
                    { college: 'Safety School' }
                ],
                tasks: [
                    { title: 'Finalize college list', daysFromNow: 2, priority: 'high' },
                    { title: 'Request recommendation letters', daysFromNow: 3, priority: 'high' },
                    { title: 'Draft Common App essay', daysFromNow: 7, priority: 'medium' }
                ],
                timeBlocks: [
                    { title: 'Essay writing block', daysFromNow: 2, start: '19:00', end: '20:30', category: 'general' }
                ]
            }
        },
        {
            id: 'sat-act-prep',
            name: 'SAT/ACT Prep',
            icon: '📝',
            description: 'A prep plan note, vocabulary + math review decks, and weekly practice blocks.',
            tags: ['student', 'testprep'],
            artifacts: {
                notes: [
                    {
                        title: 'SAT/ACT Prep Plan',
                        content: '<h2>Test Prep Plan</h2>'
                            + '<h3>Target score</h3><p></p>'
                            + '<h3>Test date</h3><p></p>'
                            + '<h3>Weekly schedule</h3><ul><li>Reading</li><li>Math</li><li>Full practice test</li></ul>'
                    }
                ],
                decks: [
                    {
                        name: 'SAT — Math Reminders',
                        subject: 'SAT Math',
                        cards: [
                            { prompt: 'Slope formula', answer: '(y2 − y1) / (x2 − x1)' },
                            { prompt: 'Quadratic formula', answer: 'x = (−b ± √(b² − 4ac)) / 2a' },
                            { prompt: 'Area of a circle', answer: 'πr²' }
                        ]
                    }
                ],
                timeBlocks: [
                    { title: 'Practice test', daysFromNow: 6, start: '09:00', end: '12:00', category: 'study' },
                    { title: 'Math drills', daysFromNow: 2, start: '17:00', end: '17:45', category: 'study' }
                ],
                tasks: [
                    { title: 'Register for test date', daysFromNow: 1, priority: 'high' }
                ]
            }
        },
        {
            id: 'tsa-project',
            name: 'TSA Project',
            icon: '🛠️',
            description: 'A TSA event activity, project plan note, and milestone tasks for competition prep.',
            tags: ['project', 'activity'],
            artifacts: {
                courses: [
                    { name: 'TSA', type: 'activity', color: '#c98bd0' }
                ],
                notes: [
                    {
                        title: 'TSA Project Plan',
                        content: '<h2>TSA Project Plan</h2>'
                            + '<h3>Event</h3><p></p>'
                            + '<h3>Requirements / rubric</h3><ul><li></li></ul>'
                            + '<h3>Milestones</h3><ul><li>Research</li><li>Build</li><li>Documentation</li><li>Presentation</li></ul>'
                    }
                ],
                tasks: [
                    { title: 'Read event rubric', daysFromNow: 1, priority: 'high' },
                    { title: 'Finish research phase', daysFromNow: 5, priority: 'medium' },
                    { title: 'Build prototype', daysFromNow: 10, priority: 'medium' }
                ],
                timeBlocks: [
                    { title: 'TSA build session', daysFromNow: 2, start: '16:00', end: '18:00', category: 'general' }
                ]
            }
        },
        {
            id: 'robotics-team',
            name: 'Robotics Team',
            icon: '🤖',
            description: 'A robotics activity, build-season note, subsystem review deck, and meeting blocks.',
            tags: ['project', 'activity'],
            artifacts: {
                courses: [
                    { name: 'Robotics', type: 'activity', color: '#5fb0c9' }
                ],
                notes: [
                    {
                        title: 'Build Season Plan',
                        content: '<h2>Build Season</h2>'
                            + '<h3>Subsystems</h3><ul><li>Drivetrain</li><li>Intake</li><li>Control</li></ul>'
                            + '<h3>Deadlines</h3><ul><li></li></ul>'
                    }
                ],
                decks: [
                    {
                        name: 'Robotics — Concepts',
                        subject: 'Robotics',
                        cards: [
                            { prompt: 'PID controller', answer: 'Proportional-Integral-Derivative feedback control' },
                            { prompt: 'Gear ratio', answer: 'driven teeth / driving teeth' }
                        ]
                    }
                ],
                timeBlocks: [
                    { title: 'Team meeting', daysFromNow: 1, start: '15:30', end: '17:30', category: 'general' },
                    { title: 'Build session', daysFromNow: 3, start: '15:30', end: '18:00', category: 'general' }
                ]
            }
        },
        {
            id: 'senior-year',
            name: 'Senior Year',
            icon: '🏁',
            description: 'A senior-year overview note, college checklist, and a balanced mix of deadlines and habits.',
            tags: ['student', 'college'],
            artifacts: {
                notes: [
                    {
                        title: 'Senior Year Game Plan',
                        content: '<h2>Senior Year</h2>'
                            + '<h3>Academics</h3><ul><li>Keep GPA steady</li></ul>'
                            + '<h3>Applications</h3><ul><li>Deadlines</li></ul>'
                            + '<h3>Scholarships</h3><ul><li></li></ul>'
                            + '<h3>Balance</h3><ul><li>Sleep</li><li>Friends</li></ul>'
                    }
                ],
                collegeChecklist: [
                    { college: 'Top Choice' }
                ],
                tasks: [
                    { title: 'Submit early applications', daysFromNow: 14, priority: 'high' },
                    { title: 'Apply to 3 scholarships', daysFromNow: 21, priority: 'medium' }
                ],
                timeBlocks: [
                    { title: 'Applications block', daysFromNow: 2, start: '18:30', end: '20:00', category: 'general' }
                ]
            }
        },
        {
            id: 'research-project',
            name: 'Research Project',
            icon: '🔬',
            description: 'A research log note, literature review deck, and phased research milestones.',
            tags: ['project', 'research'],
            artifacts: {
                notes: [
                    {
                        title: 'Research Log',
                        content: '<h2>Research Project</h2>'
                            + '<h3>Question</h3><p></p>'
                            + '<h3>Hypothesis</h3><p></p>'
                            + '<h3>Method</h3><ul><li></li></ul>'
                            + '<h3>Sources</h3><ul><li></li></ul>'
                            + '<h3>Findings</h3><p></p>'
                    }
                ],
                tasks: [
                    { title: 'Define research question', daysFromNow: 1, priority: 'high' },
                    { title: 'Complete literature review', daysFromNow: 7, priority: 'medium' },
                    { title: 'Collect data', daysFromNow: 14, priority: 'medium' }
                ],
                timeBlocks: [
                    { title: 'Reading & notes', daysFromNow: 2, start: '16:00', end: '17:00', category: 'study' }
                ]
            }
        },
        {
            id: 'business-freelancer',
            name: 'Business / Freelancer',
            icon: '💼',
            description: 'A client/project note, pipeline tasks, and weekly admin blocks for freelance work.',
            tags: ['work', 'business'],
            artifacts: {
                notes: [
                    {
                        title: 'Business Plan',
                        content: '<h2>Business / Freelance</h2>'
                            + '<h3>Offer</h3><p></p>'
                            + '<h3>Clients / pipeline</h3><ul><li></li></ul>'
                            + '<h3>Rates</h3><p></p>'
                            + '<h3>This month\'s goals</h3><ul><li></li></ul>'
                    }
                ],
                tasks: [
                    { title: 'Follow up with leads', daysFromNow: 1, priority: 'high' },
                    { title: 'Send invoices', daysFromNow: 2, priority: 'high' },
                    { title: 'Update portfolio', daysFromNow: 7, priority: 'medium' }
                ],
                timeBlocks: [
                    { title: 'Admin & invoicing', daysFromNow: 1, start: '09:00', end: '10:00', category: 'general' },
                    { title: 'Deep work block', daysFromNow: 1, start: '10:00', end: '12:00', category: 'focus' }
                ]
            }
        },
        {
            id: 'personal-life-os',
            name: 'Personal Life OS',
            icon: '🌱',
            description: 'A life-areas note, recurring habit blocks, and a couple of grounding tasks.',
            tags: ['life'],
            artifacts: {
                notes: [
                    {
                        title: 'Life OS',
                        content: '<h2>Personal Life OS</h2>'
                            + '<h3>Health</h3><ul><li>Sleep</li><li>Movement</li></ul>'
                            + '<h3>Relationships</h3><ul><li></li></ul>'
                            + '<h3>Finances</h3><ul><li></li></ul>'
                            + '<h3>Growth</h3><ul><li></li></ul>'
                    }
                ],
                tasks: [
                    { title: 'Plan the week', daysFromNow: 0, priority: 'medium' },
                    { title: 'Weekly reset & tidy', daysFromNow: 6, priority: 'low' }
                ],
                timeBlocks: [
                    { title: 'Morning routine', daysFromNow: 1, start: '07:00', end: '07:30', category: 'general' },
                    { title: 'Weekly review', daysFromNow: 6, start: '18:00', end: '18:30', category: 'general' }
                ]
            }
        }
    ];

    global.SUTRA_STARTER_PACKS = PACKS;
})(typeof window !== 'undefined' ? window : this);
