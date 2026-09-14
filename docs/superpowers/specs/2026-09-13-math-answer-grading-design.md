# Lectern — Math Answer Grading Design

Date: 2026-09-13
Status: Approved design, ready for implementation planning

## 1. Context

Lectern's quiz grades a free-text answer by token overlap. `gradeShortAnswer`
(`src/lib/grading.ts:27`) lowercases the answer, runs
`replace(/[^a-z0-9\s]/g, " ")`, drops stopwords, and scores Jaccard similarity
against the reference answer. Every character that carries mathematical meaning
is deleted before the comparison happens.

For a humanities lecture that is a reasonable trade — the grader is local, costs
nothing, and paraphrase is what it is measuring. For a linear algebra lecture it
is not grading at all:

- `\det(A) = 0` tokenizes to `det a 0`. So does `A = 0 det`, and so does a
  sentence mentioning the determinant of `A` in passing.
- `x^2` tokenizes to `x 2`. So does `2x`. A student who answers `2x` where the
  reference is `x^2` scores a perfect 1.0.
- `\frac{2}{3}`, `2/3`, and `0.667` are three unrelated token sets. Two of them
  are marked wrong against the third.
- `\mathbb{R}^3` becomes `mathbb r 3`, where `mathbb` — a rendering command that
  means nothing about the answer — is a third of the score.

The failure is silent in both directions. A correct answer marked wrong is
visible and infuriating; a wrong answer marked correct is invisible and writes a
false row into the recall ledger, where `suggestQuality` turns it into a longer
SM-2 interval for material the student does not know.

Three smaller problems sit alongside it:

**Quiz prompts do not render math.** `QuizRunner` passes `prompt` to components
that put it in a `<p>` as plain text (`src/components/quiz/ShortAnswerQuestion.tsx:20`,
`ClozeQuestion.tsx:28`, `MultipleChoiceQuestion.tsx`). The `<Markdown>` component
(`src/components/Markdown.tsx`) already carries `remark-math` and `rehype-katex`
and is used for notes, but the quiz never adopted it. A generated question about
an eigenvalue displays its LaTeX source.

**Generation has no math instructions.** `QUIZ_SYSTEM_PROMPT`
(`src/lib/prompts/quiz.ts`) describes three types, none of which fit "compute
this value", and says nothing about notation.

**Nothing in the repo can evaluate an expression.** `katex` renders LaTeX;
`remark-math` finds it in markdown. Neither parses it to something comparable.

## 2. Goals

- A correct answer, typed in any reasonable notation, is graded correct.
- A wrong answer is graded wrong — including the `2x` / `x^2` collision, which
  today scores 1.0.
- Coverage of the value-shaped answers in both courses: scalars, fractions,
  sets, vectors, matrices, and polynomial expressions.
- Deterministic and local. No LLM call on the grading path.
- The grader records *how* it decided, so a miscalibrated strategy is visible in
  the data instead of silently inflating scores.
- Math renders as math everywhere in the quiz.

## 3. Non-goals

- **Proof grading.** Induction, pigeonhole, and the rest of discrete math's
  proof surface cannot be graded by comparing values, and an LLM rubric grader
  is a different subsystem with a different failure mode. Deferred to its own
  spec; see section 10.
- **Trustworthy generated answers.** This design makes correct student answers
  gradeable. It does nothing about the model writing a wrong eigenvalue into
  `correctAnswer` in the first place. Parametric generators — compute the
  question and its answer in code from a random seeded matrix — are the fix for
  that, and are also deferred.
- **An equation editor or live preview.** Students type ASCII. A rendered
  preview of what they typed is a nice-to-have that can be added once the
  checker is proven.
- **Changing how existing question types are graded.** `SHORT_ANSWER`,
  `MULTIPLE_CHOICE`, and `CLOZE` keep the graders they have. Nothing already in
  the database changes behavior.

## 4. Mechanism — `src/lib/math-answer.ts`

One exported function, four strategies tried in order. The first that reaches a
verdict wins; the strategy that produced it is returned alongside so it lands in
`scoreDetail`.

```ts
export type MathStrategy = "canonical" | "numeric" | "collection" | "probe";

export type MathGrade = {
  isCorrect: boolean;
  /** Which strategy decided. */
  strategy: MathStrategy;
};

export function checkMathAnswer(userAnswer: string, correctAnswer: string): MathGrade;
```

Both sides run through `latexToAscii` (section 4.5) before any strategy sees
them.

### 4.1 Canonical string

Compare the two normalized strings exactly. Normalization removes whitespace and
`$` delimiters, lowercases, and unifies the spellings that mean the same thing
(`\cdot` and `*`, `\times` and `*` in scalar position).

