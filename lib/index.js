const assert = require('assert');
const util = require('util');
const fs = require('fs');

// You can use this to enable debugging info in this file.
const p = () => {}
// const p = console.log;
const i = (...args) => util.inspect(args, {colors:true, depth:null});
const pi = (...args) => p(i(...args));

// By default, use a new seed every 6 hours. This balances making test runs stable while debugging
// with avoiding obscure bugs caused by a rare seed.
const seed = Math.floor(Date.now() / (1000*60*60*6));

const randomReal;
if (seed != null) {
  const mersenne = require('./mersenne');

  mersenne.seed(seed);
  randomReal = (exports.randomReal = mersenne.rand_real);
} else {
  randomReal = (exports.randomReal = Math.random);
}

// Generate a random int 0 <= k < n
const randomInt = exports.randomInt = (n) => Math.floor(randomReal() * n);

// Return a random word from a corpus each time the method is called
const words = fs.readFileSync(__dirname + '/jabberwocky.txt').toString().split(/\W+/);
const randomWord = exports.randomWord = () => words[randomInt(words.length)];

// Cross-transform function. Transform server by client and client by server. Returns
// [server, client].
const transformX = exports.transformX = (type, left, right) => [type.transform(left, right, 'left'), type.transform(right, left, 'right')];

// Transform a list of server ops by a list of client ops.
// Returns [serverOps', clientOps'].
// This is O(serverOps.length * clientOps.length)
const transformLists = exports.transformLists = function(type, serverOps, clientOps) {
  p(`Transforming ${i serverOps} with ${i clientOps}`)
  serverOps = serverOps.map(s => {
    clientOps = clientOps.map(c => {
      p(`X ${i s} by ${i c}`)
      [s, c_] = transformX(type, s, c);
      p(`=> ${i s} by ${i c_}`)
      return c_;
    });
    return s;
  });

  return [serverOps, clientOps];
};

// Compose a whole list of ops together
const composeList = (type, ops) => ops.reduce(type.compose);

// Hax. Apparently this is still the fastest way to deep clone an object,
// assuming we have support for JSON.
//
// This is needed because calling apply() now destroys the original object.
const clone = function(o, type) {
  if (type.serialize) {
    o = type.serialize(o);
  }
  if (typeof o === 'object') {
    o = JSON.parse(JSON.stringify(o));
  }
  if (type.deserialize) {
    o = type.deserialize(o);
  }
  return o;
};

