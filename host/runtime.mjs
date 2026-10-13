import { readFile } from 'node:fs/promises';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Wrapper around the Spice WebAssembly module.
 *
 * The module is stateless: every call gets the complete input as JSON, the memory arena is reset before it, and the answer
 * is JSON again. All calls are synchronous, so a single instance can serve all requests.
 *
 * The templates are copied into the module's memory once, right behind the static data. The arena that is reset before
 * each call starts after them, so they survive.
 *
 * @param {string} wasmPath
 * @param {Buffer} templates  see templates.mjs
 */
export async function loadRuntime(wasmPath, templates) {
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

  // Templates
  const templatesAddress = (heapBase + 15) & ~15;
  const arenaStart = (templatesAddress + templates.length + 15) & ~15;
  if (arenaStart + 1024 * 1024 > memory.buffer.byteLength) throw new Error('templates do not fit into the wasm memory');
  new Uint8Array(memory.buffer, templatesAddress, templates.length).set(templates);
  exports.rackSetTemplates(templatesAddress, templates.length);

  const readOutput = (outPtr) => decoder.decode(new Uint8Array(memory.buffer, outPtr, exports.rackOutLength()));

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
      exports.rackArenaReset(arenaStart, memory.buffer.byteLength);
      const ptr = exports.rackAlloc(input.length + 1);
      const target = new Uint8Array(memory.buffer, ptr, input.length + 1);
      target.set(input);
      target[input.length] = 0;
      const outPtr = exports.rackStep(ptr, input.length);
      const text = readOutput(outPtr);
      this.lastUsage = exports.rackArenaUsed();
      return JSON.parse(text);
    },

    /** Syntax problems of the templates, one per line; empty if they are fine */
    templateErrors() {
      exports.rackArenaReset(arenaStart, memory.buffer.byteLength);
      return readOutput(exports.rackTemplateErrors()).trim();
    },
  };
}
