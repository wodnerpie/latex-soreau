/**
 * Keyboard-math shortcuts. These turn the characters people type on a normal
 * keyboard into the LaTeX they mean: `/` wraps the preceding expression in a
 * fraction, `*` becomes ×, and common comparison/arrow spellings become their
 * symbols. Everything runs on the source text, so exports and share links keep
 * using ordinary LaTeX.
 */

export interface ShortcutEdit {
  start: number;
  end: number;
  text: string;
  cursor: number;
}

interface Scan {
  source: string;
  comments: Uint8Array;
}

/** Command arguments that are text rather than math. */
const literalCommands = new Set([
  '\\text', '\\textrm', '\\textsf', '\\texttt', '\\textbf', '\\textit',
  '\\textsl', '\\textsc', '\\textup', '\\textmd', '\\textnormal',
  '\\emph', '\\mbox', '\\hbox', '\\operatorname',
  '\\color', '\\textcolor', '\\label', '\\tag',
  '\\begin', '\\end', '\\url', '\\href',
]);

function commentMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let inComment = false;
  for (let index = 0; index < source.length; index += 1) {
    if (inComment) {
      mask[index] = 1;
      if (source[index] === '\n') inComment = false;
      continue;
    }
    if (source[index] === '\\') {
      // An escaped character (including \%) never starts a comment.
      index += 1;
      continue;
    }
    if (source[index] === '%') {
      inComment = true;
      mask[index] = 1;
    }
  }
  return mask;
}