// Returns client result
const testRandomOp = function(type, genRandomOp, initialDoc) {
  let c_s, doc, op, s, s_c, testInvert;
  if (initialDoc == null) { initialDoc = type.create(); }
  const makeDoc = () => ({ops:[], result:initialDoc});
  const opSets = [0, 1, 2].map(makeDoc);
  const [client, client2, server] = opSets;

  for (let i1 = 0; i1 < 2; i1++) {
    doc = opSets[randomInt(3)];
    [op, doc.result] = genRandomOp(doc.result);
    doc.ops.push(op);
  }

  pi('client', client)
  pi('client2', client2)
  pi('server', server)

  const checkSnapshotsEq = (a, b) => {
    if (type.serialize) {
      assert.deepStrictEqual(type.serialize(a), type.serialize(b))
    } else {
      assert.deepStrictEqual(a, b)
    }
  }

  // First, test type.apply.
  p('APPLY')
  for (var set of opSets) {
    s = clone(initialDoc, type);
    for (op of set.ops) { s = type.apply(s, op); }

    try {
      checkSnapshotsEq(s, set.result);
    } catch (error) {
      pi(set)
      throw error;
    }
  }

  // If the type has a shatter function, we should be able to shatter all the
  // ops, apply them and get the same results.
  if (type.shatter) {
    p('SHATTER')
    for (set of opSets) {
      s = clone(initialDoc, type);
      for (op of set.ops) {
        for (let atom of type.shatter(op)) {
          s = type.apply(s, atom);
        }
      }

      checkSnapshotsEq(s, set.result);
    }
  }

  if (type.invert != null) {
    p('INVERT')
    // Invert all the ops and apply them to result. Should end up with initialDoc.
    testInvert = function(doc, ops) {
      if (ops == null) { ({ ops } = doc); }
      let snapshot = clone(doc.result, type);

      // Sadly, coffeescript doesn't seem to support iterating backwards through an array.
      // reverse() reverses an array in-place so it needs to be cloned first.
      ops = doc.ops.slice().reverse();
      for (op of ops) {
        const op_ = type.invert(op);
        snapshot = type.apply(snapshot, op_);
      }

      checkSnapshotsEq(snapshot, initialDoc);
    };

    for (set of opSets) { testInvert(set); }
  }

  if (type.diff != null) {
    p('DIFF')
    const testDiff = function(doc) {
      const op_ = type.diff(clone(initialDoc, type), doc.result);
      const result = type.apply(clone(initialDoc, type), op_);
      checkSnapshotsEq(result, doc.result);
    };

    for (set of opSets) {
      if (doc.ops.length > 0) { testDiff(set); }
    }
  }

  if (type.diffX) {
    const testDiffX = (doc) => {
      const [ op1_, op2_ ] = type.diffX(initialDoc, doc.result)
      const result1 = type.apply(clone(doc.result), op1_)
      const result2 = type.apply(clone(initialDoc), op2_)
      checkSnapshotsEq(result1, initialDoc)
      checkSnapshotsEq(result2, doc.result)
    }

    for (set of opSets) {
      testDiffX(set)
    }
  }

  // If all the ops are composed together, then applied, we should get the same result.
  if (type.compose != null) {
    p('COMPOSE')
    const compose = function(doc) {
      if (doc.ops.length > 0) {
        try {
          doc.composed = composeList(type, doc.ops);
          const actual = type.apply(clone(initialDoc, type), doc.composed);
          pi('initial', initialDoc);
          pi('composing', doc.ops)
          pi('composed', doc.composed)
          pi('composed applied', actual)
          pi('expected', doc.result)
          checkSnapshotsEq(doc.result, actual);
          // .... And this should match the expected document.
        } catch (e) {
          pi('doc', doc)
          throw e;
        }
      }
    };

    for (set of opSets) { compose(set); }

    for (set of opSets) {
      if (set.composed != null) {
        if (typeof testInvert === 'function') {
          testInvert(set, [set.composed]);
        }
      }
    }

    // Check the diamond property holds
    if (client.composed != null && server.composed != null) {
      const [server_, client_] = transformX(type, server.composed, client.composed);

      s_c = type.apply(clone(server.result, type), client_);
      c_s = type.apply(clone(client.result, type), server_);

      // Interestingly, these will not be the same as s_c and c_s above.
      // Eg, when:
      //  server.ops = [ [ { d: 'x' } ], [ { i: 'c' } ] ]
      //  client.ops = [ 1, { i: 'b' } ]
      pi('initial', initialDoc);
      pi('server delta', server.composed)
      pi('client delta', client.composed)
      pi('server delta xfmd', server_)
      pi('client delta xfmd', client_)
      pi('server then client', s_c)
      pi('client then server', c_s)
      checkSnapshotsEq(s_c, c_s);

      if (type.tp2) {
        // This is an interesting property which I don't think is strictly
        // enforced by the TP2 property, but which my text-tp2 type holds. I'm
        // curious if this will hold for any TP2 type.
        //
        // Given X, [A,B] based on a document, I'm testing if:
        //  T(T(x, A), B) == T(x, A.B).
        //
        // Because this holds, it is possible to collapse intermediate ops
        // without effecting the OT code.
        let x1 = server.composed;
        for (let c of client.ops) { x1 = type.transform(x1, c, 'left'); }

        let x2 = server.composed;
        x2 = type.transform(x2, client.composed, 'left');

        assert.deepStrictEqual(x1, x2);
      }

      if (type.tp2 && (client2.composed != null)) {
        // TP2 requires that T(op3, op1 . T(op2, op1)) == T(op3, op2 . T(op1, op2)).
        const lhs = type.transform(client2.composed, type.compose(client.composed, server_), 'left');
        const rhs = type.transform(client2.composed, type.compose(server.composed, client_), 'left');

        assert.deepStrictEqual(lhs, rhs);
      }
    }
  }

  if (type.prune != null) {
    p('PRUNE')

    const [op1] = genRandomOp(initialDoc);
    const [op2] = genRandomOp(initialDoc);

    for (let idDelta of ['left', 'right']) {
      const op1_ = type.transform(op1, op2, idDelta);
      const op1_pruned = type.prune(op1_, op2, idDelta);

      assert.deepStrictEqual(op1, op1_pruned);
    }
  }

  // Now we'll check the n^2 transform method.
  if (false && client.ops.length > 0 && server.ops.length > 0) {
    p('TRANSFORM LIST')
    p(`s ${i(server.result)} c ${i(client.result)} XF ${i(server.ops)} x ${i(client.ops)}`)
    const [s_, c_] = transformLists(type, server.ops, client.ops);
    p(`XF result -> ${i(s_)} x ${i(c_)}`)
    p(`applying ${i(c_)} to ${i(server.result)}`)
    s_c = c_.reduce(type.apply, clone(server.result, type));
    p(`applying ${i s_} to ${i client.result}`)
    c_s = s_.reduce(type.apply, clone(client.result, type));

    checkSnapshotsEq(s_c, c_s);

    // ... And we'll do a round-trip using invert().
    if (type.invert != null) {
      const c_inv = c_.slice().reverse().map(type.invert);
      const server_result_ = c_inv.reduce(type.apply, clone(s_c, type));
      checkSnapshotsEq(server.result, server_result_);
      const orig_ = server.ops.slice().reverse().map(type.invert).reduce(type.apply, server_result_);
      checkSnapshotsEq(orig_, initialDoc);
    }
  }

  return client.result;
};

