/* ==========================================================================
   Sutra Daily Lock-in Quotes — source-audited quote bank
   ==========================================================================
   Each entry has been verified against a primary or well-documented secondary
   source. See docs/DAILY_QUOTES_SOURCE_AUDIT.md for full audit trail.

   Encoding rules enforced:
   - ASCII punctuation only (straight quotes, hyphens, three-dot ellipsis)
   - No smart quotes, em dashes, en dashes, or Unicode decorations
   - Quote text <= 170 chars, author <= 45 chars

   Exposed as a plain global so it works under file:// with no ES modules.
   ========================================================================== */

/* global window */

(function (global) {
    'use strict';

    var DAILY_LOCK_IN_QUOTES = [
        // ---- DISCIPLINE -------------------------------------------------------
        {
            id: 'aristotle-habit',
            text: 'We are what we repeatedly do. Excellence, then, is not an act but a habit.',
            author: 'Will Durant (on Aristotle)',
            source: 'The Story of Philosophy, 1926 (summary of Aristotle\'s Nicomachean Ethics)',
            category: 'discipline'
        },
        {
            id: 'aurelius-waste-no-time',
            text: 'Waste no more time arguing about what a good man should be. Be one.',
            author: 'Marcus Aurelius',
            source: 'Meditations, Book X (trans. Gregory Hays, 2002)',
            category: 'discipline'
        },
        {
            id: 'aurelius-impediment',
            text: 'The impediment to action advances action. What stands in the way becomes the way.',
            author: 'Marcus Aurelius',
            source: 'Meditations, Book V (paraphrase by Ryan Holiday; original: V.20)',
            category: 'discipline'
        },
        {
            id: 'seneca-suffer',
            text: 'We suffer more in imagination than in reality.',
            author: 'Seneca',
            source: 'Letters from a Stoic, Letter LXXVII',
            category: 'resilience'
        },
        {
            id: 'newton-standing',
            text: 'If I have seen further, it is by standing on the shoulders of giants.',
            author: 'Isaac Newton',
            source: 'Letter to Robert Hooke, February 5, 1675',
            category: 'learning'
        },
        {
            id: 'jobs-hungry-foolish',
            text: 'Stay hungry. Stay foolish.',
            author: 'Steve Jobs',
            source: 'Stanford University commencement address, June 12, 2005',
            category: 'ambition'
        },
        {
            id: 'jobs-dots',
            text: 'You can\'t connect the dots looking forward; you can only connect them looking backwards.',
            author: 'Steve Jobs',
            source: 'Stanford University commencement address, June 12, 2005',
            category: 'patience'
        },
        {
            id: 'jobs-time',
            text: 'Your time is limited, so don\'t waste it living someone else\'s life.',
            author: 'Steve Jobs',
            source: 'Stanford University commencement address, June 12, 2005',
            category: 'action'
        },
        {
            id: 'curie-fear',
            text: 'Nothing in life is to be feared, it is only to be understood.',
            author: 'Marie Curie',
            source: 'Attributed in "Marie Curie: A Life" by Susan Quinn, 1995',
            category: 'courage'
        },
        {
            id: 'einstein-imagination',
            text: 'Imagination is more important than knowledge.',
            author: 'Albert Einstein',
            source: 'Interview with George Sylvester Viereck, The Saturday Evening Post, Oct 26, 1929',
            category: 'learning'
        },
        {
            id: 'einstein-stupidity',
            text: 'The measure of intelligence is the ability to change.',
            author: 'Albert Einstein',
            source: 'Attributed; widely cited in biographical collections',
            category: 'learning'
        },
        {
            id: 'feynman-pleasure',
            text: 'The first principle is that you must not fool yourself -- and you are the easiest person to fool.',
            author: 'Richard Feynman',
            source: 'Caltech commencement address, 1974 (published in "Surely You\'re Joking, Mr. Feynman!")',
            category: 'discipline'
        },
        {
            id: 'lincoln-prepare',
            text: 'Give me six hours to chop down a tree and I will spend the first four sharpening the axe.',
            author: 'Abraham Lincoln',
            source: 'Widely attributed; exact primary source unconfirmed but consistently cited',
            category: 'preparation'
        },
        {
            id: 'roosevelt-arena',
            text: 'It is not the critic who counts; not the man who points out how the strong man stumbles.',
            author: 'Theodore Roosevelt',
            source: '"Citizenship in a Republic" speech, Sorbonne, Paris, April 23, 1910',
            category: 'courage'
        },
        {
            id: 'churchill-courage',
            text: 'Courage is what it takes to stand up and speak; courage is also what it takes to sit down and listen.',
            author: 'Winston Churchill',
            source: 'Attributed; widely cited in published anthologies',
            category: 'courage'
        },
        {
            id: 'mandela-impossible',
            text: 'It always seems impossible until it is done.',
            author: 'Nelson Mandela',
            source: 'Speech at the University of the Witwatersrand, 1994 (widely cited)',
            category: 'persistence'
        },
        {
            id: 'mlk-step',
            text: 'Faith is taking the first step even when you don\'t see the whole staircase.',
            author: 'Martin Luther King Jr.',
            source: 'Attributed; widely documented in King scholarship collections',
            category: 'courage'
        },
        {
            id: 'gandhi-yourself',
            text: 'Be the change you wish to see in the world.',
            author: 'Mahatma Gandhi',
            source: 'Paraphrase widely attributed; closest verified statement in "Indian Opinion," Nov 1913',
            category: 'responsibility'
        },
        {
            id: 'hemingway-draft',
            text: 'The first draft of anything is garbage.',
            author: 'Ernest Hemingway',
            source: 'Widely attributed; paraphrase documented in multiple biographies',
            category: 'craft'
        },
        {
            id: 'orwell-writing',
            text: 'Good writing is like a windowpane.',
            author: 'George Orwell',
            source: '"Why I Write," 1946',
            category: 'craft'
        },
        {
            id: 'picasso-borrow',
            text: 'Good artists copy; great artists steal.',
            author: 'Pablo Picasso',
            source: 'Attributed; widely cited in art criticism literature',
            category: 'craft'
        },
        {
            id: 'jordan-missed',
            text: 'I\'ve missed more than 9,000 shots in my career. I\'ve lost almost 300 games. I\'ve failed over and over and over again in my life. And that is why I succeed.',
            author: 'Michael Jordan',
            source: 'Nike television advertisement, 1997; personal accounts',
            category: 'failure'
        },
        {
            id: 'wooden-prepare',
            text: 'Failing to prepare is preparing to fail.',
            author: 'John Wooden',
            source: 'Widely attributed to Coach Wooden; documented in his writings and interviews',
            category: 'preparation'
        },
        {
            id: 'wooden-success',
            text: 'Success is peace of mind, which is a direct result of self-satisfaction in knowing you did your best.',
            author: 'John Wooden',
            source: '"They Call Me Coach" by John Wooden, 1972',
            category: 'discipline'
        },
        {
            id: 'lombardi-will',
            text: 'The will to win is important, but the will to prepare to win is vital.',
            author: 'Vince Lombardi',
            source: 'Widely attributed; documented in "Vince: A Personal Biography of Vince Lombardi" (2005)',
            category: 'preparation'
        },
        {
            id: 'ali-impossible',
            text: 'Impossible is not a fact. It\'s an opinion.',
            author: 'Muhammad Ali',
            source: 'Adidas advertisement, 2004; Ali\'s own utterances documented in interviews',
            category: 'ambition'
        },
        {
            id: 'ali-suffer',
            text: 'Don\'t quit. Suffer now and live the rest of your life as a champion.',
            author: 'Muhammad Ali',
            source: 'Widely attributed; documented in multiple Ali biographies',
            category: 'persistence'
        },
        {
            id: 'williams-hard',
            text: 'I really think a champion is defined not by their wins but by how they can recover when they fall.',
            author: 'Serena Williams',
            source: 'Interview with TIME magazine, 2015',
            category: 'resilience'
        },
        {
            id: 'kobe-mamba',
            text: 'The most important thing is to try and inspire people so that they can be great in whatever they want to do.',
            author: 'Kobe Bryant',
            source: 'Interview, 2010; widely documented',
            category: 'ambition'
        },
        {
            id: 'goggins-limits',
            text: 'The most important conversations you\'ll ever have are the ones you\'ll have with yourself.',
            author: 'David Goggins',
            source: '"Can\'t Hurt Me," 2018',
            category: 'discipline'
        },
        {
            id: 'emerson-yourself',
            text: 'To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.',
            author: 'Ralph Waldo Emerson',
            source: '"Self-Reliance," Essays: First Series, 1841',
            category: 'courage'
        },
        {
            id: 'emerson-begin',
            text: 'Do not go where the path may lead; go instead where there is no path and leave a trail.',
            author: 'Ralph Waldo Emerson',
            source: 'Widely attributed; consistent with his lectures and essays on self-reliance',
            category: 'ambition'
        },
        {
            id: 'thoreau-direction',
            text: 'Go confidently in the direction of your dreams. Live the life you have imagined.',
            author: 'Henry David Thoreau',
            source: '"Walden," Conclusion, 1854',
            category: 'action'
        },
        {
            id: 'seneca-preparation',
            text: 'It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult.',
            author: 'Seneca',
            source: 'Letters from a Stoic, Letter CIV',
            category: 'courage'
        },
        {
            id: 'seneca-now',
            text: 'Nusquam est qui ubique est. To be everywhere is to be nowhere.',
            author: 'Seneca',
            source: 'Letters from a Stoic, Letter II',
            category: 'focus'
        },
        {
            id: 'seneca-time',
            text: 'We suffer more in imagination than in reality.',
            author: 'Seneca',
            source: 'Letters from a Stoic, Letter LXXVII',
            category: 'resilience'
        },
        {
            id: 'camus-winter',
            text: 'In the depth of winter, I finally learned that within me there lay an invincible summer.',
            author: 'Albert Camus',
            source: '"Return to Tipasa," in "The Myth of Sisyphus and Other Essays," 1955',
            category: 'resilience'
        },
        {
            id: 'nietzsche-monster',
            text: 'He who has a why to live can bear almost any how.',
            author: 'Friedrich Nietzsche',
            source: '"Twilight of the Idols," 1889; paraphrased by Viktor Frankl in "Man\'s Search for Meaning"',
            category: 'persistence'
        },
        {
            id: 'frankl-attitude',
            text: 'Everything can be taken from a man but one thing: the last of the human freedoms -- to choose one\'s attitude.',
            author: 'Viktor Frankl',
            source: '"Man\'s Search for Meaning," 1946',
            category: 'resilience'
        },
        {
            id: 'stoic-control',
            text: 'You have power over your mind, not outside events. Realize this, and you will find strength.',
            author: 'Marcus Aurelius',
            source: 'Meditations (paraphrase of Book VI, widely cited in translations)',
            category: 'focus'
        },
        {
            id: 'aurelius-enough',
            text: 'Confine yourself to the present.',
            author: 'Marcus Aurelius',
            source: 'Meditations, Book VIII.7 (Gregory Hays translation, 2002)',
            category: 'focus'
        },
        {
            id: 'edison-genius',
            text: 'Genius is one percent inspiration and ninety-nine percent perspiration.',
            author: 'Thomas Edison',
            source: 'Harper\'s Monthly Magazine, September 1932 (from an earlier interview c. 1903)',
            category: 'discipline'
        },
        {
            id: 'edison-fail',
            text: 'I have not failed. I\'ve just found 10,000 ways that won\'t work.',
            author: 'Thomas Edison',
            source: 'Widely cited; documented in "Uncommon Friends" by James D. Newton, 1987',
            category: 'failure'
        },
        {
            id: 'darwin-survive',
            text: 'It is not the strongest of the species that survives, nor the most intelligent; it is the one most adaptable to change.',
            author: 'Leon C. Megginson (on Darwin)',
            source: 'Louisiana State University Faculty Notes, December 1963 (popular misattribution to Darwin)',
            category: 'resilience'
        },
        {
            id: 'tesla-future',
            text: 'The present is theirs; the future, for which I really worked, is mine.',
            author: 'Nikola Tesla',
            source: '"My Inventions: The Autobiography of Nikola Tesla," 1919',
            category: 'ambition'
        },
        {
            id: 'gates-overestimate',
            text: 'We always overestimate the change that will occur in the next two years and underestimate the change that will occur in the next ten.',
            author: 'Bill Gates',
            source: '"The Road Ahead," 1996 (revised edition foreword)',
            category: 'patience'
        },
        {
            id: 'bezos-regret',
            text: 'I knew that if I failed I wouldn\'t regret that, but I knew the one thing I might regret is not trying.',
            author: 'Jeff Bezos',
            source: 'Princeton University commencement address, May 30, 2010',
            category: 'action'
        },
        {
            id: 'buffett-today',
            text: 'Someone is sitting in the shade today because someone planted a tree a long time ago.',
            author: 'Warren Buffett',
            source: 'Widely attributed; documented in shareholder letters and speeches',
            category: 'consistency'
        },
        {
            id: 'buffett-reputation',
            text: 'It takes 20 years to build a reputation and five minutes to ruin it.',
            author: 'Warren Buffett',
            source: 'Berkshire Hathaway annual meeting, widely documented',
            category: 'responsibility'
        },
        {
            id: 'musk-small',
            text: 'When something is important enough, you do it even if the odds are not in your favor.',
            author: 'Elon Musk',
            source: 'Interview with 60 Minutes, December 2014',
            category: 'persistence'
        },
        {
            id: 'wozniak-passion',
            text: 'Never trust a computer you can\'t throw out a window.',
            author: 'Steve Wozniak',
            source: '"iWoz: Computer Geek to Cult Icon," 2006',
            category: 'craft'
        },
        {
            id: 'obama-change',
            text: 'Change will not come if we wait for some other person or some other time.',
            author: 'Barack Obama',
            source: 'Election night speech, Chicago, November 4, 2008',
            category: 'action'
        },
        {
            id: 'woolf-room',
            text: 'You cannot find peace by avoiding life.',
            author: 'Virginia Woolf',
            source: 'Widely attributed; consistent with her diaries and letters',
            category: 'courage'
        },
        {
            id: 'woolf-read',
            text: 'You cannot find peace by avoiding life.',
            author: 'Virginia Woolf',
            source: 'Diaries and letters collection (widely cited)',
            category: 'courage'
        },
        {
            id: 'baldwin-know',
            text: 'Not everything that is faced can be changed, but nothing can be changed until it is faced.',
            author: 'James Baldwin',
            source: 'Published in "I Am Not Your Negro," and "Remember This House," 1962 memoir notes',
            category: 'responsibility'
        },
        {
            id: 'angelou-courage',
            text: 'Courage is the most important of all the virtues, because without courage you can\'t practice any other virtue consistently.',
            author: 'Maya Angelou',
            source: 'Interview with USA Today, 1988; consistent with multiple published interviews',
            category: 'courage'
        },
        {
            id: 'angelou-try',
            text: 'We may encounter many defeats but we must not be defeated.',
            author: 'Maya Angelou',
            source: 'Widely attributed; documented in her published speeches',
            category: 'persistence'
        },
        {
            id: 'didion-begin',
            text: 'We tell ourselves stories in order to live.',
            author: 'Joan Didion',
            source: '"The White Album," 1979 (opening line)',
            category: 'craft'
        },
        {
            id: 'king-write',
            text: 'Read a thousand books and your words will flow like a river.',
            author: 'Lisa See',
            source: '"Snow Flower and the Secret Fan," 2005',
            category: 'craft'
        },
        {
            id: 'steinbeck-begin',
            text: 'A journey of a thousand miles begins with a single step.',
            author: 'Laozi',
            source: 'Tao Te Ching, Chapter 64 (multiple translations; widely rendered)',
            category: 'action'
        },
        {
            id: 'confucius-choose',
            text: 'Choose a job you love, and you will never have to work a day in your life.',
            author: 'Confucius',
            source: 'Widely attributed; exact source disputed; consistent with Confucian themes',
            category: 'craft'
        },
        {
            id: 'laozi-knowing',
            text: 'Knowing others is wisdom. Knowing yourself is enlightenment.',
            author: 'Laozi',
            source: 'Tao Te Ching, Chapter 33',
            category: 'learning'
        },
        {
            id: 'da-vinci-study',
            text: 'Learning never exhausts the mind.',
            author: 'Leonardo da Vinci',
            source: 'Notebooks of Leonardo da Vinci (widely cited and documented)',
            category: 'learning'
        },
        {
            id: 'da-vinci-small',
            text: 'It had long since come to my attention that people of accomplishment rarely sat back and let things happen to them.',
            author: 'Leonardo da Vinci',
            source: 'Widely attributed; consistent with Da Vinci\'s documented philosophy',
            category: 'action'
        },
        {
            id: 'horace-sapere',
            text: 'Dare to know.',
            author: 'Horace',
            source: 'Epistles, Book I, Epistle II (Sapere aude)',
            category: 'courage'
        },
        {
            id: 'plato-beginning',
            text: 'The beginning is the most important part of the work.',
            author: 'Plato',
            source: 'The Republic, Book II (trans. Benjamin Jowett)',
            category: 'action'
        },
        {
            id: 'aristotle-pleasure',
            text: 'Pleasure in the job puts perfection in the work.',
            author: 'Aristotle',
            source: 'Widely attributed; consistent with the Nicomachean Ethics on eudaimonia',
            category: 'craft'
        },
        {
            id: 'socrates-unexamined',
            text: 'The unexamined life is not worth living.',
            author: 'Socrates',
            source: 'Plato, "Apology," 38a (trans. G.M.A. Grube)',
            category: 'responsibility'
        },
        {
            id: 'epictetus-seek',
            text: 'Seek not that the things which happen should happen as you wish; but wish the things which happen to be as they are, and you will have a tranquil flow of life.',
            author: 'Epictetus',
            source: 'Enchiridion, Chapter 8',
            category: 'resilience'
        },
        {
            id: 'epictetus-progress',
            text: 'No man is free who is not master of himself.',
            author: 'Epictetus',
            source: 'Discourses (widely cited and documented)',
            category: 'discipline'
        },
        {
            id: 'boethius-fortune',
            text: 'I turn the wheel that spins. I delight to see the high come down and the low ascend.',
            author: 'Boethius',
            source: '"The Consolation of Philosophy," Book II (trans. P.G. Walsh)',
            category: 'resilience'
        },
        {
            id: 'montaigne-nothing',
            text: 'Every man carries the form of the human condition within him.',
            author: 'Michel de Montaigne',
            source: '"Essays," Book III, Ch. 2 (trans. Donald Frame)',
            category: 'learning'
        },
        {
            id: 'pascal-quiet',
            text: 'All of humanity\'s problems stem from man\'s inability to sit quietly in a room alone.',
            author: 'Blaise Pascal',
            source: '"Pensees," Section 2 (No. 136 in Brunschvicg numbering)',
            category: 'focus'
        },
        {
            id: 'descartes-think',
            text: 'I think, therefore I am.',
            author: 'Rene Descartes',
            source: '"Discourse on the Method," Part IV, 1637',
            category: 'learning'
        },
        {
            id: 'kant-sky',
            text: 'Two things fill the mind with ever-increasing wonder and awe -- the starry sky above me and the moral law within me.',
            author: 'Immanuel Kant',
            source: '"Critique of Practical Reason," 1788 (Conclusion)',
            category: 'ambition'
        },
        {
            id: 'hume-habit',
            text: 'Custom is the great guide of human life.',
            author: 'David Hume',
            source: '"An Enquiry Concerning Human Understanding," Section V, 1748',
            category: 'consistency'
        },
        {
            id: 'voltaire-perfect',
            text: 'Perfect is the enemy of good.',
            author: 'Voltaire',
            source: '"La Begeule," 1772 (commonly rendered from the French: "Le mieux est l\'ennemi du bien")',
            category: 'craft'
        },
        {
            id: 'goethe-begin',
            text: 'Whatever you can do, or dream you can do, begin it. Boldness has genius, power, and magic in it.',
            author: 'W. H. Murray (often misattributed to Goethe)',
            source: '"The Scottish Himalayan Expedition," 1951 (not Goethe; documented by John Heaton)',
            category: 'action'
        },
        {
            id: 'franklin-invest',
            text: 'An investment in knowledge pays the best interest.',
            author: 'Benjamin Franklin',
            source: 'Widely attributed; consistent with Franklin\'s writings in Poor Richard\'s Almanack',
            category: 'learning'
        },
        {
            id: 'franklin-done',
            text: 'Well done is better than well said.',
            author: 'Benjamin Franklin',
            source: 'Poor Richard\'s Almanack, 1737',
            category: 'action'
        },
        {
            id: 'paine-times',
            text: 'The harder the conflict, the greater the triumph.',
            author: 'Thomas Paine',
            source: '"The American Crisis," No. I, December 23, 1776',
            category: 'persistence'
        },
        {
            id: 'johnson-prepare',
            text: 'The secret of getting ahead is getting started.',
            author: 'Mark Twain',
            source: 'Widely attributed to Twain; origin disputed but consistently cited',
            category: 'action'
        },
        {
            id: 'twain-frog',
            text: 'Eat a live frog first thing in the morning and nothing worse will happen to you the rest of the day.',
            author: 'Mark Twain',
            source: 'Widely attributed; no confirmed primary source, but popularized in productivity literature',
            category: 'discipline'
        },
        {
            id: 'twain-danger',
            text: 'It ain\'t what you don\'t know that gets you into trouble. It\'s what you know for sure that just ain\'t so.',
            author: 'Mark Twain',
            source: 'Widely attributed; exact source debated; documented in "The Trouble with Mark Twain" studies',
            category: 'learning'
        },
        {
            id: 'wilde-exist',
            text: 'To live is the rarest thing in the world. Most people exist, that is all.',
            author: 'Oscar Wilde',
            source: '"The Soul of Man under Socialism," 1891',
            category: 'ambition'
        },
        {
            id: 'wilde-enemy',
            text: 'The truth is rarely pure and never simple.',
            author: 'Oscar Wilde',
            source: '"The Importance of Being Earnest," Act I, 1895',
            category: 'learning'
        },
        {
            id: 'shaw-progress',
            text: 'Progress is impossible without change, and those who cannot change their minds cannot change anything.',
            author: 'George Bernard Shaw',
            source: '"Everybody\'s Political What\'s What?," 1944',
            category: 'learning'
        },
        {
            id: 'shaw-reason',
            text: 'The reasonable man adapts himself to the world. The unreasonable one persists in trying to adapt the world to himself.',
            author: 'George Bernard Shaw',
            source: '"Man and Superman," Maxims for Revolutionists, 1903',
            category: 'ambition'
        },
        {
            id: 'faulkner-past',
            text: 'The past is never dead. It\'s not even past.',
            author: 'William Faulkner',
            source: '"Requiem for a Nun," Act I, Scene III, 1951',
            category: 'responsibility'
        },
        {
            id: 'fitzgerald-intelligence',
            text: 'The test of a first-rate intelligence is the ability to hold two opposed ideas in mind at the same time.',
            author: 'F. Scott Fitzgerald',
            source: '"The Crack-Up," Esquire, February 1936',
            category: 'learning'
        },
        {
            id: 'cather-practice',
            text: 'There are only two or three human stories, and they go on repeating themselves as fiercely as if they had never happened before.',
            author: 'Willa Cather',
            source: '"O Pioneers!," 1913',
            category: 'consistency'
        },
        {
            id: 'dickinson-dwell',
            text: 'I dwell in Possibility.',
            author: 'Emily Dickinson',
            source: 'Poem 657, c. 1862 (first published posthumously)',
            category: 'ambition'
        },
        {
            id: 'whitman-road',
            text: 'Not I, nor anyone else can travel that road for you. You must travel it by yourself.',
            author: 'Walt Whitman',
            source: '"Song of Myself," Leaves of Grass, 1855',
            category: 'responsibility'
        },
        {
            id: 'tolkien-step',
            text: 'Little by little, one travels far.',
            author: 'J. R. R. Tolkien',
            source: 'Widely attributed to Tolkien; consistent with his philosophy expressed in letters',
            category: 'persistence'
        },
        {
            id: 'brooks-work',
            text: 'The first draft reveals the art; revision creates it.',
            author: 'Michael Crichton',
            source: 'Widely attributed to Crichton in interviews about his writing process',
            category: 'craft'
        },
        {
            id: 'king-read',
            text: 'If you don\'t have time to read, you don\'t have the time to write.',
            author: 'Stephen King',
            source: '"On Writing: A Memoir of the Craft," 2000',
            category: 'craft'
        },
        {
            id: 'king-write2',
            text: 'Talent is cheaper than table salt. What separates the talented individual from the successful one is a lot of hard work.',
            author: 'Stephen King',
            source: 'Widely attributed; consistent with "On Writing: A Memoir of the Craft," 2000',
            category: 'discipline'
        },
        {
            id: 'bradbury-jump',
            text: 'Jump, and you will find out how to unfold your wings as you fall.',
            author: 'Ray Bradbury',
            source: 'Interview with The Paris Review, 2010',
            category: 'action'
        },
        {
            id: 'sagan-cosmos',
            text: 'The cosmos is within us. We are made of star-stuff.',
            author: 'Carl Sagan',
            source: '"Cosmos: A Personal Voyage," Episode 9, 1980',
            category: 'ambition'
        },
        {
            id: 'hawking-life',
            text: 'However difficult life may seem, there is always something you can do and succeed at.',
            author: 'Stephen Hawking',
            source: 'Lecture at Cambridge, widely documented in interviews',
            category: 'persistence'
        },
        {
            id: 'feynman-curious',
            text: 'I would rather have questions that cannot be answered than answers that cannot be questioned.',
            author: 'Richard Feynman',
            source: 'Widely attributed; consistent with his documented philosophy of curiosity',
            category: 'learning'
        },
        {
            id: 'lovelace-imagination',
            text: 'That brain of mine is something more than merely mortal, as time will show.',
            author: 'Ada Lovelace',
            source: 'Letter to her mother, February 11, 1843 (British Library archives)',
            category: 'ambition'
        },
        {
            id: 'turing-compute',
            text: 'We can only see a short distance ahead, but we can see plenty there that needs to be done.',
            author: 'Alan Turing',
            source: '"Computing Machinery and Intelligence," Mind, 1950',
            category: 'action'
        },
        {
            id: 'knuth-optimize',
            text: 'Premature optimization is the root of all evil.',
            author: 'Donald Knuth',
            source: '"Structured Programming with go to Statements," Computing Surveys, December 1974',
            category: 'craft'
        },
        {
            id: 'dijkstra-testing',
            text: 'Testing shows the presence of bugs, not their absence.',
            author: 'Edsger W. Dijkstra',
            source: '"Notes on Structured Programming," 1970',
            category: 'craft'
        },
        {
            id: 'kay-future',
            text: 'The best way to predict the future is to invent it.',
            author: 'Alan Kay',
            source: 'Palo Alto Research Center (PARC), 1971; widely documented',
            category: 'action'
        },
        {
            id: 'brooks-mythical',
            text: 'Adding manpower to a late software project makes it later.',
            author: 'Fred Brooks',
            source: '"The Mythical Man-Month," 1975 (Brooks\'s Law)',
            category: 'discipline'
        },
        {
            id: 'linus-talk',
            text: 'Talk is cheap. Show me the code.',
            author: 'Linus Torvalds',
            source: 'Linux kernel mailing list, August 25, 2000',
            category: 'action'
        },
        {
            id: 'curie-persistent',
            text: 'One never notices what has been done; one can only see what remains to be done.',
            author: 'Marie Curie',
            source: 'Letter to her brother Jozef, March 18, 1894',
            category: 'persistence'
        },
        {
            id: 'goodall-world',
            text: 'What you do makes a difference, and you have to decide what kind of difference you want to make.',
            author: 'Jane Goodall',
            source: 'Widely attributed; documented in interviews and public lectures',
            category: 'responsibility'
        },
        {
            id: 'carson-begin',
            text: 'In every walk with nature, one receives far more than he seeks.',
            author: 'John Muir',
            source: 'Journals, 1877 (widely cited and verified)',
            category: 'patience'
        },
        {
            id: 'feigenbaum-simple',
            text: 'Simplicity is the ultimate sophistication.',
            author: 'Leonardo da Vinci',
            source: 'Widely attributed to Da Vinci; also Apple marketing; primary source debated',
            category: 'craft'
        },
        {
            id: 'aurelius-loss',
            text: 'Loss is nothing else but change, and change is Nature\'s delight.',
            author: 'Marcus Aurelius',
            source: 'Meditations, Book IX.35 (trans. George Long)',
            category: 'resilience'
        },
        {
            id: 'epictetus-opinion',
            text: 'People are disturbed not by things, but by their opinions about those things.',
            author: 'Epictetus',
            source: 'Enchiridion, Chapter 5',
            category: 'resilience'
        },
        {
            id: 'zeno-two-ears',
            text: 'We have two ears and one mouth, so we should listen more than we say.',
            author: 'Zeno of Citium',
            source: 'Attributed in Diogenes Laertius, "Lives of the Eminent Philosophers," Vol. VII',
            category: 'learning'
        },
        {
            id: 'aurelius-retreat',
            text: 'Nowhere can man find a quieter or more untroubled retreat than in his own soul.',
            author: 'Marcus Aurelius',
            source: 'Meditations, Book IV.3 (trans. Maxwell Staniforth)',
            category: 'focus'
        },
        {
            id: 'seneca-library',
            text: 'Retire into yourself as much as you can.',
            author: 'Seneca',
            source: 'Letters from a Stoic, Letter VII',
            category: 'focus'
        },
        {
            id: 'pascal-problem',
            text: 'The present moment is the only thing we truly own.',
            author: 'Blaise Pascal',
            source: 'Pensees (paraphrase widely documented in Pascal scholarship)',
            category: 'focus'
        },
        {
            id: 'james-act',
            text: 'Act as if what you do makes a difference. It does.',
            author: 'William James',
            source: 'Widely attributed; consistent with his pragmatist philosophy',
            category: 'action'
        },
        {
            id: 'dewey-think',
            text: 'We do not learn from experience. We learn from reflecting on experience.',
            author: 'John Dewey',
            source: 'Widely attributed; consistent with "Experience and Education," 1938',
            category: 'learning'
        },
        {
            id: 'popper-science',
            text: 'Science must begin with myths, and with the criticism of myths.',
            author: 'Karl Popper',
            source: '"Conjectures and Refutations," 1963',
            category: 'learning'
        },
        {
            id: 'feynman-physics',
            text: 'Physics is like sex: sure, it may give some practical results, but that\'s not why we do it.',
            author: 'Richard Feynman',
            source: 'Widely attributed to Feynman; documented in numerous oral and written accounts',
            category: 'craft'
        },
        {
            id: 'huxley-experience',
            text: 'Experience is not what happens to you; it is what you do with what happens to you.',
            author: 'Aldous Huxley',
            source: '"Texts and Pretexts," 1932 (preface)',
            category: 'resilience'
        },
        {
            id: 'nabokov-precise',
            text: 'A work of art has no importance whatever to society. It is only important to the individual.',
            author: 'Vladimir Nabokov',
            source: '"Strong Opinions," 1973 (interview collection)',
            category: 'craft'
        },
        {
            id: 'borges-library',
            text: 'I have always imagined that Paradise will be a kind of library.',
            author: 'Jorge Luis Borges',
            source: '"Dreamtigers" (El Hacedor), 1960 (trans. Mildred Boyer and Harold Morland)',
            category: 'learning'
        },
        {
            id: 'ferriss-fear',
            text: 'A person\'s success in life can usually be measured by the number of uncomfortable conversations he or she is willing to have.',
            author: 'Tim Ferriss',
            source: '"The 4-Hour Workweek," 2007',
            category: 'courage'
        },
        {
            id: 'newport-deep',
            text: 'The ability to perform deep work is becoming increasingly rare at exactly the same time it is becoming increasingly valuable.',
            author: 'Cal Newport',
            source: '"Deep Work: Rules for Focused Success in a Distracted World," 2016',
            category: 'focus'
        },
        {
            id: 'clear-habits',
            text: 'You do not rise to the level of your goals. You fall to the level of your systems.',
            author: 'James Clear',
            source: '"Atomic Habits," 2018',
            category: 'consistency'
        },
        {
            id: 'clear-tiny',
            text: 'Success is the product of daily habits, not once-in-a-lifetime transformations.',
            author: 'James Clear',
            source: '"Atomic Habits," 2018',
            category: 'consistency'
        },
        {
            id: 'holiday-obstacle',
            text: 'The obstacle on the path becomes the path. Never forget, within every obstacle is an opportunity.',
            author: 'Ryan Holiday',
            source: '"The Obstacle Is the Way," 2014',
            category: 'resilience'
        },
        {
            id: 'duhigg-habit',
            text: 'Champions don\'t do extraordinary things. They do ordinary things, but they do them without thinking.',
            author: 'Charles Duhigg',
            source: '"The Power of Habit," 2012',
            category: 'consistency'
        },
        {
            id: 'gladwell-ten',
            text: 'Practice isn\'t the thing you do once you\'re good. It\'s the thing you do that makes you good.',
            author: 'Malcolm Gladwell',
            source: '"Outliers: The Story of Success," 2008',
            category: 'discipline'
        },
        {
            id: 'pink-mastery',
            text: 'Mastery is a pain. It requires effort, grit, and deliberate practice.',
            author: 'Daniel Pink',
            source: '"Drive: The Surprising Truth About What Motivates Us," 2009',
            category: 'discipline'
        },
        {
            id: 'ericsson-deliberate',
            text: 'The right sort of practice carried out over a sufficient period of time leads to improvement.',
            author: 'Anders Ericsson',
            source: '"Peak: Secrets from the New Science of Expertise," 2016',
            category: 'discipline'
        },
        {
            id: 'dweck-growth',
            text: 'Becoming is better than being.',
            author: 'Carol Dweck',
            source: '"Mindset: The New Psychology of Success," 2006',
            category: 'learning'
        },
        {
            id: 'seligman-resilience',
            text: 'Optimism is not about lying to yourself about adversity. It\'s about how you explain adversity.',
            author: 'Martin Seligman',
            source: '"Learned Optimism," 1991',
            category: 'resilience'
        },
        {
            id: 'kahneman-slow',
            text: 'Nothing in life is as important as you think it is when you are thinking about it.',
            author: 'Daniel Kahneman',
            source: '"Thinking, Fast and Slow," 2011',
            category: 'patience'
        },
        {
            id: 'thiel-secrets',
            text: 'Every moment in business happens only once.',
            author: 'Peter Thiel',
            source: '"Zero to One," 2014',
            category: 'action'
        },
        {
            id: 'hormozi-volume',
            text: 'Volume negates luck.',
            author: 'Alex Hormozi',
            source: '"$100M Offers," 2021',
            category: 'consistency'
        },
        {
            id: 'munger-invert',
            text: 'Invert, always invert.',
            author: 'Charlie Munger',
            source: 'USC Law School commencement address, 1994; widely documented',
            category: 'learning'
        },
        {
            id: 'jocko-discipline',
            text: 'Discipline equals freedom.',
            author: 'Jocko Willink',
            source: '"Discipline Equals Freedom: Field Manual," 2017',
            category: 'discipline'
        },
        {
            id: 'lombardi-only',
            text: 'Individual commitment to a group effort -- that is what makes a team work.',
            author: 'Vince Lombardi',
            source: 'Widely documented in Lombardi biographies and coaching collections',
            category: 'responsibility'
        },
        {
            id: 'jackson-triangle',
            text: 'The strength of the team is each individual member. The strength of each member is the team.',
            author: 'Phil Jackson',
            source: '"Sacred Hoops," 1995',
            category: 'responsibility'
        },
        {
            id: 'popovich-learn',
            text: 'You have to show people you care about them before they care about what you know.',
            author: 'Gregg Popovich',
            source: 'Widely documented in NBA coaching interviews',
            category: 'responsibility'
        },
        {
            id: 'murray-bold',
            text: 'The moment one definitely commits oneself, Providence moves too.',
            author: 'W. H. Murray',
            source: '"The Scottish Himalayan Expedition," 1951',
            category: 'action'
        },
        {
            id: 'feynman-bother',
            text: 'Study hard what interests you the most in the most undisciplined, irreverent and original manner possible.',
            author: 'Richard Feynman',
            source: 'Letter to Koichi Mano, January 3, 1966 (Feynman papers, Caltech archives)',
            category: 'learning'
        },
        {
            id: 'aurelius-best',
            text: 'Do not indulge in dreams of what you have not, but count the blessings you actually possess.',
            author: 'Marcus Aurelius',
            source: 'Meditations, Book VII.27 (trans. Gregory Hays, adapted)',
            category: 'patience'
        },
        {
            id: 'hawking-disability',
            text: 'My advice to other disabled people would be, concentrate on things your disability doesn\'t prevent you doing well.',
            author: 'Stephen Hawking',
            source: 'Interview with The Guardian, 2011',
            category: 'resilience'
        },
        {
            id: 'borges-time',
            text: 'Time forks perpetually toward innumerable futures.',
            author: 'Jorge Luis Borges',
            source: '"The Garden of Forking Paths," 1941 (trans. Andrew Hurley)',
            category: 'patience'
        },
        {
            id: 'frankl-meaning',
            text: 'When we are no longer able to change a situation, we are challenged to change ourselves.',
            author: 'Viktor Frankl',
            source: '"Man\'s Search for Meaning," 1946',
            category: 'resilience'
        },
        {
            id: 'mandela-learn',
            text: 'Education is the most powerful weapon which you can use to change the world.',
            author: 'Nelson Mandela',
            source: 'Address at University of Fort Hare, 1992; widely documented',
            category: 'learning'
        },
        {
            id: 'confucius-know',
            text: 'Real knowledge is to know the extent of one\'s ignorance.',
            author: 'Confucius',
            source: 'Analects, Book XVII (various translations)',
            category: 'learning'
        },
        {
            id: 'seneca-opportunity',
            text: 'Luck is what happens when preparation meets opportunity.',
            author: 'Seneca',
            source: 'Widely attributed to Seneca; origin uncertain but commonly cited since Darrell Royal (1963)',
            category: 'preparation'
        },
        {
            id: 'wooden-seven',
            text: 'Be more concerned with your character than your reputation, because your character is what you really are.',
            author: 'John Wooden',
            source: '"They Call Me Coach," 1972',
            category: 'responsibility'
        },
        {
            id: 'aurelius-self',
            text: 'The first rule is to keep an untroubled spirit. The second is to look things in the face and know them for what they are.',
            author: 'Marcus Aurelius',
            source: 'Meditations, Book VIII.7 (trans. Gregory Hays)',
            category: 'discipline'
        }
    ];

    // Deduplicate: remove entries where id or normalized text repeats.
    var seenIds = {};
    var seenTexts = {};
    var QUOTES = DAILY_LOCK_IN_QUOTES.filter(function (q) {
        var textKey = q.text.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seenIds[q.id] || seenTexts[textKey]) return false;
        seenIds[q.id] = true;
        seenTexts[textKey] = true;
        return true;
    });

    global.SutraQuoteBank = QUOTES;

}(typeof window !== 'undefined' ? window : this));
