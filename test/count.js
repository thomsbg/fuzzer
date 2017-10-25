/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// This is a simple test for the fuzzer, using a trivial OT type. The type
// is correct - we should add tests where types are not correct get caught by
// the fuzzer.

const fuzzer = require('../lib');

// Each op is [expectedSnapshot, increment].
const count = {};
count.name = 'count';
count.create = () => 1;

count.apply = function(snapshot, op) {
  const [v, inc] = op;
  if (snapshot !== v) { throw new Error(`Op ${v} != snapshot ${snapshot}`); }
  return snapshot + inc;
};

count.transform = function(op1, op2) {
  if (op1[0] !== op2[0]) { throw new Error(`Op1 ${op1[0]} != op2 ${op2[0]}`); }
  return [op1[0] + op2[1], op1[1]];
};

count.compose = function(op1, op2) {
  if ((op1[0] + op1[1]) !== op2[0]) { throw new Error(`Op1 ${op1} + 1 != op2 ${op2}`); }
  return [op1[0], op1[1] + op2[1]];
};

const genOp = doc => [[doc, 1], doc + 1];


describe('type count', () =>
  it('should pass the randomizer tests', function() {
    this.slow(200);
    return fuzzer(count, genOp);
  })
);
