import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEBATE_AGENTS,
  MAX_DEBATE_EXCHANGES,
  STUDENT_SPEAKER,
  canAdvance,
  exchangeCount,
  nextOrder,
  nextSpeaker,
  pendingInterjection,
  type DebateTurn,
} from "./debate.ts";

function agentTurn(order: number, speaker: string): DebateTurn {
  return { order, speaker, answer: null };
}
function studentTurn(order: number, text: string): DebateTurn {
  return { order, speaker: STUDENT_SPEAKER, answer: text };
}

test("an exchange is one utterance from each agent", () => {
  assert.equal(exchangeCount([]), 0);
  assert.equal(exchangeCount([agentTurn(0, DEBATE_AGENTS[0])]), 0);
  assert.equal(
    exchangeCount([agentTurn(0, DEBATE_AGENTS[0]), agentTurn(1, DEBATE_AGENTS[1])]),
    1
  );
});

test("a student interjection does not count as an exchange", () => {
  const turns = [
    agentTurn(0, DEBATE_AGENTS[0]),
    agentTurn(1, DEBATE_AGENTS[1]),
    studentTurn(2, "But that ignores the boundary condition."),
  ];
  assert.equal(exchangeCount(turns), 1);
});

test("the agents alternate, and an interjection does not steal a turn", () => {
  assert.equal(nextSpeaker([]), DEBATE_AGENTS[0]);
  assert.equal(nextSpeaker([agentTurn(0, DEBATE_AGENTS[0])]), DEBATE_AGENTS[1]);
  const afterInterjection = [agentTurn(0, DEBATE_AGENTS[0]), studentTurn(1, "Wait — why?")];
  assert.equal(nextSpeaker(afterInterjection), DEBATE_AGENTS[1]);
});

test("orders keep climbing across interjections", () => {
  assert.equal(nextOrder([]), 0);
  assert.equal(nextOrder([agentTurn(0, DEBATE_AGENTS[0]), studentTurn(1, "hm")]), 2);
});

test("the debate stops at six exchanges", () => {
  const turns: DebateTurn[] = [];
  for (let i = 0; i < MAX_DEBATE_EXCHANGES * DEBATE_AGENTS.length; i++) {
    turns.push(agentTurn(i, DEBATE_AGENTS[i % DEBATE_AGENTS.length]));
  }
  assert.equal(exchangeCount(turns), MAX_DEBATE_EXCHANGES);
  assert.equal(canAdvance(turns), false);
  turns.pop();
  assert.equal(canAdvance(turns), true);
});

test("the agents owe an answer to the newest interjection only", () => {
  assert.equal(pendingInterjection([]), null);

  const answered = [
    agentTurn(0, DEBATE_AGENTS[0]),
    studentTurn(1, "First objection"),
    agentTurn(2, DEBATE_AGENTS[1]),
  ];
  assert.equal(pendingInterjection(answered), null);

  const unanswered = [...answered, studentTurn(3, "Second objection")];
  assert.equal(pendingInterjection(unanswered)?.answer, "Second objection");
});
