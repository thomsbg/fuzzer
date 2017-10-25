import * as fuzzer from './index';
// Assign all named exports as properties of the default export
Object.assign(fuzzer.default, fuzzer)
// Delete circular reference
delete fuzzer.default.default;
module.exports = fuzzer.default;
