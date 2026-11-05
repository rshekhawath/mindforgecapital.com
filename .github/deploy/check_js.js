/* Second opinion on build_site.py's comment stripping: every script must read as
   the same sequence of tokens before and after. Uses the acorn parser that ships
   inside Node (hence --expose-internals), so nothing is downloaded. If this Node
   no longer exposes it, falls back to asking V8 whether the stripped script still
   parses, and says so in the result.
   Usage: node --expose-internals check_js.js <scripts.json> <result.json> */
"use strict";
const fs = require("fs");
const vm = require("vm");

let acorn = null;
try { acorn = require("internal/deps/acorn/acorn/dist/acorn"); } catch (e) { /* see above */ }

function tokens(code, sourceType) {
  const out = [];
  acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType,
    allowReturnOutsideFunction: true,
    allowHashBang: true,
    onToken(t) {
      const v = t.value;
      const shown = v && typeof v === "object" ? (v.pattern + "/" + v.flags) : String(v);
      out.push(t.type.label + "\u0000" + shown);
    },
  });
  return out;
}

function tokensEither(code) {
  try { return tokens(code, "script"); } catch (e) { return tokens(code, "module"); }
}

function parsesInV8(code) {
  try { new vm.Script(code); return true; } catch (e) { return !(e instanceof SyntaxError); }
}

const pairs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const bad = [];
let compared = 0;
for (const p of pairs) {
  if (p.before === p.after) continue;
  if (!acorn) {
    if (parsesInV8(p.before) && !parsesInV8(p.after)) bad.push({ file: p.file, i: p.i, why: "stops parsing once stripped" });
    compared++;
    continue;
  }
  let before;
  try { before = tokensEither(p.before); } catch (e) {
    // The original is beyond this parser. Only a script V8 still accepts may ship stripped.
    if (parsesInV8(p.before) && !parsesInV8(p.after)) bad.push({ file: p.file, i: p.i, why: "stops parsing once stripped" });
    compared++;
    continue;
  }
  compared++;
  let after;
  try { after = tokensEither(p.after); } catch (e) {
    bad.push({ file: p.file, i: p.i, why: "stops parsing once stripped: " + e.message });
    continue;
  }
  const same = before.length === after.length && before.every((t, k) => t === after[k]);
  if (!same) bad.push({ file: p.file, i: p.i, why: "tokens differ once stripped" });
}
fs.writeFileSync(process.argv[3], JSON.stringify({ parser: acorn ? "acorn" : "v8-syntax-only", checked: compared, bad }));
console.log("check_js: " + compared + " scripts compared with " + (acorn ? "acorn" : "V8 syntax only") + ", " + bad.length + " failed");
