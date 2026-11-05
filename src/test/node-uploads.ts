// jsdom brings its own File/Blob/FormData, and newer Node versions (undici) refuse them inside a Request body.
// The code under test builds FormData for fetch, so give the tests Node's own trio - they only have to agree with each other.
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";

const NodeFormData = (await new Response(new URLSearchParams()).formData()).constructor;
for (const [name, value] of Object.entries({ Blob: NodeBlob, File: NodeFile, FormData: NodeFormData })) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
