import { readFile } from 'node:fs/promises';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Wrapper around the Spice WebAssembly module.
 *
 * The module is stateless: every call gets the complete input as JSON, the memory arena is reset before it, and the answer
 * is JSON again. All calls are synchronous, so a single instance can serve all requests.
 */
export async function loadRuntime(wasmPath) {
  const bytes = await readFile(wasmPath);
  const module = await WebAssembly.compile(bytes);

  let memory;
  const readCString = (ptr) => {
    const view = new Uint8Array(memory.buffer);
    let end = ptr;
    while (view[end] !== 0 && end - ptr < 4096) end++;
    return decoder.decode(view.subarray(ptr, end));
  };
  const instance = await WebAssembly.instantiate(module, {
    env: {
      hostAbort: (messagePtr) => {
        throw new Error(`wasm module aborted: ${readCString(messagePtr)}`);
      },
    },
  });
  const exports = instance.exports;
  memory = exports.memory;
  const heapBase = exports.__heap_base.value;

  return {
    /** Memory consumption of the last call in bytes, for diagnostics */
    lastUsage: 0,

    /**
     * Run one step of a request.
     * @param {object} envelope request, config, time, randomness and the results of earlier effect batches
     * @returns {{response?: object, batch?: object}}
     */
    step(envelope) {
      const input = encoder.encode(JSON.stringify(envelope));
      exports.rackArenaReset(heapBase, memory.buffer.byteLength);
      const ptr = exports.rackAlloc(input.length + 1);
      const target = new Uint8Array(memory.buffer, ptr, input.length + 1);
      target.set(input);
      target[input.length] = 0;
      const outPtr = exports.rackStep(ptr, input.length);
      const outLen = exports.rackOutLength();
      this.lastUsage = exports.rackArenaUsed();
      const text = decoder.decode(new Uint8Array(memory.buffer, outPtr, outLen));
      return JSON.parse(text);
    },
  };
}
