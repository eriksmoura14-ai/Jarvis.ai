import { describe, expect, it } from 'vitest';
import { calculate } from './calculator.js';

describe('calculadora segura', () => {
  it.each([
    ['2 + 3 * 4', 14], ['(12 + 8) / 2', 10], ['-3 * -2', 6], ['1,5 + .5', 2], ['0.1 + 0.2', 0.3], ['2 / (3 - 1)', 1],
  ])('calcula %s', (expression, expected) => expect(calculate(expression)).toBe(expected));
  it.each(['1 / 0', '2(3)', '(2+3', '2 +', 'process.exit()', '2 ** 5', '', '1; alert(1)', '2'.repeat(161)])('rejeita %s', expression => expect(() => calculate(expression)).toThrow());
});
