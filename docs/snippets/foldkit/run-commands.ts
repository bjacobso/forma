export const BeginRun = Command.define("RunFormaWithApproval", {
  args: { basis: Analysis, token: S.Number },
  messages: [Message.Ran, Message.FailedRun],
  execute: ({ basis, token }) =>
    startRun(basis, token).pipe(
      Effect.map((outcome) => Message.Ran({ outcome })),
      Effect.catch((reason) => Effect.succeed(Message.FailedRun({ token, reason }))),
    ),
});
export const ResumeRun = Command.define("ResumeApprovedFormaCall", {
  args: { run: RunOutcome, basis: Analysis, allow: S.Boolean },
  messages: [Message.Ran, Message.FailedRun],
  execute: ({ run, basis, allow }) =>
    resumeRun(run, basis, allow).pipe(
      Effect.map((outcome) => Message.Ran({ outcome })),
      Effect.catch((reason) => Effect.succeed(Message.FailedRun({ token: run.token, reason }))),
    ),
});
