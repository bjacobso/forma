import { acceptProgram } from "../../accept-support.mjs";
import { entryForms, projected, rejectedAt } from "../../hard-support.mjs";
const step = (id, depends=[], timeout=2, attempts=1, manual=false) => `{:id "${id}" :depends [${depends.map(d=>JSON.stringify(d)).join(" ")}] :timeout ${timeout} :attempts ${attempts} :manual ${manual}}`;
export async function accept(dir) {
 const cases = [
  {steps:[], budget:0, order:[], cost:0, problems:[]},
  {steps:[step("z",["b"]),step("b",["a"]),step("c"),step("a")],budget:8,order:["c","a","b","z"],cost:8,problems:[]},
  {steps:[step("a",["b"]),step("b",["a"]),step("c")],budget:6,order:["c"],cost:6,problems:["cycle"]},
  {steps:[step("a",["missing"])],budget:0,order:[],cost:2,problems:["dependencies","budget","cycle"]},
  {steps:[step("x",[],2,2,true)],budget:4,order:["x"],cost:4,problems:["settings"]},
  {steps:[step("a",["a","a"])],budget:2,order:[],cost:2,problems:["dependencies","cycle"]},
  {steps:[step("a"),step("a")],budget:4,order:["a"],cost:4,problems:["ids","cycle"]},
  {steps:[step("  ",[],0)],budget:-1,order:["  "],cost:0,problems:["ids","settings","budget"]},
 ];
 const checks = cases.map(c => {
  const p = `{:steps [${c.steps.join(" ")}] :budget ${c.budget}}`;
  const list = xs => `[${xs.map(x=>JSON.stringify(x)).join(" ")}]`;
  return `(= [(= (cost ${p}) ${c.cost}) (= (order ${p}) ${list(c.order)}) (= (problems ${p}) ${list(c.problems)})] [true true true])`;
 });
 const behavior = await acceptProgram(dir, `(import "./planner.lisp" [cost order problems])
(= [${checks.join(" ")}] [${checks.map(()=>"true").join(" ")}])`);
 const reasons = [...behavior.reasons, ...entryForms(dir,"Workflow",2)];
 reasons.push(...await projected(dir, `(import "./forms.lisp" [workflow])
(workflow test :budget 6 :steps [${step("end",["root"])} ${step("root",[],2,1,true)}])`,
 [{kind:"Workflow",name:"test",cost:4,order:["root","end"]}]));
 reasons.push(...await rejectedAt(dir, `(import "./forms.lisp" [workflow])
(workflow bad :budget 0 :steps [${step("x",["x"])}])`, [{code:"workflow/invalid",token:`[${step("x",["x"])}`}]));
 return {pass:reasons.length===0,reasons};
}
