// A bounded arithmetic parser: never evaluates JavaScript or executes user code.
export function calculate(expression: string): number {
  if (expression.length > 160) throw new Error('Use uma expressão com até 160 caracteres.');
  const source = expression.replace(/,/g, '.').replace(/\s/g, '');
  const tokens = source.match(/\d+(?:\.\d+)?|\.\d+|[()+\-*/]/g) ?? [];
  if (!tokens.length || tokens.join('') !== source) throw new Error('Use apenas números, parênteses e +, −, * ou /.');
  let position = 0;
  const peek = () => tokens[position];
  const atom = (): number => {
    const token = tokens[position++];
    if (token === '+') return atom();
    if (token === '-') return -atom();
    if (token === '(') {
      const value = sum();
      if (tokens[position++] !== ')') throw new Error('Confira os parênteses da expressão.');
      return value;
    }
    if (!token || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) throw new Error('A expressão está incompleta.');
    return Number(token);
  };
  const product = (): number => {
    let result = atom();
    while (peek() === '*' || peek() === '/') {
      const operator = tokens[position++];
      const next = atom();
      if (operator === '/' && next === 0) throw new Error('Não é possível dividir por zero.');
      result = operator === '*' ? result * next : result / next;
    }
    return result;
  };
  const sum = (): number => {
    let result = product();
    while (peek() === '+' || peek() === '-') {
      const operator = tokens[position++];
      const next = product();
      result = operator === '+' ? result + next : result - next;
    }
    return result;
  };
  const result = sum();
  if (position !== tokens.length) throw new Error('Confira os operadores da expressão.');
  if (!Number.isFinite(result)) throw new Error('O resultado excede o limite permitido.');
  return Number(result.toPrecision(12));
}
