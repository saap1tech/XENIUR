import {createRequire} from "node:module";
import {dirname,join} from "node:path";
import {createWorker,OEM,type Worker} from "tesseract.js";

const require=createRequire(import.meta.url);
const unpack=(path:string)=>path.replace(/app\.asar([\\/])/g,"app.asar.unpacked$1");
/** Bundled English OCR: no CDN, remote inference, or document upload. One worker per import. */
export async function createLocalOcr():Promise<Worker>{
  return createWorker("eng",OEM.LSTM_ONLY,{
    workerPath:unpack(require.resolve("tesseract.js/src/worker-script/node/index.js")),
    langPath:unpack(join(dirname(require.resolve("@tesseract.js-data/eng")),"4.0.0")),
    cacheMethod:"none",gzip:true,
    errorHandler:()=>{},
  });
}
