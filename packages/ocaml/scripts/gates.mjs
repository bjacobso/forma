export const corpusGolden = {
  "moduleCounts": {
    "bizops": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "bookstore": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "chronicle": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "company": {
      "sourceCount": 1,
      "declarationCount": 7
    },
    "compiler-debug": {
      "sourceCount": 8,
      "declarationCount": 15
    },
    "dataroom": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "dnd": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "family": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "fantasy": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "hr": {
      "sourceCount": 1,
      "declarationCount": 6
    },
    "insurance": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "labor-union": {
      "sourceCount": 11,
      "declarationCount": 106
    },
    "law-firm": {
      "sourceCount": 10,
      "declarationCount": 165
    },
    "movies": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "performance-reviews": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "real-estate": {
      "sourceCount": 1,
      "declarationCount": 5
    },
    "staffing": {
      "sourceCount": 14,
      "declarationCount": 180
    },
    "teams": {
      "sourceCount": 1,
      "declarationCount": 7
    },
    "todo-app": {
      "sourceCount": 1,
      "declarationCount": 7
    }
  },
  "sourceCount": 58,
  "emittedCount": 58,
  "declarationCount": 548,
  "kindCounts": {
    "Action": 49,
    "Constraint": 23,
    "Document": 10,
    "DocumentLocale": 11,
    "DocumentLocalized": 7,
    "Entity": 62,
    "ErrorDef": 3,
    "HttpApi": 1,
    "Link": 97,
    "PdfMapping": 1,
    "Process": 5,
    "Query": 60,
    "Record": 138,
    "Relation": 28,
    "SchemaDef": 2,
    "TaskDefinition": 4,
    "View": 38,
    "Workspace": 9
  },
  "manifestHash": "20b5cbb227e240b9df6e0d9f4440a869e872afb45a7fa2833791b66aa899c93a"
};

export const architectureThresholds = {
  expectedSourceCount: corpusGolden.moduleCounts.staffing.sourceCount + 1,
  expectedDeclarationCount: corpusGolden.moduleCounts.staffing.declarationCount + 33,
  maxDiagnosticCount: 0,
  maxWasmBrotliBytes: 8 * 1024 * 1024,
  maxJsGzipBytes: 600_000,
  maxWasmGzipBytes: 750_000,
  maxNativeStartupMs: 2_000,
  maxJsStartupMs: 2_000,
  maxWasmStartupMs: 500,
  maxNativeEvalLatencyAvgMs: 50,
  maxJsEvalLatencyAvgMs: 250,
  maxWasmEvalLatencyAvgMs: 250,
  maxCorpusLoadAndSummarizeMs: 15_000,
};
