import { createRequire } from "node:module";

const jsPath = process.argv[2];
process.argv = [process.execPath, jsPath, '{"op":"version"}'];
const { formaOcaml } = createRequire(import.meta.url)(jsPath);
if (typeof formaOcaml?.handleJson !== "function") throw new Error("Missing OCaml JS handleJson export");
process.on("message", payload => {
  try {
    process.send({ value: JSON.parse(formaOcaml.handleJson(JSON.stringify(payload))) });
  } catch (error) {
    process.send({ error: String(error) });
  }
});
