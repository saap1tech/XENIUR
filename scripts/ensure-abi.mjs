/** SQLite 13 and Sharp use portable Node-API bindings. Verify them in the actual runtime.
 * Rebuilding every switch between Node and Electron is unnecessary and can break clean installs.
 */
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
if(Number(process.versions.node.split('.')[0])<22||Number(process.versions.napi)<10){
 console.error("XENIUR requires Node.js 22.14 or newer with Node-API 10. Run nvm use 22, then npm ci.");process.exit(1);
}
const target=process.argv[2];if(!["node","electron"].includes(target)){console.error("usage: ensure-abi.mjs node|electron");process.exit(1);}
const code=`const Database=require(${JSON.stringify(require.resolve("better-sqlite3"))});const db=new Database(':memory:');if(db.prepare('select 1 as ok').get().ok!==1)throw Error('SQLite check failed');db.close();require(${JSON.stringify(require.resolve("sharp"))});`;
try{
 execFileSync(target==='electron'?require('electron'):process.execPath,['--eval',code],{stdio:'inherit',env:{...process.env,...(target==='electron'?{ELECTRON_RUN_AS_NODE:'1'}:{})}});
}catch{console.error("Native dependency verification failed. Restore the platform packages with npm ci before starting XENIUR.");process.exit(1);}
