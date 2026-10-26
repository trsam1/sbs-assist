/**
 * Canned, copyright-free glossary for the Step 10 figure taxonomy. Keyed by `FigureType.id`; each
 * entry is a short plain-language definition plus a brief GENERIC illustration — NO scripture
 * quotation (the app serves no Bible text the student did not provide). A pure constant: the
 * "Explain a category" help uses this with no AI call and no network. A test asserts there is one
 * entry for every id in FIGURE_TYPES.
 */
export const FIGURE_GLOSSARY: Readonly<Record<string, string>> = {
  // Parallelism
  synonymous:
    'Two lines that say the same thing in different words, the second echoing the first. Generic example: "The storm raged; the tempest roared."',
  antithetic:
    'Two lines set in contrast, the second stating the opposite of the first. Generic example: "The diligent prosper, but the idle go hungry."',
  synthetic:
    'The second line develops, completes, or builds on the first rather than repeating or opposing it. Generic example: "She planted the seed, and in time it bore fruit."',
  'statement-and-comment':
    'A statement followed by a line that explains, qualifies, or comments on it. Generic example: "He kept silent — for he knew the time had not yet come."',
  emblematic:
    'One line gives an image or comparison and the other its point, often linked by "as" or "like". Generic example: "As a river finds the sea, so the traveler came home."',
  // Figures of speech
  allegory:
    'An extended narrative in which characters and events stand for a second, deeper meaning throughout. Generic example: a journey that represents a life of growth.',
  allusion:
    'A brief, indirect reference to a person, event, or text the audience is expected to recognize. Generic example: calling a betrayer "a Judas" in ordinary speech.',
  apostrophe:
    'A direct address to someone absent, dead, or to an abstract or inanimate thing as if it could hear. Generic example: "O Death, where is thy sting?" (addressing death itself).',
  climax:
    'A series arranged in ascending order of force or importance, building to a peak. Generic example: "He came, he worked, he conquered."',
  ellipsis:
    'The deliberate omission of a word or words the reader supplies from context. Generic example: "Some trust in chariots; others, in horses" (omitting "trust").',
  euphemism:
    'A mild or indirect expression substituted for one that is harsh or blunt. Generic example: "fell asleep" for "died".',
  hyperbole:
    'Deliberate exaggeration for emphasis, not meant to be taken literally. Generic example: "I have told you a thousand times."',
  irony:
    'Words that convey the opposite of their literal sense, or a sense the speaker does not mean; sarcasm is its pointed form. Generic example: calling a downpour "lovely weather."',
  litotes:
    'Understatement that affirms something by denying its opposite. Generic example: "no small crowd" for "a large crowd."',
  metaphor:
    'An implied comparison that speaks of one thing as if it were another, without "like" or "as". Generic example: "He is a rock" (meaning steady, dependable).',
  metonymy:
    'Naming a thing by something closely associated with it. Generic example: "the crown" for the monarchy, or "the pen" for writing.',
  parable:
    'A short illustrative story that teaches a moral or spiritual lesson by analogy. Generic example: a tale of a farmer sowing seed to illustrate how people receive a message.',
  personification:
    'Attributing human qualities or actions to something non-human or abstract. Generic example: "the wind whispered through the trees."',
  anthropomorphism:
    'Describing God (or a deity) with human form, features, or emotions to make the divine comprehensible. Generic example: speaking of "the hand" or "the eyes" of God.',
  typology:
    'A person, event, or institution that foreshadows or prefigures a later one. Generic example: an earlier deliverer presented as a pattern of a greater one to come.',
};