This is the strategy that catches answers no evaluator can help with —
`\det(A) = 0`, `rank 2`, `R^3`, `{a, b} \subseteq S` — because for these the
answer *is* a piece of notation rather than a value. It runs first because it is
free and because a string match needs no tolerance argument.

### 4.2 Numeric

Parse both sides with `mathjs` and evaluate. If both evaluate to finite numbers,
compare with a relative tolerance of `1e-9` (absolute `1e-12` near zero, so
`0` and `1e-15` compare equal and the relative test does not divide by zero).

This is what makes `1/2`, `0.5`, `\frac{1}{2}`, and `2^{-1}` one answer. It
covers determinants, ranks, traces, eigenvalues, `C(10,3)`, modular arithmetic
results — most of what a linear algebra or combinatorics drill actually asks
for.

### 4.3 Collections — sets, vectors, matrices

If both sides parse to a collection, compare element-wise with the numeric
tolerance from 4.2:

- **Sets** — `{2, 3, 5}` — order-insensitive, duplicates collapsed. This is the
  discrete math case: divisors, residues, a vertex cover.
- **Vectors and matrices** — `[1, 2, 3]`, `[[1, 2], [3, 4]]` — order-sensitive,
  shape must match. mathjs parses both natively. This is the linear algebra
  case: an inverse, an RREF, a projection, a basis vector.

A set written with braces and a vector written with brackets are different
answers, and comparing one against the other is a mismatch rather than a parse
failure.

### 4.4 Random-point equivalence

If both sides parse to expressions over the same free variables, substitute
random values for those variables and evaluate both. Agreement at several
independent points is the verdict.

This is what makes `(x+1)^2` and `x^2 + 2x + 1` the same answer without a CAS —
characteristic polynomials, generating functions, any algebraic rearrangement.

Three details that matter:

1. **Sample count.** Five points. Two polynomials that differ agree at finitely
   many points; five random reals agreeing to tolerance is decisive enough for
   an answer box, and the cost is five evaluations.
2. **Sample range.** Draw from a continuous range away from the small integers
   (roughly 1.5 to 9.5, non-integer). Sampling `0` and `1` is how `x^2` and `x`
   get declared equal.
3. **Domain errors.** An expression undefined at a sample point (division by
   zero, a log of a negative) discards that point and draws another, up to a
   small retry cap. If too few valid points survive, the strategy declines
   rather than guessing.

Variable sets must match before probing. `x + 1` and `y + 1` are different
answers, not the same expression under a rename.

### 4.5 `latexToAscii`

mathjs reads ASCII math, not LaTeX. The reference answers the model writes will
contain LaTeX, so a small converter handles the subset that appears in *answers*
— a far narrower language than LaTeX at large:

`\frac{a}{b}` → `(a)/(b)`, `\sqrt{a}` → `sqrt(a)`, `\cdot`/`\times` → `*`,
`^{...}` → `^(...)`, `\left`/`\right` dropped, greek commands to their names,
`\pmatrix`/`\bmatrix`/`\begin{matrix}` bodies to nested-bracket form, `\{ \}` to
plain braces.

It carries a `ponytail:` comment naming the ceiling: this is a lexical
converter, not a LaTeX parser. Unsupported commands survive literally, but
supported syntax nested inside them still converts, and this is safe because
both sides of a comparison run through the same converter — failures occur for
the same reason on both sides. Unsupported syntax fails to parse in strategies
2–4 and is compared as a string by strategy 1, which is the correct
degradation.

### 4.6 Dependency

`mathjs` is new. Nothing installed can parse or evaluate an expression — `katex`
renders and `remark-math` locates, neither evaluates. A parser plus evaluator
for arithmetic, matrices, and symbolic substitution is not a few lines of our
own code, and a hand-rolled one would be wrong at exactly the edges that matter
(operator precedence, unary minus, implicit multiplication). Pinned like the
rest of `package.json`.

Only the parse/evaluate surface is used: `math.parse`, `math.evaluate`, and
matrix comparison. No mathjs config, no `math.create` scope juggling.

## 5. Mechanism — the `MATH` question type

`QuestionType` gains `MATH`. The migration is additive: a new enum value, no
column changes, no data touched. `npm run db:migrate` snapshots `prisma/dev.db`
before it runs, as it does for every migration.

`correctAnswer` holds one canonical value. `options` stays null. `explanation`
works as it does today.

**Grading route.** `src/app/api/quiz/[questionId]/answer/route.ts` gains a
branch before the short-answer fallback:

```
MULTIPLE_CHOICE → gradeMultipleChoice
MATH            → checkMathAnswer
otherwise       → gradeShortAnswer
```