const collectStats = function(type) {
  const functions = ['transform', 'compose', 'apply', 'prune'];

  const orig = {};
  for (var fn of functions) {
    if (type[fn] != null) { orig[fn] = type[fn]; }
  }
  const restore = () => {
    for (fn of functions) {
      if (orig[fn] != null) { type[fn] = orig[fn]; }
    }
  }

  const stats = {};
  for (fn of functions) {
    if (orig[fn] != null) { stats[fn] = 0; }
  }

  const collect = (fn) => (...args) => {
    stats[fn]++;
    return orig[fn].apply(null, args);
  };

  for (fn of functions) {
    if (orig[fn] != null) { type[fn] = collect(fn); }
  }

  return [stats, restore];
};

// Run some iterations of the random op tester. Requires a random op generator for the type.
module.exports = function(type, genRandomOp, iterations) {
  if (iterations == null) { iterations = 2000; }
  assert.ok(type.transform);

  const [stats, restore] = collectStats(type);

  console.error(`   Running ${iterations} randomized tests for type ${type.name}...`);
  if (seed != null) { console.error(`     (seed: ${seed})`); }

  const warnUnless = (fn) => {
    if (type[fn] == null) {
      console.error(`NOTE: Not running ${fn} tests because ${type.name} does not have ${fn}() defined`);
    }
  };
  warnUnless('invert');
  warnUnless('compose');

  let doc = type.create();

  console.time('randomizer');
  const iterationsPerPct = iterations / 100;
  for (let n = 0, end = iterations, asc = 0 <= end; asc ? n <= end : n >= end; asc ? n++ : n--) {
    if ((n % (iterationsPerPct * 2)) === 0) {
      process.stdout.write(((n % (iterationsPerPct * 10)) === 0 ? `${n / iterationsPerPct}` : '.'));
    }
    p('ITERATION', n)
    doc = testRandomOp(type, genRandomOp, doc);
  }
  console.log();

  console.timeEnd('randomizer');

  console.log("Performed:");
  for (let fn in stats) {
    const number = stats[fn]; console.log(`\t${fn}s: ${number}`);
  }

  return restore();
};

Object.assign(module.exports, exports);