/** True when the character at `index` is preceded by an odd number of backslashes. */
function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function matchBack(scan: Scan, closeIndex: number, open: string, close: string): number {
  const { source, comments } = scan;
  let depth = 0;
  for (let index = closeIndex; index >= 0; index -= 1) {
    if (comments[index] || isEscaped(source, index)) continue;
    if (source[index] === close) depth += 1;
    else if (source[index] === open) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** The command immediately before an opening brace, if there is one. */
function commandBeforeOpen(source: string, openIndex: number, comments: Uint8Array): string | undefined {
  let index = openIndex - 1;
  const skipSpace = () => {
    while (index >= 0 && /\s/.test(source[index])) index -= 1;
  };
  skipSpace();
  if (source[index] === ']') {
    let depth = 1;
    index -= 1;
    while (index >= 0) {
      if (!comments[index] && !isEscaped(source, index)) {
        if (source[index] === ']') depth += 1;
        else if (source[index] === '[') {
          depth -= 1;
          if (!depth) break;
        }
      }
      index -= 1;
    }
    if (depth) return undefined;
    index -= 1;
    skipSpace();
  }
  if (source[index] === '*') {
    index -= 1;
    skipSpace();
  }
  const end = index + 1;
  while (index >= 0 && /[a-zA-Z]/.test(source[index])) index -= 1;
  if (index < 0 || source[index] !== '\\' || comments[index] || isEscaped(source, index)) return undefined;
  return source.slice(index, end);
}

/**
 * Whether `index` is inside a comment or inside a text-like argument such as
 * `\text{…}` or `\operatorname{…}`, where the shortcuts must stay literal.
 */
export function isLiteralContext(source: string, index: number, comments = commentMask(source)): boolean {
  if (index < 0 || index >= source.length || comments[index]) return true;
  const stack: boolean[] = [];
  let i = 0;
  while (i < index) {
    if (comments[i]) {
      i += 1;
      continue;
    }
    const char = source[i];
    if (char === '\\') {
      const command = /^\\(?:[a-zA-Z]+|.)/.exec(source.slice(i))?.[0];
      if (!command) {
        i += 1;
        continue;
      }
      i += command.length;
      continue;
    }
    if (char === '{') {
      const nested = stack.at(-1) === true;
      const command = nested ? undefined : commandBeforeOpen(source, i, comments);
      stack.push(nested || (command !== undefined && literalCommands.has(command)));
      i += 1;
      continue;
    }
    if (char === '}') {
      stack.pop();
      i += 1;
      continue;
    }
    i += 1;
  }
  return stack.includes(true);
}

/** Commands that join two expressions, so they must not be pulled into a numerator. */
const binaryCommands = new Set([
  '\\times', '\\cdot', '\\div', '\\pm', '\\mp', '\\ast', '\\star', '\\circ', '\\bullet',
  '\\le', '\\leq', '\\ge', '\\geq', '\\ne', '\\neq', '\\approx', '\\sim', '\\simeq',
  '\\cong', '\\equiv', '\\propto', '\\ll', '\\gg', '\\prec', '\\succ', '\\preceq', '\\succeq',
  '\\to', '\\rightarrow', '\\leftarrow', '\\leftrightarrow', '\\Rightarrow', '\\Leftarrow',
  '\\Leftrightarrow', '\\implies', '\\iff', '\\mapsto', '\\longmapsto', '\\longrightarrow',
  '\\Longrightarrow', '\\gets', '\\uparrow', '\\downarrow', '\\updownarrow',
  '\\cup', '\\cap', '\\setminus', '\\subset', '\\subseteq', '\\supset', '\\supseteq',
  '\\in', '\\notin', '\\ni', '\\land', '\\lor', '\\neg', '\\wedge', '\\vee',
  '\\oplus', '\\otimes', '\\perp', '\\parallel', '\\mid', '\\nmid',
  '\\over', '\\atop', '\\choose', '\\bmod', '\\mod', '\\pmod',
]);

function skipSpaceBack(source: string, index: number): number {
  while (index >= 0 && /\s/.test(source[index])) index -= 1;
  return index;
}

interface Atom {
  start: number;
  end: number;
}

/** Start of a command ending at `endExclusive`, or undefined for ordinary words. */
function commandStartBefore(source: string, endExclusive: number, comments: Uint8Array): number | undefined {
  let index = endExclusive - 1;
  while (index >= 0 && /[a-zA-Z]/.test(source[index])) index -= 1;
  if (index < 0 || source[index] !== '\\' || comments[index] || isEscaped(source, index)) return undefined;
  return index;
}

/**
 * The expression atom that ends at `end` (exclusive), read backwards. This is
 * deliberately conservative: it understands numbers, words, commands with
 * their arguments, grouped expressions, powers, subscripts, factorials, and
 * absolute values, but never reaches across a binary operator.
 */
function readAtomBack(scan: Scan, end: number): Atom | undefined {
  const { source, comments } = scan;
  let index = skipSpaceBack(source, end - 1);
  if (index < 0) return undefined;
  const atomEnd = index + 1;

  let suffixed = false;
  while (index >= 0 && !comments[index] && (source[index] === '!' || source[index] === "'")) {
    suffixed = true;
    index -= 1;
  }
  if (suffixed) {
    const baseEnd = skipSpaceBack(source, index) + 1;
    const base = readAtomBack(scan, baseEnd);
    return base ? { start: base.start, end: atomEnd } : undefined;
  }

  let start: number;
  const char = source[index];
  if (char === '}') {
    const open = matchBack(scan, index, '{', '}');
    if (open < 0) return undefined;
    start = open;
    // Walk back over adjacent brace/bracket arguments to find the command
    // that owns them, so \frac{a}{b}, \sqrt[3]{x}, and \sqrt{x} stay whole.
    let argumentsStart = open;
    for (;;) {
      const before = skipSpaceBack(source, argumentsStart - 1);
      if (before < 0) break;
      const closer = source[before];
      if (closer !== '}' && closer !== ']') break;
      const opener = closer === '}' ? '{' : '[';
      const argument = matchBack(scan, before, opener, closer);
      if (argument < 0) break;
      argumentsStart = argument;
    }
    const command = commandStartBefore(source, argumentsStart, comments);
    if (command !== undefined && !binaryCommands.has(source.slice(command, argumentsStart))) start = command;
  } else if (char === ')' || char === ']') {
    const open = matchBack(scan, index, char === ')' ? '(' : '[', char);
    if (open < 0) return undefined;
    start = open;
    const command = commandStartBefore(source, start, comments);
    if (command !== undefined && !binaryCommands.has(source.slice(command, start))) start = command;
  } else if (/[A-Za-z0-9.]/.test(char)) {
    const wordEnd = index + 1;
    while (index >= 0 && !comments[index] && /[A-Za-z0-9.]/.test(source[index])) index -= 1;
    if (index >= 0 && source[index] === '\\' && !comments[index] && !isEscaped(source, index)) {
      // A binary command with no right operand is not a numerator.
      if (binaryCommands.has(source.slice(index, wordEnd))) return undefined;
      start = index;
      // A numeric coefficient binds to the command: 2\pi reads as one atom.
      const before = skipSpaceBack(source, index - 1);
      if (before >= 0 && /[0-9.]/.test(source[before])) {
        let number = before;
        while (number >= 0 && /[0-9.]/.test(source[number])) number -= 1;
        start = number + 1;
      }
    } else {
      start = index + 1;
    }
  } else if (char === '|') {
    let open = index - 1;
    while (open >= 0 && (source[open] !== '|' || comments[open] || isEscaped(source, open))) open -= 1;
    if (open < 0) return undefined;
    start = open;
  } else {
    return undefined;
  }

  // Extend across powers/subscripts (x^2, x_i), implicit multiplication
  // (2x, f(x), \sin x), and adjacent groups, but never across an operator.
  for (;;) {
    let extended = start;
    const operator = skipSpaceBack(source, start - 1);
    if (operator >= 0 && !comments[operator] && (source[operator] === '^' || source[operator] === '_')) {
      const baseEnd = skipSpaceBack(source, operator - 1) + 1;
      const base = readAtomBack(scan, baseEnd);
      if (base && base.start < start) extended = base.start;
    }
    if (extended === start) {
      const before = skipSpaceBack(source, start - 1);
      if (before >= 0 && !comments[before]) {
        const previous = source[before];
        if (previous === ')' || previous === ']' || previous === '}') {
          const atom = readAtomBack(scan, before + 1);
          if (atom && atom.start < start) extended = atom.start;
        } else if (/[A-Za-z0-9.]/.test(previous)) {
          let word = before;
          while (word >= 0 && !comments[word] && /[A-Za-z0-9.]/.test(source[word])) word -= 1;
          if (word >= 0 && source[word] === '\\' && !comments[word] && !isEscaped(source, word)) {
            if (!binaryCommands.has(source.slice(word, before + 1)) && word < start) extended = word;
          } else if (word + 1 < start) {
            extended = word + 1;
          }
        }
      }
    }
    if (extended === start) break;
    start = extended;
  }

  return { start, end: atomEnd };
}

function replacement(source: string, start: number, end: number, text: string): ShortcutEdit {
  return { start, end, text, cursor: start + text.length };
}

/** True when `*` is part of a command name such as \operatorname* or a \\* break. */
function isCommandStar(source: string, index: number, comments: Uint8Array): boolean {
  if (index > 0 && source[index - 1] === '\\') return true;
  let i = index - 1;
  while (i >= 0 && !comments[i] && /[a-zA-Z]/.test(source[i])) i -= 1;
  return i >= 0 && source[i] === '\\' && !comments[i] && !isEscaped(source, i);
}

/**
 * Returns the source edit for a shortcut finishing at `cursor`, or undefined
 * when the text should be left alone. `cursor` is the offset immediately after
 * the character that was just typed.
 */
export function keyboardMathEdit(source: string, cursor: number): ShortcutEdit | undefined {
  if (cursor <= 0 || cursor > source.length) return undefined;
  const scan: Scan = { source, comments: commentMask(source) };
  const { comments } = scan;
  const suffix = (text: string) => source.slice(cursor - text.length, cursor) === text;

  if (suffix('txt')) {
    const start = cursor - 3;
    const before = start > 0 ? source[start - 1] : '';
    const boundary = before === '' || (!/[A-Za-z0-9_]/.test(before) && before !== '\\' && before !== '^');
    if (boundary && !isLiteralContext(source, start, comments)) {
      return { start, end: cursor, text: '\\text{}', cursor: start + '\\text{'.length };
    }
    return undefined;
  }
  if (suffix('...')) {
    const start = cursor - 3;
    if (!isLiteralContext(source, start, comments)) return replacement(source, start, cursor, '\\ldots ');
    return undefined;
  }
  for (const [from, to] of [['<=', '\\le '], ['>=', '\\ge '], ['!=', '\\ne '], ['=/', '\\ne '], ['/=', '\\ne '], ['->', '\\to '], ['=>', '\\Rightarrow ']] as const) {
    if (!suffix(from)) continue;
    const start = cursor - from.length;
    if (isEscaped(source, start) || isLiteralContext(source, start, comments)) return undefined;
    return replacement(source, start, cursor, to);
  }
  if (source[cursor - 1] === '*') {
    const start = cursor - 1;
    if (isEscaped(source, start) || isCommandStar(source, start, comments) || isLiteralContext(source, start, comments)) return undefined;
    return replacement(source, start, cursor, '\\times{}');
  }
  if (source[cursor - 1] !== '/') return undefined;

  const slash = cursor - 1;
  if (isEscaped(source, slash) || isLiteralContext(source, slash, comments)) return undefined;
  const numerator = readAtomBack(scan, slash);
  if (!numerator) {
    // Start a new fraction only after an operator, an opening delimiter, or
    // at the beginning. If there is an expression we could not parse, leave
    // the slash alone instead of dropping it.
    const before = skipSpaceBack(source, slash - 1);
    if (before >= 0 && !/[=+\-*/([{,;:<>]/.test(source[before])) return undefined;
    const text = '\\frac{}{}';
    return { start: slash, end: cursor, text, cursor: slash + '\\frac{'.length };
  }
  const value = source.slice(numerator.start, slash).trimEnd();
  if (!value) return undefined;
  const text = `\\frac{${value}}{}`;
  return { start: numerator.start, end: cursor, text, cursor: numerator.start + text.length - 1 };
}
