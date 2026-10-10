  {
    name: "Chat.post",
    arity: 2,
    purity: "write",
    description: "Posts a message to a chat channel.",
    typeScheme: {
      kind: "function",
      params: [
        { kind: "type", name: "String" },
        { kind: "type", name: "String" },
      ],
      result: { kind: "type", name: "Unit" },
    },
    perform: ([channel, message]) =>
      Effect.sync(() => {
        posted.push(`${text(channel)}: ${text(message)}`);
        return { kind: "nil" } as const;
      }),
  },