`scoreDetail` for a MATH answer records `{ strategy }`. The recall row uses
`{ kind: "QUIZ", correct: isCorrect }` — the boolean form, like multiple choice,
not the similarity form. A math answer is right or wrong; there is no partial
credit to feed the interval, and inventing a similarity number for one would
make the ledger lie.

**Input.** A new `MathQuestion` component: a single-line input rather than the
short answer's textarea, because a value is not a paragraph, with placeholder
text carrying the notation contract — `e.g. 1/2, x^2+1, [[1,2],[3,4]], {2,3,5}`.
Enter submits, matching `ClozeQuestion`. `QuizRunner`'s `QuizQuestionForRunner`
type and its branch gain the case.

## 6. Mechanism — rendering

`ShortAnswerQuestion`, `ClozeQuestion`, `MultipleChoiceQuestion`, and the new
`MathQuestion` render their prompt through `<Markdown>` instead of interpolating
it into a `<p>`. `QuizResultsSummary` does the same for the prompt, the user's
answer, and the correct answer.

`ClozeQuestion` is the one with a wrinkle: it splits the prompt around the gap
with `splitCloze` and needs the input inline inside the sentence. The two
fragments each render through `<Markdown>` with the input between them, and
`<Markdown>`'s block-level `<p>` wrappers have to be neutralized for that row so
the sentence does not break across three lines.

## 7. Mechanism — generation

`QUIZ_SYSTEM_PROMPT` gains the MATH shape and its rules:

- Use MATH when the answer is a value the student computes: a number, a
  fraction, a set, a vector, a matrix, or an expression.
- Write the prompt's notation as LaTeX; it will be rendered.
- Write `correctAnswer` as a single canonical value in plain ASCII — `1/2`, not
  `\frac{1}{2}` and not a sentence. No units, no "the answer is".
- Never use MATH for a proof, a derivation, or "explain why".

`buildMissesQuizUserPrompt` needs no change; it passes prompts and answers
through as text.

## 8. Error handling

- **Neither side parses.** Strategy 1 still ran and returned a verdict on the
  normalized strings, so there is always an answer. `strategy` is `"canonical"`
  whenever no evaluator-backed strategy reached one.
- **The student's answer is unparseable but the reference is fine.** Graded
  wrong by strategy 1, which is correct: an answer the checker cannot read is an
  answer that does not match.
- **mathjs throws.** Every parse and evaluate call is wrapped; a throw means
  that strategy declines and the next one runs. A parse error is a control-flow
  signal here, not an incident, and must not reach the route.
- **Runaway input.** A student-typed expression is untrusted input even on a
  local-only app. Expression length is capped (a few hundred characters) before
  parsing, which is the cheap guard against a pathological input;
  `math.evaluate` is called without a scope that could reach anything outside
  the expression.

## 9. Testing

`src/lib/math-answer.test.ts`, in the existing `node:test` style, as a table of
pairs per strategy. The cases that must be there:

**Must be equal** — `1/2` / `0.5` / `\frac{1}{2}`; `\det(A) = 0` / `det(A)=0`;
`{2,3,5}` / `{5,3,2}`; `[[1,2],[3,4]]` / `\begin{bmatrix}1&2\\3&4\end{bmatrix}`;
`(x+1)^2` / `x^2+2x+1`.

**Must not be equal** — `x^2` / `2x` (the collision today's grader scores 1.0);
`{2,3}` / `[2,3]`; `[[1,2],[3,4]]` / `[[1,3],[2,4]]`; `x+1` / `y+1`;
`0.5` / `0.6`.

**Degradation** — an answer the converter cannot read falls to strategy 1 and is
compared as a string, and the returned `strategy` says so.

`latexToAscii` gets its own table: each supported command in, ASCII out, and an
unsupported command passing through unchanged.

The route's branch and the components are not unit-tested; the repo tests
`src/lib` only, and the branch is three lines of dispatch over a function that
is tested directly.

## 10. Deferred

- **Proof grading for discrete math.** An LLM grader against a rubric, writing
  its diagnosis to `ReviewLog.misconception` — the column already exists for it.
  Its own spec, because rubric design and grader calibration are the whole
  problem and neither is a string comparison.
- **Parametric generators.** Compute a question and its answer in code from a
  seeded random matrix. Infinite drill, an answer that cannot be hallucinated.
  The real fix for generated-answer quality, and a subsystem rather than a
  patch.
- **Live KaTeX preview of the student's input.** Add when the notation contract
  in the placeholder proves insufficient.
- **Proof-step ordering questions.** Scramble an induction proof's steps,
  student reorders. Deterministic grading, tests structure rather than recall —
  the cheapest way to assess a proof without grading prose.
