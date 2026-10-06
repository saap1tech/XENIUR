import {existsSync,readdirSync} from "node:fs";
import {delimiter,join} from "node:path";

/** Search the person's PATH first; optional tools never prevent the application opening. */
export function findExecutable(name:string,override?:string):string {
  if(override)return override;
  const suffixes=process.platform==="win32"?[".exe",".cmd",""]:[""];
  for(const directory of (process.env["PATH"]??"").split(delimiter).filter(Boolean))for(const suffix of suffixes){const candidate=join(directory,name+suffix);if(existsSync(candidate))return candidate;}
  const candidates=process.platform==="darwin"?[`/opt/homebrew/bin/${name}`,`/usr/local/bin/${name}`,...(name==="blender"?["/Applications/Blender.app/Contents/MacOS/Blender"]:[])]:[];
  if(name==="blender"&&process.platform==="win32"){
    for(const base of [process.env["ProgramFiles"],process.env["ProgramFiles(x86)"]].filter((v):v is string=>!!v)){
      try{for(const directory of readdirSync(join(base,"Blender Foundation")).sort().reverse())candidates.push(join(base,"Blender Foundation",directory,"blender.exe"));}catch{/* Optional tool. */}
    }
  }
  if(name==="xelatex"&&process.platform==="darwin"){
    candidates.push("/Library/TeX/texbin/xelatex");
    try{for(const year of readdirSync("/usr/local/texlive").sort().reverse())candidates.push(`/usr/local/texlive/${year}/bin/universal-darwin/xelatex`);}catch{/* TeX is optional. */}
  }
  return candidates.find(existsSync)??name;
}
