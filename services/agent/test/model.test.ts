import { strict as assert } from "node:assert";
import { test } from "node:test";
import { devigMultiplicative, devigShin, impliedFromDecimal, overround } from "../src/model/devig";
import {
  inPlayLambdas,
  lambdasFromMarket,
  outcomeProbabilities,
  poissonPmf,
} from "../src/model/poisson";
import { sizePosition } from "../src/risk/kelly";

test("de-vig: multiplicative normalizes to 1 and preserves order", () => {
  const implied = impliedFromDecimal([1.8, 3.6, 5.0]);
  assert.ok(overround(implied) > 1);
  const fair = devigMultiplicative(implied);
  assert.ok(Math.abs(fair.reduce((s, p) => s + p, 0) - 1) < 1e-12);
  assert.ok(fair[0] > fair[1] && fair[1] > fair[2]);
});

test("de-vig: Shin shades longshots more than favourites", () => {
  const implied = impliedFromDecimal([1.5, 4.5, 8.0]);
  const multiplicative = devigMultiplicative(implied);
  const shin = devigShin(implied);
  assert.ok(Math.abs(shin.reduce((s, p) => s + p, 0) - 1) < 1e-9);
  // Shin gives the favourite MORE probability than proportional de-vig...
  assert.ok(shin[0] > multiplicative[0]);
  // ...and the longshot LESS.
  assert.ok(shin[2] < multiplicative[2]);
});

test("poisson: pmf sums to ~1 and matches known value", () => {
  let sum = 0;
  for (let k = 0; k < 40; k++) sum += poissonPmf(1.5, k);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  // P(X=0 | λ=1.5) = e^-1.5
  assert.ok(Math.abs(poissonPmf(1.5, 0) - Math.exp(-1.5)) < 1e-12);
});

test("poisson: outcome probabilities are a proper distribution", () => {
  const p = outcomeProbabilities(0, 0, 1.4, 1.1);
  assert.ok(Math.abs(p.homeWin + p.draw + p.awayWin - 1) < 1e-6);
  assert.ok(p.homeWin > p.awayWin); // higher λ → more likely to win
  const over25 = p.over(2.5, 0);
  assert.ok(over25 > 0 && over25 < 1);
});

test("poisson: conditioning on the current score shifts win probability", () => {
  const level = outcomeProbabilities(0, 0, 1.0, 1.0);
  const leading = outcomeProbabilities(1, 0, 1.0, 1.0);
  assert.ok(leading.homeWin > level.homeWin + 0.2);
});

test("lambda solver: round-trips market probabilities", () => {
  const target = { pHome: 0.5, pOver: 0.55, line: 2.5 };
  const { lambdaHome, lambdaAway, fitError } = lambdasFromMarket(
    target.pHome,
    target.pOver,
    target.line,
  );
  assert.ok(fitError < 0.01, `fitError ${fitError} too high`);
  const check = outcomeProbabilities(0, 0, lambdaHome, lambdaAway);
  assert.ok(Math.abs(check.homeWin - target.pHome) < 0.01);
  assert.ok(Math.abs(check.over(target.line, 0) - target.pOver) < 0.01);
});

test("in-play: red card cuts a side's expectancy", () => {
  const base = inPlayLambdas(1.5, 1.2, 0.5, 0, 0);
  const withRed = inPlayLambdas(1.5, 1.2, 0.5, 1, 0);
  assert.ok(withRed.remLambdaHome < base.remLambdaHome);
  assert.ok(withRed.remLambdaAway > base.remLambdaAway);
});

test("kelly: no bet without edge, bounded with edge", () => {
  const noEdge = sizePosition({
    modelProb: 0.5,
    priceDecimal: 2.0,
    bankrollUsdc: 1000,
    calibrationFactor: 1,
    allocationWeight: 1,
    maxStakeUsdc: 50,
  });
  assert.equal(noEdge.stakeUsdc, 0);

  const withEdge = sizePosition({
    modelProb: 0.58,
    priceDecimal: 2.0,
    bankrollUsdc: 1000,
    calibrationFactor: 1,
    allocationWeight: 1,
    maxStakeUsdc: 50,
  });
  assert.ok(withEdge.stakeUsdc > 0);
  assert.ok(withEdge.stakeUsdc <= 50);
});

test("kelly: calibration factor scales stakes down", () => {
  const inputs = {
    modelProb: 0.58,
    priceDecimal: 2.0,
    bankrollUsdc: 1000,
    allocationWeight: 1,
    maxStakeUsdc: 500,
  };
  const confident = sizePosition({ ...inputs, calibrationFactor: 1 });
  const shaken = sizePosition({ ...inputs, calibrationFactor: 0.25 });
  assert.ok(shaken.stakeUsdc < confident.stakeUsdc);
});
